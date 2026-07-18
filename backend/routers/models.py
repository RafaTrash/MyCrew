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

router = APIRouter()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_REQUEST_TIMEOUT = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "30"))
OLLAMA_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")


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


def getModelKind(name: str):
    from typing import Optional
    name_lower = name.lower() if name else ""
    if "embed" in name_lower:
        return "embedding"
    if "vision" in name_lower or "visual" in name_lower:
        return "vision"
    return "chat"


def _query_user_providers_with_models(conn, user_id: str) -> dict:
    """Original query from main.py - fallback version"""
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
                            'created_at', to_char(om.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                            'updated_at', to_char(om.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                        )), '[]'::jsonb)
                        FROM models om
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
    """Get models for the authenticated user"""
    # Token validation - placeholder
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token de autenticação não fornecido")
    
    # Extract user ID from token (simplified)
    from jose import jwt
    JWT_SECRET = os.getenv("JWT_SECRET", "mycrew-jwt-secret-key-change-in-production")
    JWT_ALGORITHM = "HS256"
    token = auth_header.replace("Bearer ", "")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload["sub"]
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")
    
    try:
        with get_db_connection() as conn:
            db_data = _query_user_providers_with_models(conn, user_id)
        return {"providers": db_data.get("providers", []), "totalModels": db_data.get("totalModels", 0)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")