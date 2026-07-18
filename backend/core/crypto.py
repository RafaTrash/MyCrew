"""
Crypto utilities - API key encryption/decryption
"""
import base64
from cryptography.fernet import Fernet
from .config import CRYPTO_KEY

_cipher = Fernet(CRYPTO_KEY)


def encrypt_api_key(api_key: str) -> bytes:
    """Encrypt an API key for storage."""
    return _cipher.encrypt(api_key.encode())


def decrypt_api_key(encrypted) -> str:
    """Decrypt an API key from storage.
    
    Handles different types returned by PostgreSQL (memoryview, bytearray, etc.)
    """
    if encrypted is None:
        raise ValueError("api_key_encrypted is None")
    
    # Convert buffer types to bytes
    if isinstance(encrypted, memoryview):
        encrypted = bytes(encrypted)
    elif isinstance(encrypted, bytearray):
        encrypted = bytes(encrypted)
    elif isinstance(encrypted, str):
        # If somehow stored as base64 string
        try:
            encrypted = base64.b64decode(encrypted)
        except Exception:
            raise ValueError(f"api_key_encrypted is invalid string: {encrypted[:50]}...")
    elif isinstance(encrypted, bytes):
        pass  # Already bytes, proceed
    else:
        raise ValueError(f"api_key_encrypted has unexpected type: {type(encrypted)}")
    
    # Check if empty after conversion
    if len(encrypted) == 0:
        raise ValueError("api_key_encrypted is empty")
    
    return _cipher.decrypt(encrypted).decode()


__all__ = ["encrypt_api_key", "decrypt_api_key"]