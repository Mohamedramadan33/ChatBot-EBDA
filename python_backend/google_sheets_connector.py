"""Google Sheets API v4 + Public Link Connector for ChromaDB Organic Crop RAG."""
import csv
import io
import re
from typing import Any
import httpx

from .rag_pipeline import AgronomyRAGPipeline


def extract_spreadsheet_id(url_or_id: str) -> str:
    trimmed = url_or_id.strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", trimmed)
    if match:
        return match.group(1)
    return trimmed


async def sync_google_sheet_oauth(
    rag: AgronomyRAGPipeline,
    spreadsheet_url_or_id: str,
    bearer_token: str,
) -> dict[str, Any]:
    """Read all tabs of a Google Sheet via Google Sheets API v4 using client OAuth Bearer token."""
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    headers = {"Authorization": f"Bearer {bearer_token}"}

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1. Fetch spreadsheet metadata first to discover real sheet tab names (never hardcode Sheet1)
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
            return {"title": title, "tabs_synced": 0, "rows_ingested": 0}

        # 2. Batch-fetch values across all discovered tabs
        params = [("ranges", tab) for tab in sheet_titles]
        vals_url = f"https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values:batchGet"
        vals_resp = await client.get(vals_url, headers=headers, params=params)
        vals_resp.raise_for_status()
        value_ranges = vals_resp.json().get("valueRanges", [])

    records: list[dict[str, str]] = []
    for tab_name, vr in zip(sheet_titles, value_ranges):
        rows = vr.get("values", [])
        non_empty = [[str(c).strip() for c in r] for r in rows if any(str(c).strip() for c in r)]
        if len(non_empty) < 2:
            continue
        col_headers = [h if h else f"عمود_{i + 1}" for i, h in enumerate(non_empty[0])]
        for r_idx, r_vals in enumerate(non_empty[1:], start=1):
            pairs = [
                f"{col_headers[i]}: {val}"
                for i, val in enumerate(r_vals)
                if i < len(col_headers) and val != ""
            ]
            if not pairs:
                continue
            primary = r_vals[0] if r_vals and r_vals[0] else f"صف {r_idx}"
            records.append(
                {
                    "section": f"شيت {tab_name} · صف {r_idx} ({primary[:40]})",
                    "text": f"جوجل شيت أورجانيك ({title} - {tab_name}) — {primary}: " + " | ".join(pairs),
                }
            )

    upserted = rag.upsert_dynamic_records(
        source_name=f"gsheet:{title}",
        format_label="GOOGLE_SHEET",
        records=records,
        source_type="live_api",
    )
    return {"title": title, "tabs": sheet_titles, "rows_ingested": upserted}


async def sync_public_google_sheet_csv(
    rag: AgronomyRAGPipeline,
    spreadsheet_url_or_id: str,
    gid: str = "0",
) -> dict[str, Any]:
    """Zero-login fallback for Google Sheets shared as 'Anyone with the link can view'."""
    spreadsheet_id = extract_spreadsheet_id(spreadsheet_url_or_id)
    gid_match = re.search(r"[#&?]gid=([0-9]+)", spreadsheet_url_or_id)
    effective_gid = gid_match.group(1) if gid_match else gid
    export_url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?format=csv&gid={effective_gid}"

    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        resp = await client.get(export_url)
        resp.raise_for_status()
        csv_text = resp.text

    reader = csv.DictReader(io.StringIO(csv_text))
    records: list[dict[str, str]] = []
    for r_idx, row in enumerate(reader, start=1):
        primary = next(iter(row.values()), f"صف {r_idx}")
        pairs = [f"{k}: {v}" for k, v in row.items() if v is not None and str(v).strip() != ""]
        if pairs:
            records.append(
                {
                    "section": f"صف {r_idx} ({primary[:40]})",
                    "text": f"جوجل شيت أورجانيك ({spreadsheet_id[:10]}) — {primary}: " + " | ".join(pairs),
                }
            )

    upserted = rag.upsert_dynamic_records(
        source_name=f"gsheet:{spreadsheet_id[:10]}",
        format_label="GOOGLE_SHEET",
        records=records,
        source_type="live_api",
    )
    return {"spreadsheet_id": spreadsheet_id, "rows_ingested": upserted}
