from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KNOWLEDGE_", env_file=".env", extra="ignore")
    token: str = ""
    database_url: str = "sqlite:///.data/knowledge.db"
    model_proxy_url: str = ""
    embedding_base_url: str = ""
    embedding_api_key: str = ""
    embedding_model: str = ""
    embedding_dimension: int = Field(default=1024, ge=1, le=8192)
    rerank_url: str = ""
    rerank_api_key: str = ""
    rerank_model: str = ""
    chunk_size: int = Field(default=512, ge=64, le=4096)
    chunk_overlap: int = Field(default=64, ge=0, le=512)
    ingest_workers: int = Field(default=1, ge=1, le=8)
    max_queued_jobs: int = Field(default=20, ge=1, le=100)
    max_file_bytes: int = 10 * 1024 * 1024
    max_chunks: int = 1000


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Ingest(Input):
    request_id: UUID
    project_id: UUID
    document_id: UUID
    filename: str = Field(min_length=1, max_length=240)
    media_type: Literal[
        "text/plain",
        "text/markdown",
        "text/html",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]
    content_base64: str = Field(min_length=1, max_length=14 * 1024 * 1024)


class Retrieve(Input):
    project_id: UUID
    query: str = Field(min_length=1, max_length=8000)
    limit: int = Field(default=8, ge=1, le=20)
    rerank: bool = True


class Evidence(Input):
    id: str
    project_id: UUID
    document_id: UUID
    source: str
    content: str
    score: float
    page: int | None = None


class JobView(Input):
    id: UUID
    project_id: UUID
    document_id: UUID
    filename: str
    status: Literal["queued", "running", "completed", "failed"]
    created_at: str
    updated_at: str
    error: str = ""
    result: dict | None = None
