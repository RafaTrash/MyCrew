"""
Auth router - Authentication endpoints
"""
import os
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import bcrypt
from jose import jwt
from sqlalchemy import text
from core.database import get_db_connection

router = APIRouter()

JWT_SECRET = os.getenv("JWT_SECRET", "mycrew-jwt-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24


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


@router.post("/login")
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


@router.post("/register")
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


@router.get("/me")
async def get_current_user_info(request: Request):
    user = get_current_user(request)
    return {"user": user}