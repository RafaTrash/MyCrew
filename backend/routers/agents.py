"""
Agents router - Agent management endpoints
"""
import os
import json
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import text
from core.database import get_db_connection
from schemas.agents import CreateAgentPayload

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


@router.get("")
async def get_agents(request: Request):
    """Get agents for the authenticated user."""
    user = _get_current_user(request)
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


@router.post("")
async def create_agent(payload: CreateAgentPayload, request: Request):
    """Create a new agent for the authenticated user."""
    user = _get_current_user(request)
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