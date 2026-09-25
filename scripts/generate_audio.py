#!/usr/bin/env python3
"""Pre-generate neural TTS audio for words and sentences.

Requires: pip install edge-tts ; ffmpeg on PATH.
Usage: python scripts/generate_audio.py [--force]
Output: audio/words/{id}.mp3, audio/sentences/{id}.mp3 (mono, 32 kbps).
"""
import asyncio, json, os, subprocess, sys, tempfile
import edge_tts

VOICE = "en-US-JennyNeural"
RATE = "-10%"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORCE = "--force" in sys.argv
CONCURRENCY = 6
# Trim leading/trailing silence, keeping ~80 ms padding, so playback starts promptly.
_T = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08"
TRIM = f"{_T},areverse,{_T},areverse"

def jobs():
    for w in json.load(open(os.path.join(ROOT, "data/words.json"), encoding="utf-8")):
        yield w["word"], os.path.join(ROOT, "audio/words", f"{w['id']}.mp3")
    for s in json.load(open(os.path.join(ROOT, "data/sentences.json"), encoding="utf-8")):
        yield s["en"], os.path.join(ROOT, "audio/sentences", f"{s['id']}.mp3")

async def one(text, out, sem, failures):
    if not FORCE and os.path.exists(out) and os.path.getsize(out) > 0:
        return
    async with sem:
        for attempt in range(5):
            try:
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as t:
                    tmp = t.name
                await edge_tts.Communicate(text, VOICE, rate=RATE).save(tmp)
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y", "-loglevel", "error", "-i", tmp,
                    "-af", TRIM, "-ac", "1", "-ar", "24000", "-b:a", "32k", out,
                    stdin=asyncio.subprocess.DEVNULL)
                await proc.wait()
                os.unlink(tmp)
                if proc.returncode == 0 and os.path.getsize(out) > 0:
                    return
            except Exception as e:
                print(f"retry {attempt+1} {out}: {e}", file=sys.stderr)
            await asyncio.sleep(2 * (attempt + 1))
        failures.append(out)

async def main():
    os.makedirs(os.path.join(ROOT, "audio/words"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "audio/sentences"), exist_ok=True)
    sem = asyncio.Semaphore(CONCURRENCY)
    failures = []
    await asyncio.gather(*(one(t, o, sem, failures) for t, o in jobs()))
    print("failures:", len(failures), failures[:20])

asyncio.run(main())
