"""
Central configuration - environment variables and settings
"""
import os

# Ollama settings
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_REQUEST_TIMEOUT = int(os.getenv("OLLAMA_REQUEST_TIMEOUT", "30"))
OLLAMA_EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")

# JWT settings
JWT_SECRET = os.getenv("JWT_SECRET", "mycrew-jwt-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Qdrant settings
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "mycrew_agent_kb")

# Crypto settings
CRYPTO_KEY = os.getenv("MYCREW_CRYPTO_KEY", "tYYqiZd89uNTfzGsdudmuKGAd1aBTROyAVpet8u7WEs=")