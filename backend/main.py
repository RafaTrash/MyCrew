import os
import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import create_engine, text
from cryptography.fernet import Fernet
import bcrypt
from datetime import datetime, timedelta
from jose import jwt

app = FastAPI(
    title="MyCrew API",
    description="Backend do MyCrew - Gerenciamento de modelos de IA",
    version="0.1.0",
)

# Configurações via ambiente
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_REQUEST_TIMEOUT = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "30"))
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


def decrypt_api_key(encrypted: bytes) -> str:
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


def get_db_connection():
    return engine.connect()


def _query_user_providers_with_models(conn, user_id: str) -> dict:
    """Query providers with user's configurations and models"""
    try:
        result = conn.execute(text("""
            SELECT jsonb_build_object(
                'providers', COALESCE(jsonb_agg(p_obj ORDER BY p_obj->>'name'), '[]'::jsonb),
                'totalModels', (SELECT count(*) FROM models WHERE user_id = :user_id)
            )
            FROM (
                SELECT jsonb_build_object(
                    'id', p.id::text,
                    'name', p.name,
                    'type', p.type,
                    'slug', p.slug,
                    'config', p.config,
                    'hasApiKey', (upc.api_key_encrypted IS NOT NULL),
                    'baseUrl', upc.base_url,
                    'models', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', m.id::text,
                            'name', m.name,
                            'status', m.status,
                            'kind', m.kind,
                            'size', m.size,
                            'context', m.context
                        ))
                        FROM models m WHERE m.user_id = :user_id AND m.provider_id = p.id
                    ), '[]'::jsonb)
                ) AS p_obj
                FROM providers p
                LEFT JOIN user_provider_configs upc ON upc.user_id = :user_id AND upc.provider_id = p.id
            ) sub;
        """), {"user_id": user_id}).fetchone()
        if result and result[0]:
            return result[0]
    except Exception:
        pass
    return {"providers": [], "totalModels": 0}


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
            
            # Insert or update user provider config
            conn.execute(text("""
                INSERT INTO user_provider_configs (user_id, provider_id, base_url, api_key_encrypted, is_active)
                VALUES (:user_id, :provider_id, :base_url, :api_key, TRUE)
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


@app.get("/me/providers/{provider_slug}/test-connection")
async def test_provider_connection(provider_slug: str, request: Request):
    """Test connection to a provider API"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            # Get provider info
            provider = conn.execute(text("""
                SELECT p.id, p.slug, p.config FROM providers p WHERE p.slug = :slug
            """), {"slug": provider_slug}).fetchone()
            
            if not provider:
                raise HTTPException(status_code=404, detail=f"Provedor '{provider_slug}' não encontrado")
            
            # Get user's config for this provider
            user_config = conn.execute(text("""
                SELECT base_url, api_key_encrypted FROM user_provider_configs 
                WHERE user_id = :user_id AND provider_id = :provider_id
            """), {"user_id": user["id"], "provider_id": provider[0]}).fetchone()
            
            if not user_config:
                raise HTTPException(status_code=400, detail="Configure o provedor antes de testar conexão")
            
            base_url = user_config[0]
            if not base_url:
                base_url = "https://openrouter.ai/api"  # Default for OpenRouter
            
            api_key = decrypt_api_key(user_config[1]) if user_config[1] else None
            
            if not api_key:
                raise HTTPException(status_code=400, detail="API key não configurada para este provedor")
            
            # Test connection based on provider type
            config = provider[2] or {}
            
            # Check if provider uses OpenAI-compatible API (openrouter, openai, mistral, etc.)
            api_format = config.get("api_format", "")
            is_openai_compatible = api_format in ["openai", "openai_compatible"]
            
            if provider_slug == 'openrouter' or is_openai_compatible:
                # OpenAI-compatible API test
                try:
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        response = await client.get(
                            f"{base_url}/v1/models",
                            headers={"Authorization": f"Bearer {api_key}"}
                        )
                    if response.status_code == 200:
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
    """Sync models from Ollama for the authenticated user"""
    user = get_current_user(request)
    try:
        with get_db_connection() as conn:
            ollama_provider = conn.execute(text("SELECT id FROM providers WHERE slug = 'ollama'")).fetchone()
            if not ollama_provider:
                raise HTTPException(status_code=404, detail="Provedor Ollama não encontrado no banco.")
            
            provider_id = ollama_provider[0]
            
            # Check if user has configured ollama
            user_config = conn.execute(text("""
                SELECT id, base_url FROM user_provider_configs 
                WHERE user_id = :user_id AND provider_id = :provider_id
            """), {"user_id": user["id"], "provider_id": provider_id}).fetchone()
            
            # For Ollama, auto-create config if not exists - use default OLLAMA_URL
            if not user_config:
                conn.execute(text("""
                    INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active)
                    VALUES (:user_id, :provider_id, :base_url, TRUE)
                    ON CONFLICT (user_id, provider_id) 
                    DO NOTHING
                """), {
                    "user_id": user["id"],
                    "provider_id": provider_id,
                    "base_url": OLLAMA_URL
                })
                conn.commit()
                ollama_base_url = OLLAMA_URL
            else:
                ollama_base_url = user_config[1] if user_config[1] else OLLAMA_URL
            
            try:
                async with httpx.AsyncClient(timeout=OLLAMA_REQUEST_TIMEOUT) as client:
                    response = await client.get(f"{ollama_base_url}/api/tags")
                if response.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Ollama retornou status {response.status_code}")
                
                ollama_models = response.json().get("models", [])
                for model in ollama_models:
                    conn.execute(text("""
                        INSERT INTO models (user_id, provider_id, name, status, kind, size, context)
                        VALUES (:user_id, :provider_id, :name, 'ready', :kind, :size, :context)
                        ON CONFLICT (user_id, provider_id, name) DO UPDATE SET
                            status = 'ready', kind = EXCLUDED.kind, size = EXCLUDED.size, context = EXCLUDED.context, updated_at = now()
                    """), {"user_id": user["id"], "provider_id": provider_id, "name": model.get("name", ""), "kind": getModelKind(model.get("name", "")),
                        "size": formatSize(model.get("size", 0)), "context": str(model.get("details", {}).get("context_length", "8K") if model.get("details") else "8K")})
                
                conn.commit()
                db_data = _query_user_providers_with_models(conn, user["id"])
                return {"synced": len(ollama_models), "providers": db_data.get("providers", []), "totalModels": db_data.get("totalModels", 0)}
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Não foi possível conectar ao Ollama em {ollama_base_url}: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao sincronizar modelos: {str(e)}")


@app.post("/models")
async def create_model(payload: CreateModelPayload, request: Request):
    """Create a model for the authenticated user"""
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
            # For local providers (like Ollama), auto-create config if not exists
            user_config = conn.execute(text("""
                SELECT id, base_url, api_key_encrypted FROM user_provider_configs 
                WHERE user_id = :user_id AND provider_id = :provider_id
            """), {"user_id": user["id"], "provider_id": provider_id}).fetchone()
            
            if not user_config and provider_type == 'local':
                conn.execute(text("""
                    INSERT INTO user_provider_configs (user_id, provider_id, base_url, is_active)
                    VALUES (:user_id, :provider_id, :base_url, TRUE)
                    ON CONFLICT (user_id, provider_id) DO NOTHING
                """), {"user_id": user["id"], "provider_id": provider_id, "base_url": OLLAMA_URL})
                conn.commit()
            
            if not user_config and provider_type != 'local':
                raise HTTPException(status_code=400, detail=f"Configure o provedor '{payload.providerSlug}' antes de adicionar modelos")
            
            model_exists = conn.execute(text("""
                SELECT id FROM models 
                WHERE user_id = :user_id AND provider_id = :provider_id AND name = :name
            """), {"user_id": user["id"], "provider_id": provider_id, "name": payload.modelName}).fetchone()
            
            if model_exists:
                raise HTTPException(status_code=409, detail=f"Modelo '{payload.modelName}' já existe para este provedor.")
            
            # Fetch model metadata for API providers
            model_kind = getModelKind(payload.modelName)
            model_context = "8K"  # default
            
            # For API providers, try to fetch metadata from the API
            if user_config and provider_type != 'local':
                base_url = user_config[1] or "https://openrouter.ai/api"
                api_key_encrypted = user_config[2]
                
                if api_key_encrypted:
                    api_key = decrypt_api_key(api_key_encrypted)
                    if api_key:
                        # Try to get model info from API
                        model_info = await fetchModelInfoOpenRouter(base_url, api_key, payload.modelName)
                        if model_info:
                            model_context = model_info.get("context", model_context)
            
            conn.execute(text("""
                INSERT INTO models (user_id, provider_id, name, status, kind, context) 
                VALUES (:user_id, :provider_id, :name, :status, :kind, :context)
            """), {
                "user_id": user["id"],
                "provider_id": provider_id,
                "name": payload.modelName,
                "status": "ready",
                "kind": model_kind,
                "context": model_context
            })
            conn.commit()
            return {"message": f"Modelo '{payload.modelName}' adicionado com sucesso.", "context": model_context}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar modelo: {str(e)}")


@app.get("/")
async def root():
    return {"message": "MyCrew API", "status": "ok"}


@app.get("/health")
async def health():
    return {"status": "healthy"}