"""
Core utilities - helper functions used across routers
"""
import httpx
from typing import Optional
from .config import OLLAMA_URL, OLLAMA_REQUEST_TIMEOUT, OLLAMA_EMBEDDING_MODEL


def formatSize(bytes_size: int) -> str:
    """Format bytes to human readable string (KB, MB, GB)."""
    if bytes_size >= 1024**3:
        return f"{bytes_size / (1024**3):.1f} GB"
    elif bytes_size >= 1024**2:
        return f"{bytes_size / (1024**2):.0f} MB"
    elif bytes_size >= 1024:
        return f"{bytes_size / 1024:.0f} KB"
    return f"{bytes_size} B"


def formatContext(context_length: int) -> str:
    """Format context length to human readable string (e.g., 128K, 2M)."""
    if context_length >= 1024 * 1024:
        return f"{context_length / (1024 * 1024):.0f}M"
    elif context_length >= 1024:
        return f"{context_length / 1024:.0f}K"
    return f"{context_length}"


def getModelKind(name: str) -> Optional[str]:
    """Determine model kind based on name."""
    name_lower = name.lower() if name else ""
    if "embed" in name_lower:
        return "embedding"
    if "vision" in name_lower or "visual" in name_lower:
        return "vision"
    return "chat"


async def fetchModelInfoOpenRouter(base_url: str, api_key: str, model_name: str) -> dict:
    """Fetch model metadata from OpenRouter API."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{base_url}/v1/models",
                headers={"Authorization": f"Bearer {api_key}"}
            )
            if response.status_code != 200:
                return {}
            
            data = response.json()
            models = data.get("data", [])
            
            for model in models:
                if model.get("id") == model_name or model.get("name", "").lower() == model_name.lower():
                    context_length = model.get("context_length", 8192)
                    return {
                        "kind": getModelKind(model_name),
                        "context": formatContext(context_length)
                    }
            
            return {
                "kind": getModelKind(model_name),
                "context": "8K"
            }
    except Exception:
        return {}


def _generate_model_id() -> str:
    """Generate a unique model ID."""
    import uuid
    return str(uuid.uuid4())


__all__ = [
    "formatSize",
    "formatContext", 
    "getModelKind",
    "fetchModelInfoOpenRouter",
    "_generate_model_id"
]