import os
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from cryptography.fernet import Fernet
import base64

app = FastAPI(
    title="MyCrew API",
    description="Backend do MyCrew - Gerenciamento de modelos de IA",
    version="0.1.0",
)

# Configurações via ambiente
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_REQUEST_TIMEOUT = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "30"))

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


class CreateModelPayload(BaseModel):
    type: str
    providerName: str
    providerSlug: Optional[str] = None
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None
    modelName: str


class CreateProviderPayload(BaseModel):
    name: str
    type: str = "api"
    slug: str
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None


class UpdateProviderPayload(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
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


def getModelKind(name: str) -> Optional[str]:
    name_lower = name.lower()
    if "embed" in name_lower:
        return "embedding"
    if "vision" in name_lower or "visual" in name_lower:
        return "vision"
    return "chat"


def get_db_connection():
    return engine.connect()


def _query_providers_with_models(conn) -> dict:
    try:
        result = conn.execute(text("""
            SELECT jsonb_build_object(
                'providers', COALESCE(jsonb_agg(p_obj ORDER BY p_obj->>'name'), '[]'::jsonb),
                'totalModels', (SELECT count(*) FROM models)
            )
            FROM (
                SELECT jsonb_build_object(
                    'id', p.id::text,
                    'name', p.name,
                    'type', p.type,
                    'slug', p.slug,
                    'baseUrl', p.base_url,
                    'hasApiKey', (p.api_key_encrypted IS NOT NULL),
                    'models', COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'id', m.id::text,
                            'name', m.name,
                            'status', m.status,
                            'kind', m.kind,
                            'size', m.size,
                            'context', m.context
                        ))
                        FROM models m WHERE m.provider_id = p.id
                    ), '[]'::jsonb)
                ) AS p_obj
                FROM providers p
            ) sub;
        """)).fetchone()
        if result and result[0]:
            return result[0]
    except Exception:
        pass
    return {"providers": [], "totalModels": 0}


@app.get("/")
async def root():
    return {"message": "MyCrew API", "status": "ok"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/providers")
async def get_providers():
    try:
        with get_db_connection() as conn:
            result = conn.execute(text("""
                SELECT jsonb_agg(jsonb_build_object(
                    'id', p.id::text,
                    'name', p.name,
                    'type', p.type,
                    'slug', p.slug,
                    'baseUrl', p.base_url,
                    'hasApiKey', (p.api_key_encrypted IS NOT NULL),
                    'modelCount', (SELECT count(*) FROM models WHERE provider_id = p.id)
                ) ORDER BY p.name)
                FROM providers p
            """)).fetchone()
            providers = result[0] if result and result[0] else []
            return {"providers": providers}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar provedores: {str(e)}")


@app.post("/providers")
async def create_provider(payload: CreateProviderPayload):
    try:
        with get_db_connection() as conn:
            existing = conn.execute(text("SELECT id FROM providers WHERE slug = :slug"), {"slug": payload.slug}).fetchone()
            if existing:
                raise HTTPException(status_code=409, detail=f"Já existe um provedor com o slug '{payload.slug}'.")
            
            provider_id = conn.execute(text("""
                INSERT INTO providers (name, type, slug, base_url, api_key_encrypted)
                VALUES (:name, :type, :slug, :base_url, :api_key)
                RETURNING id
            """), {"name": payload.name, "type": payload.type, "slug": payload.slug, 
                   "base_url": payload.baseUrl, "api_key": encrypt_api_key(payload.apiKey) if payload.apiKey else None}).scalar()
            
            conn.commit()
            return {"id": str(provider_id), "name": payload.name, "type": payload.type,
                    "slug": payload.slug, "baseUrl": payload.baseUrl, "hasApiKey": bool(payload.apiKey), "modelCount": 0}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao criar provedor: {str(e)}")


@app.put("/providers/{provider_id}")
async def update_provider(provider_id: str, payload: UpdateProviderPayload):
    try:
        with get_db_connection() as conn:
            existing = conn.execute(text("SELECT id FROM providers WHERE id = :id"), {"id": provider_id}).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Provedor com id '{provider_id}' não encontrado.")
            
            if payload.slug is not None:
                slug_exists = conn.execute(text("SELECT id FROM providers WHERE slug = :slug AND id != :id"),
                                          {"slug": payload.slug, "id": provider_id}).fetchone()
                if slug_exists:
                    raise HTTPException(status_code=409, detail=f"Já existe um provedor com o slug '{payload.slug}'.")
            
            update_fields = []
            params = {"id": provider_id}
            if payload.name is not None:
                update_fields.append("name = :name")
                params["name"] = payload.name
            if payload.slug is not None:
                update_fields.append("slug = :slug")
                params["slug"] = payload.slug
            if payload.baseUrl is not None:
                update_fields.append("base_url = :base_url")
                params["base_url"] = payload.baseUrl
            if payload.apiKey is not None:
                update_fields.append("api_key_encrypted = :api_key")
                params["api_key"] = encrypt_api_key(payload.apiKey) if payload.apiKey else None
            
            if update_fields:
                conn.execute(text(f"UPDATE providers SET {', '.join(update_fields)} WHERE id = :id"), params)
                conn.commit()
            
            result = conn.execute(text("""
                SELECT jsonb_build_object('id', p.id::text, 'name', p.name, 'type', p.type, 'slug', p.slug,
                    'baseUrl', p.base_url, 'hasApiKey', (p.api_key_encrypted IS NOT NULL),
                    'modelCount', (SELECT count(*) FROM models WHERE provider_id = p.id))
                FROM providers p WHERE p.id = :id
            """), {"id": provider_id}).fetchone()
            
            return {"provider": result[0] if result else None}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar provedor: {str(e)}")


@app.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str):
    try:
        with get_db_connection() as conn:
            existing = conn.execute(text("SELECT id, slug FROM providers WHERE id = :id"), {"id": provider_id}).fetchone()
            if not existing:
                raise HTTPException(status_code=404, detail=f"Provedor com id '{provider_id}' não encontrado.")
            if existing[1] == 'ollama':
                raise HTTPException(status_code=403, detail="O provedor Ollama não pode ser excluído.")
            
            conn.execute(text("DELETE FROM providers WHERE id = :id"), {"id": provider_id})
            conn.commit()
            return {"message": "Provedor removido com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao remover provedor: {str(e)}")


@app.get("/models")
async def get_models():
    try:
        with get_db_connection() as conn:
            db_data = _query_providers_with_models(conn)
        return {"providers": db_data.get("providers", []), "totalModels": db_data.get("totalModels", 0)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")


@app.post("/models/sync")
async def sync_models():
    try:
        with get_db_connection() as conn:
            ollama_provider = conn.execute(text("SELECT id FROM providers WHERE slug = 'ollama'")).fetchone()
            if not ollama_provider:
                raise HTTPException(status_code=404, detail="Provedor Ollama não encontrado no banco.")
            
            provider_id = ollama_provider[0]
            
            try:
                async with httpx.AsyncClient(timeout=OLLAMA_REQUEST_TIMEOUT) as client:
                    response = await client.get(f"{OLLAMA_URL}/api/tags")
                if response.status_code != 200:
                    raise HTTPException(status_code=502, detail=f"Ollama retornou status {response.status_code}")
                
                ollama_models = response.json().get("models", [])
                for model in ollama_models:
                    conn.execute(text("""
                        INSERT INTO models (provider_id, name, status, kind, size, context)
                        VALUES (:provider_id, :name, 'ready', :kind, :size, :context)
                        ON CONFLICT (provider_id, name) DO UPDATE SET
                            status = 'ready', kind = EXCLUDED.kind, size = EXCLUDED.size, context = EXCLUDED.context, updated_at = now()
                    """), {"provider_id": provider_id, "name": model.get("name", ""), "kind": getModelKind(model.get("name", "")),
                          "size": formatSize(model.get("size", 0)), "context": str(model.get("details", {}).get("context_length", "8K") if model.get("details") else "8K")})
                
                conn.commit()
                db_data = _query_providers_with_models(conn)
                return {"synced": len(ollama_models), "providers": db_data.get("providers", []), "totalModels": db_data.get("totalModels", 0)}
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Não foi possível conectar ao Ollama em {OLLAMA_URL}: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao sincronizar modelos: {str(e)}")


@app.post("/models")
async def create_model(payload: CreateModelPayload):
    try:
        provider_slug = payload.providerSlug or payload.providerName.lower()
        with get_db_connection() as conn:
            provider_result = conn.execute(text("SELECT id FROM providers WHERE slug = :slug"), {"slug": provider_slug}).fetchone()
            if not provider_result:
                raise HTTPException(status_code=404, detail=f"Provedor com slug '{provider_slug}' não encontrado.")
            
            provider_id = provider_result[0]
            model_exists = conn.execute(text("SELECT id FROM models WHERE provider_id = :provider_id AND name = :name"),
                                       {"provider_id": provider_id, "name": payload.modelName}).fetchone()
            if model_exists:
                raise HTTPException(status_code=409, detail=f"Modelo '{payload.modelName}' já existe para este provedor.")
            
            conn.execute(text("INSERT INTO models (provider_id, name, status, kind) VALUES (:provider_id, :name, :status, :kind)"),
                        {"provider_id": provider_id, "name": payload.modelName, "status": "ready", "kind": getModelKind(payload.modelName)})
            conn.commit()
            return {"message": f"Modelo '{payload.modelName}' adicionado com sucesso."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao salvar modelo: {str(e)}")
