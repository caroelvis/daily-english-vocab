"""
Minimal usage analytics API for Daily English Vocab.
Persists events in SQLite; exposes POST /events and GET /stats.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = Path(__file__).resolve().parent / "analytics.db"

app = FastAPI(title="Daily English Vocab Analytics", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://([a-zA-Z0-9-]+\.)*github\.io",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                event TEXT NOT NULL,
                mode TEXT,
                ts REAL NOT NULL,
                received_at REAL NOT NULL DEFAULT (strftime('%s','now'))
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, ts)"
        )


@app.on_event("startup")
def on_startup() -> None:
    init_db()


EventName = Literal["session_start", "mode_enter", "session_end"]
ModeName = Literal["flashcard", "quiz"]


class EventIn(BaseModel):
    session_id: str = Field(..., min_length=8, max_length=128)
    event: EventName
    mode: Optional[ModeName] = None
    ts: float = Field(..., description="Client timestamp in milliseconds since epoch")


class EventsBatch(BaseModel):
    """Accept a single event or a list under `events`."""

    events: Optional[list[EventIn]] = None
    session_id: Optional[str] = None
    event: Optional[EventName] = None
    mode: Optional[ModeName] = None
    ts: Optional[float] = None


def _normalize_payload(body: EventsBatch) -> list[EventIn]:
    if body.events is not None:
        return body.events
    if body.session_id and body.event is not None and body.ts is not None:
        return [
            EventIn(
                session_id=body.session_id,
                event=body.event,
                mode=body.mode,
                ts=body.ts,
            )
        ]
    raise HTTPException(status_code=422, detail="Provide a single event or events[]")


@app.post("/events")
def ingest_events(body: EventsBatch) -> dict[str, Any]:
    items = _normalize_payload(body)
    with db() as conn:
        for ev in items:
            if ev.event == "mode_enter" and ev.mode is None:
                raise HTTPException(
                    status_code=422, detail="mode_enter requires mode"
                )
            conn.execute(
                "INSERT INTO events (session_id, event, mode, ts) VALUES (?, ?, ?, ?)",
                (ev.session_id, ev.event, ev.mode, ev.ts),
            )
    return {"ok": True, "accepted": len(items)}


def _session_bounds(rows: list[sqlite3.Row]) -> Optional[tuple[float, float]]:
    """Return (start_ms, end_ms) for a session from ordered events."""
    if not rows:
        return None
    start = None
    end = None
    for r in rows:
        if r["event"] == "session_start" and start is None:
            start = r["ts"]
        if r["event"] == "session_end":
            end = r["ts"]
    if start is None:
        start = rows[0]["ts"]
    if end is None:
        end = rows[-1]["ts"]
    if end < start:
        return None
    return (start, end)


def _mode_durations(rows: list[sqlite3.Row]) -> dict[str, list[float]]:
    """
    Accumulate contiguous mode segments within a session.
    A mode_enter starts a segment; next mode_enter or session_end closes it.
    """
    out: dict[str, list[float]] = {"flashcard": [], "quiz": []}
    active_mode: Optional[str] = None
    active_ts: Optional[float] = None

    for r in rows:
        ev = r["event"]
        ts = float(r["ts"])
        if ev == "mode_enter" and r["mode"] in ("flashcard", "quiz"):
            if active_mode and active_ts is not None and ts >= active_ts:
                out[active_mode].append(ts - active_ts)
            active_mode = r["mode"]
            active_ts = ts
        elif ev == "session_end":
            if active_mode and active_ts is not None and ts >= active_ts:
                out[active_mode].append(ts - active_ts)
            active_mode = None
            active_ts = None
    return out


@app.get("/stats")
def get_stats() -> dict[str, Any]:
    with db() as conn:
        sessions = [
            r[0]
            for r in conn.execute(
                "SELECT DISTINCT session_id FROM events ORDER BY session_id"
            ).fetchall()
        ]
        unique_sessions = len(sessions)

        session_durations_ms: list[float] = []
        flash_ms: list[float] = []
        quiz_ms: list[float] = []

        for sid in sessions:
            rows = conn.execute(
                "SELECT event, mode, ts FROM events WHERE session_id = ? ORDER BY ts ASC, id ASC",
                (sid,),
            ).fetchall()
            bounds = _session_bounds(rows)
            if bounds:
                session_durations_ms.append(bounds[1] - bounds[0])
            md = _mode_durations(rows)
            flash_ms.extend(md["flashcard"])
            quiz_ms.extend(md["quiz"])

    def avg_sec(values_ms: list[float]) -> Optional[float]:
        if not values_ms:
            return None
        return round((sum(values_ms) / len(values_ms)) / 1000.0, 3)

    return {
        "unique_sessions": unique_sessions,
        "avg_session_duration_sec": avg_sec(session_durations_ms),
        "avg_flashcard_time_sec": avg_sec(flash_ms),
        "avg_quiz_time_sec": avg_sec(quiz_ms),
        "sample_counts": {
            "sessions_with_duration": len(session_durations_ms),
            "flashcard_segments": len(flash_ms),
            "quiz_segments": len(quiz_ms),
        },
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
