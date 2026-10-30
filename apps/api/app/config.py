from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=API_ROOT / ".env", extra="ignore")

    qloo_api_key: str = ""
    qloo_base_url: str = "https://hackathon.api.qloo.com"
    groq_api_key: str = ""
    database_url: str = f"sqlite:///{API_ROOT / 'marquee.db'}"
    app_secret: str = "dev-secret"
    frontend_origin: str = "http://localhost:3000"
    public_base_url: str = "http://localhost:8000"

    groq_vision_model: str = "qwen/qwen3.8-27b"
    groq_agent_model: str = "openai/gpt-oss-120b"
    groq_writer_model: str = "qwen/qwen3.8-27b"
    groq_search_model: str = "openai/gpt-oss-20b"

    qloo_bin: str = ""
    live_runs_per_hour: int = 5
    brand_checks_per_hour: int = 20
    web_research_brands: int = 4
    web_cache_days: int = 7

    @property
    def qloo_executable(self) -> str:
        if self.qloo_bin:
            return self.qloo_bin
        import os

        name = "qloo.cmd" if os.name == "nt" else "qloo"
        local = API_ROOT / "node_modules" / ".bin" / name
        return str(local) if local.exists() else "qloo"

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.frontend_origin.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
