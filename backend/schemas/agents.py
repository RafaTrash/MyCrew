"""
Agent schemas
"""
from pydantic import BaseModel
from typing import Optional


class CreateAgentPayload(BaseModel):
    name: str
    description: Optional[str] = None
    avatarUrl: Optional[str] = None
    modelId: str
    modelName: Optional[str] = None
    tags: list[str] = []
    prompt: str
    skills: list[str] = []
    knowledge: list[str] = []