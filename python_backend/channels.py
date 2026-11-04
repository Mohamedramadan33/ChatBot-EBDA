"""Multi-Channel Webhook Adapters for WhatsApp Business API, Facebook Messenger, and Web Widget."""
from typing import Any
import httpx
from fastapi import HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from .config import settings


def verify_meta_webhook(
    mode: str | None,
    token: str | None,
    challenge: str | None,
    expected_token: str,
) -> PlainTextResponse:
    """Shared GET webhook verification handshake for Meta WhatsApp Cloud API & Messenger."""
    if mode == "subscribe" and token == expected_token and challenge is not None:
        return PlainTextResponse(content=challenge, status_code=200)
    raise HTTPException(status_code=403, detail="Webhook verification token mismatch.")


def parse_whatsapp_inbound(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Extract sender phone and message text from WhatsApp Business Cloud API webhook event."""
    extracted: list[dict[str, str]] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            contacts = value.get("contacts", [])
            profile_name = contacts[0].get("profile", {}).get("name", "Grower") if contacts else "Grower"
            for msg in value.get("messages", []):
                if msg.get("type") == "text":
                    sender = msg.get("from", "unknown")
                    text = msg.get("text", {}).get("body", "").strip()
                    if text:
                        extracted.append(
                            {
                                "session_id": f"whatsapp:{sender}",
                                "external_user_id": sender,
                                "profile_name": profile_name,
                                "message_id": msg.get("id", ""),
                                "text": text,
                            }
                        )
    return extracted


async def dispatch_whatsapp_reply(recipient_phone: str, reply_text: str) -> dict[str, Any]:
    """Send outbound WhatsApp message via Meta Graph API (or return structured dry-run payload)."""
    outbound_body = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient_phone,
        "type": "text",
        "text": {"preview_url": False, "body": reply_text},
    }
    if not settings.whatsapp_access_token or not settings.whatsapp_phone_number_id:
        return {"dispatched": False, "mode": "sandbox_preview", "graph_payload": outbound_body}

    url = f"https://graph.facebook.com/v21.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {"Authorization": f"Bearer {settings.whatsapp_access_token}"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json=outbound_body, headers=headers)
        return {"dispatched": resp.is_success, "status_code": resp.status_code, "graph_payload": outbound_body}


def parse_messenger_inbound(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Extract sender PSID and message text from Facebook Messenger webhook event."""
    extracted: list[dict[str, str]] = []
    for entry in payload.get("entry", []):
        for event in entry.get("messaging", []):
            sender_psid = event.get("sender", {}).get("id", "unknown")
            message = event.get("message", {})
            if message and not message.get("is_echo") and message.get("text"):
                extracted.append(
                    {
                        "session_id": f"messenger:{sender_psid}",
                        "external_user_id": sender_psid,
                        "message_id": message.get("mid", ""),
                        "text": message["text"].strip(),
                    }
                )
    return extracted


async def dispatch_messenger_reply(recipient_psid: str, reply_text: str) -> dict[str, Any]:
    """Send outbound Facebook Messenger reply via Graph API Send endpoint."""
    outbound_body = {
        "recipient": {"id": recipient_psid},
        "messaging_type": "RESPONSE",
        "message": {"text": reply_text},
    }
    if not settings.messenger_page_access_token:
        return {"dispatched": False, "mode": "sandbox_preview", "graph_payload": outbound_body}

    url = "https://graph.facebook.com/v21.0/me/messages"
    params = {"access_token": settings.messenger_page_access_token}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, params=params, json=outbound_body)
        return {"dispatched": resp.is_success, "status_code": resp.status_code, "graph_payload": outbound_body}
