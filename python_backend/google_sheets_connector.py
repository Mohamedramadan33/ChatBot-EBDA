"""Real-time Dynamic Google Sheets Sync via gspread, google-api-python-client, or Shared CSV Export."""
from __future__ import annotations

import csv
import io
import os
import re
from typing import Any
import httpx

from .rag_pipeline import AgronomyRAGPipeline


def extract_spreadsheet_id(url_or_id: str) -> str:
    """Extract canonical Google Spreadsheet ID from a full URL or raw ID."""
    trimmed = url_or_id.strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", trimmed)
    if match:
        return match.group(1)
    return trimmed


def _rows_to_rag_records(
    sheet_title: str,
    tab_name: str,
    raw_rows: list[list[Any]],
) -> list[dict[str, str]]:
    """Convert raw 2D worksheet grid rows into structured Arabic RAG passages."""
    non_empty = [
        [("" if cell is None else str(cell).strip()) for cell in row]
        for row in raw_rows
        if any(cell is not None and str(cell).strip() != "" for cell in row)
    ]
    if len(non_empty) < 2:
        return []

    header_idx = 0
    for idx, candidate in enumerate(non_empty[:4]):
        if sum(1 for c in candidate if c) >= 2:
            header_idx = idx
            break

    col_headers = [h if h else f"عمود_{i + 1}" for i, h in enumerate(non_empty[header_idx])]
    records: list[dict[str, str]] = []

    for r_idx, r_vals in enumerate(non_empty[header_idx + 1 :], start=1):
        pairs = [
            f"{col_headers[i]}: {val}"
            for i, val in enumerate(r_vals)
            if i < len(col_headers) and val != ""
        ]
        if not pairs:
            continue
        primary = next((v for v in r_vals if v != ""), f"صف {r_idx}")
        records.append(
            {
                "section": f"تبويب {tab_name} · صف {r_idx} ({primary[:42]})",
                "text": f"بيانات Google Sheets ({sheet_title} - {tab_name}) — {primary}: " + " | ".join(pairs),
            }
        )
    return records


def sync_google_sheet_gspread(
    rag: AgronomyRAGPipeline,
    spreadsheet_url_or_id: str,
    service_account_json_path: str | None = None,
) -> dict[str, Any]:
    """Fetch live agricultural rows from all tabs via gspread (Service Account credentials)."""
    import gspread

    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    creds_path = service_account_json_path or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")

    if creds_path and os.path.exists(creds_path):
        gc = gspread.service_account(filename=creds_path)
    else:
        gc = gspread.service_account()

    sh = gc.open_by_key(spreadsheet_id)
    title = sh.title or f"GoogleSheet_{spreadsheet_id[:8]}"
    worksheets = sh.worksheets()

    all_records: list[dict[str, str]] = []
    tab_names: list[str] = []
    for ws in worksheets:
        tab_names.append(ws.title)
        values = ws.get_all_values()
        all_records.extend(_rows_to_rag_records(title, ws.title, values))

    upserted = rag.upsert_dynamic_records(
        source_name=f"gsheet:{title}",
        format_label="GOOGLE_SHEET",
        records=all_records,
        source_type="google_sheet",
    )
    return {
        "mode": "gspread_service_account",
        "spreadsheet_id": spreadsheet_id,
        "title": title,
        "tabs": tab_names,
        "rows_ingested": upserted,
    }


def sync_google_sheet_api_client(
    rag: AgronomyRAGPipeline,
    spreadsheet_url_or_id: str,
    bearer_token: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    """Fetch live agricultural rows via official google-api-python-client (Sheets API v4)."""
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    if bearer_token:
        creds = Credentials(token=bearer_token)
        service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    else:
        effective_key = api_key or os.environ.get("GOOGLE_SHEETS_API_KEY", "")
        if not effective_key:
            raise ValueError("Provide either OAuth bearer_token or GOOGLE_SHEETS_API_KEY for Sheets API v4.")
        service = build("sheets", "v4", developerKey=effective_key, cache_discovery=False)

    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    title = meta.get("properties", {}).get("title", f"GoogleSheet_{spreadsheet_id[:8]}")
    sheet_titles = [
        s["properties"]["title"]
        for s in meta.get("sheets", [])
        if "properties" in s and "title" in s["properties"]
    ]
    if not sheet_titles:
        return {"mode": "google_api_python_client", "title": title, "tabs": [], "rows_ingested": 0}

    batch = (
        service.spreadsheets()
        .values()
        .batchGet(spreadsheetId=spreadsheet_id, ranges=sheet_titles)
        .execute()
    )
    value_ranges = batch.get("valueRanges", [])

    all_records: list[dict[str, str]] = []
    for tab_name, vr in zip(sheet_titles, value_ranges):
        rows = vr.get("values", [])
        all_records.extend(_rows_to_rag_records(title, tab_name, rows))

    upserted = rag.upsert_dynamic_records(
        source_name=f"gsheet:{title}",
        format_label="GOOGLE_SHEET",
        records=all_records,
        source_type="google_sheet",
    )
    return {
        "mode": "google_api_python_client",
        "spreadsheet_id": spreadsheet_id,
        "title": title,
        "tabs": sheet_titles,
        "rows_ingested": upserted,
    }


async def sync_google_sheet_oauth(
    rag: AgronomyRAGPipeline,
    spreadsheet_url_or_id: str,
    bearer_token: str,
) -> dict[str, Any]:
    """Async wrapper using google-api-python-client (with httpx fallback) for OAuth Bearer tokens."""
    try:
        return sync_google_sheet_api_client(rag, spreadsheet_url_or_id, bearer_token=bearer_token)
    except ImportError:
        spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
        headers = {"Authorization": f"Bearer {bearer_token}"}
        async with httpx.AsyncClient(timeout=15.0) as client:
            meta_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}"
            meta_resp = await client.get(meta_url, headers=headers)
            meta_resp.raise_for_status()
            meta = meta_resp.json()

            title = meta.get("properties", {}).get("title", f"GoogleSheet_{spreadsheet_id[:8]}")
            sheet_titles = [
                s["properties"]["title"]
                for s in meta.get("sheets", [])
                if "properties" in s and "title" in s["properties"]
            ]
            if not sheet_titles:
                return {"mode": "oauth_rest", "title": title, "tabs": [], "rows_ingested": 0}

            params = [("ranges", tab) for tab in sheet_titles]
            vals_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchGet"
            vals_resp = await client.get(vals_url, headers=headers, params=params)
            vals_resp.raise_for_status()
            value_ranges = vals_resp.json().get("valueRanges", [])

        records: list[dict[str, str]] = []
        for tab_name, vr in zip(sheet_titles, value_ranges):
            records.extend(_rows_to_rag_records(title, tab_name, vr.get("values", [])))

        upserted = rag.upsert_dynamic_records(
            source_name=f"gsheet:{title}",
            format_label="GOOGLE_SHEET",
            records=records,
            source_type="google_sheet",
        )
        return {
            "mode": "oauth_rest",
            "spreadsheet_id": spreadsheet_id,
            "title": title,
            "tabs": sheet_titles,
            "rows_ingested": upserted,
        }


async def sync_public_google_sheet_csv(
    rag: AgronomyRAGPipeline,
    spreadsheet_url_or_id: str,
    gid: str = "0",
) -> dict[str, Any]:
    """Zero-login real-time sync for Google Sheets shared as 'Anyone with the link can view'."""
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    gid_match = re.search(r"[#&?]gid=([0-9]+)", spreadsheet_url_or_id)
    effective_gid = gid_match.group(1) if gid_match else gid
    export_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={effective_gid}"

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        resp = await client.get(export_url)
        resp.raise_for_status()
        csv_text = resp.text

    reader = csv.reader(io.StringIO(csv_text))
    raw_rows = list(reader)
    title = f"GoogleSheet_{spreadsheet_id[:10]}"
    records = _rows_to_rag_records(title, f"gid_{effective_gid}", raw_rows)

    upserted = rag.upsert_dynamic_records(
        source_name=f"gsheet:{spreadsheet_id[:10]}",
        format_label="GOOGLE_SHEET",
        records=records,
        source_type="google_sheet",
    )
    return {
        "mode": "public_csv_export",
        "spreadsheet_id": spreadsheet_id,
        "title": title,
        "tabs": [f"gid_{effective_gid}"],
        "rows_ingested": upserted,
    }


async def sync_google_sheet_live(
    rag: AgronomyRAGPipeline,
    spreadsheet_url_or_id: str,
    bearer_token: str | None = None,
    gid: str = "0",
) -> dict[str, Any]:
    """Unified real-time Google Sheets sync dispatcher (OAuth -> gspread Service Account -> Shared Link)."""
    if bearer_token:
        return await sync_google_sheet_oauth(rag, spreadsheet_url_or_id, bearer_token)

    creds_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if creds_path and os.path.exists(creds_path):
        return sync_google_sheet_gspread(rag, spreadsheet_url_or_id, creds_path)

    sheets_api_key = os.environ.get("GOOGLE_SHEETS_API_KEY", "")
    if sheets_api_key:
        return sync_google_sheet_api_client(rag, spreadsheet_url_or_id, api_key=sheets_api_key)

    return await sync_public_google_sheet_csv(rag, spreadsheet_url_or_id, gid=gid)
