"""
Models router - Model management endpoints
"""
import os
import json
import uuid
import asyncio
import httpx
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text
from core.database import get_db_connection
from core.config import OLLAMA_URL, OLLAMA_REQUEST_TIMEOUT
from core.utils import formatSize, formatContext, getModelKind, fetchModelInfoOpenRouter
from core.crypto import decrypt_api_key
from schemas.providers import CreateModelPayload

router = APIRouter()


def _get_current_user(request: Request) -> dict:
    """Extract user from JWT token in Authorization header."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token de autenticação não fornecido")
    
    from jose import jwt
    JWT_SECRET = os.getenv("JWT_SECRET", "mycrew-jwt-secret-key-change-in-production")
    JWT_ALGORITHM = "HS256"
    token = auth_header.replace("Bearer ", "")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"id": payload["sub"], "username": payload["username"], "role": payload["role"]}
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")


def _generate_model_id() -> str:
    """Generate a unique model ID."""
    return str(uuid.uuid4())


def _query_user_providers_with_models(conn, user_id: str) -> dict:
    """Query providers with user's configurations and models - includes usage stats from providers_usage table."""
    try:
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
        import logging
        logging.getLogger(__name__).warning(f"[Models] Error in query: {e}")
    
    return {"providers": [], "totalModels": 0}


@router.get("")
async def get_models(request: Request):
    """Get models for the authenticated user."""
    user = _get_current_user(request)
    try:
        with get_db_connection() as conn:
            db_data = _query_user_providers_with_models(conn, user["id"])
        return {"providers": db_data.get("providers", []), "totalModels": db_data.get("totalModels", 0)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")


@router.post("/sync")
async def sync_models(request: Request):
    """Sync models from Ollama for the authenticated user - stores in both models table and JSONB."""
    user = _get_current_user(request)
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


@router.post("")
async def create_model(payload: CreateModelPayload, request: Request):
    """Create a model for the authenticated user - stores in JSONB."""
    user = _get_current_user(request)
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