import os
import json
import asyncio
import uuid
import httpx
from fastapi import FastAPI, HTTPException, Request, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import create_engine, text
from cortex.flow import KnowledgeFlow
from cryptography.fernet import Fernet
import bcrypt
from datetime import datetime, timedelta
from jose import jwt

app = FastAPI(
    title="MyCrew API",
    description="Backend do MyCrew - Gerenciamento de modelos de IA",
    version="0.1.0",
)

# CORS middleware - permite requisições do frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8081"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Include routers for modular organization
try:
    from routers import auth_router, models_router
    app.include_router(auth_router, prefix="/auth")
    app.include_router(models_router, prefix="/me/models")
except Exception:
    pass  # Fallback to original endpoints in main.py

# Configurações via ambiente
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_REQUEST_TIMEOUT = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "30"))
OLLAMA_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "mycrew_agent_kb")
JWT_SECRET = os.getenv("JWT_SECRET", "mycrew-jwt-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Database configuration - uses POSTGRES_* env vars directly
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_USER = os.getenv("POSTGRES_USER", "mycrew")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
POSTGRES_DB = os.getenv("POSTGRES_DB", "mycrew")

# Build DATABASE_URL from component parts
DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}")

# Crypto key for API encryption
CRYPTO_KEY = os.getenv("MYCREW_CRYPTO_KEY", "tYYqiZd89uNTfzGsdudmuKGAd1aBTROyAVpet8u7WEs=")
cipher = Fernet(CRYPTO_KEY)


def encrypt_api_key(api_key: str) -> bytes:
    return cipher.encrypt(api_key.encode())


def decrypt_api_key(encrypted) -> str:
    # Handle different types returned by PostgreSQL (memoryview, bytearray, etc.)
    # Debug: log type for troubleshooting
    # print(f"DEBUG: decrypt_api_key type={type(encrypted)}, value={repr(encrypted)[:100]}")
    
    if encrypted is None:
        raise ValueError("api_key_encrypted is None")
    
    # Convert buffer types to bytes
    if isinstance(encrypted, memoryview):
        encrypted = bytes(encrypted)
    elif isinstance(encrypted, bytearray):
        encrypted = bytes(encrypted)
    elif isinstance(encrypted, str):
        # If somehow stored as base64 string
        import base64
        try:
            encrypted = base64.b64decode(encrypted)
        except Exception:
            raise ValueError(f"api_key_encrypted is invalid string: {encrypted[:50]}...")
    elif isinstance(encrypted, bytes):
        pass  # Already bytes, proceed
    else:
        raise ValueError(f"api_key_encrypted has unexpected type: {type(encrypted)}")
    
    # Check if empty after conversion
    if len(encrypted) == 0:
        raise ValueError("api_key_encrypted is empty")
    
    return cipher.decrypt(encrypted).decode()


engine = create_engine(DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://"), echo=False)


# ============== Auth Models ==============

class LoginPayload(BaseModel):
    username: str
    password: str


class RegisterPayload(BaseModel):
    username: str
    password: str


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_token(user_id: str, username: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "role": role,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(request: Request) -> dict:
    """Extract user from JWT token in Authorization header"""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token de autenticação não fornecido")
    
    token = auth_header.replace("Bearer ", "")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"id": payload["sub"], "username": payload["username"], "role": payload["role"]}
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")


# ============== Payloads ==============

class CreateModelPayload(BaseModel):
    providerSlug: str
    modelName: str


class CreateAgentPayload(BaseModel):
    name: str
    description: Optional[str] = None
    avatarUrl: Optional[str] = None
    modelId: str
    modelName: Optional[str] = None
    tags: list[str] = []
    prompt: str
    skills: list[str] = []
    knowledge: list[str] = []


class ProviderConfigPayload(BaseModel):
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None


def formatSize(bytes_size: int) -> str:
    if bytes_size >= 1024**3:
        return f"{bytes_size / (1024**3):.1f} GB"
    elif bytes_size >= 1024**2:
        return f"{bytes_size / (1024**2):.0f} MB"
    elif bytes_size >= 1024:
        return f"{bytes_size / 1024:.0f} KB"
    return f"{bytes_size} B"


def formatContext(context_length: int) -> str:
    """Format context length to human readable string (e.g., 128K, 2M)"""
    if context_length >= 1024 * 1024:
        return f"{context_length / (1024 * 1024):.0f}M"
    elif context_length >= 1024:
        return f"{context_length / 1024:.0f}K"
    return f"{context_length}"


def getModelKind(name: str) -> Optional[str]:
    name_lower = name.lower()
    if "embed" in name_lower:
        return "embedding"
    if "vision" in name_lower or "visual" in name_lower:
        return "vision"
    return "chat"


async def fetchModelInfoOpenRouter(base_url: str, api_key: str, model_name: str) -> dict:
    """Fetch model metadata from OpenRouter API"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # OpenRouter uses OpenAI-compatible API
            response = await client.get(
                f"{base_url}/v1/models",
                headers={"Authorization": f"Bearer {api_key}"}
            )
            if response.status_code != 200:
                return {}
            
            data = response.json()
            models = data.get("data", [])
            
            # Find matching model
            for model in models:
                if model.get("id") == model_name or model.get("name", "").lower() == model_name.lower():
                    context_length = model.get("context_length", 8192)
                    return {
                        "kind": getModelKind(model_name),
                        "context": formatContext(context_length)
                    }
            
            # Model not found in list, but still return kind based on name
            return {
                "kind": getModelKind(model_name),
                "context": "8K"
            }
    except Exception:
        return {}


def _generate_model_id() -> str:
    """Generate a unique model ID"""
    import uuid
    return str(uuid.uuid4())


def get_db_connection():
    return engine.connect()


import logging
_logger = logging.getLogger(__name__)


def _query_user_providers_with_models(conn, user_id: str) -> dict:
    """Query providers with user's configurations and models - includes usage stats from providers_usage table"""
    try:
        # Get base providers data
        result = conn.execute(text("""
            WITH user_configs AS (
                SELECT provider_id, base_url, api_key_encrypted, models
                FROM user_provider_configs
                WHERE user_id = :user_id AND is_active = TRUE
            ),
            local_providers AS (
                SELECT p.id, p.name, p.type, p.slug, p.config
                FROM providers p
                WHERE p.type = 'local' AND p.is_active = TRUE
            )
            SELECT jsonb_build_object(
                'providers', COALESCE(jsonb_agg(p_obj ORDER BY p_obj->>'name'), '[]'::jsonb),
                'totalModels', (SELECT COUNT(*) FROM models m 
                               JOIN providers p ON p.id = m.provider_id 
                               WHERE m.user_id = :user_id)
            )
            FROM (
                SELECT jsonb_build_object(
                    'id', p.id::text,
                    'name', p.name,
                    'type', p.type,
                    'slug', p.slug,
                    'config', p.config,
                    'hasApiKey', TRUE,
                    'baseUrl', upc.base_url,
                    'models', COALESCE(upc.models, '[]'::jsonb)
                ) AS p_obj
                FROM providers p
                JOIN user_configs upc ON p.id = upc.provider_id
                WHERE p.type = 'api'
                
                UNION ALL
                
                SELECT jsonb_build_object(
                    'id', lp.id::text,
                    'name', lp.name,
                    'type', lp.type,
                    'slug', lp.slug,
                    'config', lp.config,
                    'hasApiKey', FALSE,
                    'baseUrl', COALESCE(upc.base_url, 'http://ollama:11434'),
                    'models', (
                        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                            'id', om.id::text,
                            'name', om.name,
                            'status', om.status,
                            'kind', om.kind,
                            'size', om.size,
                            'context', om.context,
                            'usage', (
                                SELECT jsonb_build_object(
                                    'requests', COALESCE(usg.requests, 0)::INTEGER,
                                    'tokens', COALESCE(usg.tokens, 0)::INTEGER,
                                    'avgLatencyMs', COALESCE(usg.avg_latency, 0)::INTEGER,
                                    'daily', '[]'::jsonb
                                )
                            ),
                            'created_at', to_char(om.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                            'updated_at', to_char(om.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                        )), '[]'::jsonb)
                        FROM models om
                        LEFT JOIN (
                            SELECT 
                                model_id,
                                COUNT(*) as requests,
                                SUM(total_tokens) as tokens,
                                ROUND(AVG(latency_ms))::INTEGER as avg_latency
                            FROM providers_usage 
                            WHERE user_id = :user_id AND created_at >= now() - interval '7 days'
                            GROUP BY model_id
                        ) usg ON usg.model_id = om.id
                        WHERE om.user_id = :user_id AND om.provider_id = lp.id
                    )
                ) AS p_obj
                FROM local_providers lp
                LEFT JOIN user_configs upc ON lp.id = upc.provider_id
            ) sub;
        """), {"user_id": user_id}).fetchone()
        if result and result[0]:
            return result[0]
    except Exception as e:
        _logger.warning(f"[Models] Error in query: {e}")
    
    return {"providers": [], "totalModels": 0}


def _get_provider_config_for_user(conn, user_id: str, provider_id: str) -> tuple:
    """Get user provider config, auto-creating for local providers if needed"""
    # Check if user has configured this provider
    user_config = conn.execute(text("""
        SELECT id, base_url, api_key_encrypted, models FROM user_provider_configs 
        WHERE user_id = :user_id AND provider_id = :provider_id
    """), {"user_id": user_id, "provider_id": provider_id}).fetchone()
    
    if not user_config:
        # Check if provider is local type for auto-creation
        provider = conn.execute(text("""
            SELECT type FROM providers WHERE id = :provider_id
        """), {"provider_id": provider_id}).fetchone()
        
        if provider and provider[0] == 'local':
            ollama_base_url = conn.execute(text("""
                SELECT base_url FROM user_provider_configs upc
                JOIN providers p ON p.id = upc.provider_id
                WHERE p.slug = 'ollama' AND upc.user_id = :user_id
            """), {"user_id": user_id}).fetchone()
            
            conn.execute(text("""
                INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active, models)
                VALUES (:user_id, :provider_id, :base_url, TRUE, '[]'::jsonb)
                ON CONFLICT (user_id, provider_id) DO NOTHING
            """), {
                "user_id": user_id,
                "provider_id": provider_id,
                "base_url": ollama_base_url[0] if ollama_base_url else OLLAMA_URL
            })
            conn.commit()
            
            # Fetch again
            user_config = conn.execute(text("""
                SELECT id, base_url, api_key_encrypted, models FROM user_provider_configs 
                WHERE user_id = :user_id AND provider_id = :provider_id
            """), {"user_id": user_id, "provider_id": provider_id}).fetchone()
    
    return user_config


def _add_model_to_user_config(conn, user_id: str, provider_id: str, model_data: dict):
    """Add a model to the user_provider_configs JSONB models array"""
    # Get current models
    user_config = conn.execute(text("""
        SELECT models FROM user_provider_configs 
        WHERE user_id = :user_id AND provider_id = :provider_id
    """), {"user_id": user_id, "provider_id": provider_id}).fetchone()
    
    current_models = list(user_config[0]) if user_config and user_config[0] else []
    
    # Check if model already exists
    if any(m.get('name') == model_data['name'] for m in current_models):
        return False  # Model already exists
    
    # Add new model
    current_models.append(model_data)
    
    conn.execute(text("""
        UPDATE user_provider_configs 
        SET models = :models
        WHERE user_id = :user_id AND provider_id = :provider_id
    """), {
        "user_id": user_id,
        "provider_id": provider_id,
        "models": json.dumps(current_models)
    })
    
    return True


# ============== Auth Endpoints ==============

@app.post("/auth/login")
async def login(payload: LoginPayload):
    try:
        with get_db_connection() as conn:
            result = conn.execute(text("""
                SELECT id, username, password_hash, role FROM users WHERE username = :username
            """), {"username": payload.username}).fetchone()
            
            if not result:
                raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
            
            user_id, username, password_hash, role = result
            
            if not verify_password(payload.password, password_hash):
                raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
            
            token = create_token(str(user_id), username, role)
            return {"token": token, "user": {"id": str(user_id), "username": username, "role": role}}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao autenticar: {str(e)}")


@app.post("/auth/register")
async def register(payload: RegisterPayload):
    try:
        with get_db_connection() as conn:
            existing = conn.execute(text("SELECT id FROM users WHERE username = :username"), 
                                   {"username": payload.username}).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="Nome de usuário já existe")
            
            password_hash = hash_password(payload.password)
            user_id = conn.execute(text("""
                INSERT INTO users (username, password_hash, role)
                VALUES (:username, :password_hash, 'user')
                RETURNING id
            """), {"username": payload.username, "password_hash": password_hash}).scalar()
            
            conn.commit()
            return {"message": "Usuário criado com sucesso", "id": str(user_id)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao registrar usuário: {str(e)}")


@app.get("/auth/me")
async def get_current_user_info(request: Request):
    user = get_current_user(request)
    return {"user": user}


# ============== Providers Endpoints ==============

@app.get("/providers")
async def get_providers():
    """List all available provider templates (no auth required for listing)"""
    try:
        with get_db_connection() as conn:
            result = conn.execute(text("""
                SELECT jsonb_agg(jsonb_build_object(
                    'id', p.id::text,
                    'name', p.name,
                    'type', p.type,
                    'slug', p.slug,
                    'config', p.config
                ) ORDER BY p.name)
                FROM providers p
                WHERE p.is_active = TRUE
            """)).fetchone()
            providers = result[0] if result and result[0] else []
            return {"providers": providers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar provedores: {str(e)}")


@app.post("/me/providers/{provider_slug}/configure")
async def configure_provider(
    provider_slug: str, 
    payload: ProviderConfigPayload,
    request: Request
):
    """Configure a provider for the current user (save API key and base_url)"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            # Verify provider exists
            provider = conn.execute(text("""
                SELECT id, config FROM providers WHERE slug = :slug
            """), {"slug": provider_slug}).fetchone()
            
            if not provider:
                raise HTTPException(status_code=404, detail=f"Provedor '{provider_slug}' não encontrado")
            
            provider_id = provider[0]
            config = provider[1] or {}
            
            # Validate required fields based on provider config
            requires_base_url = config.get("requires_base_url", False)
            requires_api_key = config.get("requires_api_key", False)
            
            if requires_base_url and not payload.baseUrl:
                raise HTTPException(status_code=400, detail="URL base é obrigatória para este provedor")
            
            if requires_api_key and not payload.apiKey:
                raise HTTPException(status_code=400, detail="API key é obrigatória para este provedor")
            
            # Insert or update user provider config (initialize models as empty array if not exists)
            conn.execute(text("""
                INSERT INTO user_provider_configs (user_id, provider_id, base_url, api_key_encrypted, models, is_active)
                VALUES (:user_id, :provider_id, :base_url, :api_key, '[]'::jsonb, TRUE)
                ON CONFLICT (user_id, provider_id) 
                DO UPDATE SET base_url = EXCLUDED.base_url, 
                              api_key_encrypted = EXCLUDED.api_key_encrypted,
                              is_active = TRUE
            """), {
                "user_id": user["id"],
                "provider_id": provider_id,
                "base_url": payload.baseUrl,
                "api_key": encrypt_api_key(payload.apiKey) if payload.apiKey else None
            })
            
            conn.commit()
            return {"message": f"Provedor '{provider_slug}' configurado com sucesso"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao configurar provedor: {str(e)}")


@app.get("/me/providers/{provider_slug}/models")
async def get_provider_models(provider_slug: str, request: Request):
    """Get available models from a provider API or local Ollama instance"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            # Get provider info
            provider = conn.execute(text("""
                SELECT p.id, p.slug, p.type, p.config FROM providers p WHERE p.slug = :slug
            """), {"slug": provider_slug}).fetchone()
            
            if not provider:
                raise HTTPException(status_code=404, detail=f"Provedor '{provider_slug}' não encontrado")
            
            provider_type = provider[2]
            
            # For local providers (like Ollama), auto-create config if not exists and use default URL
            if provider_type == 'local':
                user_config = conn.execute(text("""
                    SELECT id, base_url FROM user_provider_configs 
                    WHERE user_id = :user_id AND provider_id = :provider_id
                """), {"user_id": user["id"], "provider_id": provider[0]}).fetchone()
                
                base_url = OLLAMA_URL  # Use default Ollama URL
                
                if not user_config:
                    # Auto-create config for local provider
                    conn.execute(text("""
                        INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active, models)
                        VALUES (:user_id, :provider_id, :base_url, TRUE, '[]'::jsonb)
                        ON CONFLICT (user_id, provider_id) DO NOTHING
                    """), {
                        "user_id": user["id"],
                        "provider_id": provider[0],
                        "base_url": base_url
                    })
                    conn.commit()
                elif user_config[1]:
                    base_url = user_config[1]
            else:
                # Get user's config for API providers
                user_config = conn.execute(text("""
                    SELECT base_url, api_key_encrypted FROM user_provider_configs 
                    WHERE user_id = :user_id AND provider_id = :provider_id
                """), {"user_id": user["id"], "provider_id": provider[0]}).fetchone()
                
                if not user_config:
                    raise HTTPException(status_code=400, detail="Configure o provedor antes de buscar modelos")
                
                base_url = user_config[0]
                if not base_url:
                    base_url = "https://openrouter.ai/api"  # Default for OpenRouter
                
                api_key_encrypted = user_config[1]
                if isinstance(api_key_encrypted, (memoryview, bytearray)):
                    api_key_encrypted = bytes(api_key_encrypted)
                
                if not api_key_encrypted or len(api_key_encrypted) == 0:
                    raise HTTPException(status_code=400, detail="API key não configurada para este provedor")
                
                api_key = decrypt_api_key(api_key_encrypted)
            
            # Fetch models from provider
            try:
                async with httpx.AsyncClient(timeout=OLLAMA_REQUEST_TIMEOUT) as client:
                    if provider_type == 'local':
                        # Local providers (Ollama) use /api/tags endpoint
                        response = await client.get(f"{base_url}/api/tags")
                        
                        if response.status_code != 200:
                            raise HTTPException(status_code=502, detail=f"Erro no provedor local: status {response.status_code}")
                        
                        data = response.json()
                        models = data.get("models", [])
                        
                        # Format Ollama model list
                        formatted_models = [
                            {
                                "id": m.get("name"),
                                "name": m.get("name"),
                                "description": m.get("name", ""),
                                "size": formatSize(m.get("size", 0)),
                                "context": str(m.get("details", {}).get("context_length", "8K") if m.get("details") else "8K")
                            }
                            for m in models
                        ]
                    else:
                        # API providers use /v1/models endpoint
                        response = await client.get(
                            f"{base_url}/v1/models",
                            headers={"Authorization": f"Bearer {api_key}"}
                        )
                        
                        if response.status_code == 401:
                            raise HTTPException(status_code=401, detail="API key inválida ou expirada")
                        elif response.status_code != 200:
                            raise HTTPException(status_code=502, detail=f"Erro na API: status {response.status_code}")
                        
                        data = response.json()
                        models = data.get("data", [])
                        
                        # Format model list
                        formatted_models = [
                            {
                                "id": m.get("id"),
                                "name": m.get("id"),
                                "description": m.get("name", ""),
                                "context": formatContext(m.get("context_length", 8192))
                            }
                            for m in models
                        ]
                    
                    return {"models": formatted_models}
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Falha na conexão: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar modelos: {str(e)}")


@app.get("/me/providers/{provider_slug}/test-connection")
async def test_provider_connection(provider_slug: str, request: Request):
    """Test connection to a provider API, optionally check if specific model exists"""
    model_name = request.query_params.get("modelName")
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            # Get provider info
            provider = conn.execute(text("""
                SELECT p.id, p.slug, p.type, p.config FROM providers p WHERE p.slug = :slug
            """), {"slug": provider_slug}).fetchone()
            
            if not provider:
                raise HTTPException(status_code=404, detail=f"Provedor '{provider_slug}' não encontrado")
            
            provider_type = provider[2]
            
            # For local providers (like Ollama), auto-create config if not exists
            if provider_type == 'local':
                user_config = conn.execute(text("""
                    SELECT id, base_url FROM user_provider_configs 
                    WHERE user_id = :user_id AND provider_id = :provider_id
                """), {"user_id": user["id"], "provider_id": provider[0]}).fetchone()
                
                base_url = OLLAMA_URL
                
                if not user_config:
                    conn.execute(text("""
                        INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active, models)
                        VALUES (:user_id, :provider_id, :base_url, TRUE, '[]'::jsonb)
                        ON CONFLICT (user_id, provider_id) DO NOTHING
                    """), {
                        "user_id": user["id"],
                        "provider_id": provider[0],
                        "base_url": base_url
                    })
                    conn.commit()
                elif user_config[1]:
                    base_url = user_config[1]
            else:
                # Get user's config for API providers
                user_config = conn.execute(text("""
                    SELECT base_url, api_key_encrypted FROM user_provider_configs 
                    WHERE user_id = :user_id AND provider_id = :provider_id
                """), {"user_id": user["id"], "provider_id": provider[0]}).fetchone()
                
                if not user_config:
                    raise HTTPException(status_code=400, detail="Configure o provedor antes de testar conexão")
                
                base_url = user_config[0] or "https://openrouter.ai/api"
                
                api_key_encrypted = user_config[1]
                if isinstance(api_key_encrypted, (memoryview, bytearray)):
                    api_key_encrypted = bytes(api_key_encrypted)
                
                if not api_key_encrypted or len(api_key_encrypted) == 0:
                    raise HTTPException(status_code=400, detail="API key não configurada para este provedor")
                
                api_key = decrypt_api_key(api_key_encrypted)
            
            # Test connection
            if provider_type == 'local':
                # For local providers (Ollama), check /api/tags endpoint
                try:
                    async with httpx.AsyncClient(timeout=OLLAMA_REQUEST_TIMEOUT) as client:
                        response = await client.get(f"{base_url}/api/tags")
                    
                    if response.status_code == 200:
                        # If model_name provided, check if model exists
                        if model_name:
                            data = response.json()
                            models = data.get("models", [])
                            model_found = any(
                                m.get("name") == model_name
                                for m in models
                            )
                            return {"connected": True, "modelFound": model_found, 
                                    "message": "Conexão estabelecida" + (" - modelo encontrado" if model_found else " - modelo não encontrado")}
                        return {"connected": True, "message": "Conexão estabelecida com sucesso"}
                    else:
                        raise HTTPException(status_code=502, detail=f"Erro no provedor local: status {response.status_code}")
                except httpx.RequestError as e:
                    raise HTTPException(status_code=502, detail=f"Falha na conexão: {str(e)}")
            else:
                config = provider[3] or {}
                api_format = config.get("api_format", "")
                is_openai_compatible = api_format in ["openai", "openai_compatible"]
                
                if provider_slug == 'openrouter' or is_openai_compatible:
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            response = await client.get(
                                f"{base_url}/v1/models",
                                headers={"Authorization": f"Bearer {api_key}"}
                            )
                        
                        if response.status_code == 200:
                            # If model_name provided, check if model exists
                            if model_name:
                                data = response.json()
                                models = data.get("data", [])
                                model_found = any(
                                    m.get("id") == model_name or m.get("name", "").lower() == model_name.lower()
                                    for m in models
                                )
                                return {"connected": True, "modelFound": model_found, 
                                        "message": "Conexão estabelecida" + (" - modelo encontrado" if model_found else " - modelo não encontrado")}
                            return {"connected": True, "message": "Conexão estabelecida com sucesso"}
                        elif response.status_code == 401:
                            raise HTTPException(status_code=401, detail="API key inválida ou expirada")
                        elif response.status_code == 403:
                            raise HTTPException(status_code=403, detail="Acesso negado. Verifique permissões da API key")
                        else:
                            raise HTTPException(status_code=502, detail=f"Erro na API: status {response.status_code}")
                    except httpx.RequestError as e:
                        raise HTTPException(status_code=502, detail=f"Falha na conexão: {str(e)}")
                else:
                    # Generic test - just check if we can reach the base URL
                    try:
                        async with httpx.AsyncClient(timeout=10.0) as client:
                            response = await client.get(f"{base_url}")
                        if response.status_code < 500:
                            return {"connected": True, "message": "Conexão estabelecida com sucesso"}
                        raise HTTPException(status_code=502, detail=f"Erro na conexão: status {response.status_code}")
                    except httpx.RequestError as e:
                        raise HTTPException(status_code=502, detail=f"Falha na conexão: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao testar conexão: {str(e)}")


# ============== Models Endpoints ==============

@app.get("/models")
async def get_models(request: Request):
    """Get models for the authenticated user"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            db_data = _query_user_providers_with_models(conn, user["id"])
        return {"providers": db_data.get("providers", []), "totalModels": db_data.get("totalModels", 0)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")


@app.post("/models/sync")
async def sync_models(request: Request):
    """Sync models from Ollama for the authenticated user - stores in both models table and JSONB"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            ollama_provider = conn.execute(text("SELECT id FROM providers WHERE slug = 'ollama'")).fetchone()
            if not ollama_provider:
                raise HTTPException(status_code=404, detail="Provedor Ollama não encontrado no banco.")
            
            provider_id = ollama_provider[0]
            ollama_base_url = OLLAMA_URL
            
            # Check if user has configured ollama
            user_config = conn.execute(text("""
                SELECT id, base_url, models FROM user_provider_configs 
                WHERE user_id = :user_id AND provider_id = :provider_id
            """), {"user_id": user["id"], "provider_id": provider_id}).fetchone()
            
            # For Ollama, auto-create config if not exists
            if not user_config:
                conn.execute(text("""
                    INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active, models)
                    VALUES (:user_id, :provider_id, :base_url, TRUE, '[]'::jsonb)
                    ON CONFLICT (user_id, provider_id) 
                    DO NOTHING
                """), {
                    "user_id": user["id"],
                    "provider_id": provider_id,
                    "base_url": OLLAMA_URL
                })
                conn.commit()
            else:
                ollama_base_url = user_config[1] if user_config[1] else OLLAMA_URL
            
            try:
                async with httpx.AsyncClient(timeout=OLLAMA_REQUEST_TIMEOUT) as client:
                    response = await client.get(f"{ollama_base_url}/api/tags")
                if response.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Ollama retornou status {response.status_code}")
                
                ollama_models = response.json().get("models", [])
                
                # Upsert into models table and build JSONB list
                models_to_add_jsonb = []
                synced_count = 0
                
                for model in ollama_models:
                    model_name = model.get("name", "")
                    model_kind = getModelKind(model_name)
                    model_size = formatSize(model.get("size", 0))
                    model_context = str(model.get("details", {}).get("context_length", "8K") if model.get("details") else "8K")
                    
                    # Upsert into models table (INSERT ... ON CONFLICT DO UPDATE)
                    conn.execute(text("""
                        INSERT INTO models (user_id, provider_id, name, status, kind, size, context, metadata, created_at, updated_at)
                        VALUES (:user_id, :provider_id, :name, 'ready', :kind, :size, :context, '{}', now(), now())
                        ON CONFLICT (user_id, provider_id, name) 
                        DO UPDATE SET 
                            status = 'ready',
                            kind = EXCLUDED.kind,
                            size = EXCLUDED.size,
                            context = EXCLUDED.context,
                            updated_at = now()
                    """), {
                        "user_id": user["id"],
                        "provider_id": provider_id,
                        "name": model_name,
                        "kind": model_kind,
                        "size": model_size,
                        "context": model_context
                    })
                    
                    # Also build JSONB list for user_provider_configs
                    model_id = conn.execute(text("""
                        SELECT id FROM models WHERE user_id = :user_id AND provider_id = :provider_id AND name = :name
                    """), {"user_id": user["id"], "provider_id": provider_id, "name": model_name}).scalar()
                    
                    models_to_add_jsonb.append({
                        "id": str(model_id) if model_id else _generate_model_id(),
                        "name": model_name,
                        "status": "ready",
                        "kind": model_kind,
                        "size": model_size,
                        "context": model_context,
                        "created_at": datetime.utcnow().isoformat() + "Z",
                        "updated_at": datetime.utcnow().isoformat() + "Z"
                    })
                    synced_count += 1
                
                conn.commit()
                
                # Update JSONB with all models from Ollama (replace to keep in sync)
                conn.execute(text("""
                    UPDATE user_provider_configs 
                    SET models = :models
                    WHERE user_id = :user_id AND provider_id = :provider_id
                """), {
                    "user_id": user["id"],
                    "provider_id": provider_id,
                    "models": json.dumps(models_to_add_jsonb)
                })
                conn.commit()
                
                db_data = _query_user_providers_with_models(conn, user["id"])
                return {"synced": synced_count, "providers": db_data.get("providers", []), "totalModels": db_data.get("totalModels", 0)}
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Não foi possível conectar ao Ollama em {ollama_base_url}: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao sincronizar modelos: {str(e)}")


@app.post("/models")
async def create_model(payload: CreateModelPayload, request: Request):
    """Create a model for the authenticated user - stores in JSONB"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            provider_result = conn.execute(text("SELECT id, type FROM providers WHERE slug = :slug"), 
                                        {"slug": payload.providerSlug}).fetchone()
            if not provider_result:
                raise HTTPException(status_code=404, detail=f"Provedor com slug '{payload.providerSlug}' não encontrado.")
            
            provider_id = provider_result[0]
            provider_type = provider_result[1]
            
            # Check if user has configured this provider
            user_config = conn.execute(text("""
                SELECT id, base_url, api_key_encrypted, models FROM user_provider_configs 
                WHERE user_id = :user_id AND provider_id = :provider_id
            """), {"user_id": user["id"], "provider_id": provider_id}).fetchone()
            
            # For local providers (like Ollama), auto-create config if not exists
            if not user_config and provider_type == 'local':
                conn.execute(text("""
                    INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active, models)
                    VALUES (:user_id, :provider_id, :base_url, TRUE, '[]'::jsonb)
                    ON CONFLICT (user_id, provider_id) DO NOTHING
                """), {"user_id": user["id"], "provider_id": provider_id, "base_url": OLLAMA_URL})
                conn.commit()
                
                # Fetch again
                user_config = conn.execute(text("""
                    SELECT id, base_url, api_key_encrypted, models FROM user_provider_configs 
                    WHERE user_id = :user_id AND provider_id = :provider_id
                """), {"user_id": user["id"], "provider_id": provider_id}).fetchone()
            elif not user_config and provider_type != 'local':
                raise HTTPException(status_code=400, detail=f"Configure o provedor '{payload.providerSlug}' antes de adicionar modelos")
            
            # Check if model already exists in JSONB
            current_models = list(user_config[3]) if user_config and user_config[3] else []
            if any(m.get('name') == payload.modelName for m in current_models):
                raise HTTPException(status_code=409, detail=f"Modelo '{payload.modelName}' já existe para este provedor.")
            
            # Fetch model metadata for API providers
            model_kind = getModelKind(payload.modelName)
            model_context = "8K"  # default
            
            # For API providers, try to fetch metadata from the API
            if user_config and provider_type != 'local':
                base_url = user_config[1] or "https://openrouter.ai/api"
                api_key_encrypted = user_config[2]
                
                # Convert any buffer type to bytes first
                if isinstance(api_key_encrypted, (memoryview, bytearray)):
                    api_key_encrypted = bytes(api_key_encrypted)
                
                if api_key_encrypted and len(api_key_encrypted) > 0:
                    try:
                        api_key = decrypt_api_key(api_key_encrypted)
                        if api_key:
                            # Try to get model info from API
                            model_info = await fetchModelInfoOpenRouter(base_url, api_key, payload.modelName)
                            if model_info:
                                model_context = model_info.get("context", model_context)
                    except Exception:
                        pass  # Continue with default context if decryption fails
            
            # Create model object
            new_model = {
                "id": _generate_model_id(),
                "name": payload.modelName,
                "status": "ready",
                "kind": model_kind,
                "context": model_context,
                "created_at": datetime.utcnow().isoformat() + "Z",
                "updated_at": datetime.utcnow().isoformat() + "Z"
            }
            
            current_models.append(new_model)
            
            conn.execute(text("""
                UPDATE user_provider_configs 
                SET models = :models
                WHERE user_id = :user_id AND provider_id = :provider_id
            """), {
                "user_id": user["id"],
                "provider_id": provider_id,
                "models": json.dumps(current_models)
            })
            conn.commit()
            return {"message": f"Modelo '{payload.modelName}' adicionado com sucesso.", "context": model_context}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar modelo: {str(e)}")


# ============== Agents Endpoints ==============

@app.get("/agents")
async def get_agents(request: Request):
    """Get agents for the authenticated user"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            result = conn.execute(text("""
                SELECT jsonb_build_object(
                    'agents', COALESCE(jsonb_agg(a_obj ORDER BY a_obj->>'name'), '[]'::jsonb),
                    'totalAgents', (SELECT count(*) FROM agents WHERE user_id = :user_id)
                )
                FROM (
                    SELECT jsonb_build_object(
                        'id', a.id::text,
                        'name', a.name,
                        'description', a.description,
                        'avatarUrl', a.avatar_url,
                        'modelId', a.model_id,
                        'modelName', a.model_name,
                        'tags', COALESCE(a.tags, '[]'::jsonb),
                        'prompt', a.prompt,
                        'skills', COALESCE(a.skills, '[]'::jsonb),
                        'knowledge', COALESCE(a.knowledge, '[]'::jsonb),
                        'createdAt', to_char(a.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                        'updatedAt', to_char(a.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                    ) AS a_obj
                    FROM agents a
                    WHERE a.user_id = :user_id
                ) sub;
            """), {"user_id": user["id"]}).fetchone()
            
            if result and result[0]:
                return result[0]
            return {"agents": [], "totalAgents": 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar agentes: {str(e)}")


@app.post("/agents")
async def create_agent(payload: CreateAgentPayload, request: Request):
    """Create a new agent for the authenticated user"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            agent_id = conn.execute(text("""
                INSERT INTO agents (user_id, name, description, avatar_url, model_id, model_name, tags, prompt, skills, knowledge)
                VALUES (:user_id, :name, :description, :avatar_url, :model_id, :model_name, CAST(:tags AS jsonb), :prompt, CAST(:skills AS jsonb), CAST(:knowledge AS jsonb))
                RETURNING id
            """), {
                "user_id": user["id"],
                "name": payload.name,
                "description": payload.description,
                "avatar_url": payload.avatarUrl,
                "model_id": payload.modelId,
                "model_name": payload.modelName,
                "tags": json.dumps(payload.tags),
                "prompt": payload.prompt,
                "skills": json.dumps(payload.skills),
                "knowledge": json.dumps(payload.knowledge),
            }).scalar()
            
            conn.commit()
            return {"message": f"Agente '{payload.name}' criado com sucesso.", "id": str(agent_id)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao criar agente: {str(e)}")


@app.get("/")
async def root():
    return {"message": "MyCrew API", "status": "ok"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


# ============== Knowledge Endpoints ==============

# In-memory flow storage for SSE (em produção, usar Redis)
knowledge_flows: dict[str, KnowledgeFlow] = {}


@app.get("/knowledge/status/{flow_id}")
async def knowledge_status(flow_id: str, request: Request):
    """Get current flow status and recommendation for reconnection recovery"""
    user = get_current_user(request)
    flow = knowledge_flows.get(flow_id)
    if not flow:
        # Try to get from database
        with get_db_connection() as conn:
            result = conn.execute(text("""
                SELECT raw_analysis, status FROM knowledge_flow kf
                JOIN knowledge_document kd ON kd.id = kf.document_id
                WHERE kf.flow_id = :flow_id AND kf.user_id = :user_id
            """), {"flow_id": flow_id, "user_id": user["id"]}).fetchone()
            
            if result and result[0]:
                return {
                    "status": result[1] or "awaiting_confirmation",
                    "recommendation": result[0]
                }
        raise HTTPException(status_code=404, detail="Flow not found")
    
    return {
        "status": "awaiting_confirmation",
        "recommendation": flow._recommendation
    }


async def _process_flow_background(flow: KnowledgeFlow, user_id: str, name: str, file_type: str):
    """Processa o documento em background e persiste no banco"""
    try:
        recommendation = await flow.process()
        
        with get_db_connection() as conn:
            doc_id = conn.execute(text("""
                INSERT INTO knowledge_document (user_id, filename, file_type, language, structure_level, domain, raw_analysis)
                VALUES (:user_id, :filename, :file_type, :language, :structure_level, :domain, :raw_analysis)
                RETURNING id
            """), {
                "user_id": user_id,
                "filename": name,
                "file_type": file_type,
                "language": recommendation.document.language,
                "structure_level": recommendation.document.structure_level,
                "domain": recommendation.document.domain,
                "raw_analysis": json.dumps(recommendation.model_dump())
            }).scalar()
            
            conn.execute(text("""
                INSERT INTO knowledge_flow (flow_id, document_id, user_id, status)
                VALUES (:flow_id, :document_id, :user_id, 'awaiting_confirmation')
            """), {
                "flow_id": flow.flow_id,
                "document_id": str(doc_id),
                "user_id": user_id
            })
            conn.commit()
    except Exception as e:
        await flow.emit_step('analyze', 'Analisando com Cortex', 'error', error_message=f'Erro no processamento: {str(e)}')
    finally:
        # Limpa o flow da memória após 5 minutos (tempo para reconexão SSE)
        async def cleanup():
            await asyncio.sleep(300)  # 5 minutos
            knowledge_flows.pop(flow.flow_id, None)
        asyncio.create_task(cleanup())


@app.post("/knowledge/ingest")
async def knowledge_ingest(
    request: Request,
    name: str = Form(...),
    description: str = Form(...),
    file: UploadFile = File(...),
    tags: str = Form(default=""),
):
    """Inicia o fluxo de ingestão de conhecimento"""
    user = get_current_user(request)
    
    # Gera flow_id
    flow_id = str(uuid.uuid4())
    
    # Lê conteúdo do arquivo
    file_content = await file.read()
    
    # Define file_type antes de usar
    file_type = file.filename.split('.')[-1].lower() if '.' in file.filename else 'other'
    
    # Busca o prompt do agente Cortex pelo nome (mais flexível que ID fixo)
    with get_db_connection() as conn:
        cortex_agent = conn.execute(text("""
            SELECT prompt FROM agents WHERE name = 'Cortex' AND user_id = :user_id
        """), {"user_id": user["id"]}).fetchone()
        cortex_prompt = cortex_agent[0] if cortex_agent else ""
    
    # Cria flow manager com prompt dinâmico
    flow = KnowledgeFlow(flow_id, user["id"], file_content, file.filename or "unknown", cortex_prompt)
    knowledge_flows[flow_id] = flow
    
    # Delay pequeno para garantir que o SSE se conecte antes do processamento iniciar
    async def delayed_process():
        await asyncio.sleep(0.5)
        await _process_flow_background(flow, user["id"], name, file_type)
    
    # Processa em background para que SSE consiga capturar eventos
    asyncio.create_task(delayed_process())
    
    return {"flow_id": flow_id}


@app.get("/knowledge/stream")
async def knowledge_stream(request: Request, flow_id: str):
    """Endpoint SSE para streaming de eventos do Knowledge Flow"""
    from fastapi.responses import StreamingResponse
    
    async def event_generator():
        flow = knowledge_flows.get(flow_id)
        if not flow:
            yield f"data: {json.dumps({'error': 'Flow not found'})}\n\n"
            return
        
        # Cria queue para eventos
        events_queue = []
        
        async def subscribe(event_json: str):
            events_queue.append(event_json)
        
        flow._subscribers.append(subscribe)
        
        # Reenvia eventos do buffer para este novo subscriber
        for buffered_event in flow._event_buffer:
            events_queue.append(buffered_event)
        
        try:
            while True:
                if await request.is_disconnected():
                    break
                    
                if events_queue:
                    yield f"data: {events_queue.pop(0)}\n\n"
                else:
                    await asyncio.sleep(0.1)
        finally:
            flow._subscribers.remove(subscribe)
    
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/knowledge/confirm")
async def knowledge_confirm(
    payload: dict,
    request: Request
):
    """Confirma e inicia a indexação do documento"""
    user = get_current_user(request)
    flow_id = payload.get("flow_id")
    
    flow = knowledge_flows.get(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="Flow not found")
    
    try:
        chunking_params = payload.get("chunking_strategy", {}).get("parameters")
        
        # Get document_id from knowledge_flow
        with get_db_connection() as conn:
            doc_result = conn.execute(text("""
                SELECT document_id FROM knowledge_flow WHERE flow_id = :flow_id AND user_id = :user_id
            """), {"flow_id": flow_id, "user_id": user["id"]}).fetchone()
            
            if doc_result:
                document_id = doc_result[0]
            else:
                document_id = str(uuid.uuid4())
        
        # Pass document_id to continue_after_confirmation
        await flow.continue_after_confirmation(chunking_params, str(document_id))
        
        # Persist chunks to database
        if flow._content and flow._recommendation:
            chunks = flow._chunks if hasattr(flow, '_chunks') else []
            if chunks:
                with get_db_connection() as conn:
                    for i, chunk in enumerate(chunks):
                        conn.execute(text("""
                            INSERT INTO knowledge_chunk (document_id, content, chunk_index, token_count, strategy_used, embedding_model, qdrant_collection)
                            VALUES (:document_id, :content, :chunk_index, :token_count, :strategy_used, :embedding_model, :qdrant_collection)
                        """), {
                            "document_id": document_id,
                            "content": chunk,
                            "chunk_index": i,
                            "token_count": len(chunk) // 4,
                            "strategy_used": flow._recommendation.get('chunking_strategy', {}).get('primary', {}).get('type', 'paragraph'),
                            "embedding_model": flow._recommendation.get('embedding', {}).get('model', OLLAMA_EMBEDDING_MODEL),
                            "qdrant_collection": QDRANT_COLLECTION
                        })
                    conn.commit()
            
            # Update knowledge_flow status
            with get_db_connection() as conn:
                conn.execute(text("""
                    UPDATE knowledge_flow SET status = 'done', updated_at = now()
                    WHERE flow_id = :flow_id
                """), {"flow_id": flow_id})
                conn.commit()
        
        return {"message": "Knowledge processing completed", "status": "completed"}
    except Exception as e:
        await flow.emit_step('chunking', 'Indexando', 'error', error_message=str(e))
        # Update knowledge_flow status on error
        with get_db_connection() as conn:
            conn.execute(text("""
                UPDATE knowledge_flow SET status = 'error', updated_at = now()
                WHERE flow_id = :flow_id
            """), {"flow_id": flow_id})
            conn.commit()
        raise HTTPException(status_code=500, detail=f"Erro no processamento: {str(e)}")
