"""
Providers router - Provider management endpoints
"""
import asyncio
import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text
import httpx
from core.database import get_db_connection
from core.config import OLLAMA_URL, OLLAMA_REQUEST_TIMEOUT, JWT_SECRET, JWT_ALGORITHM
from core.crypto import encrypt_api_key, decrypt_api_key
from core.utils import formatSize, formatContext

router = APIRouter()


def _get_current_user(request: Request) -> dict:
    """Extract user from JWT token in Authorization header."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token de autenticação não fornecido")
    
    from jose import jwt
    token = auth_header.replace("Bearer ", "")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {"id": payload["sub"], "username": payload["username"], "role": payload["role"]}
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")


@router.get("")
async def get_providers():
    """List all available provider templates (no auth required for listing)."""
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


@router.post("/{provider_slug}/configure")
async def configure_provider(
    provider_slug: str, 
    payload: dict,
    request: Request
):
    """Configure a provider for the current user (save API key and base_url)."""
    user = _get_current_user(request)
    
    base_url = payload.get("baseUrl")
    api_key = payload.get("apiKey")
    
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
            
            if requires_base_url and not base_url:
                raise HTTPException(status_code=400, detail="URL base é obrigatória para este provedor")
            
            if requires_api_key and not api_key:
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
                "base_url": base_url,
                "api_key": encrypt_api_key(api_key) if api_key else None
            })
            
            conn.commit()
            return {"message": f"Provedor '{provider_slug}' configurado com sucesso"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao configurar provedor: {str(e)}")


@router.get("/{provider_slug}/models")
async def get_provider_models(provider_slug: str, request: Request):
    """Get available models from a provider API or local Ollama instance."""
    user = _get_current_user(request)
    try:
        with get_db_connection() as conn:
            # Get provider info
            provider = conn.execute(text("""
                SELECT p.id, p.slug, p.type, p.config FROM providers p WHERE p.slug = :slug
            """), {"slug": provider_slug}).fetchone()
            
            if not provider:
                raise HTTPException(status_code=404, detail=f"Provedor '{provider_slug}' não encontrado")
            
            provider_type = provider[2]
            base_url = None
            api_key = None
            
            # For local providers (like Ollama), auto-create config if not exists
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
                        # API providers use /v1 models endpoint
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


@router.get("/{provider_slug}/test-connection")
async def test_provider_connection(provider_slug: str, request: Request):
    """Test connection to a provider API, optionally check if specific model exists."""
    model_name = request.query_params.get("modelName")
    user = _get_current_user(request)
    
    try:
        with get_db_connection() as conn:
            # Get provider info
            provider = conn.execute(text("""
                SELECT p.id, p.slug, p.type, p.config FROM providers p WHERE p.slug = :slug
            """), {"slug": provider_slug}).fetchone()
            
            if not provider:
                raise HTTPException(status_code=404, detail=f"Provedor '{provider_slug}' não encontrado")
            
            provider_type = provider[2]
            base_url = None
            api_key = None
            
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