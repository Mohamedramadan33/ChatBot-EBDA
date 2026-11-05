"""Interactive Local CLI Tester for Google Sheets + ChromaDB + Gemini 2.5 Flash Arabic Advisor."""
from __future__ import annotations

import argparse
import asyncio
from google import genai
from google.genai import types

from .config import settings
from .google_sheets_connector import sync_google_sheet_live
from .persona import ADVISOR_SYSTEM_INSTRUCTION, build_rag_augmented_prompt
from .rag_pipeline import AgronomyRAGPipeline


async def main_cli() -> None:
    parser = argparse.ArgumentParser(description="AgriPulse Arabic RAG CLI Tester (Gemini 2.5 Flash + ChromaDB)")
    parser.add_argument("--sheet-url", type=str, default="", help="Google Sheet URL or Spreadsheet ID to sync live")
    parser.add_argument("--in-memory", action="store_true", help="Use ephemeral in-memory ChromaDB store")
    args = parser.parse_args()

    if not settings.gemini_api_key:
        raise SystemExit("GEMINI_API_KEY environment variable is required.")

    client = genai.Client(api_key=settings.gemini_api_key)
    rag = AgronomyRAGPipeline(genai_client=client, in_memory=args.in_memory)
    local_stats = rag.ingest_directory()
    print(f"[ChromaDB] Indexed {local_stats['collection_count']} records from local data.")

    if args.sheet_url.strip():
        sheet_stats = await sync_google_sheet_live(rag=rag, spreadsheet_url_or_id=args.sheet_url.strip())
        print(f"[Google Sheets] Synced {sheet_stats['rows_ingested']} live rows ({sheet_stats['mode']}).")

    print("\n=== المستشار الزراعي وتحليلات الأعمال (اكتب 'exit' للخروج أو '/sync <URL>' لمزامنة شيت) ===")
    history: list[types.Content] = []

    while True:
        try:
            user_input = input("\nسؤالك > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nتم الإنهاء.")
            break

        if not user_input:
            continue
        if user_input.lower() in {"exit", "quit", "خروج"}:
            break
        if user_input.startswith("/sync "):
            target = user_input.replace("/sync ", "", 1).strip()
            res = await sync_google_sheet_live(rag=rag, spreadsheet_url_or_id=target)
            print(f"[تم التحديث] تمت فهرسة {res['rows_ingested']} صف من {res.get('title')}.")
            continue

        hits = rag.retrieve(user_input, top_k=5, min_similarity=0.15)
        augmented = build_rag_augmented_prompt(
            user_query=user_input,
            retrieved_chunks=hits,
            farm_context={},
            channel="cli",
        )
        contents = [*history[-6:], types.Content(role="user", parts=[types.Part.from_text(text=augmented)])]
        resp = client.models.generate_content(
            model=settings.generation_model,
            contents=contents,
            config=types.GenerateContentConfig(system_instruction=ADVISOR_SYSTEM_INSTRUCTION),
        )
        answer = (resp.text or "").strip()
        print(f"\nالمستشار:\n{answer}")
        if hits:
            print(f"\n[المصادر المسترجعة من ChromaDB]: " + " | ".join(f"{h['source']} ({h['similarity']})" for h in hits[:3]))

        history.append(types.Content(role="user", parts=[types.Part.from_text(text=user_input)]))
        history.append(types.Content(role="model", parts=[types.Part.from_text(text=answer)]))


if __name__ == "__main__":
    asyncio.run(main_cli())
