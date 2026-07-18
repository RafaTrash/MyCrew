"""
Auth schemas
"""
from pydantic import BaseModel


class LoginPayload(BaseModel):
    username: str
    password: str


class RegisterPayload(BaseModel):
    username: str
    password: str