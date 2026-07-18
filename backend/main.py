import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
from sqlalchemy import text
from core.database import get_db_connection

# Create FastAPI app
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
from routers import auth_router, providers_router, models_router, agents_router, knowledge_router

# Auth routes
app.include_router(auth_router, prefix="/auth")

# Providers routes - `/providers` is public list, `/me/providers/*` is authenticated user endpoints
app.include_router(providers_router, prefix="/me/providers")

# Model routes  
app.include_router(models_router, prefix="/me/models")

# Agents routes
app.include_router(agents_router, prefix="/agents")

# Knowledge routes
app.include_router(knowledge_router, prefix="/knowledge")


# ============== Providers Public Endpoints ==============

@app.get("/providers")
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


# ============== Root Endpoints ==============

@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "MyCrew API", "status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}