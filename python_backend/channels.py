"""Multi-Channel Webhook Adapters for WhatsApp Business API, Facebook Messenger, and Web Widget."""
from typing import Any
import httpx
from fastapi import HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

from .config import settings
from .persona import format_message_for_channel, shorten_choice_title


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
    """Extract sender phone and message/button/list text from WhatsApp Business Cloud API webhook event."""
    extracted: list[dict[str, str]] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            contacts = value.get("contacts", [])
            profile_name = contacts[0].get("profile", {}).get("name", "Grower") if contacts else "Grower"
            for msg in value.get("messages", []):
                sender = msg.get("from", "unknown")
                msg_type = msg.get("type", "")
                text = ""
                if msg_type == "text":
                    text = msg.get("text", {}).get("body", "").strip()
                elif msg_type == "interactive":
                    inter = msg.get("interactive", {})
                    text = (
                        inter.get("button_reply", {}).get("id")
                        or inter.get("button_reply", {}).get("title")
                        or inter.get("list_reply", {}).get("id")
                        or inter.get("list_reply", {}).get("title")
                        or ""
                    ).strip()
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


async def dispatch_whatsapp_reply(
    recipient_phone: str,
    reply_text: str,
    choices: list[str] | None = None,
) -> dict[str, Any]:
    """Send outbound WhatsApp message via Meta Graph API using native Reply Buttons / Interactive List."""
    valid_choices = [c for c in (choices or []) if c][:10]
    clean_body = format_message_for_channel(reply_text, "whatsapp", bool(valid_choices))

    if not valid_choices:
        outbound_body: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "text",
            "text": {"preview_url": False, "body": clean_body},
        }
    elif len(valid_choices) <= 3:
        outbound_body = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": clean_body},
                "action": {
                    "buttons": [
                        {
                            "type": "reply",
                            "reply": {
                                "id": label[:256],
                                "title": shorten_choice_title(label, 20),
                            },
                        }
                        for label in valid_choices
                    ]
                },
            },
        }
    else:
        outbound_body = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient_phone,
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": clean_body},
                "action": {
                    "button": "اختر من القائمة",
                    "sections": [
                        {
                            "title": "خدمات الجمعية (EBDA)",
                            "rows": [
                                {
                                    "id": label[:200],
                                    "title": shorten_choice_title(label, 24),
                                    **(
                                        {"description": label[:72]}
                                        if shorten_choice_title(label, 24) != label or len(label) > 24
                                        else {}
                                    ),
                                }
                                for label in valid_choices
                            ],
                        }
                    ],
                },
            },
        }

    if not settings.whatsapp_access_token or not settings.whatsapp_phone_number_id:
        return {"dispatched": False, "mode": "sandbox_preview", "graph_payload": outbound_body}

    url = f"https://graph.facebook.com/v21.0/{settings.whatsapp_phone_number_id}/messages"
    headers = {"Authorization": f"Bearer {settings.whatsapp_access_token}"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json=outbound_body, headers=headers)
        return {"dispatched": resp.is_success, "status_code": resp.status_code, "graph_payload": outbound_body}


def parse_messenger_inbound(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Extract sender PSID and message/quick_reply text from Facebook Messenger webhook event."""
    extracted: list[dict[str, str]] = []
    for entry in payload.get("entry", []):
        for event in entry.get("messaging", []):
            sender_psid = event.get("sender", {}).get("id", "unknown")
            message = event.get("message", {})
            postback = event.get("postback", {})
            if message and message.get("is_echo"):
                continue
            text = (
                (message.get("quick_reply") or {}).get("payload")
                or postback.get("payload")
                or message.get("text")
                or ""
            ).strip()
            if text:
                extracted.append(
                    {
                        "session_id": f"messenger:{sender_psid}",
                        "external_user_id": sender_psid,
                        "message_id": message.get("mid", ""),
                        "text": text,
                    }
                )
    return extracted


async def dispatch_messenger_reply(
    recipient_psid: str,
    reply_text: str,
    choices: list[str] | None = None,
) -> dict[str, Any]:
    """Send outbound Facebook Messenger reply via Graph API Send endpoint (plain Arabic + Quick Replies)."""
    clean_text = format_message_for_channel(reply_text, "messenger", bool(choices))
    valid_choices = [c for c in (choices or []) if c][:13]
    msg_obj: dict[str, Any] = {"text": clean_text}
    if valid_choices:
        msg_obj["quick_replies"] = [
            {
                "content_type": "text",
                "title": shorten_choice_title(label, 20),
                "payload": label[:1000],
            }
            for label in valid_choices
        ]

    outbound_body = {
        "recipient": {"id": recipient_psid},
        "messaging_type": "RESPONSE",
        "message": msg_obj,
    }
    if not settings.messenger_page_access_token:
        return {"dispatched": False, "mode": "sandbox_preview", "graph_payload": outbound_body}

    url = "https://graph.facebook.com/v21.0/me/messages"
    params = {"access_token": settings.messenger_page_access_token}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, params=params, json=outbound_body)
        return {"dispatched": resp.is_success, "status_code": resp.status_code, "graph_payload": outbound_body}
