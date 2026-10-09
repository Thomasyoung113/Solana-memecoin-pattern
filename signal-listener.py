#!/usr/bin/env python3
"""Zero-Telethon Web Signal Listener — scrapes public Telegram channels
via Telegram's official web reader (https://t.me/s/<channel>), analyzes CAs
via the memecoin-pattern engine, and broadcasts distinguished Quick 2x Micro-Cap alerts
via the Telegram Bot API.

No Telethon, no phone number, no API ID/Hash required.
Run: python3 signal-listener.py
"""
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request

# Load environment variables (.env.local, .env, or memecoin-alert-bot/.env)
def load_env():
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.local"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"),
        os.path.expanduser("~/memecoin-alert-bot/.env"),
    ]
    env_vars = {}
    for path in candidates:
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("'\"")
                        if k not in env_vars and v:
                            env_vars[k] = v
                            os.environ[k] = v
    return env_vars

ENV = load_env()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
TELEGRAM_CHANNEL_ID = os.getenv("TELEGRAM_CHANNEL_ID", "")
ANALYZER_URL = os.getenv("ANALYZER_URL", "http://localhost:3000")

CHANNELS = ["FrankCowpergang", "HumbleApes"]
POLL_INTERVAL_SECONDS = 6

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signals.db")

B58 = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
URL_MINT = re.compile(
    r"(?:pump\.fun/coin/|pump\.fun/|jup\.ag/|raydium\.io/|dexscreener\.com/solana/)"
    r"([1-9A-HJ-NP-Za-km-z]{32,44})"
)

# ---------- Base58 validation ----------
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
    pad = len(s) - len(s.lstrip("1"))
    return len(b"\x00" * pad + raw) == 32

def extract_mint(text: str) -> str | None:
    for m in URL_MINT.finditer(text):
        if is_valid_mint(m.group(1)):
            return m.group(1)
    cands = [m.group(0) for m in B58.finditer(text) if is_valid_mint(m.group(0))]
    seen = []
    for c in cands:
        if c not in seen:
            seen.append(c)
    return seen[-1] if seen else None

# ---------- Deduplication Database ----------
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

# ---------- Analyzer Integration ----------
def analyze_token(mint: str) -> dict | None:
    """Analyze token via local Next.js API or fallback to direct DexScreener + RugCheck."""
    # 1. Try local analyzer API endpoint
    try:
        url = f"{ANALYZER_URL}/api/analyze"
        req = urllib.request.Request(
            url,
            data=json.dumps({"mint": mint}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception:
        pass

    # 2. Resilient standalone fallback: query DexScreener & RugCheck directly
    try:
        dex_url = f"https://api.dexscreener.com/latest/dex/tokens/{mint}"
        dex_req = urllib.request.Request(dex_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(dex_req, timeout=10) as resp:
            dex_data = json.loads(resp.read().decode("utf-8"))
        pairs = dex_data.get("pairs") or []
        if not pairs:
            return None
        pair = sorted(pairs, key=lambda p: float((p.get("liquidity") or {}).get("usd") or 0), reverse=True)[0]

        rc_url = f"https://api.rugcheck.xyz/v1/tokens/{mint}/report"
        rc_req = urllib.request.Request(rc_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(rc_req, timeout=10) as resp:
            rc_data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"[analyze-standalone-err] {mint}: {e}")
        return None

    mc = float(pair.get("marketCap") or pair.get("fdv") or 0)
    buys_m5 = int((pair.get("txns") or {}).get("m5", {}).get("buys") or 0)
    sells_m5 = int((pair.get("txns") or {}).get("m5", {}).get("sells") or 0)
    vol_m5 = float((pair.get("volume") or {}).get("m5") or 0)
    is_curve = pair.get("dexId") in ("pumpfun", "moonshot") or rc_data.get("tokenType") == "pump_fun"

    creator = rc_data.get("creator") or ""
    top_holders = rc_data.get("topHolders") or []
    dev_holder = next((h for h in top_holders if h.get("owner") == creator or h.get("address") == creator), None)
    dev_pct = float(dev_holder.get("pct") or 0) if dev_holder else 0.0

    mint_revoked = rc_data.get("mintAuthority") is None and (rc_data.get("token") or {}).get("mintAuthority") is None
    freeze_revoked = rc_data.get("freezeAuthority") is None and (rc_data.get("token") or {}).get("freezeAuthority") is None

    mc_in_range = 6_000 <= mc <= 22_000
    is_spot = mc_in_range and dev_pct <= 8.0 and mint_revoked and freeze_revoked and (buys_m5 >= 10 or is_curve)

    tp1_mult = f"{max(1.5, round(20_000 / mc, 1))}x" if mc > 0 else "2.0x"
    tp2_mult = f"{max(2.5, round(50_000 / mc, 1))}x - {round(100_000 / mc, 1)}x" if mc > 0 else "2.5x - 5.0x"

    return {
        "mint": mint,
        "overallScore": 85 if is_spot else (70 if mc_in_range else 50),
        "verdict": "bullish" if is_spot else "neutral",
        "overview": {
            "symbol": pair.get("baseToken", {}).get("symbol"),
            "name": pair.get("baseToken", {}).get("name"),
            "mc": mc,
            "price": float(pair.get("priceUsd") or 0),
            "liquidity": float((pair.get("liquidity") or {}).get("usd") or 0) if not is_curve else None,
            "volume24h": float((pair.get("volume") or {}).get("h24") or 0),
            "volumeM5": vol_m5,
            "txnsM5": {"buys": buys_m5, "sells": sells_m5},
            "dexId": pair.get("dexId"),
        },
        "security": {
            "score": rc_data.get("score") or 0,
            "devHoldingPct": dev_pct,
            "mintAuthorityRevoked": mint_revoked,
            "freezeAuthorityRevoked": freeze_revoked,
            "isBondingCurve": is_curve,
        },
        "microCapSpot": {
            "isSpot": is_spot,
            "confidence": "high" if is_spot and buys_m5 >= 15 else "medium",
            "potentialMultiplier": f"2.0x (at $20k MC) – 5.0x (at $100k MC)",
            "tp1_scalp": {
                "targetDisplay": "$20,000 – $25,000 MC",
                "potentialGain": tp1_mult,
                "strategy": "Take initial capital / 50% profit off at $20k MC (de-risk)",
            },
            "tp2_runner": {
                "targetDisplay": "$50,000 – $100,000 MC",
                "potentialGain": tp2_mult,
                "strategy": "Let runner ride to bonding curve graduation ($50k–$100k MC)",
            },
        },
        "redFlags": [],
    }

# ---------- Classification & Formatting ----------
def classify(result: dict) -> tuple[str, list[str], str]:
    score = result.get("overallScore", 0)
    flags = result.get("redFlags", [])
    ov = result.get("overview") or {}
    mc = ov.get("mc") or 0
    micro = result.get("microCapSpot") or {}

    high = [f for f in flags if f.get("severity") in ("high", "critical")]
    tags = []
    if micro.get("isSpot"):
        tags.append("#micro-cap-2x")
    if (result.get("security") or {}).get("isBondingCurve"):
        tags.append("#bonding-curve")

    if score < 35 or len(high) >= 2:
        cat, emoji = "RUG-SHAPED", "🔴"
    elif micro.get("isSpot") and not high:
        cat, emoji = "QUICK 2X SPOT", "⚡"
    elif score >= 70 and not high:
        cat, emoji = "APEABLE", "🟢"
    elif mc > 50_000_000:
        cat, emoji = "ESTABLISHED", "⚪"
    else:
        cat, emoji = "GAMBLING", "🟡"
    return cat, sorted(set(tags)), emoji

def fmt_alert(result: dict, cat: str, tags: list[str], emoji: str, channel: str, post_id: str) -> str:
    ov = result.get("overview") or {}
    micro = result.get("microCapSpot") or {}
    sec = result.get("security") or {}
    mint = result.get("mint")
    symbol = ov.get("symbol") or "Unknown"
    name = ov.get("name") or ""
    mc = ov.get("mc") or 0

    m5 = ov.get("txnsM5") or {}
    buys = m5.get("buys", 0)
    sells = m5.get("sells", 0)
    vol_m5 = ov.get("volumeM5", 0)

    dev_pct = sec.get("devHoldingPct", 0.0)
    auth = "Revoked ✅" if sec.get("mintAuthorityRevoked") and sec.get("freezeAuthorityRevoked") else "Active ⚠️"
    liq_str = "Bonding Curve (Pump.fun)" if sec.get("isBondingCurve") else f"${ov.get('liquidity') or 0:,.0f}"

    tp1 = micro.get("tp1_scalp", {})
    tp2 = micro.get("tp2_runner", {})

    lines = [
        "⚡⚡ *[MICRO-CAP PATTERN SCANNER]* ⚡⚡",
        f"🎯 *QUICK 2X SPOT DETECTED* (${mc:,.0f} MC Entry)",
        "",
        f"🪙 *${symbol}* {f'({name})' if name else ''}",
        f"📊 *Market Cap:* ${mc:,.0f} (Micro-Cap Stage)",
        f"💧 *Liquidity:* {liq_str}",
        "",
        f"🎯 *TP1 (Quick 2x Take-Profit):* {tp1.get('targetDisplay', '$20k–$25k MC')} ({tp1.get('potentialGain', '2.0x')})",
        f"   └ _Strategy:_ Take initial capital out at $20k MC to de-risk",
        f"🚀 *TP2 (Runner Exit):* {tp2.get('targetDisplay', '$50k–$100k MC')} ({tp2.get('potentialGain', '5.0x')})",
        f"   └ _Strategy:_ Moonbag hold towards graduation / breakout",
        "",
        f"📈 *5m Momentum:* {buys} Buys / {sells} Sells (Vol: ${vol_m5:,.0f})",
        f"🛡️ *Security:* Dev Bag {dev_pct:.1f}% | Authorities {auth} | Audit Score: {sec.get('score', 0)}",
        f"🔬 *Pattern Score:* {result.get('overallScore', 0)}/100 (BULLISH RUNNER)",
        "",
        f"CA: `{mint}`",
        f"Dex: https://dexscreener.com/solana/{mint}",
        f"RugCheck: https://rugcheck.xyz/tokens/{mint}",
        f"📡 Source: {channel} (Post: {post_id})",
    ]
    return "\n".join(lines)

# ---------- Telegram Bot Broadcast (Zero Telethon) ----------
def broadcast_alert(text: str):
    if not TELEGRAM_BOT_TOKEN:
        print("[broadcast-skipped] TELEGRAM_BOT_TOKEN not configured")
        return

    targets = []
    if TELEGRAM_CHANNEL_ID:
        targets.append(TELEGRAM_CHANNEL_ID)
    if TELEGRAM_CHAT_ID and TELEGRAM_CHAT_ID not in targets:
        targets.append(TELEGRAM_CHAT_ID)

    for target in targets:
        try:
            url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
            payload = {
                "chat_id": target,
                "text": text,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            }
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                if resp.status == 200:
                    print(f"[alert-sent] -> Telegram chat/channel {target}")
        except Exception as e:
            print(f"[alert-fail] {target}: {e}")

# ---------- Channel Scraper Loop ----------
def scrape_channel(channel: str):
    url = f"https://t.me/s/{channel}"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            page = resp.read().decode("utf-8")
    except Exception as e:
        print(f"[scrape-err] {channel}: {e}")
        return

    # Extract messages with data-post
    msgs = re.findall(
        r'<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)".*?<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>\s*</div>',
        page,
        re.DOTALL,
    )

    for post_id, text_html in msgs:
        clean_text = html.unescape(re.sub(r"<[^>]+>", " ", text_html)).strip()
        mint = extract_mint(clean_text)
        if not mint:
            continue
        if already_seen(mint):
            continue

        print(f"\n[new-signal] {mint} from {post_id}")
        result = analyze_token(mint)
        if not result:
            record(mint, channel, 0, None, "ANALYZE_FAIL")
            continue

        cat, tags, emoji = classify(result)
        score = result.get("overallScore")
        record(mint, channel, 0, score, cat)

        ov = result.get("overview") or {}
        mc = ov.get("mc") or 0
        sym = ov.get("symbol") or mint[:8]
        print(f" -> {sym} | MC ${mc:,.0f} | Category: {cat} (Score: {score})")

        # Broadcast if it's a Quick 2x Micro-Cap Spot or Apeable setup
        if cat in ("QUICK 2X SPOT", "APEABLE"):
            alert_msg = fmt_alert(result, cat, tags, emoji, channel, post_id)
            broadcast_alert(alert_msg)

def run_loop():
    print(f"🚀 Zero-Telethon Signal Listener active!")
    print(f"📡 Scraping channels: {CHANNELS}")
    print(f"🤖 Bot token: {'Configured ✅' if TELEGRAM_BOT_TOKEN else 'Missing ❌'}")
    print(f"📢 Target: {TELEGRAM_CHANNEL_ID or TELEGRAM_CHAT_ID or 'Terminal only'}")
    print(f"🎯 Target strategy: Spot quick 2x at $8k–$15k entry -> $20k TP1 take-profit")
    print("=" * 60)

    while True:
        try:
            for ch in CHANNELS:
                scrape_channel(ch)
                time.sleep(2)
        except KeyboardInterrupt:
            print("\nStopping listener...")
            break
        except Exception as e:
            print(f"[loop-err] {e}")
        time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    run_loop()
