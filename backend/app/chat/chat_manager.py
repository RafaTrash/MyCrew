"""
chat_manager.py - Gerenciamento de sessão de chat

Responsabilidades:
- Criar e gerenciar sessões de conversa
- Controlar estado do agente (ocupado/ocioso)
- Gerenciar contexto temporário por sessão
- Coordenar finalização de conversa
- Persistir sessões no PostgreSQL
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

logger = logging.getLogger("mycrew.chat")


def _datetime_to_iso(val: Any) -> str:
    """Converte datetime para string ISO ou retorna string vazia."""
    if val is None:
        return ""
    if isinstance(val, datetime):
        return val.isoformat()
    return str(val) if val else ""


class ChatSession:
    """Representa uma sessão de conversa entre usuário e agente."""

    def __init__(
        self,
        session_id: str,
        persona_id: str,
        model: str = "",
        temperature: float = 0.7,
    ):
        self.session_id = session_id
        self.persona_id = persona_id
        self.model = model
        self.temperature = temperature
        self.status: str = "active"  # active, finalized, discarded
        self.messages: list[dict[str, Any]] = []
        self.temp_context: dict[str, Any] = {}
        self.metrics: dict[str, Any] = {
            "stages": {},
            "total_time_ms": 0,
            "tokens_sent": 0,
            "tokens_received": 0,
            "documents_found": 0,
            "redis_cache_hit": False,
            "model_used": model,
            "temperature": temperature,
            "provider": "",
            "memory_used": False,
        }
        self.started_at: str = _now_iso()
        self.finalized_at: Optional[str] = None

    def add_message(self, role: str, content: str) -> None:
        self.messages.append({
            "role": role,
            "content": content,
            "timestamp": _now_iso(),
        })

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "persona_id": self.persona_id,
            "model": self.model,
            "temperature": self.temperature,
            "status": self.status,
            "message_count": len(self.messages),
            "started_at": self.started_at,
            "finalized_at": self.finalized_at,
            "metrics": self.metrics,
            "messages": self.messages,  # Inclui mensagens para histórico no frontend
        }


class ChatManager:
    """Gerencia múltiplas sessões de chat concorrentes."""

    def __init__(self):
        self._sessions: dict[str, ChatSession] = {}
        self._agent_status: dict[str, str] = {}  # persona_id -> status

    def create_session(
        self,
        persona_id: str,
        model: str = "",
        temperature: float = 0.7,
    ) -> ChatSession:
        """Cria nova sessão e marca agente como ocupado. Persiste no PostgreSQL."""
        session_id = str(uuid4())
        session = ChatSession(
            session_id=session_id,
            persona_id=persona_id,
            model=model,
            temperature=temperature,
        )
        self._sessions[session_id] = session
        self._agent_status[persona_id] = "occupied"

        # Persiste sessão no PostgreSQL
        try:
            from ..database import get_db_cursor
            with get_db_cursor(commit=True) as cur:
                cur.execute(
                    """
                    INSERT INTO mycrew_chat_sessions
                    (id, persona_id, model, temperature, status, started_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (session_id, persona_id, model, temperature, "active", session.started_at)
                )
            logger.info("Session persisted in DB: %s", session_id)
        except Exception as e:
            logger.warning("Failed to persist session in DB: %s", e)

        logger.info(
            "Session created: %s for persona=%s model=%s",
            session_id, persona_id, model,
        )
        return session

    def get_session(self, session_id: str) -> Optional[ChatSession]:
        return self._sessions.get(session_id)

    def get_active_session_by_persona(self, persona_id: str) -> Optional[ChatSession]:
        """Retorna sessão ativa para uma persona específica."""
        for session in self._sessions.values():
            if session.persona_id == persona_id and session.status == "active":
                return session
        return None

    def finalize_session(
        self,
        session_id: str,
        option: str = "discard",
    ) -> Optional[dict[str, Any]]:
        """
        Finaliza uma sessão.

        Args:
            session_id: ID da sessão
            option: "discard", "auto_save", ou "approve"

        Returns:
            Dict com resultado da finalização ou None se sessão não encontrada
        """
        session = self._sessions.get(session_id)
        if not session:
            return None

        session.status = "finalized" if option != "discard" else "discarded"
        session.finalized_at = _now_iso()

        # Atualiza sessão no PostgreSQL
        try:
            from ..database import get_db_cursor
            with get_db_cursor(commit=True) as cur:
                # Salva mensagens no DB
                for msg in session.messages:
                    cur.execute(
                        """
                        INSERT INTO mycrew_chat_messages (session_id, role, content, timestamp)
                        VALUES (%s, %s, %s, %s)
                        """,
                        (
                            session_id,
                            msg.get("role", "user"),
                            msg.get("content", ""),
                            msg.get("timestamp", _now_iso())
                        )
                    )
                # Atualiza status da sessão
                cur.execute(
                    """
                    UPDATE mycrew_chat_sessions
                    SET status = %s, finalized_at = %s, total_messages = %s, metrics = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (
                        session.status,
                        session.finalized_at,
                        len(session.messages),
                        json.dumps(session.metrics),
                        session_id
                    )
                )
            logger.info("Session finalized and persisted in DB: %s", session_id)
        except Exception as e:
            logger.warning("Failed to persist session finalization in DB: %s", e)

        # Libera o agente
        self._agent_status[session.persona_id] = "idle"

        result = {
            "session_id": session_id,
            "persona_id": session.persona_id,
            "status": session.status,
            "option": option,
            "message_count": len(session.messages),
            "finalized_at": session.finalized_at,
        }

        if option == "auto_save":
            result["memory_extracted"] = True
        elif option == "approve":
            result["requires_approval"] = True
            result["summary"] = self._generate_summary(session)

        logger.info(
            "Session finalized: %s option=%s status=%s",
            session_id, option, session.status,
        )
        return result

    def get_agent_status(self, persona_id: str) -> str:
        return self._agent_status.get(persona_id, "idle")

    def set_agent_idle(self, persona_id: str) -> None:
        self._agent_status[persona_id] = "idle"

    def cleanup_session(self, session_id: str) -> None:
        """Remove sessão da memória (após finalizada)."""
        session = self._sessions.pop(session_id, None)
        if session and session.persona_id:
            # Só libera agente se não houver outra sessão ativa
            if not self.get_active_session_by_persona(session.persona_id):
                self._agent_status[session.persona_id] = "idle"

    def list_sessions_by_persona(self, persona_id: str) -> list[dict[str, Any]]:
        """Lista todas as sessões de um agente específico, ordenadas por atividade mais recente."""
        # Primeiro tenta carregar do DB
        try:
            from ..database import get_db_cursor
            with get_db_cursor() as cur:
                cur.execute(
                    """
                    SELECT s.id as session_id, s.persona_id, s.model, s.temperature,
                           s.status, s.started_at, s.finalized_at, s.metrics,
                           s.total_messages as message_count
                    FROM mycrew_chat_sessions s
                    WHERE s.persona_id = %s
                    ORDER BY s.started_at DESC
                    """,
                    (persona_id,)
                )
                rows = cur.fetchall()
                sessions = []
                for row in rows:
                    session = {
                        "session_id": row["session_id"],
                        "persona_id": row["persona_id"],
                        "model": row["model"] or "",
                        "temperature": row["temperature"] or 0.7,
                        "status": row["status"],
                        "message_count": row["message_count"] or 0,
                        "started_at": _datetime_to_iso(row["started_at"]),
                        "finalized_at": _datetime_to_iso(row["finalized_at"]) if row["finalized_at"] else None,
                        "metrics": row["metrics"] or {},
                        "messages": [],  # Carregado sob demanda
                    }
                    # Carrega mensagens
                    cur.execute(
                        """
                        SELECT role, content, timestamp
                        FROM mycrew_chat_messages
                        WHERE session_id = %s
                        ORDER BY timestamp ASC
                        """,
                        (row["session_id"],)
                    )
                    messages = cur.fetchall()
                    session["messages"] = [
                        {"role": m["role"], "content": m["content"], "timestamp": _datetime_to_iso(m["timestamp"])}
                        for m in messages
                    ]
                    sessions.append(session)
                if sessions:
                    return sessions
        except Exception as e:
            logger.warning("Failed to load sessions from DB, using memory: %s", e)

        # Fallback: usa sessões em memória
        sessions = [
            s.to_dict()
            for s in self._sessions.values()
            if s.persona_id == persona_id
        ]
        sessions.sort(key=lambda s: s.get("started_at", ""), reverse=True)
        return sessions

    def list_active_sessions(self) -> list[dict[str, Any]]:
        return [
            s.to_dict()
            for s in self._sessions.values()
            if s.status == "active"
        ]

    def _generate_summary(self, session: ChatSession) -> str:
        """Gera um resumo da conversa para aprovação do usuário."""
        if not session.messages:
            return "Nenhuma mensagem trocada."

        lines = []
        for msg in session.messages[-20:]:  # últimas 20 mensagens
            role_label = "Usuário" if msg["role"] == "user" else "Agente"
            content = msg["content"][:200]
            lines.append(f"{role_label}: {content}")
        return "\n".join(lines)


# Singleton global
_chat_manager: Optional[ChatManager] = None


def get_chat_manager() -> ChatManager:
    global _chat_manager
    if _chat_manager is None:
        _chat_manager = ChatManager()
    return _chat_manager


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()