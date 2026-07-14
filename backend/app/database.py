import os
from contextlib import contextmanager

import psycopg2
import redis
from psycopg2.extras import RealDictCursor

from .config import env


def get_db_connection():
    """Create database connection from environment variables."""
    return psycopg2.connect(
        host=env("POSTGRES_HOST", "postgres"),
        port=int(env("POSTGRES_PORT", "5432") or "5432"),
        database=env("POSTGRES_DB", "litellm"),
        user=env("POSTGRES_USER", "litellm"),
        password=env("POSTGRES_PASSWORD", "litellm_password"),
        cursor_factory=RealDictCursor,
    )


@contextmanager
def get_db_cursor(commit: bool = False):
    """Context manager for database cursor operations."""
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        yield cursor
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cursor.close()
        conn.close()


def get_redis_client():
    """Get Redis client for caching."""
    return redis.Redis(
        host=env("REDIS_HOST", "redis"),
        port=int(env("REDIS_PORT", "6379") or "6379"),
        db=int(env("REDIS_DB", "0") or "0"),
        decode_responses=True,
    )


def init_iot_table():
    """Initialize the IoT devices table if it doesn't exist."""
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mycrew_iotdevices (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                ip_address VARCHAR(45) NOT NULL,
                port INTEGER DEFAULT 22,
                username VARCHAR(255) DEFAULT 'root',
                description TEXT,
                auth_method VARCHAR(20) DEFAULT 'password',
                password_hash TEXT,
                private_key TEXT,
                status VARCHAR(50) DEFAULT 'disconnected',
                last_connection TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)
        
        # Create indexes for faster queries
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_mycrew_iotdevices_name ON mycrew_iotdevices(name);
            CREATE INDEX IF NOT EXISTS idx_mycrew_iotdevices_ip ON mycrew_iotdevices(ip_address);
        """)


def init_knowledge_tables():
    """Initialize knowledge-related tables in PostgreSQL."""
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mycrew_knowledge_items (
                id SERIAL PRIMARY KEY,
                persona_id VARCHAR(255) NOT NULL,
                qdrant_point_id UUID,
                title VARCHAR(500),
                source VARCHAR(255),
                tags JSONB,
                chunk_index INTEGER DEFAULT 0,
                content_preview TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)
        
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_mycrew_knowledge_persona ON mycrew_knowledge_items(persona_id);
            CREATE INDEX IF NOT EXISTS idx_mycrew_knowledge_source ON mycrew_knowledge_items(source);
            CREATE INDEX IF NOT EXISTS idx_mycrew_knowledge_created ON mycrew_knowledge_items(created_at DESC);
        """)


def init_chat_tables():
    """Initialize chat session and memory tables."""
    with get_db_cursor(commit=True) as cur:
        # Tabela de sessões de chat
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mycrew_chat_sessions (
                id UUID PRIMARY KEY,
                persona_id VARCHAR(255) NOT NULL,
                model VARCHAR(255) DEFAULT '',
                temperature FLOAT DEFAULT 0.7,
                status VARCHAR(20) DEFAULT 'active',
                total_messages INTEGER DEFAULT 0,
                metrics JSONB DEFAULT '{}',
                started_at TIMESTAMP DEFAULT NOW(),
                finalized_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_persona ON mycrew_chat_sessions(persona_id);
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON mycrew_chat_sessions(status);
        """)

        # Tabela de memória extraída de conversas
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mycrew_conversation_memory (
                id UUID PRIMARY KEY,
                session_id UUID REFERENCES mycrew_chat_sessions(id) ON DELETE CASCADE,
                persona_id VARCHAR(255) NOT NULL,
                memory_type VARCHAR(50) NOT NULL,
                title VARCHAR(500),
                content TEXT,
                tags JSONB DEFAULT '[]',
                created_at TIMESTAMP DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_memory_persona ON mycrew_conversation_memory(persona_id);
            CREATE INDEX IF NOT EXISTS idx_memory_session ON mycrew_conversation_memory(session_id);
            CREATE INDEX IF NOT EXISTS idx_memory_type ON mycrew_conversation_memory(memory_type);
        """)

        # Tabela de mensagens individuais (para auditoria)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS mycrew_chat_messages (
                id SERIAL PRIMARY KEY,
                session_id UUID REFERENCES mycrew_chat_sessions(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL,
                content TEXT,
                timestamp TIMESTAMP DEFAULT NOW()
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_messages_session ON mycrew_chat_messages(session_id);
        """)