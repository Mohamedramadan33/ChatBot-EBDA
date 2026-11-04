"""Environment & runtime configuration for AgriPulse Python FastAPI RAG Backend."""
from dataclasses import dataclass, field
import os


@dataclass(frozen=True)
class Settings:
    # Engine & Zero-Infrastructure Free Tier Models
    gemini_api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", ""))
    generation_model: str = field(default_factory=lambda: os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"))
    embedding_model: str = field(
        default_factory=lambda: os.environ.get("GEMINI_EMBEDDING_MODEL", "gemini-embedding-2-preview")
    )

    # Local Zero-Cost Storage Paths
    data_dir: str = field(default_factory=lambda: os.environ.get("DATA_DIR", "./data"))
    chroma_persist_dir: str = field(default_factory=lambda: os.environ.get("CHROMA_PERSIST_DIR", "./.local_store/chroma"))
    chroma_collection: str = "agripulse_agronomy_kb"
    sqlite_db_path: str = field(default_factory=lambda: os.environ.get("SQLITE_DB_PATH", "./.local_store/agripulse.db"))

    # Multi-Channel Webhook Credentials (Meta WhatsApp Cloud API & Facebook Messenger)
    whatsapp_verify_token: str = field(
        default_factory=lambda: os.environ.get("WHATSAPP_VERIFY_TOKEN", "agripulse_wa_verify_2026")
    )
    whatsapp_access_token: str = field(default_factory=lambda: os.environ.get("WHATSAPP_ACCESS_TOKEN", ""))
    whatsapp_phone_number_id: str = field(default_factory=lambda: os.environ.get("WHATSAPP_PHONE_NUMBER_ID", ""))

    messenger_verify_token: str = field(
        default_factory=lambda: os.environ.get("MESSENGER_VERIFY_TOKEN", "agripulse_fb_verify_2026")
    )
    messenger_page_access_token: str = field(
        default_factory=lambda: os.environ.get("MESSENGER_PAGE_ACCESS_TOKEN", "")
    )

    # External Agricultural API Keys (Optional — Open-Meteo & ISRIC SoilGrids require no key)
    openweather_api_key: str = field(default_factory=lambda: os.environ.get("OPENWEATHER_API_KEY", ""))
    usda_quickstats_api_key: str = field(default_factory=lambda: os.environ.get("USDA_QUICKSTATS_API_KEY", ""))


settings = Settings()
