# EBDA Organic & Biodynamic Chatbot — Modular Python (`google-genai` + `ChromaDB` + `Google Sheets` + `FastAPI` + `Streamlit`)

Official modular backend for **الجمعية المصرية للزراعة الحيوية (EBDA — Egyptian Biodynamic Association)** & **Economy of Love (EoL)** certification under the **SI/EoL** German-Egyptian project (BMZ, bbw gGmbH, sequa gGmbH).

Built on the official **`google-genai`** SDK (`gemini-2.5-flash` + `gemini-embedding-2-preview`), **`chromadb`** local/in-memory vector store, real-time **Google Sheets** dynamic sync (`gspread` / `google-api-python-client` / shared CSV), local **CLI + Streamlit** testing interfaces, and **FastAPI** webhooks for Meta (WhatsApp Cloud API, Facebook Messenger) and website chat widgets.

## Covered ToR Knowledge Modules
- **7 Core Organic & Biodynamic Topics** (General & Crop-Specific across 67 Egyptian crops):
  1. Environmental needs (Soil Type, Light, Heat, Moisture)
  2. Seeds & Planting (Seed rate/feddan, Seedlings, Planting practices, Land preparation)
  3. Irrigation (Methods & costs, Water requirements, Salinity)
  4. Fertilization (Compost, Liquid bio-fertilizers, Certified input suppliers)
  5. Bio Control (Pests & diseases, Biological control, Weed management)
  6. Harvesting (Harvesting methods & dates)
  7. Post-harvest treatments (Processing, Transportation, Storage, Marketing & EoL/DEMETER)
- **11 Official FAQs**: Biodynamic farming, Weed management, Biological control, Certified organic input sources, Organic marketing, High-efficiency compost production, Permitted irrigation water sources, Required irrigation water lab tests, Liquid bio-fertilizers, Egyptian seasonal planting guidelines, and Economy of Love (EoL) Carbon Credits.

## 1. Installation & Environment Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r python_backend/requirements.txt

export GEMINI_API_KEY="your_gemini_api_key"
# Optional for private Google Sheets via Service Account (gspread):
# export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service_account.json"
```

## 2. Local Testing Interfaces (Streamlit & CLI)

### Option A — Interactive Arabic Streamlit UI
```bash
streamlit run python_backend/streamlit_app.py
```

### Option B — Local CLI Tester (with optional live Google Sheet URL/ID)
```bash
python3 -m python_backend.cli_tester --sheet-url "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit"
```

## 3. Multi-Channel FastAPI Server (WhatsApp, Messenger, Website Widget)

```bash
uvicorn python_backend.main:app --host 0.0.0.0 --port 8000 --reload
```

- `POST /api/google-sheets/sync`: Real-time Google Sheets sync into ChromaDB (`gspread`, `google-api-python-client`, or shared link).
- `POST /api/knowledge/query`: Direct ChromaDB vector retrieval inspection.
- `POST /api/chat` & `POST /webhooks/widget`: Website chat widget RAG endpoint.
- `GET / POST /webhooks/whatsapp`: Meta WhatsApp Business Cloud API verification & inbound webhook.
- `GET / POST /webhooks/messenger`: Facebook Messenger Platform verification & inbound webhook.
- `GET / POST /api/feedback`: Farmer satisfaction feedback & RAG improvement loop.

## 4. Maintenance Guide
- **Updating Crop & Input Data**: Sync updated Google Sheets directly via `POST /api/google-sheets/sync` or drop updated `.csv`/`.md`/`.pdf` guides into `data/` (`ebda_tor_knowledge_base.md`).
- **Monitoring Quality**: Review farmer thumbs-up/down ratings in `/api/feedback` and promote verified agronomic answers into ChromaDB.
