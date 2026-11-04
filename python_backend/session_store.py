"""SQLite Session History, Farm Context, and User Feedback / RAG Improvement Loop Store."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from typing import Any
import uuid

from google.genai import types

from .config import settings


DEFAULT_FARM_CONTEXT: dict[str, Any] = {
    "farm_name": "مزرعة البركة - كفر الشيخ",
    "region": "الدلتا - كفر الشيخ",
    "latitude": 31.1107,
    "longitude": 30.9388,
    "farm_size_ha": 10,
    "primary_crops": "قمح، ذرة شامية، طماطم، بطاطس",
    "soil_type": "طينية ثقيلة خصبة (أراضي الدلتا)",
    "soil_ph": 7.6,
    "irrigation_type": "ري بالتنقيط وري مطور",
    "currency": "EGP",
}


class SessionAndFeedbackStore:
    """Zero-infrastructure persistent SQLite database for sessions, transcripts, and response ratings."""

    def __init__(self, db_path: str | None = None) -> None:
        self.db_path = db_path or settings.sqlite_db_path
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    channel TEXT NOT NULL,
                    external_user_id TEXT NOT NULL,
                    farm_context_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS messages (
                    message_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    citations_json TEXT NOT NULL DEFAULT '[]',
                    latency_ms INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS feedback (
                    feedback_id TEXT PRIMARY KEY,
                    message_id TEXT NOT NULL UNIQUE,
                    session_id TEXT NOT NULL,
                    rating INTEGER NOT NULL CHECK (rating IN (-1, 1)),
                    category TEXT NOT NULL DEFAULT 'general',
                    comment TEXT NOT NULL DEFAULT '',
                    query_text TEXT NOT NULL DEFAULT '',
                    assistant_text TEXT NOT NULL DEFAULT '',
                    retrieved_chunks_json TEXT NOT NULL DEFAULT '[]',
                    promoted_to_rag INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );
                """
            )

    def get_or_create_session(
        self,
        session_id: str,
        channel: str = "widget",
        external_user_id: str = "web-grower",
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
            if row:
                return {
                    "session_id": row["session_id"],
                    "channel": row["channel"],
                    "external_user_id": row["external_user_id"],
                    "farm_context": json.loads(row["farm_context_json"]),
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                }
            conn.execute(
                """
                INSERT INTO sessions (session_id, channel, external_user_id, farm_context_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (session_id, channel, external_user_id, json.dumps(DEFAULT_FARM_CONTEXT), now, now),
            )
            return {
                "session_id": session_id,
                "channel": channel,
                "external_user_id": external_user_id,
                "farm_context": dict(DEFAULT_FARM_CONTEXT),
                "created_at": now,
                "updated_at": now,
            }

    def update_farm_context(self, session_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        sess = self.get_or_create_session(session_id)
        merged = {**sess["farm_context"], **patch}
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._connect() as conn:
            conn.execute(
                "UPDATE sessions SET farm_context_json = ?, updated_at = ? WHERE session_id = ?",
                (json.dumps(merged), now, session_id),
            )
        sess["farm_context"] = merged
        sess["updated_at"] = now
        return sess

    def append_message(
        self,
        session_id: str,
        role: str,
        content: str,
        citations: list[dict[str, Any]] | None = None,
        latency_ms: int = 0,
    ) -> dict[str, Any]:
        message_id = f"msg_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO messages (message_id, session_id, role, content, citations_json, latency_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (message_id, session_id, role, content, json.dumps(citations or []), latency_ms, now),
            )
            conn.execute("UPDATE sessions SET updated_at = ? WHERE session_id = ?", (now, session_id))
        return {
            "message_id": message_id,
            "session_id": session_id,
            "role": role,
            "content": content,
            "citations": citations or [],
            "latency_ms": latency_ms,
            "created_at": now,
        }

    def get_genai_history(self, session_id: str, max_turns: int = 10) -> list[types.Content]:
        """Convert recent SQLite conversation turns into google-genai Content objects."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
                (session_id, max_turns * 2),
            ).fetchall()
        history: list[types.Content] = []
        for row in reversed(rows):
            sdk_role = "model" if row["role"] == "assistant" else "user"
            history.append(types.Content(role=sdk_role, parts=[types.Part.from_text(text=row["content"])]))
        return history

    def record_feedback(
        self,
        message_id: str,
        session_id: str,
        rating: int,
        category: str = "general",
        comment: str = "",
    ) -> dict[str, Any]:
        """Store thumbs up (+1) or thumbs down (-1) rating with retrieved chunk lineage for RAG auditing."""
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        feedback_id = f"fb_{uuid.uuid4().hex[:12]}"
        with self._connect() as conn:
            msg_row = conn.execute("SELECT * FROM messages WHERE message_id = ?", (message_id,)).fetchone()
            prev_user = conn.execute(
                """
                SELECT content FROM messages
                WHERE session_id = ? AND role = 'user' AND created_at <= ?
                ORDER BY created_at DESC LIMIT 1
                """,
                (session_id, msg_row["created_at"] if msg_row else now),
            ).fetchone()
            assistant_text = msg_row["content"] if msg_row else ""
            citations_json = msg_row["citations_json"] if msg_row else "[]"
            query_text = prev_user["content"] if prev_user else ""

            conn.execute(
                """
                INSERT INTO feedback (
                    feedback_id, message_id, session_id, rating, category, comment,
                    query_text, assistant_text, retrieved_chunks_json, promoted_to_rag, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                ON CONFLICT(message_id) DO UPDATE SET
                    rating = excluded.rating,
                    category = excluded.category,
                    comment = excluded.comment,
                    created_at = excluded.created_at
                """,
                (
                    feedback_id,
                    message_id,
                    session_id,
                    1 if rating >= 1 else -1,
                    category,
                    comment.strip(),
                    query_text,
                    assistant_text,
                    citations_json,
                    now,
                ),
            )
        return {"feedback_id": feedback_id, "message_id": message_id, "rating": rating, "category": category}
