from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import FastAPI, HTTPException, Query
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
    QDRANT_COLLECTION,
    QDRANT_TOP_K,
    QDRANT_URL,
)
from .schemas import (
    ChatRequest,
    ChatResponse,
    FlowStartRequest,
    FlowStartResponse,
    KnowledgeAttachRequest,
    KnowledgeSearchResponse,
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


async def fetch_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
        payload = resp.json()
        return [item.get("name", "") for item in payload.get("models", []) if item.get("name")]
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
                return
            # Dimensao divergente na colecao dedicada do MyCrew: recria do zero.
            await client.delete(f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}")

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


async def upsert_knowledge_points(persona_id: str, title: str, source: str, chunks: list[str], tags: list[str]) -> dict[str, Any]:
    total = 0

    for index, chunk in enumerate(chunks):
        vector = await ollama_embedding(chunk)
        await ensure_qdrant_collection(len(vector))
        point = {
            "id": str(uuid4()),
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
        upsert_body = {"points": [point], "wait": True}
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.put(
                f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points",
                content=json.dumps(upsert_body).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            resp.raise_for_status()
        total += 1

    return {"inserted_points": total, "collection": QDRANT_COLLECTION}


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
    ]

    health_results, models, openwebui_agents = await asyncio.gather(
        asyncio.gather(*[check_service(item["health"]) for item in service_defs]),
        fetch_models(),
        fetch_openwebui_agents(),
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
        },
        "ollama_models": models,
        "counters": {
            "services_total": len(services),
            "services_online": online_count,
            "models_total": len(models),
            "openwebui_agents": len(openwebui_agents),
        },
        "qdrant_collection": QDRANT_COLLECTION,
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
    chunks = chunk_text(payload.content)
    if not chunks:
        raise HTTPException(status_code=400, detail="conteudo vazio apos normalizacao")

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
