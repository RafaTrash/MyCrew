from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import os
import socket
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import io

import httpx
import paramiko
from cryptography.fernet import Fernet
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .config import (
    AGENTS_DIR,
    EMBEDDING_MODEL,
    N8N_CHAT_FLOW_WEBHOOK,
    N8N_KNOWLEDGE_FLOW_WEBHOOK,
    N8N_URL,
    DOZZLE_URL,
    PORTAINER_URL,
    UPTIME_KUMA_URL,
    AIDER_URL,
    WATCHTOWER_URL,
    LITELLM_URL,
    OLLAMA_KEEP_ALIVE,
    OLLAMA_NUM_PREDICT,
    OLLAMA_TIMEOUT,
    OLLAMA_URL,
    OPEN_WEBUI_API_KEY,
    OPEN_WEBUI_TOKEN,
    OPEN_WEBUI_URL,
    PUBLIC_BACKEND,
    PUBLIC_FRONTEND,
    PUBLIC_N8N,
    PUBLIC_OLLAMA,
    PUBLIC_OPEN_WEBUI,
    PUBLIC_QDRANT,
    PUBLIC_QDRANT_DASHBOARD,
    PUBLIC_DOZZLE,
    PUBLIC_PORTAINER,
    PUBLIC_UPTIME_KUMA,
    PUBLIC_AIDER,
    PUBLIC_WATCHTOWER,
    PUBLIC_LITELLM,
    PUBLIC_POSTGRES,
    PUBLIC_REDIS,
    QDRANT_COLLECTION,
    QDRANT_TOP_K,
    QDRANT_URL,
)
from .database import get_db_cursor, get_redis_client, init_iot_table, init_knowledge_tables
from .schemas import (
    ChatRequest,
    ChatResponse,
    FlowStartRequest,
    FlowStartResponse,
    IoTDeviceCreate,
    IoTDeviceResponse,
    IoTDeviceUpdate,
    KnowledgeAttachRequest,
    KnowledgeSearchResponse,
    SshConnectRequest,
    SshConnectResponse,
)

app = FastAPI(title="MyCrew Backend", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FLOW_RUNS: dict[str, dict[str, Any]] = {}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_cipher() -> Fernet:
    key = os.getenv("MYCREW_CRYPTO_KEY")
    if not key or key == "CHANGE_ME_IN_PRODUCTION":
        raise RuntimeError(
            "MYCREW_CRYPTO_KEY não configurada. "
            "Gere uma chave com: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\" "
            "e defina a variável de ambiente."
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:
        raise RuntimeError(f"MYCREW_CRYPTO_KEY inválida: {exc}")


def encrypt_password(password: str) -> str:
    cipher = _get_cipher()
    return cipher.encrypt(password.encode()).decode()


def decrypt_password(password_hash: str) -> str:
    cipher = _get_cipher()
    try:
        return cipher.decrypt(password_hash.encode()).decode()
    except Exception:
        return ""


def openwebui_headers() -> dict[str, str]:
    token = OPEN_WEBUI_API_KEY or OPEN_WEBUI_TOKEN
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def list_agent_files() -> list[Path]:
    agents_path = Path(AGENTS_DIR)
    if not agents_path.exists():
        return []
    return sorted([p for p in agents_path.iterdir() if p.is_file() and p.suffix.lower() == ".md"])


def parse_agent_doc(path: Path) -> dict[str, Any]:
    content = path.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.splitlines() if line.strip()]
    name = path.stem
    role = "Agente"
    objective = ""

    for line in lines[:25]:
        if line.lower().startswith("nome:"):
            name = line.split(":", 1)[1].strip() or name
        elif line.lower().startswith("tipo:"):
            role = line.split(":", 1)[1].strip() or role
        elif line.lower().startswith("missao:") or line.lower().startswith("missão:"):
            objective = line.split(":", 1)[1].strip()

    return {
        "id": path.stem.lower(),
        "slug": path.stem.lower(),
        "nome": name,
        "papel": role,
        "objetivo": objective,
        "doc": path.name,
        "source": "local-doc",
    }


def get_agent_doc_path(persona_id: str) -> Path:
    safe = persona_id.strip().lower()
    path = Path(AGENTS_DIR) / f"{safe}.md"
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="persona nao encontrada")
    return path


def read_agent_doc(persona_id: str) -> str:
    safe = persona_id.strip().lower()
    path = Path(AGENTS_DIR) / f"{safe}.md"
    if not path.exists() or not path.is_file():
        return ""
    return path.read_text(encoding="utf-8").strip()


def load_knowledge_block(persona_id: str) -> str:
    folder = Path(AGENTS_DIR) / persona_id.lower()
    if not folder.exists() or not folder.is_dir():
        return ""

    chunks: list[str] = []
    for file_path in sorted(folder.glob("*.md")):
        data = file_path.read_text(encoding="utf-8").strip()
        if data:
            chunks.append(f"### {file_path.name}\n{data}")
    return "\n\n".join(chunks)


def chunk_text(content: str, size: int = 900, overlap: int = 160) -> list[str]:
    clean = " ".join(content.split())
    if not clean:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(clean):
        end = min(len(clean), start + size)
        chunks.append(clean[start:end])
        if end >= len(clean):
            break
        start = max(0, end - overlap)
    return chunks


async def check_service(url: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(url)
        return {"ok": True, "status": resp.status_code}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def check_tcp_service(host: str, port: int, service_name: str = "") -> dict[str, Any]:
    """Check TCP connectivity for services like PostgreSQL and Redis."""
    try:
        loop = asyncio.get_running_loop()
        await asyncio.wait_for(
            loop.run_in_executor(None, lambda: socket.create_connection((host, port), timeout=3.0)),
            timeout=3.0
        )
        return {"ok": True, "status": "tcp_connected"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


async def fetch_qdrant_collection_info() -> dict[str, Any]:
    """Fetch real-time Qdrant collection info: status, points count, segments, optimizer status."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}")
            if resp.status_code == 200:
                result = resp.json().get("result", {})
                status = (result.get("status") or "").lower()
                vectors_count = int(result.get("vectors_count") or 0)
                points_count = int(result.get("points_count") or 0)
                segments_count = int(result.get("segments_count") or 0)
                optimizer_status = (result.get("optimizer_status") or "unknown").lower()
                return {
                    "name": QDRANT_COLLECTION,
                    "status": status if status in ("green", "yellow", "red") else "unknown",
                    "vectors_count": vectors_count,
                    "points_count": points_count,
                    "segments_count": segments_count,
                    "optimizer_status": optimizer_status,
                    "online": True,
                }
            return {
                "name": QDRANT_COLLECTION,
                "status": "offline",
                "vectors_count": 0,
                "points_count": 0,
                "segments_count": 0,
                "optimizer_status": "unknown",
                "online": False,
                "error": f"HTTP {resp.status_code}",
            }
    except Exception as exc:
        return {
            "name": QDRANT_COLLECTION,
            "status": "offline",
            "vectors_count": 0,
            "points_count": 0,
            "segments_count": 0,
            "optimizer_status": "unknown",
            "online": False,
            "error": str(exc),
        }


async def fetch_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
        payload = resp.json()
        return [item.get("name", "") for item in payload.get("models", []) if item.get("name")]
    except Exception:
        return []


def parse_provider_from_model(model_id: str) -> tuple[str, str]:
    """Extract provider and model name from LiteLLM format (e.g., 'openai/gpt-4o' -> ('openai', 'gpt-4o'))."""
    if "/" in model_id:
        parts = model_id.split("/", 1)
        return parts[0].lower(), parts[1] if len(parts) > 1 else model_id
    return "unknown", model_id


def get_origin_for_provider(provider: str) -> str:
    """Determine origin based on provider."""
    local_providers = {"ollama"}
    return "local" if provider in local_providers else "api"


def get_provider_info(provider: str) -> dict[str, Any]:
    """Return display info for a provider (icon, color, label)."""
    provider_data = {
        "ollama": {"label": "Ollama", "color": "green"},
        "openai": {"label": "OpenAI", "color": "blue"},
        "openrouter": {"label": "OpenRouter", "color": "violet"},
        "gemini": {"label": "Google", "color": "amber"},
        "groq": {"label": "Groq", "color": "cyan"},
        "xai": {"label": "Grok", "color": "pink"},
        "anthropic": {"label": "Anthropic", "color": "orange"},
    }
    return provider_data.get(provider, {"label": provider.title(), "color": "muted"})


async def fetch_litellm_models() -> list[dict[str, Any]]:
    """Fetch all available models from LiteLLM including Ollama models."""
    try:
        headers = {"Content-Type": "application/json"}
        # Try to get master key from config for authentication
        master_key = os.getenv("LITELLM_MASTER_KEY", "")
        if master_key:
            headers["Authorization"] = f"Bearer {master_key}"
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{LITELLM_URL}/v1/models", headers=headers)
            resp.raise_for_status()
        payload = resp.json()
        models_raw = payload.get("data", [])
        if not isinstance(models_raw, list):
            return []
        
        models = []
        for item in models_raw:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id", "")).strip()
            if not model_id:
                continue
            
            provider, model_name = parse_provider_from_model(model_id)
            
            # Determine mode from item or default to chat
            model_info = item.get("info", {}) if isinstance(item.get("info"), dict) else {}
            mode = model_info.get("mode", "chat")
            
            models.append({
                "id": model_id,
                "name": model_name,
                "provider": provider,
                "origin": get_origin_for_provider(provider),
                "mode": mode,
                "source": "litellm",
            })
        return models
    except Exception:
        return []


def resolve_avatar(raw: Any) -> str:
    avatar = str(raw or "").strip()
    if avatar.startswith("/"):
        avatar = PUBLIC_OPEN_WEBUI.rstrip("/") + avatar
    if not (avatar.startswith("http") or avatar.startswith("data:")):
        return ""
    return avatar


async def fetch_openwebui_model_detail(model_id: str) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                f"{OPEN_WEBUI_URL}/api/v1/models/model",
                params={"id": model_id},
                headers=openwebui_headers(),
            )
            resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


async def fetch_openwebui_agents() -> list[dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(
                f"{OPEN_WEBUI_URL}/api/v1/models/list",
                headers=openwebui_headers(),
            )
            resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return []

    items = payload if isinstance(payload, list) else (
        payload.get("items") or payload.get("data") or payload.get("models") or payload.get("results") or []
    )
    if not isinstance(items, list):
        return []

    agents: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or item.get("model") or "").strip()
        if not model_id:
            continue
        name = str(item.get("name") or model_id).strip()
        meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
        info = item.get("info") if isinstance(item.get("info"), dict) else {}
        description = str(meta.get("description") or "").strip()
        base_model = str(
            item.get("base_model_id")
            or info.get("base_model_id")
            or meta.get("base_model_id")
            or ""
        ).strip()

        avatar = resolve_avatar(meta.get("profile_image_url"))

        tags_raw = meta.get("tags") if isinstance(meta.get("tags"), list) else []
        tags = [str(t.get("name") if isinstance(t, dict) else t).strip() for t in tags_raw]
        tags = [t for t in tags if t]

        agents.append(
            {
                "id": model_id,
                "slug": model_id,
                "nome": name,
                "papel": description or "Agente Open WebUI",
                "objetivo": description,
                "model": base_model or model_id,
                "avatar": avatar,
                "tags": tags,
                "doc": f"{model_id}.md",
                "source": "open-webui",
            }
        )

    return agents


async def openwebui_chat(model_id: str, messages: list[dict[str, str]]) -> tuple[str, dict[str, Any]]:
    body = {
        "model": model_id,
        "messages": messages,
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        resp = await client.post(
            f"{OPEN_WEBUI_URL}/api/chat/completions",
            content=json.dumps(body).encode("utf-8"),
            headers=openwebui_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    choices = data.get("choices") or []
    text = ""
    if choices and isinstance(choices[0], dict):
        text = ((choices[0].get("message") or {}).get("content") or "").strip()
    usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
    return text, usage


async def ollama_embedding(text: str, model: str = EMBEDDING_MODEL) -> list[float]:
    payload = {"model": model, "prompt": text}
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            content=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
    data = resp.json()
    vector = data.get("embedding") or data.get("vector") or data.get("data")
    if not isinstance(vector, list) or not vector:
        raise HTTPException(status_code=502, detail="embedding vazio")
    return vector


async def ensure_qdrant_collection(vector_size: int) -> None:
    import logging
    logger = logging.getLogger("mycrew.knowledge")
    async with httpx.AsyncClient(timeout=8.0) as client:
        get_resp = await client.get(f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}")
        if get_resp.status_code == 200:
            existing_size = None
            try:
                vectors_cfg = (
                    get_resp.json()
                    .get("result", {})
                    .get("config", {})
                    .get("params", {})
                    .get("vectors")
                )
                if isinstance(vectors_cfg, dict):
                    existing_size = vectors_cfg.get("size")
            except Exception:
                existing_size = None

            if existing_size == vector_size:
                logger.info("Collection %s already exists with size %d", QDRANT_COLLECTION, vector_size)
                return
            # Dimensao divergente na colecao dedicada do MyCrew: recria do zero.
            logger.warning(
                "Collection %s exists but size mismatch (existing=%s, needed=%d). Recreating.",
                QDRANT_COLLECTION, existing_size, vector_size,
            )
            del_resp = await client.delete(f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}")
            if del_resp.status_code not in (200, 204):
                logger.warning("Delete collection returned %d: %s", del_resp.status_code, del_resp.text)
        else:
            logger.info(
                "Collection %s not found (status=%d). Creating new one with size %d.",
                QDRANT_COLLECTION, get_resp.status_code, vector_size,
            )

        create_payload = {
            "vectors": {
                "size": vector_size,
                "distance": "Cosine",
            }
        }
        put_resp = await client.put(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}",
            content=json.dumps(create_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        put_resp.raise_for_status()
        logger.info("Collection %s created/updated with size %d", QDRANT_COLLECTION, vector_size)


async def upsert_knowledge_points(persona_id: str, title: str, source: str, chunks: list[str], tags: list[str]) -> dict[str, Any]:
    import logging
    logger = logging.getLogger("mycrew.knowledge")
    total = 0
    point_ids = []
    errors = []

    for index, chunk in enumerate(chunks):
        try:
            vector = await ollama_embedding(chunk)
            await ensure_qdrant_collection(len(vector))
            point_id = str(uuid4())
            point = {
                "id": point_id,
                "vector": vector,
                "payload": {
                    "persona_id": persona_id,
                    "title": title,
                    "source": source,
                    "tags": tags,
                    "content": chunk,
                    "chunk_index": index,
                    "created_at": now_iso(),
                },
            }
            point_ids.append(point_id)
            upsert_body = {"points": [point], "wait": True}
            async with httpx.AsyncClient(timeout=12.0) as client:
                resp = await client.put(
                    f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points",
                    content=json.dumps(upsert_body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
            total += 1
        except HTTPException:
            raise
        except Exception as exc:
            errors.append(f"chunk {index}: {exc}")
            logger.error("Failed to upsert chunk %d for persona=%s: %s", index, persona_id, exc)

    if not total and errors:
        raise HTTPException(
            status_code=500,
            detail=f"Nenhum chunk foi inserido no Qdrant. Erros: {'; '.join(errors[:3])}",
        )

    qdrant_summary = {"inserted_points": total, "collection": QDRANT_COLLECTION, "point_ids": point_ids}
    if errors:
        qdrant_summary["warnings"] = errors

    # Save metadata to PostgreSQL (best-effort)
    try:
        import json as json_module
        with get_db_cursor(commit=True) as cur:
            for idx, point_id in enumerate(point_ids):
                cur.execute("""
                    INSERT INTO mycrew_knowledge_items (persona_id, qdrant_point_id, title, source, tags, chunk_index, content_preview)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    persona_id,
                    point_id,
                    title,
                    source,
                    json_module.dumps(tags),
                    idx,
                    chunks[idx][:200] if len(chunks[idx]) > 200 else chunks[idx],
                ))
        logger.info("Metadata saved to PostgreSQL for %d chunks (persona=%s)", len(point_ids), persona_id)
    except Exception as exc:
        logger.warning("Failed to save metadata to PostgreSQL (persona=%s): %s", persona_id, exc)

    # Cache the result in Redis (best-effort)
    try:
        redis_client = get_redis_client()
        cache_key = f"knowledge:last_attachments:{persona_id}"
        redis_client.lpush(cache_key, json.dumps({"title": title, "source": source, "chunks": total, "timestamp": now_iso()}))
        redis_client.ltrim(cache_key, 0, 9)  # Keep last 10 items
        redis_client.expire(cache_key, 86400)  # 24h TTL
        logger.info("Cache updated in Redis for persona=%s", persona_id)
    except Exception as exc:
        logger.warning("Failed to cache in Redis (persona=%s): %s", persona_id, exc)

    return {
        "inserted_points": total,
        "collection": QDRANT_COLLECTION,
        "point_ids": point_ids,
        "errors": errors if errors else [],
    }


async def search_knowledge(persona_id: str, query_text: str, top_k: int = QDRANT_TOP_K) -> list[dict[str, Any]]:
    try:
        vector = await ollama_embedding(query_text)
    except Exception:
        return []

    body = {
        "vector": vector,
        "limit": max(1, top_k),
        "with_payload": True,
        "with_vector": False,
        "filter": {
            "must": [
                {
                    "key": "persona_id",
                    "match": {"value": persona_id},
                }
            ]
        },
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/search",
                content=json.dumps(body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
        payload = resp.json()
    except Exception:
        return []

    result = payload.get("result") if isinstance(payload, dict) else []
    if not isinstance(result, list):
        return []

    items: list[dict[str, Any]] = []
    for row in result:
        content = ((row.get("payload") or {}).get("content") or "").strip()
        if not content:
            continue
        items.append(
            {
                "score": row.get("score"),
                "title": ((row.get("payload") or {}).get("title") or "Conhecimento").strip(),
                "source": ((row.get("payload") or {}).get("source") or "manual").strip(),
                "content": content,
            }
        )
    return items


async def trigger_flow(flow_type: str, persona_id: str, message: str | None, extra_payload: dict[str, Any]) -> FlowStartResponse:
    webhook_url = N8N_CHAT_FLOW_WEBHOOK if flow_type == "chat" else N8N_KNOWLEDGE_FLOW_WEBHOOK
    if not webhook_url:
        raise HTTPException(status_code=400, detail=f"webhook n8n para fluxo '{flow_type}' nao configurado")

    flow_id = str(uuid4())
    started_at = now_iso()

    payload = {
        "flow_id": flow_id,
        "flow_type": flow_type,
        "persona_id": persona_id,
        "message": message or "",
        "payload": extra_payload,
        "started_at": started_at,
    }

    FLOW_RUNS[flow_id] = {
        "flow_id": flow_id,
        "flow_type": flow_type,
        "persona_id": persona_id,
        "status": "running",
        "started_at": started_at,
        "updated_at": started_at,
        "response": {},
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(webhook_url, json=payload)
        response_body = {}
        try:
            response_body = resp.json() if resp.text else {}
        except Exception:
            response_body = {"raw": resp.text}

        status = "completed" if resp.status_code < 400 else "error"
        FLOW_RUNS[flow_id]["status"] = status
        FLOW_RUNS[flow_id]["updated_at"] = now_iso()
        FLOW_RUNS[flow_id]["response"] = response_body
        if status == "error":
            FLOW_RUNS[flow_id]["error"] = f"HTTP {resp.status_code}"
    except Exception as exc:
        FLOW_RUNS[flow_id]["status"] = "error"
        FLOW_RUNS[flow_id]["updated_at"] = now_iso()
        FLOW_RUNS[flow_id]["error"] = str(exc)

    return FlowStartResponse(
        flow_id=flow_id,
        status=FLOW_RUNS[flow_id]["status"],
        started_at=started_at,
        response=FLOW_RUNS[flow_id].get("response") or {},
    )


@app.get("/")
async def root() -> dict[str, Any]:
    return {
        "service": "mycrew-backend",
        "version": "2.1.0",
        "docs": "/docs",
        "timestamp": now_iso(),
    }


@app.get("/health")
@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "mycrew-backend", "timestamp": now_iso()}


@app.get("/api/models")
async def models_list() -> dict[str, Any]:
    """
    Lista todos os modelos disponíveis agrupados por provider/origem.
    Retorna modelos do Ollama (locais) e do LiteLLM (APIs).
    """
    ollama_models = await fetch_models()
    litellm_models = await fetch_litellm_models()
    
    # Formata modelos do Ollama para formato unificado
    ollama_formatted = [
        {
            "id": m,
            "name": m,
            "provider": "ollama",
            "origin": "local",
            "mode": "chat",
            "source": "ollama",
        }
        for m in ollama_models
    ]
    
    # Combina todos os modelos
    all_models = ollama_formatted + litellm_models
    
    # Agrupa por provider
    by_provider: dict[str, list[dict[str, Any]]] = {}
    for model in all_models:
        provider = model.get("provider", "unknown")
        if provider not in by_provider:
            by_provider[provider] = []
        by_provider[provider].append(model)
    
    # Ordena providers: local primeiro, depois por nome
    provider_order = {"ollama": 0, "openai": 1, "openrouter": 2, "gemini": 3, "groq": 4, "xai": 5}
    sorted_providers = sorted(by_provider.keys(), key=lambda p: (provider_order.get(p, 99), p))
    
    return {
        "models": all_models,
        "by_provider": by_provider,
        "providers": sorted_providers,
        "total": len(all_models),
        "counter": {
            "local": len(ollama_formatted),
            "api": len(litellm_models),
        },
    }


@app.get("/api/status")
async def status() -> dict[str, Any]:
    service_defs = [
        {
            "key": "open_webui",
            "label": "Open WebUI",
            "address": PUBLIC_OPEN_WEBUI,
            "internal": OPEN_WEBUI_URL,
            "health": f"{OPEN_WEBUI_URL}/api/version",
        },
        {
            "key": "ollama",
            "label": "Ollama",
            "address": PUBLIC_OLLAMA,
            "internal": OLLAMA_URL,
            "health": f"{OLLAMA_URL}/api/tags",
        },
        {
            "key": "qdrant",
            "label": "Qdrant",
            "address": PUBLIC_QDRANT,
            "internal": QDRANT_URL,
            "health": f"{QDRANT_URL}/collections",
        },
        {
            "key": "n8n",
            "label": "n8n",
            "address": PUBLIC_N8N,
            "internal": N8N_URL,
            "health": N8N_URL,
        },
        {
            "key": "postgres",
            "label": "PostgreSQL",
            "address": PUBLIC_POSTGRES,
            "internal": "postgres",
            "health": ("tcp", 5432),
        },
        {
            "key": "redis",
            "label": "Redis",
            "address": PUBLIC_REDIS,
            "internal": "redis",
            "health": ("tcp", 6379),
        },
        {
            "key": "dozzle",
            "label": "Dozzle",
            "address": PUBLIC_DOZZLE,
            "internal": DOZZLE_URL,
            "health": f"{DOZZLE_URL}/dozzle/healthcheck",
        },
        {
            "key": "portainer",
            "label": "Portainer",
            "address": PUBLIC_PORTAINER,
            "internal": PORTAINER_URL,
            "health": f"{PORTAINER_URL}/api/status",
        },
        {
            "key": "uptime_kuma",
            "label": "Uptime Kuma",
            "address": PUBLIC_UPTIME_KUMA,
            "internal": UPTIME_KUMA_URL,
            "health": UPTIME_KUMA_URL,
        },
        {
            "key": "aider",
            "label": "Aider (Dev Agent)",
            "address": PUBLIC_AIDER,
            "internal": AIDER_URL,
            "health": f"{AIDER_URL}/_stcore/health",
        },
        {
            "key": "litellm",
            "label": "LiteLLM (AI Gateway)",
            "address": PUBLIC_LITELLM,
            "internal": LITELLM_URL,
            "health": f"{LITELLM_URL}/health/liveliness",
        },
        {
            "key": "watchtower",
            "label": "Watchtower",
            "address": PUBLIC_WATCHTOWER,
            "internal": WATCHTOWER_URL,
            "health": f"{WATCHTOWER_URL}/",
        },
    ]

    # Build health check tasks - HTTP or TCP
    health_tasks = []
    for item in service_defs:
        if isinstance(item["health"], tuple) and item["health"][0] == "tcp":
            health_tasks.append(check_tcp_service(item["internal"], item["health"][1]))
        else:
            health_tasks.append(check_service(item["health"]))

    health_results, models, openwebui_agents, qdrant_info = await asyncio.gather(
        asyncio.gather(*health_tasks),
        fetch_models(),
        fetch_openwebui_agents(),
        fetch_qdrant_collection_info(),
    )

    services: list[dict[str, Any]] = []
    for definition, health in zip(service_defs, health_results):
        services.append(
            {
                "key": definition["key"],
                "label": definition["label"],
                "address": definition["address"],
                "internal": definition["internal"],
                "online": bool(health.get("ok")),
                "detail": health.get("error") if not health.get("ok") else "online",
            }
        )

    online_count = sum(1 for item in services if item["online"])

    return {
        "services": services,
        "endpoints": {
            "frontend": PUBLIC_FRONTEND,
            "backend": PUBLIC_BACKEND,
            "qdrant_dashboard": PUBLIC_QDRANT_DASHBOARD,
            "dozzle": PUBLIC_DOZZLE,
            "portainer": PUBLIC_PORTAINER,
            "uptime_kuma": PUBLIC_UPTIME_KUMA,
            "aider": PUBLIC_AIDER,
            "watchtower": PUBLIC_WATCHTOWER,
            "litellm": PUBLIC_LITELLM,
        },
        "ollama_models": models,
        "counters": {
            "services_total": len(services),
            "services_online": online_count,
            "models_total": len(models),
            "openwebui_agents": len(openwebui_agents),
        },
        "qdrant_collection": qdrant_info,
        "updated_at": now_iso(),
    }


@app.get("/api/personas")
async def personas() -> dict[str, Any]:
    openwebui_agents = await fetch_openwebui_agents()

    # A listagem do OpenWebUI omite o avatar; buscamos no endpoint de detalhe.
    details = await asyncio.gather(
        *[fetch_openwebui_model_detail(agent["id"]) for agent in openwebui_agents]
    )
    for agent, detail in zip(openwebui_agents, details):
        meta = detail.get("meta") if isinstance(detail.get("meta"), dict) else {}
        avatar = resolve_avatar(meta.get("profile_image_url"))
        if avatar:
            agent["avatar"] = avatar

    return {"personas": openwebui_agents}


@app.get("/api/agent-doc")
async def agent_doc(persona_id: str = Query(..., min_length=1)) -> dict[str, Any]:
    path = get_agent_doc_path(persona_id)
    return {
        "persona_id": persona_id,
        "doc": path.name,
        "content": path.read_text(encoding="utf-8"),
        "updated_at": now_iso(),
    }


@app.post("/api/knowledge/attach")
async def knowledge_attach(payload: KnowledgeAttachRequest) -> dict[str, Any]:
    import logging
    logger = logging.getLogger("mycrew.knowledge")
    try:
        chunks = chunk_text(payload.content)
        if not chunks:
            raise HTTPException(status_code=400, detail="conteudo vazio apos normalizacao")

        logger.info(
            "Attaching knowledge: persona=%s title=%s source=%s chunks=%d",
            payload.persona_id, payload.title, payload.source, len(chunks),
        )

        result = await upsert_knowledge_points(
            persona_id=payload.persona_id.strip().lower(),
            title=payload.title.strip(),
            source=payload.source.strip() or "manual",
            chunks=chunks,
            tags=payload.tags,
        )

        return {
            "ok": True,
            "persona_id": payload.persona_id.strip().lower(),
            "chunks": len(chunks),
            "qdrant": result,
            "timestamp": now_iso(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Falha ao anexar conhecimento para persona=%s", payload.persona_id)
        raise HTTPException(
            status_code=500,
            detail=f"Erro ao anexar conhecimento: {str(exc)}",
        )


@app.get("/api/knowledge/files")
async def knowledge_files() -> dict[str, Any]:
    """Get list of indexed knowledge files from PostgreSQL."""
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT persona_id, title, source, tags, chunk_index, created_at
                FROM mycrew_knowledge_items 
                ORDER BY created_at DESC
                LIMIT 100
            """)
            rows = cur.fetchall()
        
        files = []
        for row in rows:
            files.append({
                "persona_id": row["persona_id"],
                "title": row["title"] or row["source"] or "Sem título",
                "source": row["source"],
                "tags": row["tags"] if isinstance(row["tags"], list) else [],
                "chunks": 1,  # Each row is one chunk
                "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            })
        return {"files": files, "total": len(files)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao buscar arquivos: {exc}")


@app.get("/api/knowledge/search", response_model=KnowledgeSearchResponse)
async def knowledge_search(
    persona_id: str = Query(..., min_length=1),
    q: str = Query(..., min_length=1),
    top_k: int = Query(QDRANT_TOP_K, ge=1, le=20),
) -> KnowledgeSearchResponse:
    items = await search_knowledge(persona_id.strip().lower(), q.strip(), top_k=top_k)
    return KnowledgeSearchResponse(items=items, total=len(items))


@app.post("/api/flows/start", response_model=FlowStartResponse)
async def flows_start(payload: FlowStartRequest) -> FlowStartResponse:
    return await trigger_flow(payload.flow_type, payload.persona_id, payload.message, payload.payload)


@app.get("/api/flows/{flow_id}")
async def flow_status(flow_id: str) -> dict[str, Any]:
    flow = FLOW_RUNS.get(flow_id)
    if not flow:
        raise HTTPException(status_code=404, detail="flow nao encontrado")
    return flow


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    persona_id = payload.persona_id.strip()
    model_name = (payload.model or persona_id).strip()
    if not model_name:
        raise HTTPException(status_code=400, detail="agente/modelo nao informado")

    qdrant_context_items: list[dict[str, Any]] = []
    if payload.retrieve_knowledge:
        qdrant_context_items = await search_knowledge(
            persona_id.lower(), payload.message.strip(), top_k=QDRANT_TOP_K
        )

    messages: list[dict[str, str]] = []
    if qdrant_context_items:
        qdrant_context_text = "\n\n".join(
            f"### {item['title']} (origem: {item['source']})\n{item['content']}"
            for item in qdrant_context_items
        )
        messages.append(
            {
                "role": "system",
                "content": "Conhecimento recuperado do Qdrant:\n" + qdrant_context_text,
            }
        )

    for item in payload.history[-12:]:
        role = item.role.strip().lower()
        if role in ("user", "assistant") and item.content.strip():
            messages.append({"role": role, "content": item.content.strip()})
    messages.append({"role": "user", "content": payload.message.strip()})

    try:
        text, usage = await openwebui_chat(model_name, messages)
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"erro no Open WebUI: {exc.response.text}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if not text:
        raise HTTPException(status_code=502, detail="resposta vazia do Open WebUI")

    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))

    return ChatResponse(
        reply=text,
        model=model_name,
        timestamp=now_iso(),
        usage={
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "knowledge_hits": len(qdrant_context_items),
        },
    )


def _ssh_exec(payload: SshConnectRequest) -> SshConnectResponse:
    """
    Sincrono: executa a conexao SSH em uma thread separada via run_in_executor.
    """
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        if payload.key_type == "key" and payload.private_key:
            key_file = io.StringIO(payload.private_key)
            try:
                private_key = paramiko.RSAKey.from_private_key(key_file)
            except paramiko.SSHException:
                try:
                    key_file.seek(0)
                    private_key = paramiko.Ed25519Key.from_private_key(key_file)
                except paramiko.SSHException:
                    raise HTTPException(status_code=400, detail="chave privada invalida (formato RSA ou Ed25519 esperado)")
            client.connect(
                hostname=payload.host,
                port=payload.port,
                username=payload.username,
                pkey=private_key,
                timeout=10,
            )
        else:
            client.connect(
                hostname=payload.host,
                port=payload.port,
                username=payload.username,
                password=payload.password,
                timeout=10,
            )

        output = ""
        if payload.command:
            stdin, stdout, stderr = client.exec_command(payload.command, timeout=15)
            stdout_str = stdout.read().decode("utf-8", errors="replace").strip()
            stderr_str = stderr.read().decode("utf-8", errors="replace").strip()
            lines = [s for s in [stdout_str, stderr_str] if s]
            output = "\n".join(lines)
        else:
            output = f"Conexao SSH estabelecida com {payload.host}:{payload.port} como {payload.username}"

        client.close()
        return SshConnectResponse(
            connected=True,
            host=payload.host,
            port=payload.port,
            username=payload.username,
            output=output,
        )

    except paramiko.AuthenticationException as exc:
        return SshConnectResponse(
            connected=False,
            host=payload.host,
            port=payload.port,
            username=payload.username,
            error=f"Falha de autenticacao: {exc}",
        )
    except paramiko.SSHException as exc:
        return SshConnectResponse(
            connected=False,
            host=payload.host,
            port=payload.port,
            username=payload.username,
            error=f"Erro SSH: {exc}",
        )
    except Exception as exc:
        return SshConnectResponse(
            connected=False,
            host=payload.host,
            port=payload.port,
            username=payload.username,
            error=f"Erro ao conectar: {exc}",
        )


@app.post("/api/iot/ssh/connect", response_model=SshConnectResponse)
async def ssh_connect(payload: SshConnectRequest) -> SshConnectResponse:
    """
    Conecta via SSH a um dispositivo IoT e retorna a saida do comando (se fornecido).
    """
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, _ssh_exec, payload)
    return result


@app.get("/api/iot/devices/{device_id}/credentials")
async def get_iot_device_credentials(device_id: int) -> dict[str, Any]:
    """Return decrypted credentials for a device (for SSH connections)."""
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT id, name, ip_address, port, username, auth_method, password_hash, private_key
            FROM mycrew_iotdevices 
            WHERE id = %s
        """, (device_id,))
        device = cur.fetchone()
        
        if not device:
            raise HTTPException(status_code=404, detail="Dispositivo nao encontrado")
    
    decrypted_password = ""
    if device.get("password_hash"):
        decrypted_password = decrypt_password(device["password_hash"])
    
    return {
        "id": device["id"],
        "host": device["ip_address"],
        "port": device["port"],
        "username": device["username"],
        "auth_method": device["auth_method"],
        "password": decrypted_password,
        "private_key": device.get("private_key") or "",
    }


@app.websocket("/api/iot/ssh/terminal")
async def ssh_terminal(websocket: WebSocket):
    """
    WebSocket para terminal SSH interativo.
    Primeira mensagem deve ser um JSON com os parametros de conexao:
    { "host": "...", "port": 22, "username": "root", "password": "...",
      "key_type": "password", "private_key": "...", "device_id": 123 }
    Se device_id for fornecido e password/private_key estiverem vazios,
    busca as credenciais criptografadas do banco.
    A partir dai, cada mensagem de texto do cliente e enviada ao shell SSH
    e a saida do shell e retornada ao cliente.
    """
    await websocket.accept()

    client: paramiko.SSHClient | None = None
    channel: paramiko.Channel | None = None
    transport: paramiko.Transport | None = None

    try:
        # --- 1. Receber parametros de conexao ---
        raw = await websocket.receive_text()
        try:
            params = json.loads(raw)
        except json.JSONDecodeError:
            await websocket.send_text(json.dumps({"error": "JSON invalido para parametros de conexao"}))
            await websocket.close(1008)
            return

        host = params.get("host", "").strip()
        port = int(params.get("port", 22))
        username = params.get("username", "root").strip()
        password = params.get("password", "")
        key_type = params.get("key_type", "password")
        private_key_str = params.get("private_key", "")
        cols = int(params.get("cols", 80))
        rows = int(params.get("rows", 24))
        device_id = params.get("device_id")

        # If device_id is provided and credentials are missing, fetch from DB
        if device_id and not password and not private_key_str and key_type == "password":
            try:
                creds = get_iot_device_credentials_sync(int(device_id))
                if creds:
                    host = creds.get("host", host) or host
                    username = creds.get("username", username) or username
                    password = creds.get("password", "") or ""
                    key_type = creds.get("auth_method", key_type) or key_type
                    private_key_str = creds.get("private_key", "") or ""
            except Exception:
                pass  # Use provided credentials if DB fetch fails

        if not host:
            await websocket.send_text(json.dumps({"error": "host nao informado"}))
            await websocket.close(1008)
            return

        # --- 2. Conectar SSH ---
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            if key_type == "key" and private_key_str:
                key_file = io.StringIO(private_key_str)
                try:
                    private_key = paramiko.RSAKey.from_private_key(key_file)
                except paramiko.SSHException:
                    try:
                        key_file.seek(0)
                        private_key = paramiko.Ed25519Key.from_private_key(key_file)
                    except paramiko.SSHException:
                        await websocket.send_text(json.dumps({"error": "chave privada invalida"}))
                        await websocket.close(1008)
                        return
                client.connect(
                    hostname=host, port=port, username=username,
                    pkey=private_key, timeout=10,
                )
            else:
                client.connect(
                    hostname=host, port=port, username=username,
                    password=password, timeout=10,
                )

            transport = client.get_transport()
            if not transport:
                await websocket.send_text(json.dumps({"error": "falha ao obter transporte SSH"}))
                await websocket.close(1011)
                return

            channel = transport.open_session()
            channel.get_pty(width=cols, height=rows, term="xterm-256color")
            channel.invoke_shell()
            # Small delay for shell initialization - don't send stty to avoid breaking some shells
            await asyncio.sleep(0.1)
        except paramiko.AuthenticationException as exc:
            await websocket.send_text(json.dumps({"error": f"Falha de autenticacao: {exc}"}))
            await websocket.close(1008)
            return
        except Exception as exc:
            await websocket.send_text(json.dumps({"error": f"Erro SSH: {exc}"}))
            await websocket.close(1011)
            return

        await websocket.send_text(json.dumps({"connected": True, "host": host, "port": port, "username": username}))

        # --- 3. Loop bidirecional ---
        async def reader():
            """Le do canal SSH e envia para o WebSocket."""
            try:
                while channel and not channel.closed:
                    # Check both stdout and stderr - use if/elif to avoid duplicate reads
                    if channel.recv_ready():
                        data = channel.recv(4096)
                        if data:
                            await websocket.send_text(json.dumps({"data": data.decode("utf-8", errors="replace")}))
                    elif channel.recv_stderr_ready():
                        data = channel.recv_stderr(4096)
                        if data:
                            await websocket.send_text(json.dumps({"data": data.decode("utf-8", errors="replace")}))
                    else:
                        # Check if channel is still alive
                        if channel.exit_status_ready():
                            break
                        await asyncio.sleep(0.05)  # Increased delay to reduce CPU usage and prevent race conditions
            except (asyncio.CancelledError, WebSocketDisconnect, Exception):
                pass
            finally:
                try:
                    await websocket.close(1000)
                except Exception:
                    pass

        async def writer():
            """Le do WebSocket e envia para o canal SSH."""
            try:
                while True:
                    msg = await websocket.receive_text()
                    try:
                        parsed = json.loads(msg)
                    except json.JSONDecodeError:
                        continue

                    # Resize terminal
                    if "resize" in parsed:
                        new_cols = parsed["resize"].get("cols", cols)
                        new_rows = parsed["resize"].get("rows", rows)
                        if channel and not channel.closed:
                            try:
                                channel.resize_pty(width=new_cols, height=new_rows)
                            except Exception:
                                pass
                        continue

                    # Input data
                    data = parsed.get("input", "")
                    if data and channel and not channel.closed:
                        channel.send(data)

                    # Disconnect
                    if parsed.get("disconnect"):
                        break
            except (WebSocketDisconnect, asyncio.CancelledError, Exception):
                pass
            finally:
                if channel and not channel.closed:
                    try:
                        channel.close()
                    except Exception:
                        pass
                if client:
                    try:
                        client.close()
                    except Exception:
                        pass

        # Executa leitura e escrita concorrentemente
        await asyncio.gather(reader(), writer())

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_text(json.dumps({"error": str(exc)}))
        except Exception:
            pass
    finally:
        if channel and not channel.closed:
            try:
                channel.close()
            except Exception:
                pass
        if client:
            try:
                client.close()
            except Exception:
                pass
        try:
            await websocket.close(1000)
        except Exception:
            pass


# ===== IoT Device Endpoints =====

@app.on_event("startup")
async def startup_event():
    """Initialize tables on startup."""
    try:
        init_iot_table()
    except Exception:
        pass  # Table might already exist or DB not ready yet
    try:
        init_knowledge_tables()
    except Exception:
        pass  # Table might already exist or DB not ready yet


@app.get("/api/iot/devices")
async def list_iot_devices() -> dict[str, Any]:
    """List all registered IoT devices."""
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT id, name, ip_address, port, username, description, 
                   auth_method, status, last_connection, created_at, updated_at
            FROM mycrew_iotdevices 
            ORDER BY created_at DESC
        """)
        devices = cur.fetchall()
    return {"devices": devices, "total": len(devices)}


@app.post("/api/iot/devices", response_model=IoTDeviceResponse)
async def create_iot_device(payload: IoTDeviceCreate) -> IoTDeviceResponse:
    """Create a new IoT device registration."""
    password_hash = encrypt_password(payload.password) if payload.password else None
    
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            INSERT INTO mycrew_iotdevices (name, ip_address, port, username, description, auth_method, password_hash, private_key)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, name, ip_address, port, username, description, 
                       auth_method, private_key, status, last_connection, created_at, updated_at
        """, (
            payload.name,
            payload.ip_address,
            payload.port,
            payload.username,
            payload.description,
            payload.auth_method,
            password_hash,
            payload.private_key,
        ))
        device = cur.fetchone()
    
    return IoTDeviceResponse(
        id=device["id"],
        name=device["name"],
        ip_address=device["ip_address"],
        port=device["port"],
        username=device["username"],
        description=device["description"] or "",
        auth_method=device["auth_method"],
        private_key=device["private_key"] or "",
        status=device["status"],
        last_connection=device["last_connection"].isoformat() if device["last_connection"] else None,
        created_at=device["created_at"].isoformat(),
        updated_at=device["updated_at"].isoformat(),
    )


@app.put("/api/iot/devices/{device_id}", response_model=IoTDeviceResponse)
async def update_iot_device(device_id: int, payload: IoTDeviceUpdate) -> IoTDeviceResponse:
    """Update an existing IoT device registration."""
    with get_db_cursor(commit=True) as cur:
        # Build dynamic update query
        updates = []
        values = []
        
        if payload.name is not None:
            updates.append("name = %s")
            values.append(payload.name)
        if payload.ip_address is not None:
            updates.append("ip_address = %s")
            values.append(payload.ip_address)
        if payload.port is not None:
            updates.append("port = %s")
            values.append(payload.port)
        if payload.username is not None:
            updates.append("username = %s")
            values.append(payload.username)
        if payload.description is not None:
            updates.append("description = %s")
            values.append(payload.description)
        if payload.auth_method is not None:
            updates.append("auth_method = %s")
            values.append(payload.auth_method)
        if payload.private_key is not None:
            updates.append("private_key = %s")
            values.append(payload.private_key)
        if payload.password is not None:
            # Only update password if a new value is provided
            if payload.password:
                encrypted = encrypt_password(payload.password)
                updates.append("password_hash = %s")
                values.append(encrypted)
        
        if not updates:
            raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")
        
        values.append(device_id)
        query = f"UPDATE mycrew_iotdevices SET {', '.join(updates)}, updated_at = NOW() WHERE id = %s RETURNING *"
        cur.execute(query, values)
        device = cur.fetchone()
        
        if not device:
            raise HTTPException(status_code=404, detail="Dispositivo nao encontrado")
    
    return IoTDeviceResponse(
        id=device["id"],
        name=device["name"],
        ip_address=device["ip_address"],
        port=device["port"],
        username=device["username"],
        description=device["description"] or "",
        auth_method=device["auth_method"],
        private_key=device["private_key"] or "",
        status=device["status"],
        last_connection=device["last_connection"].isoformat() if device["last_connection"] else None,
        created_at=device["created_at"].isoformat(),
        updated_at=device["updated_at"].isoformat(),
    )


@app.delete("/api/iot/devices/{device_id}")
async def delete_iot_device(device_id: int) -> dict[str, Any]:
    """Delete an IoT device registration."""
    with get_db_cursor(commit=True) as cur:
        cur.execute("DELETE FROM mycrew_iotdevices WHERE id = %s RETURNING id", (device_id,))
        deleted = cur.fetchone()
        
        if not deleted:
            raise HTTPException(status_code=404, detail="Dispositivo nao encontrado")
    
    return {"deleted": True, "id": device_id}


def get_iot_device_credentials_sync(device_id: int) -> dict[str, Any] | None:
    """Synchronous helper to fetch device credentials for WebSocket."""
    try:
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT id, name, ip_address, port, username, auth_method, password_hash, private_key
                FROM mycrew_iotdevices 
                WHERE id = %s
            """, (device_id,))
            device = cur.fetchone()
            
            if not device:
                return None
        
        decrypted_password = ""
        if device.get("password_hash"):
            decrypted_password = decrypt_password(device["password_hash"])
        
        return {
            "id": device["id"],
            "host": device["ip_address"],
            "port": device["port"],
            "username": device["username"],
            "auth_method": device["auth_method"],
            "password": decrypted_password,
            "private_key": device.get("private_key") or "",
        }
    except Exception:
        return None


@app.post("/api/iot/devices/{device_id}/status")
async def update_iot_device_status(device_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Update device connection status."""
    status = payload.get("status", "disconnected")
    if status not in ("online", "offline", "disconnected"):
        status = "disconnected"
    
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            UPDATE mycrew_iotdevices 
            SET status = %s, last_connection = NOW() 
            WHERE id = %s
        """, (status, device_id))
    
    return {"updated": True, "device_id": device_id, "status": status}


@app.get("/api/iot/devices/{device_id}/check-status")
async def check_iot_device_status(device_id: int) -> dict[str, Any]:
    """Check if a device is reachable by attempting TCP connection to its SSH port."""
    with get_db_cursor() as cur:
        cur.execute("""
            SELECT id, name, ip_address, port, username
            FROM mycrew_iotdevices 
            WHERE id = %s
        """, (device_id,))
        device = cur.fetchone()
        
        if not device:
            raise HTTPException(status_code=404, detail="Dispositivo nao encontrado")
    
    # Attempt TCP connection to check if device is online
    loop = asyncio.get_running_loop()
    try:
        result = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: socket.create_connection((device["ip_address"], device["port"]), timeout=3.0)
            ),
            timeout=4.0
        )
        result.close()
        is_online = True
        error_msg = None
    except Exception as exc:
        is_online = False
        error_msg = str(exc)
    
    # Update device status in database
    new_status = "online" if is_online else "offline"
    with get_db_cursor(commit=True) as cur:
        cur.execute("""
            UPDATE mycrew_iotdevices 
            SET status = %s, last_connection = NOW() 
            WHERE id = %s
        """, (new_status, device_id))
    
    return {
        "device_id": device_id,
        "name": device["name"],
        "ip_address": device["ip_address"],
        "port": device["port"],
        "online": is_online,
        "status": new_status,
        "error": error_msg,
        "checked_at": now_iso(),
    }
