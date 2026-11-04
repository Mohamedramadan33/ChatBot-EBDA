# AgriPulse RAG — Python FastAPI + `google-genai` + ChromaDB Backend

Zero-infrastructure agricultural & agribusiness advisory backend powered by the official **`google-genai`** SDK (`gemini-2.5-flash` + `gemini-embedding-2-preview`), **ChromaDB** persistent local vector storage, **SQLite** session & feedback memory, external live agricultural API connectors, and **FastAPI** multi-channel webhooks.

## 1. Quick Start (Zero Infrastructure Cost)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r python_backend/requirements.txt

export GEMINI_API_KEY="your_free_tier_gemini_api_key"
export WHATSAPP_VERIFY_TOKEN="agripulse_wa_verify_2026"
export MESSENGER_VERIFY_TOKEN="agripulse_fb_verify_2026"

# Generate sample agronomy PDF (if not already in ./data) and launch FastAPI
python3 python_backend/generate_sample_pdf.py
uvicorn python_backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## 2. Architecture Overview

- **`config.py`**: Environment-driven settings defaulting to free-tier `gemini-2.5-flash` and `gemini-embedding-2-preview`.
- **`rag_pipeline.py`**: `chromadb.PersistentClient` with cosine similarity (`hnsw:space="cosine"`), custom `GeminiGenAIEmbeddingFunction` batching embeddings cleanly within free-tier RPM limits, and native parsers for `.pdf` (`pypdf`), `.csv` (`csv.DictReader`), and `.json` protocols.
- **`external_connectors.py`**: Live connectors for **Open-Meteo Agricultural Weather** (temperature, precipitation, soil moisture, FAO Penman-Monteith $ET_0$), **OpenWeatherMap**, and **ISRIC SoilGrids v2.0** public soil databases using deterministic ChromaDB chunk IDs (`dyn_<sha256>`) to overwrite stale telemetry without vector bloat.
- **`persona.py`**: Strict zero-fluff Senior Agronomist & Agribusiness Economist system prompt enforcing `[Source: filename]` citations, SI/commercial units (`kg/ha`, `t/ha`, `USD/ha`, breakeven yields), and channel-aware formatting.
- **`session_store.py`**: Local SQLite persistence for multi-channel grower profiles (`sessions`), sliding-window `google.genai.types.Content` history (`messages`), and user thumbs-up/down ratings + chunk lineage (`feedback`).
- **`channels.py` & `main.py`**: Webhook verification (`GET`) and event ingestion (`POST`) for **WhatsApp Business Cloud API** (`/webhooks/whatsapp`), **Facebook Messenger** (`/webhooks/messenger`), and the **Website Widget** (`/webhooks/widget`).
