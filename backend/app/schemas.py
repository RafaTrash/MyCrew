from typing import Any, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    persona_id: str
    message: str = Field(min_length=1)
    model: Optional[str] = None
    history: list[ChatMessage] = []
    retrieve_knowledge: bool = True


class ChatResponse(BaseModel):
    reply: str
    model: str
    timestamp: str
    usage: dict[str, Any]


class KnowledgeAttachRequest(BaseModel):
    persona_id: str
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    source: str = "manual"
    tags: list[str] = []


class KnowledgeSearchResponse(BaseModel):
    items: list[dict[str, Any]]
    total: int


class FlowStartRequest(BaseModel):
    flow_type: str = Field(pattern="^(chat|knowledge)$")
    persona_id: str
    message: Optional[str] = None
    payload: dict[str, Any] = {}


class FlowStartResponse(BaseModel):
    flow_id: str
    status: str
    started_at: str
    response: dict[str, Any] = {}


class SshConnectRequest(BaseModel):
    host: str = Field(min_length=1)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(default="root")
    password: str = ""
    key_type: str = Field(default="password", pattern="^(password|key)$")
    private_key: str = ""
    command: str = Field(default="", description="Comando opcional para executar apos conectar")


class SshConnectResponse(BaseModel):
    connected: bool
    host: str
    port: int
    username: str
    output: str = ""
    error: str = ""
