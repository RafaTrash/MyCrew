import os


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


OPEN_WEBUI_URL = env("OPEN_WEBUI_URL", "http://open-webui:8080")
OPEN_WEBUI_API_KEY = env("OPEN_WEBUI_API_KEY", "")
OPEN_WEBUI_TOKEN = env("OPEN_WEBUI_TOKEN", "")
N8N_URL = env("N8N_URL", "http://n8n:5678")
OLLAMA_URL = env("OLLAMA_URL", "http://ollama:11434")
DOZZLE_URL = env("DOZZLE_URL", "http://dozzle:8080")
PORTAINER_URL = env("PORTAINER_URL", "http://portainer:9000")
UPTIME_KUMA_URL = env("UPTIME_KUMA_URL", "http://uptime-kuma:3001")
AIDER_URL = env("AIDER_URL", "http://aider:8501")
OLLAMA_TIMEOUT = int(env("OLLAMA_REQUEST_TIMEOUT", "240") or "240")
OLLAMA_NUM_PREDICT = int(env("OLLAMA_NUM_PREDICT", "512") or "512")
OLLAMA_KEEP_ALIVE = env("OLLAMA_KEEP_ALIVE", "30m")
EMBEDDING_MODEL = env("EMBEDDING_MODEL", "nomic-embed-text")
AGENTS_DIR = env("AGENTS_DIR", "/app/agents")
QDRANT_URL = env("QDRANT_URL", "http://qdrant:6333")
QDRANT_COLLECTION = env("QDRANT_COLLECTION", "mycrew_agent_kb")
QDRANT_TOP_K = int(env("QDRANT_TOP_K", "4") or "4")
N8N_CHAT_FLOW_WEBHOOK = env("N8N_CHAT_FLOW_WEBHOOK", "")
N8N_KNOWLEDGE_FLOW_WEBHOOK = env("N8N_KNOWLEDGE_FLOW_WEBHOOK", "")

# Enderecos publicos (host) exibidos no dashboard do frontend.
PUBLIC_OPEN_WEBUI = env("PUBLIC_OPEN_WEBUI", "http://localhost:3001")
PUBLIC_N8N = env("PUBLIC_N8N", "http://localhost:5678")
PUBLIC_QDRANT = env("PUBLIC_QDRANT", "http://localhost:6333")
PUBLIC_QDRANT_DASHBOARD = env("PUBLIC_QDRANT_DASHBOARD", "http://localhost:6333/dashboard")
PUBLIC_OLLAMA = env("PUBLIC_OLLAMA", "http://localhost:11435")
PUBLIC_BACKEND = env("PUBLIC_BACKEND", "http://localhost:8082")
PUBLIC_FRONTEND = env("PUBLIC_FRONTEND", "http://localhost:8081")
PUBLIC_DOZZLE = env("PUBLIC_DOZZLE", "http://localhost:8085/dozzle")
PUBLIC_PORTAINER = env("PUBLIC_PORTAINER", "http://localhost:9000")
PUBLIC_UPTIME_KUMA = env("PUBLIC_UPTIME_KUMA", "http://localhost:3002")
PUBLIC_AIDER = env("PUBLIC_AIDER", "http://localhost:8501")
