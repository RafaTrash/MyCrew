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
    persona_id: str = Field(..., min_length=1)
    title: str = Field(default="", description="Optional title for the knowledge content")
    source: str = Field(default="manual", description="Source identifier")
    content: str = Field(min_length=1, description="Knowledge content to be indexed")
    tags: list[str] = Field(default=[], description="Optional tags for categorization")


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


# ===== IoT Device Schemas =====

class IoTDeviceBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    ip_address: str = Field(..., min_length=1, max_length=45)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(default="root", max_length=255)
    description: str = ""
    auth_method: str = Field(default="password", pattern="^(password|key)$")
    password: str = ""
    private_key: str = ""


class IoTDeviceCreate(IoTDeviceBase):
    pass


class IoTDeviceUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    ip_address: Optional[str] = Field(None, min_length=1, max_length=45)
    port: Optional[int] = Field(None, ge=1, le=65535)
    username: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    auth_method: Optional[str] = Field(None, pattern="^(password|key)$")
    private_key: Optional[str] = None
    password: Optional[str] = None


class IoTDeviceResponse(IoTDeviceBase):
    id: int
    status: str = "disconnected"
    last_connection: Optional[str] = None
    created_at: str
    updated_at: str
