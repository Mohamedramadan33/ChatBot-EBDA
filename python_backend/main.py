"""AgriPulse FastAPI Application: Gemini 2.5 Flash + ChromaDB RAG + Multi-Channel Webhooks."""
from contextlib import asynccontextmanager
import time
from typing import Any

from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from .channels import (
    dispatch_messenger_reply,
    dispatch_whatsapp_reply,
    parse_messenger_inbound,
    parse_whatsapp_inbound,
    verify_meta_webhook,
)
from .config import settings
from .external_connectors import sync_isric_soilgrids_profile, sync_open_meteo_ag_weather
from .persona import ADVISOR_SYSTEM_INSTRUCTION, build_rag_augmented_prompt
from .rag_pipeline import AgronomyRAGPipeline
from .session_store import SessionAndFeedbackStore


genai_client = genai.Client(api_key=settings.gemini_api_key)
rag_pipeline = AgronomyRAGPipeline(genai_client=genai_client)
store = SessionAndFeedbackStore()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    rag_pipeline.ingest_directory()
    yield


app = FastAPI(
    title="AgriPulse RAG Agronomy & Agribusiness Advisor",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    session_id: str = Field(default="widget:default")
    message: str
    channel: str = Field(default="widget")
    external_user_id: str = Field(default="web-visitor")
    farm_context: dict[str, Any] | None = None


class FeedbackRequest(BaseModel):
    message_id: str
    session_id: str
    rating: int = Field(description="+1 for thumbs up, -1 for thumbs down")
    category: str = Field(default="general")
    comment: str = Field(default="")


class PromoteCorrectionRequest(BaseModel):
    feedback_id: str
    verified_fact_passage: str
    topic_label: str


class LiveSyncRequest(BaseModel):
    latitude: float = 36.7378
    longitude: float = -119.7871
    region_label: str = "Valley Ridge Station"
    include_soilgrids: bool = True


async def run_rag_advisor_turn(
    session_id: str,
    user_message: str,
    channel: str,
    external_user_id: str,
    context_patch: dict[str, Any] | None = None,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    session = store.get_or_create_session(session_id, channel=channel, external_user_id=external_user_id)
    if context_patch:
        session = store.update_farm_context(session_id, context_patch)

    prior_history = store.get_genai_history(session_id, max_turns=8)
    retrieved_chunks = rag_pipeline.retrieve(user_message, top_k=5)

    augmented_prompt = build_rag_augmented_prompt(
        user_query=user_message,
        retrieved_chunks=retrieved_chunks,
        farm_context=session["farm_context"],
        channel=channel,
    )

    contents = [*prior_history, types.Content(role="user", parts=[types.Part.from_text(text=augmented_prompt)])]
    answer_text = ""
    last_exc: Exception | None = None
    for candidate_model in [settings.generation_model, "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.1-flash-lite"]:
        try:
            response = genai_client.models.generate_content(
                model=candidate_model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=ADVISOR_SYSTEM_INSTRUCTION,
                ),
            )
            answer_text = (response.text or "").strip()
            if answer_text:
                last_exc = None
                break
        except Exception as exc:
            last_exc = exc
            msg = str(exc)
            if not any(code in msg for code in ("503", "UNAVAILABLE", "429", "404", "NOT_FOUND")):
                raise
    if not answer_text and last_exc:
        raise last_exc
    latency_ms = int((time.perf_counter() - t0) * 1000)

    store.append_message(session_id=session_id, role="user", content=user_message)
    assistant_msg = store.append_message(
        session_id=session_id,
        role="assistant",
        content=answer_text,
        citations=retrieved_chunks,
        latency_ms=latency_ms,
    )
    return {
        "session_id": session_id,
        "channel": channel,
        "message_id": assistant_msg["message_id"],
        "answer": answer_text,
        "citations": retrieved_chunks,
        "latency_ms": latency_ms,
        "farm_context": session["farm_context"],
    }


@app.post("/api/chat")
@app.post("/webhooks/widget")
async def widget_chat_endpoint(req: ChatRequest) -> dict[str, Any]:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")
    return await run_rag_advisor_turn(
        session_id=req.session_id,
        user_message=req.message,
        channel=req.channel,
        external_user_id=req.external_user_id,
        context_patch=req.farm_context,
    )


@app.get("/webhooks/whatsapp")
async def whatsapp_verify(
    hub_mode: str | None = Query(default=None, alias="hub.mode"),
    hub_verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(default=None, alias="hub.challenge"),
):
    return verify_meta_webhook(hub_mode, hub_verify_token, hub_challenge, settings.whatsapp_verify_token)


@app.post("/webhooks/whatsapp")
async def whatsapp_inbound(payload: dict[str, Any]) -> dict[str, Any]:
    events = parse_whatsapp_inbound(payload)
    results = []
    for ev in events:
        turn = await run_rag_advisor_turn(
            session_id=ev["session_id"],
            user_message=ev["text"],
            channel="whatsapp",
            external_user_id=ev["external_user_id"],
        )
        delivery = await dispatch_whatsapp_reply(ev["external_user_id"], turn["answer"])
        results.append({"inbound": ev, "advisor_turn": turn, "delivery": delivery})
    return {"status": "processed", "events_handled": len(results), "results": results}


@app.get("/webhooks/messenger")
async def messenger_verify(
    hub_mode: str | None = Query(default=None, alias="hub.mode"),
    hub_verify_token: str | None = Query(default=None, alias="hub.verify_token"),
    hub_challenge: str | None = Query(default=None, alias="hub.challenge"),
):
    return verify_meta_webhook(hub_mode, hub_verify_token, hub_challenge, settings.messenger_verify_token)


@app.post("/webhooks/messenger")
async def messenger_inbound(payload: dict[str, Any]) -> dict[str, Any]:
    events = parse_messenger_inbound(payload)
    results = []
    for ev in events:
        turn = await run_rag_advisor_turn(
            session_id=ev["session_id"],
            user_message=ev["text"],
            channel="messenger",
            external_user_id=ev["external_user_id"],
        )
        delivery = await dispatch_messenger_reply(ev["external_user_id"], turn["answer"])
        results.append({"inbound": ev, "advisor_turn": turn, "delivery": delivery})
    return {"status": "processed", "events_handled": len(results), "results": results}


@app.post("/api/connectors/sync")
async def sync_external_ag_sources(req: LiveSyncRequest) -> dict[str, Any]:
    weather_res = await sync_open_meteo_ag_weather(
        rag_pipeline, req.latitude, req.longitude, req.region_label
    )
    soil_res = None
    if req.include_soilgrids:
        soil_res = await sync_isric_soilgrids_profile(
            rag_pipeline, req.latitude, req.longitude, req.region_label
        )
    return {"weather": weather_res, "soilgrids": soil_res, "collection_count": rag_pipeline.collection.count()}


@app.post("/api/feedback")
async def submit_feedback(req: FeedbackRequest) -> dict[str, Any]:
    return store.record_feedback(
        message_id=req.message_id,
        session_id=req.session_id,
        rating=req.rating,
        category=req.category,
        comment=req.comment,
    )


@app.post("/api/knowledge/upload")
async def upload_crop_excel_or_file(file: UploadFile = File(...)) -> dict[str, Any]:
    """Upload an Excel (.xlsx), CSV, PDF, or JSON crop sheet and index directly into ChromaDB."""
    from pathlib import Path
    safe_name = Path(file.filename or "uploaded_crops.xlsx").name
    ext = Path(safe_name).suffix.lower()
    if ext not in {".xlsx", ".csv", ".pdf", ".json", ".txt", ".md"}:
        raise HTTPException(status_code=400, detail="صيغة الملف غير مدعومة. ارفع ملف Excel (.xlsx) أو CSV أو PDF.")
    dest = Path(settings.data_dir) / safe_name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(await file.read())
    chunks_added = rag_pipeline.ingest_file(dest)
    return {
        "status": "ingested",
        "filename": safe_name,
        "chunks_upserted": chunks_added,
        "collection_count": rag_pipeline.collection.count(),
    }


class GoogleSheetSyncRequest(BaseModel):
    spreadsheet_url: str
    gid: str = "0"


@app.post("/api/google-sheets/sync")
async def sync_google_sheet_endpoint(
    req: GoogleSheetSyncRequest,
    authorization: str | None = Query(default=None),
) -> dict[str, Any]:
    """Sync crop rows from Google Sheets (via OAuth Bearer token or shared sheet link) into ChromaDB."""
    from .google_sheets_connector import sync_google_sheet_oauth, sync_public_google_sheet_csv

    if authorization and authorization.startswith("Bearer "):
        token = authorization.replace("Bearer ", "", 1).strip()
        return await sync_google_sheet_oauth(rag_pipeline, req.spreadsheet_url, token)
    return await sync_public_google_sheet_csv(rag_pipeline, req.spreadsheet_url, req.gid)


@app.post("/api/feedback/promote")
async def promote_verified_correction(req: PromoteCorrectionRequest) -> dict[str, Any]:
    count = rag_pipeline.upsert_dynamic_records(
        source_name="sme_verified_feedback_kb",
        format_label="GOLDEN_QA",
        records=[{"section": req.topic_label, "text": req.verified_fact_passage}],
        source_type="feedback_verified",
    )
    return {"upserted_chunks": count, "feedback_id": req.feedback_id}
