"""
memory_extractor.py - Extração de memória de conversas

Analisa automaticamente conversas para extrair:
- Preferências do usuário
- Decisões importantes
- Conhecimento produzido
- Documentação criada
- Fatos úteis para consultas futuras

Armazena no PostgreSQL e indexa no Qdrant.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import httpx

from ..config import (
    OLLAMA_URL,
    EMBEDDING_MODEL,
    OLLAMA_TIMEOUT,
    QDRANT_URL,
    QDRANT_COLLECTION,
)
from ..database import get_db_cursor, get_redis_client

logger = logging.getLogger("mycrew.memory")


# Prompt para extração de memória
MEMORY_EXTRACTION_PROMPT = """Você é um analisador de conversas. Analise a conversa abaixo entre um usuário e um agente de IA.

Extraia APENAS informações relevantes e estruturadas nos seguintes formatos:

1. **Preferências do usuário**: Gostos, preferências, estilos que o usuário mencionou.
2. **Decisões importantes**: Decisões tomadas durante a conversa.
3. **Conhecimento produzido**: Informações, explicações, guias que foram criados.
4. **Documentação**: Documentos, códigos, configurações que foram gerados.
5. **Fatos úteis**: Fatos objetivos que podem ser úteis em conversas futuras.

Para cada item extraído, forneça:
- tipo: preference | decision | knowledge | documentation | fact
- titulo: Título curto e descritivo
- conteudo: O conteúdo relevante (máximo 500 caracteres)
- tags: Lista de tags relevantes (máximo 5)

Responda APENAS em JSON válido, sem formatação adicional:
{"memorias": [{"tipo": "...", "titulo": "...", "conteudo": "...", "tags": ["..."]}]}

Se não houver informações relevantes, retorne: {"memorias": []}

Conversa:
"""


async def extract_memory_from_conversation(
    messages: list[dict[str, Any]],
    model: str = "llama3.2:3b",
) -> list[dict[str, Any]]:
    """
    Extrai memórias de uma conversa usando o LLM local.

    Args:
        messages: Lista de mensagens {role, content}
        model: Modelo a ser usado para extração

    Returns:
        Lista de memórias extraídas
    """
    if not messages:
        return []

    # Constrói o texto da conversa
    conversation_text = "\n".join(
        f"{'Usuário' if m['role'] == 'user' else 'Agente'}: {m['content']}"
        for m in messages[-30:]  # últimas 30 mensagens
    )

    prompt = MEMORY_EXTRACTION_PROMPT + conversation_text

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                    "options": {
                        "temperature": 0.1,  # Baixa temperatura para extração precisa
                        "num_predict": 2000,
                    },
                },
            )
            resp.raise_for_status()
            data = resp.json()

        content = data.get("message", {}).get("content", "")
        if not content:
            logger.warning("Empty response from LLM during memory extraction")
            return []

        # Tenta extrair JSON da resposta
        content = content.strip()
        # Remove possíveis markdown fences
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            if "```" in content:
                content = content.rsplit("```", 1)[0]
            content = content.strip()

        result = json.loads(content)
        memories = result.get("memorias", [])

        logger.info(
            "Extracted %d memories from conversation (%d messages)",
            len(memories), len(messages),
        )
        return memories

    except json.JSONDecodeError as e:
        logger.error("Failed to parse LLM response as JSON: %s", e)
        return []
    except Exception as e:
        logger.error("Failed to extract memories: %s", e)
        return []


async def save_memory(
    session_id: str,
    persona_id: str,
    memories: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Salva memórias extraídas no PostgreSQL e indexa no Qdrant.

    Args:
        session_id: ID da sessão
        persona_id: ID da persona
        memories: Lista de memórias extraídas

    Returns:
        Dict com resultado da operação
    """
    if not memories:
        return {"saved": 0, "indexed": 0}

    saved_count = 0
    indexed_count = 0
    errors = []

    for memory in memories:
        try:
            memory_type = memory.get("tipo", "fact")
            title = memory.get("titulo", "Memória")
            content = memory.get("conteudo", "")
            tags = memory.get("tags", [])

            if not content:
                continue

            # Salva no PostgreSQL
            memory_id = str(uuid4())
            with get_db_cursor(commit=True) as cur:
                cur.execute(
                    """
                    INSERT INTO mycrew_conversation_memory
                        (id, session_id, persona_id, memory_type, title, content, tags)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        memory_id,
                        session_id,
                        persona_id,
                        memory_type,
                        title,
                        content,
                        json.dumps(tags),
                    ),
                )
            saved_count += 1

            # Indexa no Qdrant
            try:
                await _index_memory_in_qdrant(
                    memory_id=memory_id,
                    persona_id=persona_id,
                    title=title,
                    content=content,
                    tags=tags,
                    memory_type=memory_type,
                )
                indexed_count += 1
            except Exception as e:
                errors.append(f"Qdrant index error for {memory_id}: {e}")
                logger.warning("Failed to index memory in Qdrant: %s", e)

        except Exception as e:
            errors.append(str(e))
            logger.error("Failed to save memory: %s", e)

    # Atualiza cache Redis
    try:
        redis_client = get_redis_client()
        cache_key = f"memory:last:{persona_id}"
        redis_client.setex(cache_key, 86400, json.dumps({
            "count": saved_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }))
    except Exception as e:
        logger.warning("Failed to update Redis cache: %s", e)

    return {
        "saved": saved_count,
        "indexed": indexed_count,
        "errors": errors,
    }


async def _index_memory_in_qdrant(
    memory_id: str,
    persona_id: str,
    title: str,
    content: str,
    tags: list[str],
    memory_type: str,
) -> None:
    """Indexa uma memória no Qdrant para busca semântica futura."""
    # Gera embedding
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        resp = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBEDDING_MODEL, "prompt": content},
        )
        resp.raise_for_status()
        vector = resp.json().get("embedding", [])

    if not vector:
        raise ValueError("Empty embedding vector")

    # Garante que a coleção existe
    from ..main import ensure_qdrant_collection
    await ensure_qdrant_collection(len(vector))

    # Upsert no Qdrant
    point = {
        "id": memory_id,
        "vector": vector,
        "payload": {
            "persona_id": persona_id,
            "memory_id": memory_id,
            "memory_type": memory_type,
            "title": title,
            "content": content,
            "tags": tags,
            "source": "memory_extraction",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    }

    async with httpx.AsyncClient(timeout=12.0) as client:
        resp = await client.put(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points",
            json={"points": [point], "wait": True},
        )
        resp.raise_for_status()