"""
Database module - centralized database connection and utilities
"""
from sqlalchemy import create_engine, text
import os

# Database configuration from environment
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_USER = os.getenv("POSTGRES_USER", "mycrew")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "")
POSTGRES_DB = os.getenv("POSTGRES_DB", "mycrew")
DATABASE_URL = os.getenv("DATABASE_URL", f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}")

# Create engine
engine = create_engine(DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://"), echo=False)


def get_db_connection():
    """Get a database connection."""
    return engine.connect()


def execute_query(query: str, params: dict = None):
    """Execute a SQL query with optional parameters."""
    with get_db_connection() as conn:
        return conn.execute(text(query), params or {}).fetchone()