"""
telemetry.py - Captura de métricas de execução do pipeline do agente

Fornece um mecanismo de contextvars + decoradores para medir automaticamente
cada etapa do pipeline: tempo, tokens, documentos, etc.
"""

from __future__ import annotations

import time
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional

import logging

logger = logging.getLogger("mycrew.telemetry")


@dataclass
class StageMetrics:
    """Métricas de uma etapa específica do pipeline."""
    name: str
    status: str = "pending"  # pending, running, done, error
    start_time: Optional[float] = None
    end_time: Optional[float] = None
    duration_ms: float = 0.0
    error: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def start(self) -> None:
        self.status = "running"
        self.start_time = time.monotonic()

    def finish(self, error: Optional[str] = None, **metadata) -> None:
        self.end_time = time.monotonic()
        self.duration_ms = (self.end_time - (self.start_time or self.end_time)) * 1000
        self.status = "error" if error else "done"
        self.error = error
        if metadata:
            self.metadata.update(metadata)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "duration_ms": round(self.duration_ms, 2),
            "error": self.error,
            "metadata": self.metadata,
        }


@dataclass
class ExecutionTelemetry:
    """Telemetria completa de uma execução do pipeline."""
    session_id: str
    persona_id: str
    stages: dict[str, StageMetrics] = field(default_factory=dict)
    total_start: Optional[float] = None
    total_end: Optional[float] = None
    total_duration_ms: float = 0.0

    # Métricas consolidadas
    tokens_sent: int = 0
    tokens_received: int = 0
    context_chars: int = 0
    documents_found: int = 0
    embeddings_queried: int = 0
    records_returned: int = 0
    model_used: str = ""
    temperature: float = 0.7
    provider: str = ""
    redis_cache_hit: bool = False
    memory_used: bool = False
    llm_latency_ms: float = 0.0

    def start_stage(self, name: str) -> StageMetrics:
        """Inicia uma etapa e retorna o objeto para registro."""
        stage = StageMetrics(name=name)
        stage.start()
        self.stages[name] = stage
        logger.debug("Stage started: %s", name)
        return stage

    def finish_stage(self, name: str, error: Optional[str] = None, **metadata) -> None:
        """Finaliza uma etapa com métricas opcionais."""
        stage = self.stages.get(name)
        if stage:
            stage.finish(error=error, **metadata)
            logger.debug(
                "Stage finished: %s status=%s duration=%.2fms",
                name, stage.status, stage.duration_ms,
            )

    def start(self) -> None:
        self.total_start = time.monotonic()

    def finish(self) -> None:
        self.total_end = time.monotonic()
        self.total_duration_ms = (self.total_end - (self.total_start or self.total_end)) * 1000

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "persona_id": self.persona_id,
            "total_duration_ms": round(self.total_duration_ms, 2),
            "stages": {
                name: stage.to_dict()
                for name, stage in self.stages.items()
            },
            "tokens_sent": self.tokens_sent,
            "tokens_received": self.tokens_received,
            "context_chars": self.context_chars,
            "documents_found": self.documents_found,
            "embeddings_queried": self.embeddings_queried,
            "records_returned": self.records_returned,
            "model_used": self.model_used,
            "temperature": self.temperature,
            "provider": self.provider,
            "redis_cache_hit": self.redis_cache_hit,
            "memory_used": self.memory_used,
            "llm_latency_ms": round(self.llm_latency_ms, 2),
        }

    def to_timeline(self) -> list[dict[str, Any]]:
        """Gera uma timeline ordenada dos eventos para exibição no frontend."""
        # Ordem fixa do pipeline para exibição
        stage_order = [
            "memory",
            "vector_search",
            "redis_cache",
            "postgres",
            "prompt_build",
            "llm_call",
            "response",
        ]
        
        # Ordena stages pela ordem do pipeline, mantendo apenas os que existem
        sorted_stages = sorted(
            self.stages.items(),
            key=lambda x: stage_order.index(x[0]) if x[0] in stage_order else 999
        )
        
        label_map = {
            "memory": "🧠 Consulta memória",
            "vector_search": "🔍 Busca vetorial (Qdrant)",
            "postgres": "🗄️ Consulta PostgreSQL",
            "redis_cache": "⚡ Cache Redis",
            "prompt_build": "📝 Construção do Prompt",
            "llm_call": "🤖 Chamada ao Modelo",
            "response": "💬 Resposta recebida",
        }
        
        timeline = []
        for name, stage in sorted_stages:
            icon = "✅" if stage.status == "done" else "❌" if stage.status == "error" else "⏳"
            label = label_map.get(name, name)
            timeline.append({
                "stage": name,
                "label": label,
                "icon": icon,
                "status": stage.status,
                "duration_ms": round(stage.duration_ms, 2),
                "metadata": stage.metadata,
            })
        return timeline


# ContextVar para carregar a telemetria atual no contexto da requisição
_current_telemetry: ContextVar[Optional[ExecutionTelemetry]] = ContextVar(
    "current_telemetry", default=None
)


def get_current_telemetry() -> Optional[ExecutionTelemetry]:
    """Retorna a telemetria do contexto atual (thread/async local)."""
    return _current_telemetry.get()


def set_current_telemetry(telemetry: ExecutionTelemetry) -> None:
    """Define a telemetria no contexto atual."""
    _current_telemetry.set(telemetry)


def create_telemetry(session_id: str, persona_id: str) -> ExecutionTelemetry:
    """Cria e registra uma nova telemetria no contexto."""
    telemetry = ExecutionTelemetry(
        session_id=session_id,
        persona_id=persona_id,
    )
    set_current_telemetry(telemetry)
    return telemetry


def stage_timer(stage_name: str):
    """Decorator para medir tempo de execução de uma etapa.

    Uso:
        @stage_timer("vector_search")
        async def search_qdrant(query):
            ...
    """
    def decorator(func: Callable):
        async def async_wrapper(*args, **kwargs):
            telemetry = get_current_telemetry()
            if telemetry:
                telemetry.start_stage(stage_name)
            try:
                result = await func(*args, **kwargs)
                if telemetry:
                    telemetry.finish_stage(stage_name)
                return result
            except Exception as e:
                if telemetry:
                    telemetry.finish_stage(stage_name, error=str(e))
                raise
        return async_wrapper
    return decorator