"""
Provider and Model schemas
"""
from pydantic import BaseModel
from typing import Optional


class CreateModelPayload(BaseModel):
    providerSlug: str
    modelName: str


class ProviderConfigPayload(BaseModel):
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None


class ProviderConfigUpdate(BaseModel):
    baseUrl: Optional[str] = None
    apiKey: Optional[str] = None