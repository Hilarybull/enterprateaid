from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    # bcrypt limit is 72 bytes; enforce to avoid runtime errors
    password: str = Field(min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    id: str
    email: EmailStr
    name: str | None = None
    picture: str | None = None
    auth_provider: str | None = None
    has_password: bool = False


class UpdateProfileRequest(BaseModel):
    name: str | None = Field(default=None, max_length=100)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


class GoogleAuthRequest(BaseModel):
    credential: str = Field(min_length=20)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=8, max_length=72)
