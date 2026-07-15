"""
ws_chat.py - WebSocket handler para chat em tempo real

Gerencia conexões WebSocket para streaming de:
- Eventos de pipeline (estágios sendo executados)
- Tokens da resposta do LLM
- Timeline de execução
- Métricas de telemetria

Fluxo:
1. Cliente envia {type: "send", message, persona_id}
2. Servidor emite eventos de estágio em tempo real
3. Servidor faz streaming dos tokens da resposta
4. Servidor envia métricas finais
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import httpx
from fastapi import WebSocket, WebSocketDisconnect

from ..config import (
    OLLAMA_TIMEOUT,
    OPEN_WEBUI_API_KEY,
    OPEN_WEBUI_TOKEN,
    OPEN_WEBUI_URL,
    QDRANT_COLLECTION,
    QDRANT_TOP_K,
    QDRANT_URL,
    EMBEDDING_MODEL,
)
from ..database import get_redis_client
from .chat_manager import get_chat_manager
from .memory_extractor import extract_memory_from_conversation, save_memory
from .telemetry import (
    ExecutionTelemetry,
    get_current_telemetry,
    set_current_telemetry,
)

logger = logging.getLogger("mycrew.ws_chat")


def _openwebui_headers() -> dict[str, str]:
    token = OPEN_WEBUI_API_KEY or OPEN_WEBUI_TOKEN
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def _search_knowledge(persona_id: str, query: str, top_k: int = QDRANT_TOP_K) -> list[dict[str, Any]]:
    """Busca conhecimento vetorial no Qdrant."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Gera embedding
            emb_resp = await client.post(
                f"http://ollama:11434/api/embeddings",
                json={"model": EMBEDDING_MODEL, "prompt": query},
            )
            emb_resp.raise_for_status()
            vector = emb_resp.json().get("embedding", [])

            if not vector:
                return []

            # Busca no Qdrant
            search_body = {
                "vector": vector,
                "limit": max(1, top_k),
                "with_payload": True,
                "filter": {
                    "must": [{"key": "persona_id", "match": {"value": persona_id}}],
                },
            }
            resp = await client.post(
                f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/search",
                json=search_body,
            )
            resp.raise_for_status()
            result = resp.json().get("result", [])

            items = []
            for row in result:
                payload = row.get("payload", {})
                content = (payload.get("content") or "").strip()
                if content:
                    items.append({
                        "score": row.get("score"),
                        "title": (payload.get("title") or "Conhecimento").strip(),
                        "source": (payload.get("source") or "manual").strip(),
                        "content": content,
                    })
            return items
    except Exception as e:
        logger.warning("Knowledge search failed: %s", e)
        return []


async def _check_redis_cache(persona_id: str) -> Optional[str]:
    """Verifica se há contexto em cache no Redis."""
    try:
        redis_client = get_redis_client()
        cache_key = f"knowledge:last_attachments:{persona_id}"
        cached = redis_client.lindex(cache_key, 0)
        if cached:
            return cached
        return None
    except Exception:
        return None


async def _stream_llm_response(
    model: str,
    messages: list[dict[str, str]],
    websocket: WebSocket,
) -> tuple[str, dict[str, Any]]:
    """
    Faz streaming da resposta do LLM via Open WebUI.

    Retorna (texto_completo, usage)
    """
    body = {
        "model": model,
        "messages": messages,
        "stream": True,
        "options": {
            "num_predict": 512,
        },
    }

    full_text = ""
    usage = {}

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            async with client.stream(
                "POST",
                f"{OPEN_WEBUI_URL}/api/chat/completions",
                content=json.dumps(body).encode("utf-8"),
                headers=_openwebui_headers(),
            ) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            full_text += content
                            # Envia token para o frontend
                            await websocket.send_text(json.dumps({
                                "type": "token",
                                "content": content,
                            }))

                        # Captura usage no último chunk
                        if chunk.get("usage"):
                            usage = chunk.get("usage", {})
                    except json.JSONDecodeError:
                        continue

    except httpx.HTTPStatusError as e:
        logger.error("LLM streaming error: %s", e)
        await websocket.send_text(json.dumps({
            "type": "error",
            "stage": "llm_call",
            "error": f"Erro no LLM: {e.response.text[:200]}",
        }))

    return full_text.strip(), usage


class ChatWebSocketHandler:
    """Gerencia conexões WebSocket de chat."""

    def __init__(self):
        self._connections: dict[str, WebSocket] = {}

    def _build_stage_event(
        self,
        stage: str,
        status: str,
        label: str,
        metadata: dict[str, Any] | None = None,
        source: str = "",
        input_preview: str = "",
        output_preview: str = "",
        started_at: str = "",
        finished_at: str = "",
        stop_reason: str = "",
    ) -> dict[str, Any]:
        """Constrói um evento de stage enriquecido para o frontend."""
        now_iso = datetime.now(timezone.utc).isoformat()
        return {
            "type": "stage",
            "stage": stage,
            "status": status,
            "label": label,
            "source": source,
            "started_at": started_at or now_iso,
            "finished_at": finished_at or now_iso,
            "input_preview": input_preview[:500],
            "output_preview": output_preview[:500],
            "stop_reason": stop_reason,
            "metadata": metadata or {},
        }

    async def handle(self, websocket: WebSocket) -> None:
        """Handler principal da conexão WebSocket."""
        await websocket.accept()
        logger.info("WebSocket connection accepted")

        session_id = str(uuid4())
        self._connections[session_id] = websocket

        try:
            # Aguarda primeira mensagem com os parâmetros
            raw = await websocket.receive_text()
            msg = json.loads(raw)

            if msg.get("type") != "send":
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": "Primeira mensagem deve ser do tipo 'send'",
                }))
                return

            persona_id = msg.get("persona_id", "").strip()
            message = msg.get("message", "").strip()
            model = msg.get("model", persona_id)
            temperature = msg.get("temperature", 0.7)

            if not persona_id or not message:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": "persona_id e message são obrigatórios",
                }))
                return

            # Cria sessão no chat manager
            chat_manager = get_chat_manager()
            session = chat_manager.create_session(
                persona_id=persona_id,
                model=model,
                temperature=temperature,
            )

            # Cria telemetria
            telemetry = ExecutionTelemetry(
                session_id=session.session_id,
                persona_id=persona_id,
                model_used=model,
                temperature=temperature,
            )
            set_current_telemetry(telemetry)
            telemetry.start()

            # Envia info da sessão
            await websocket.send_text(json.dumps({
                "type": "session_start",
                "session_id": session.session_id,
                "persona_id": persona_id,
                "model": model,
            }))

            # ===== ETAPA 1: Consulta memória =====
            telemetry.start_stage("memory")
            stage_start = datetime.now(timezone.utc).isoformat()
            cached_memory = await _check_redis_cache(persona_id)
            await asyncio.sleep(0.05)
            telemetry.finish_stage("memory", memory_found=bool(cached_memory))
            stage_end = datetime.now(timezone.utc).isoformat()

            await websocket.send_text(json.dumps(self._build_stage_event(
                stage="memory",
                status="done",
                label="🧠 Consulta memória",
                source="redis",
                started_at=stage_start,
                finished_at=stage_end,
                input_preview=f"persona_id={persona_id}",
                output_preview=f"memória {'encontrada' if cached_memory else 'não encontrada'}",
                metadata={"memory_found": bool(cached_memory)},
            )))

            # ===== ETAPA 2: Busca vetorial (Qdrant) =====
            telemetry.start_stage("vector_search")
            stage_start = datetime.now(timezone.utc).isoformat()
            qdrant_items = await _search_knowledge(
                persona_id.lower(), message, top_k=QDRANT_TOP_K
            )
            telemetry.finish_stage(
                "vector_search",
                documents_found=len(qdrant_items),
                top_k=QDRANT_TOP_K,
            )
            telemetry.documents_found = len(qdrant_items)
            stage_end = datetime.now(timezone.utc).isoformat()

            # Gera preview dos scores
            scores_str = ", ".join(
                f"{item.get('score', 0):.3f}" for item in qdrant_items[:3]
            ) if qdrant_items else "—"

            await websocket.send_text(json.dumps(self._build_stage_event(
                stage="vector_search",
                status="done",
                label="🔍 Busca vetorial (Qdrant)",
                source="qdrant",
                started_at=stage_start,
                finished_at=stage_end,
                input_preview=f"query={message[:100]} | top_k={QDRANT_TOP_K}",
                output_preview=f"{len(qdrant_items)} documento(s) | scores: {scores_str}",
                metadata={
                    "documents_found": len(qdrant_items),
                    "top_k": QDRANT_TOP_K,
                    "avg_score": round(
                        sum(item.get("score", 0) for item in qdrant_items) / max(len(qdrant_items), 1), 4
                    ),
                    "scores": [item.get("score", 0) for item in qdrant_items],
                    "titles": [item["title"] for item in qdrant_items],
                },
            )))

            # ===== ETAPA 3: Cache Redis =====
            telemetry.start_stage("redis_cache")
            stage_start = datetime.now(timezone.utc).isoformat()
            redis_cache = await _check_redis_cache(persona_id)
            telemetry.redis_cache_hit = bool(redis_cache)
            telemetry.finish_stage("redis_cache", hit=bool(redis_cache))
            stage_end = datetime.now(timezone.utc).isoformat()

            await websocket.send_text(json.dumps(self._build_stage_event(
                stage="redis_cache",
                status="done",
                label="⚡ Cache Redis",
                source="redis",
                started_at=stage_start,
                finished_at=stage_end,
                input_preview=f"key=knowledge:last_attachments:{persona_id}",
                output_preview="HIT" if redis_cache else "MISS",
                metadata={"hit": bool(redis_cache)},
            )))

            # ===== ETAPA 4: Construção do Prompt =====
            telemetry.start_stage("prompt_build")
            stage_start = datetime.now(timezone.utc).isoformat()

            messages: list[dict[str, str]] = []

            if qdrant_items:
                qdrant_context = "\n\n".join(
                    f"### {item['title']} (origem: {item['source']})\n{item['content']}"
                    for item in qdrant_items
                )
                messages.append({
                    "role": "system",
                    "content": f"Conhecimento recuperado:\n{qdrant_context}",
                })

            for msg_item in session.messages[-12:]:
                role = msg_item["role"].strip().lower()
                if role in ("user", "assistant") and msg_item["content"].strip():
                    messages.append({"role": role, "content": msg_item["content"].strip()})

            messages.append({"role": "user", "content": message})

            context_chars = sum(len(m.get("content", "")) for m in messages)
            telemetry.context_chars = context_chars
            telemetry.tokens_sent = context_chars // 4

            telemetry.finish_stage("prompt_build", context_chars=context_chars)
            stage_end = datetime.now(timezone.utc).isoformat()

            await websocket.send_text(json.dumps(self._build_stage_event(
                stage="prompt_build",
                status="done",
                label="📝 Construção do Prompt",
                source="app",
                started_at=stage_start,
                finished_at=stage_end,
                input_preview=f"{len(messages)} mensagens | {context_chars} chars",
                output_preview=f"~{context_chars // 4} tokens estimados",
                metadata={
                    "context_chars": context_chars,
                    "messages_count": len(messages),
                    "estimated_tokens": context_chars // 4,
                    "has_qdrant_context": bool(qdrant_items),
                    "history_messages": len(session.messages),
                },
            )))

            # ===== ETAPA 5: Chamada ao Modelo =====
            telemetry.start_stage("llm_call")
            stage_start = datetime.now(timezone.utc).isoformat()

            await websocket.send_text(json.dumps(self._build_stage_event(
                stage="llm_call",
                status="running",
                label="🤖 Chamada ao Modelo",
                source="open-webui",
                started_at=stage_start,
                input_preview=f"model={model} | temp={temperature} | {len(messages)} msgs",
                metadata={"model": model, "temperature": temperature},
            )))

            llm_start = time.monotonic()
            full_text, usage = await _stream_llm_response(model, messages, websocket)
            llm_end = time.monotonic()
            telemetry.llm_latency_ms = (llm_end - llm_start) * 1000

            telemetry.finish_stage("llm_call", model=model, temperature=temperature)
            stage_end = datetime.now(timezone.utc).isoformat()

            prompt_tokens = int(usage.get("prompt_tokens", 0))
            completion_tokens = int(usage.get("completion_tokens", 0))
            telemetry.tokens_received = completion_tokens or len(full_text.split())
            telemetry.tokens_sent = prompt_tokens or telemetry.tokens_sent

            # Infere provider
            provider = "ollama"
            model_lower = model.lower()
            if "gpt" in model_lower or "openai" in model_lower:
                provider = "openai"
            elif "claude" in model_lower or "anthropic" in model_lower:
                provider = "anthropic"
            elif "gemini" in model_lower:
                provider = "gemini"
            elif "groq" in model_lower:
                provider = "groq"
            elif "grok" in model_lower:
                provider = "xai"
            elif "openrouter" in model_lower:
                provider = "openrouter"
            telemetry.provider = provider
            telemetry.embeddings_queried = 1
            telemetry.records_returned = len(qdrant_items)
            telemetry.memory_used = bool(cached_memory)

            # Determina stop_reason
            stop_reason = "stop"
            finish_reason = usage.get("finish_reason", "")
            if finish_reason:
                stop_reason = finish_reason
            elif not full_text:
                stop_reason = "empty"

            await websocket.send_text(json.dumps(self._build_stage_event(
                stage="llm_call",
                status="done",
                label="🤖 Chamada ao Modelo",
                source="open-webui",
                started_at=stage_start,
                finished_at=stage_end,
                input_preview=f"model={model} | temp={temperature} | {len(messages)} msgs",
                output_preview=f"{len(full_text)} chars | {completion_tokens} tokens gerados",
                stop_reason=stop_reason,
                metadata={
                    "model": model,
                    "temperature": temperature,
                    "provider": provider,
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                    "llm_latency_ms": round(telemetry.llm_latency_ms, 2),
                    "stop_reason": stop_reason,
                    "generation_speed": round(
                        completion_tokens / max(telemetry.llm_latency_ms / 1000, 0.001), 1
                    ) if completion_tokens and telemetry.llm_latency_ms > 0 else 0,
                },
            )))

            # ===== ETAPA 6: Resposta concluída =====
            telemetry.start_stage("response")
            stage_start = datetime.now(timezone.utc).isoformat()

            session.add_message("user", message)
            if full_text:
                session.add_message("assistant", full_text)

            session.metrics = telemetry.to_dict()

            telemetry.finish_stage("response")
            stage_end = datetime.now(timezone.utc).isoformat()
            telemetry.finish()

            await websocket.send_text(json.dumps(self._build_stage_event(
                stage="response",
                status="done",
                label="💬 Resposta concluída",
                source="app",
                started_at=stage_start,
                finished_at=stage_end,
                input_preview=f"resposta de {len(full_text)} chars",
                output_preview=full_text[:200],
                metadata={
                    "response_length": len(full_text),
                    "total_duration_ms": round(telemetry.total_duration_ms, 2),
                },
            )))

            # Envia métricas finais
            await websocket.send_text(json.dumps({
                "type": "metrics",
                "metrics": telemetry.to_dict(),
                "timeline": telemetry.to_timeline(),
            }))

            # Envia confirmação de finalização
            await websocket.send_text(json.dumps({
                "type": "done",
                "session_id": session.session_id,
                "reply": full_text,
            }))

            # Limpa telemetria do contexto
            set_current_telemetry(None)

            # Aguarda por comandos adicionais (ex: finalizar)
            await self._handle_post_commands(websocket, session.session_id)

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except json.JSONDecodeError:
            await websocket.send_text(json.dumps({
                "type": "error",
                "error": "JSON inválido",
            }))
        except Exception as e:
            logger.error("WebSocket error: %s", e)
            try:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": str(e),
                }))
            except Exception:
                pass
        finally:
            self._connections.pop(session_id, None)
            try:
                await websocket.close()
            except Exception:
                pass

    async def _handle_post_commands(
        self, websocket: WebSocket, session_id: str
    ) -> None:
        """Aguarda comandos pós-resposta (ex: finalizar conversa)."""
        chat_manager = get_chat_manager()

        try:
            while True:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=300.0)
                msg = json.loads(raw)
                cmd = msg.get("type", "")

                if cmd == "finalize":
                    option = msg.get("option", "discard")
                    result = chat_manager.finalize_session(session_id, option)

                    if result and option == "auto_save":
                        # Extrai memória automaticamente
                        session = chat_manager.get_session(session_id)
                        if session and len(session.messages) >= 3:
                            memories = await extract_memory_from_conversation(
                                session.messages,
                                model=session.model or "llama3.2:3b",
                            )
                            save_result = await save_memory(
                                session_id=session_id,
                                persona_id=session.persona_id,
                                memories=memories,
                            )
                            result["memory"] = save_result

                    await websocket.send_text(json.dumps({
                        "type": "finalized",
                        **result,
                    }))
                    break

                elif cmd == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))

        except asyncio.TimeoutError:
            # Timeout de inatividade
            chat_manager.finalize_session(session_id, "discard")
        except (WebSocketDisconnect, json.JSONDecodeError):
            pass
        except Exception as e:
            logger.error("Post-command error: %s", e)


# Singleton
_ws_handler: Optional[ChatWebSocketHandler] = None


def get_ws_handler() -> ChatWebSocketHandler:
    global _ws_handler
    if _ws_handler is None:
        _ws_handler = ChatWebSocketHandler()
    return _ws_handler