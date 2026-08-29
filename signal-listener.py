#!/usr/bin/env python3
"""Signal listener — watches Telegram channels for Solana CAs, analyzes them
via the local memecoin-pattern analyzer, and pushes classified alerts.

Run: python3 signal-listener.py
First run asks for the Telegram login code interactively.
"""
import asyncio
import json
import os
import re
import sqlite3
import sys
import time

import httpx
from dotenv import load_dotenv
from telethon import TelegramClient, events

load_dotenv()

API_ID = int(os.getenv("API_ID", "0"))
API_HASH = os.getenv("API_HASH", "")
PHONE = os.getenv("PHONE", "")
ANALYZER_URL = os.getenv("ANALYZER_URL", "http://localhost:3000")
ALERT_TARGET = os.getenv("ALERT_TARGET", "thomasgem")

CHANNELS = ["FrankCowpergang", "HumbleApes"]

SESSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signals")
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signals.db")

B58 = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
URL_MINT = re.compile(
    r"(?:pump\.fun/coin/|pump\.fun/|jup\.ag/|raydium\.io/|dexscreener\.com/solana/)"
    r"([1-9A-HJ-NP-Za-km-z]{32,44})"
)

client = TelegramClient(SESSION_FILE, API_ID, API_HASH)


# ---------- base58 validation (pure python, no deps) ----------
B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def is_valid_mint(s: str) -> bool:
    if not 32 <= len(s) <= 44:
        return False
    num = 0
    for ch in s:
        idx = B58_ALPHABET.find(ch)
        if idx < 0:
            return False
        num = num * 58 + idx
    raw = num.to_bytes((num.bit_length() + 7) // 8, "big")
    # pad leading zeros (base58 '1's)
    pad = len(s) - len(s.lstrip("1"))
    return len(b"\x00" * pad + raw) == 32


def extract_mint(text: str) -> str | None:
    """Extract the most likely mint from a message: URL mints first, then
    the last valid base58 CA in the text."""
    for m in URL_MINT.finditer(text):
        if is_valid_mint(m.group(1)):
            return m.group(1)
    cands = [m.group(0) for m in B58.finditer(text) if is_valid_mint(m.group(0))]
    # skip obvious non-mints (duplicated short words etc.) — dedupe preserving order
    seen = []
    for c in cands:
        if c not in seen:
            seen.append(c)
    return seen[-1] if seen else None


# ---------- dedupe db ----------
db = sqlite3.connect(DB_FILE)
db.execute(
    """CREATE TABLE IF NOT EXISTS seen (
        mint TEXT PRIMARY KEY, channel TEXT, msg_id INTEGER,
        first_seen INTEGER, score REAL, category TEXT)"""
)
db.commit()


def already_seen(mint: str) -> bool:
    row = db.execute("SELECT 1 FROM seen WHERE mint=?", (mint,)).fetchone()
    return row is not None


def record(mint: str, channel: str, msg_id: int, score, category):
    db.execute(
        "INSERT OR IGNORE INTO seen VALUES (?,?,?,?,?,?)",
        (mint, channel, msg_id, int(time.time()), score, category),
    )
    db.commit()


# ---------- classification ----------
def classify(result: dict) -> tuple[str, list[str], str]:
    """Returns (category, tags, emoji)."""
    score = result.get("overallScore", 0)
    flags = result.get("redFlags", [])
    patterns = result.get("patterns", [])
    mc = (result.get("overview") or {}).get("mc") or 0

    high = [f for f in flags if f.get("severity") == "high"]
    tags = []
    for f in flags:
        issue = f"{f.get('issue','')} {f.get('detail','')}".lower()
        if "whale" in issue:
            tags.append("#whale-heavy")
        if "deployer" in issue or "creator" in issue:
            tags.append("#fresh-deploy")
        if "liquidity" in issue or "liq" in issue:
            tags.append("#low-liq")
        if "holder" in issue:
            tags.append("#thin-holders")
        if "tax" in issue or "mint" in issue and "authority" in issue:
            tags.append("#contract-risk")
    for p in patterns:
        n = (p.get("name") or "").lower()
        if "volume" in n and (p.get("score") or 0) >= 70:
            tags.append("#high-volume")
    if mc > 50_000_000:
        tags.append("#established-mc")

    if score >= 70 and not high:
        cat, emoji = "APEABLE", "🟢"
    elif score < 35 or ("#low-liq" in tags and "#whale-heavy" in tags):
        cat, emoji = "RUG-SHAPED", "🔴"
    elif mc > 50_000_000:
        cat, emoji = "ESTABLISHED", "⚪"
    else:
        cat, emoji = "GAMBLING", "🟡"
    return cat, sorted(set(tags)), emoji


def fmt_alert(result: dict, cat: str, tags: list[str], emoji: str,
              channel: str, link: str) -> str:
    ov = result.get("overview") or {}
    verdict = result.get("verdict", "?")
    # Lead with the plain-English buy call
    if cat == "APEABLE":
        call = "✅ SAFE TO BUY — conditions look good"
    elif cat == "RUG-SHAPED":
        call = "❌ DO NOT BUY — looks like a rug"
    elif cat == "ESTABLISHED":
        call = "⚪ ESTABLISHED — old token, not a fresh call"
    else:
        call = "⚠️ RISKY — gamble only if you accept losing it"
    lines = [
        call,
        "",
        f"{emoji} {cat} — {verdict.upper()} ({result.get('overallScore', 0)}/100)",
        f"*{ov.get('symbol') or 'Unknown'}* — MC ${ov.get('mc') or 0:,.0f}",
        f"Liq ${ov.get('liquidity') or 0:,.0f} | 24h vol ${ov.get('volume24h') or 0:,.0f}",
        f"CA: `{result.get('mint')}`",
    ]
    flags = result.get("redFlags") or []
    if flags:
        lines.append("Flags: " + "; ".join(f.get("issue", "?") for f in flags[:4]))
    if tags:
        lines.append(" ".join(tags))
    lines.append(f"Source: {channel} — {link}")
    lines.append(f"Dex: https://dexscreener.com/solana/{result.get('mint')}")
    return "\n".join(lines)


# ---------- analyzer call ----------
async def analyze(mint: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"{ANALYZER_URL}/api/analyze",
                json={"mint": mint},
            )
            r.raise_for_status()
            return r.json()
    except Exception as e:
        print(f"[analyze] {mint}: {e}")
        return None


@client.on(events.NewMessage(chats=CHANNELS))
async def on_message(event):
    text = event.message.message or ""
    mint = extract_mint(text)
    if not mint:
        return
    if already_seen(mint):
        print(f"[skip] {mint} already seen")
        return
    print(f"[new] {mint} from {event.chat.username or event.chat_id}")

    result = await analyze(mint)
    if not result:
        record(mint, str(event.chat.username), event.message.id, None, "ANALYZE_FAIL")
        return

    cat, tags, emoji = classify(result)
    record(mint, str(event.chat.username), event.message.id,
           result.get("overallScore"), cat)
    link = f"https://t.me/{event.chat.username}/{event.message.id}" \
        if event.chat.username else "dm"
    alert = fmt_alert(result, cat, tags, emoji,
                      event.chat.username or str(event.chat_id), link)
    try:
        await client.send_message(ALERT_TARGET, alert, parse_mode="md")
        print(f"[alert] {mint} -> {cat}")
    except Exception as e:
        print(f"[alert-fail] {e}")


async def main():
    if not API_ID or not API_HASH:
        sys.exit("Missing API_ID / API_HASH in .env.local")
    await client.start(phone=PHONE)
    me = await client.get_me()
    print(f"Listening as {me.first_name} — channels: {CHANNELS} -> @{ALERT_TARGET}")
    await client.run_until_disconnected()


if __name__ == "__main__":
    asyncio.run(main())
