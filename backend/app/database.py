import os
from contextlib import contextmanager

import psycopg2
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
