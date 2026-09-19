"""
Minimal usage analytics API for Daily English Vocab.
Persists events in SQLite; exposes POST /events and GET /stats.
"""

from __future__ import annotations

import html
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
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


def _compute_stats() -> dict[str, Any]:
    """Shared stats payload for JSON and HTML endpoints."""
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


def _fmt_num(value: Any, *, suffix: str = "") -> str:
    if value is None:
        return "尚無資料"
    if isinstance(value, float):
        text = f"{value:g}"
    else:
        text = str(value)
    return f"{html.escape(text)}{html.escape(suffix)}" if suffix else html.escape(text)


def _stats_html(stats: dict[str, Any]) -> str:
    sc = stats.get("sample_counts") or {}
    unique = _fmt_num(stats.get("unique_sessions"))
    avg_session = _fmt_num(stats.get("avg_session_duration_sec"), suffix=" 秒")
    avg_flash = _fmt_num(stats.get("avg_flashcard_time_sec"), suffix=" 秒")
    avg_quiz = _fmt_num(stats.get("avg_quiz_time_sec"), suffix=" 秒")
    n_sess = _fmt_num(sc.get("sessions_with_duration"))
    n_flash = _fmt_num(sc.get("flashcard_segments"))
    n_quiz = _fmt_num(sc.get("quiz_segments"))

    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta http-equiv="refresh" content="30" />
  <title>使用統計 · Daily English Vocab</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700&family=Outfit:wght@500;700&display=swap" rel="stylesheet" />
  <style>
    :root {{
      --bg: #0f1221;
      --bg-soft: #171b2f;
      --card: #1e2438;
      --text: #f4f6fb;
      --muted: #9aa3bf;
      --accent: #6c8cff;
      --accent-2: #a78bfa;
      --radius: 20px;
      --font: "Noto Sans TC", system-ui, sans-serif;
      --font-en: "Outfit", "Noto Sans TC", system-ui, sans-serif;
      --safe-b: env(safe-area-inset-bottom, 0px);
    }}
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100dvh;
      font-family: var(--font);
      color: var(--text);
      background: var(--bg);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      padding: 1.25rem 0.75rem calc(1.5rem + var(--safe-b));
    }}
    .bg-blobs {{
      position: fixed; inset: 0; overflow: hidden; z-index: 0; pointer-events: none;
    }}
    .blob {{
      position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.35;
    }}
    .b1 {{ width: 420px; height: 420px; background: #4f46e5; top: -120px; left: -80px; }}
    .b2 {{ width: 360px; height: 360px; background: #db2777; bottom: 10%; right: -100px; }}
    .wrap {{
      position: relative; z-index: 1;
      width: min(560px, 100%);
      margin-inline: auto;
      display: flex; flex-direction: column; gap: 1rem;
    }}
    header {{
      display: flex; align-items: center; gap: 0.85rem;
    }}
    .brand-icon {{
      font-size: 1.6rem; width: 3rem; height: 3rem;
      display: grid; place-items: center;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(108, 140, 255, 0.35);
    }}
    h1 {{
      margin: 0; font-size: 1.25rem; font-weight: 700;
    }}
    .tagline {{
      margin: 0.15rem 0 0; font-size: 0.8rem; color: var(--muted);
    }}
    .card {{
      background: var(--card);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: var(--radius);
      padding: 1.1rem 1.15rem;
      box-shadow: 0 20px 50px rgba(0,0,0,0.35);
    }}
    .grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }}
    @media (max-width: 420px) {{
      .grid {{ grid-template-columns: 1fr; }}
    }}
    .stat {{
      background: var(--bg-soft);
      border-radius: 14px;
      padding: 0.9rem 1rem;
      border: 1px solid rgba(255,255,255,0.04);
    }}
    .stat.span-2 {{ grid-column: 1 / -1; }}
    .label {{
      display: block;
      font-size: 0.78rem;
      color: var(--muted);
      margin-bottom: 0.35rem;
    }}
    .value {{
      font-family: var(--font-en);
      font-size: 1.55rem;
      font-weight: 700;
      letter-spacing: 0.01em;
      word-break: break-word;
    }}
    .value.empty {{
      font-family: var(--font);
      font-size: 1.05rem;
      font-weight: 500;
      color: var(--muted);
    }}
    h2 {{
      margin: 0 0 0.75rem;
      font-size: 0.95rem;
      font-weight: 700;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }}
    th, td {{
      text-align: left;
      padding: 0.55rem 0.25rem;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }}
    th {{ color: var(--muted); font-weight: 500; font-size: 0.78rem; }}
    td.num {{
      font-family: var(--font-en);
      font-weight: 700;
      text-align: right;
    }}
    .links {{
      display: flex; flex-wrap: wrap; gap: 0.6rem;
    }}
    a {{
      color: var(--accent);
      text-decoration: none;
      font-size: 0.88rem;
      padding: 0.45rem 0.75rem;
      border-radius: 999px;
      background: rgba(108, 140, 255, 0.12);
      border: 1px solid rgba(108, 140, 255, 0.25);
    }}
    a:hover {{ background: rgba(108, 140, 255, 0.22); }}
    footer {{
      color: var(--muted);
      font-size: 0.75rem;
      text-align: center;
      margin-top: 0.25rem;
    }}
  </style>
</head>
<body>
  <div class="bg-blobs" aria-hidden="true">
    <span class="blob b1"></span>
    <span class="blob b2"></span>
  </div>
  <div class="wrap">
    <header>
      <span class="brand-icon" aria-hidden="true">📊</span>
      <div>
        <h1>使用統計</h1>
        <p class="tagline">Daily English Vocab · Analytics</p>
      </div>
    </header>

    <section class="card" aria-label="主要指標">
      <div class="grid">
        <div class="stat span-2">
          <span class="label">不重複造訪人數（unique_sessions）</span>
          <div class="value{" empty" if stats.get("unique_sessions") is None else ""}">{unique}</div>
        </div>
        <div class="stat">
          <span class="label">平均使用時間</span>
          <div class="value{" empty" if stats.get("avg_session_duration_sec") is None else ""}">{avg_session}</div>
        </div>
        <div class="stat">
          <span class="label">平均閃卡時間</span>
          <div class="value{" empty" if stats.get("avg_flashcard_time_sec") is None else ""}">{avg_flash}</div>
        </div>
        <div class="stat span-2">
          <span class="label">平均測驗時間</span>
          <div class="value{" empty" if stats.get("avg_quiz_time_sec") is None else ""}">{avg_quiz}</div>
        </div>
      </div>
    </section>

    <section class="card" aria-label="樣本數">
      <h2>樣本數（sample_counts）</h2>
      <table>
        <thead>
          <tr><th>項目</th><th>數量</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>有時長的 session（sessions_with_duration）</td>
            <td class="num">{n_sess}</td>
          </tr>
          <tr>
            <td>閃卡時段（flashcard_segments）</td>
            <td class="num">{n_flash}</td>
          </tr>
          <tr>
            <td>測驗時段（quiz_segments）</td>
            <td class="num">{n_quiz}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <nav class="links" aria-label="相關連結">
      <a href="/docs">API 文件 /docs</a>
      <a href="/stats.json">原始 JSON /stats.json</a>
    </nav>
    <footer>每 30 秒自動重新整理 · 資料為伺服器端即時彙總</footer>
  </div>
</body>
</html>
"""


@app.get("/stats.json")
def get_stats_json() -> dict[str, Any]:
    """Machine-readable stats (same payload previously at GET /stats)."""
    return _compute_stats()


@app.get("/stats", response_class=HTMLResponse)
def get_stats_html() -> HTMLResponse:
    """Human-friendly Traditional Chinese dashboard (mobile / dark friendly)."""
    return HTMLResponse(content=_stats_html(_compute_stats()))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
