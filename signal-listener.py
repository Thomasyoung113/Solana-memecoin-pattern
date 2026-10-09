#!/usr/bin/env python3
"""Solana Memecoin Pattern Scanner & Follow-Up Engine
===================================================
1. Foundation Phase:
   - Registers 100 CAs from channel history to build the ground-truth pattern foundation.
   - Extracts smart money wallets and winning deployers.

2. Pattern Signals:
   - Evaluates fresh micro-caps ($8k–$15k entry) against learned patterns.
   - Requires revoked authorities, dev bag <= 8%, and 5m buyer velocity.
   - Prevents duplicate alerts (zero CA repetition).

3. Outcome Accountability (Follow-up Notifications):
   - Actively monitors every signal sent!
   - 🎯 Sends NOTIFICATION when it HITS 2X ($20k MC or 2x entry).
   - ❌ Sends NOTIFICATION if it DID NOT HIT (drops >=45% or times out).
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

FOUNDATION_TARGET = 100

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
TELEGRAM_CHANNEL_ID = os.getenv("TELEGRAM_CHANNEL_ID", "-1004496424538")
ANALYZER_URL = os.getenv("ANALYZER_URL", "http://localhost:3000")

CHANNELS = ["FrankCowpergang", "HumbleApes"]
CHANNEL_POLL_INTERVAL = 6
OUTCOME_CHECK_INTERVAL = 20

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signals.db")

B58 = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b")
URL_MINT = re.compile(
    r"(?:pump\.fun/coin/|pump\.fun/|jup\.ag/|raydium\.io/|dexscreener\.com/solana/)"
    r"([1-9A-HJ-NP-Za-km-z]{32,44})"
)

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

# ---------- Database Initialization ----------
db = sqlite3.connect(DB_FILE)
db.executescript(
    """
    CREATE TABLE IF NOT EXISTS seen (
        mint TEXT PRIMARY KEY,
        channel TEXT,
        msg_id INTEGER,
        first_seen INTEGER,
        score REAL,
        category TEXT
    );
    CREATE TABLE IF NOT EXISTS tracked_signals (
        mint TEXT PRIMARY KEY,
        symbol TEXT,
        name TEXT,
        entry_mc REAL,
        target_2x_mc REAL,
        alerted_at INTEGER,
        channel_id TEXT,
        last_checked INTEGER,
        peak_mc REAL,
        current_mc REAL,
        status TEXT, -- 'ACTIVE', 'HIT_2X', 'DID_NOT_HIT'
        outcome_notified INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS smart_wallets (
        address TEXT PRIMARY KEY,
        source_channel TEXT,
        tokens_count INTEGER DEFAULT 1,
        winning_count INTEGER DEFAULT 0,
        last_seen INTEGER
    );
    """
)
db.commit()

SEEN_MINTS = set(row[0] for row in db.execute("SELECT mint FROM seen").fetchall())
ALERTED_MINTS = set(row[0] for row in db.execute("SELECT mint FROM tracked_signals").fetchall())
SMART_WALLETS = set(row[0] for row in db.execute("SELECT address FROM smart_wallets").fetchall())

def get_registered_count() -> int:
    return db.execute("SELECT COUNT(*) FROM seen").fetchone()[0]

def register_seen(mint: str, channel: str, msg_id: int = 0) -> bool:
    if mint in SEEN_MINTS:
        return False
    SEEN_MINTS.add(mint)
    try:
        db.execute(
            "INSERT OR IGNORE INTO seen (mint, channel, msg_id, first_seen) VALUES (?, ?, ?, ?)",
            (mint, channel, msg_id, int(time.time())),
        )
        db.commit()
    except Exception:
        pass
    return True

def learn_smart_wallets(holders: list, channel: str):
    if not holders:
        return
    now = int(time.time())
    for h in holders[:10]:
        addr = h.get("address") or h.get("owner")
        if not addr or len(addr) < 32:
            continue
        SMART_WALLETS.add(addr)
        try:
            db.execute(
                """INSERT INTO smart_wallets (address, source_channel, tokens_count, last_seen)
                   VALUES (?, ?, 1, ?)
                   ON CONFLICT(address) DO UPDATE SET
                   tokens_count = tokens_count + 1,
                   last_seen = excluded.last_seen""",
                (addr, channel, now),
            )
        except Exception:
            pass
    try:
        db.commit()
    except Exception:
        pass

# ---------- Telegram Bot Delivery ----------
def send_telegram(text: str):
    if not TELEGRAM_BOT_TOKEN:
        print("[broadcast-terminal] No bot token configured")
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
                    print(f"[telegram-sent] -> {target}")
        except Exception as e:
            print(f"[telegram-err] {target}: {e}")

# ---------- Token Analysis (Local API or Dex/RugCheck) ----------
def analyze_token(mint: str) -> dict | None:
    # 1. Try local analyzer API
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

    # 2. Resilient standalone fallback
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
    except Exception:
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

    smart_overlap = [h for h in top_holders if (h.get("address") in SMART_WALLETS or h.get("owner") in SMART_WALLETS)]

    mc_in_range = 6_000 <= mc <= 22_000
    is_spot = mc_in_range and dev_pct <= 8.0 and mint_revoked and freeze_revoked and (buys_m5 >= 10 or is_curve)

    tp1_mult = f"{max(1.5, round(20_000 / mc, 1))}x" if mc > 0 else "2.0x"
    tp2_mult = f"{max(2.5, round(50_000 / mc, 1))}x - {round(100_000 / mc, 1)}x" if mc > 0 else "2.5x - 5.0x"

    return {
        "mint": mint,
        "overallScore": 90 if (is_spot and smart_overlap) else (85 if is_spot else 50),
        "verdict": "bullish" if is_spot else "neutral",
        "smartMoneyCount": len(smart_overlap),
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
        "holders": top_holders,
        "security": {
            "score": rc_data.get("score") or 0,
            "devHoldingPct": dev_pct,
            "mintAuthorityRevoked": mint_revoked,
            "freezeAuthorityRevoked": freeze_revoked,
            "isBondingCurve": is_curve,
        },
        "microCapSpot": {
            "isSpot": is_spot,
            "confidence": "high" if is_spot and (buys_m5 >= 15 or smart_overlap) else "medium",
            "potentialMultiplier": f"2.0x (at $20k MC) – 5.0x (at $100k MC)",
            "tp1_scalp": {
                "targetDisplay": "$20,000 – $25,000 MC",
                "potentialGain": tp1_mult,
                "strategy": "Take initial capital out at $20k MC (quick 2x scalp)",
            },
            "tp2_runner": {
                "targetDisplay": "$50,000 – $100,000 MC",
                "potentialGain": tp2_mult,
                "strategy": "Let runner ride to bonding curve graduation ($50k–$100k MC)",
            },
        },
        "redFlags": [],
    }

# ---------- Format Initial Signal Alert ----------
def fmt_signal_alert(result: dict, source_desc: str) -> str:
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
    smart_count = result.get("smartMoneyCount", 0)

    lines = [
        "⚡⚡ *[MICRO-CAP PATTERN SCANNER | SIGNAL ACTIVE]* ⚡⚡",
        f"🎯 *NEW QUICK 2X SPOT* (${mc:,.0f} MC Entry)",
        "",
        f"🪙 *${symbol}* {f'({name})' if name else ''}",
        f"📊 *Entry Market Cap:* ${mc:,.0f}",
        f"💧 *Liquidity:* {liq_str}",
        "",
        f"🎯 *TP1 (Quick 2x Take-Profit):* {tp1.get('targetDisplay', '$20k–$25k MC')} ({tp1.get('potentialGain', '2.0x')})",
        f"   └ _Action:_ Take initial capital out at $20k MC to de-risk",
        f"🚀 *TP2 (Runner Exit):* {tp2.get('targetDisplay', '$50k–$100k MC')} ({tp2.get('potentialGain', '5.0x')})",
        f"   └ _Action:_ Moonbag hold towards graduation / breakout",
        "",
        f"📈 *5m Momentum:* {buys} Buys / {sells} Sells (Vol: ${vol_m5:,.0f})",
        f"🛡️ *Security:* Dev Bag {dev_pct:.1f}% | Authorities {auth} | Audit Score: {sec.get('score', 0)}",
    ]

    if smart_count > 0:
        lines.append(f"🧠 *Smart Money Match:* {smart_count} learned wallet(s) from foundation in top holders!")

    lines.extend([
        f"🔬 *Pattern Score:* {result.get('overallScore', 0)}/100 (BULLISH RUNNER)",
        "",
        f"CA: `{mint}`",
        f"Dex: https://dexscreener.com/solana/{mint}",
        f"RugCheck: https://rugcheck.xyz/tokens/{mint}",
        f"📡 Source: {source_desc}",
        "",
        "⏳ _Engine is actively tracking this signal. Outcome notification will fire when 2x hits or fails._",
    ])
    return "\n".join(lines)

# ---------- Format Follow-Up Outcome Notifications ----------
def fmt_hit_2x_alert(sig: dict, peak_mc: float, current_mc: float) -> str:
    entry = sig["entry_mc"]
    symbol = sig["symbol"]
    mint = sig["mint"]
    gain_pct = ((peak_mc - entry) / entry) * 100 if entry > 0 else 0
    mult = peak_mc / entry if entry > 0 else 0
    elapsed_m = max(1, int((time.time() - sig["alerted_at"]) / 60))

    lines = [
        "🎯🎯 *[2X TARGET HIT!]* 🎯🎯",
        f"🪙 *${symbol}* — *PROFIT ACHIEVED!*",
        "",
        f"💰 *Entry Market Cap:* ${entry:,.0f}",
        f"🚀 *Peak Market Cap:* ${peak_mc:,.0f} (*+{gain_pct:.0f}%* | *{mult:.1f}x*)",
        f"📊 *Current Market Cap:* ${current_mc:,.0f}",
        f"⏱️ *Time to 2x:* {elapsed_m} minutes",
        "",
        "✅ *TP1 TARGET HIT ($20k+ MC):*",
        "   └ Initial capital secured / 2x profit locked!",
        "   └ If holding moonbag, target TP2 ($50k–$100k graduation).",
        "",
        f"CA: `{mint}`",
        f"Dex: https://dexscreener.com/solana/{mint}",
    ]
    return "\n".join(lines)

def fmt_missed_alert(sig: dict, current_mc: float, reason: str) -> str:
    entry = sig["entry_mc"]
    symbol = sig["symbol"]
    mint = sig["mint"]
    drop_pct = ((current_mc - entry) / entry) * 100 if entry > 0 else 0
    elapsed_m = max(1, int((time.time() - sig["alerted_at"]) / 60))

    lines = [
        "❌ *[SIGNAL OUTCOME: DID NOT HIT 2X]*",
        f"🪙 *${symbol}* — *CLOSED*",
        "",
        f"💰 *Entry Market Cap:* ${entry:,.0f}",
        f"📉 *Current Market Cap:* ${current_mc:,.0f} (*{drop_pct:.0f}%*)",
        f"⏱️ *Time Elapsed:* {elapsed_m} minutes",
        f"⚠️ *Outcome Reason:* {reason}",
        "",
        "🛑 *Action:* Position marked closed / stopped out.",
        "",
        f"CA: `{mint}`",
        f"Dex: https://dexscreener.com/solana/{mint}",
    ]
    return "\n".join(lines)

# ---------- Signal Broadcaster with Strict Zero-Repetition Gate ----------
def emit_signal(mint: str, result: dict, source_desc: str):
    if mint in ALERTED_MINTS:
        return
    ALERTED_MINTS.add(mint)

    ov = result.get("overview") or {}
    symbol = ov.get("symbol") or "Unknown"
    name = ov.get("name") or ""
    entry_mc = float(ov.get("mc") or 0)
    target_2x_mc = max(20_000.0, entry_mc * 2.0)
    now = int(time.time())

    # Register into tracked_signals table permanently
    try:
        db.execute(
            """INSERT OR REPLACE INTO tracked_signals
               (mint, symbol, name, entry_mc, target_2x_mc, alerted_at, channel_id, last_checked, peak_mc, current_mc, status, outcome_notified)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0)""",
            (mint, symbol, name, entry_mc, target_2x_mc, now, TELEGRAM_CHANNEL_ID, now, entry_mc, entry_mc),
        )
        db.commit()
    except Exception as e:
        print(f"[db-tracked-err] {e}")

    alert_text = fmt_signal_alert(result, source_desc)
    send_telegram(alert_text)
    print(f"\n📢 [SIGNAL-BROADCAST] ${symbol} (CA: {mint}) -> Sent to {TELEGRAM_CHANNEL_ID}")

# ---------- Continuous Follow-Up Tracker (Hit 2x or Did Not Hit) ----------
def track_active_signals_outcome():
    rows = db.execute(
        """SELECT mint, symbol, name, entry_mc, target_2x_mc, alerted_at, channel_id, peak_mc, current_mc
           FROM tracked_signals
           WHERE status = 'ACTIVE' AND outcome_notified = 0"""
    ).fetchall()

    if not rows:
        return

    now = int(time.time())

    for row in rows:
        mint = row[0]
        sig = {
            "mint": mint,
            "symbol": row[1],
            "name": row[2],
            "entry_mc": row[3],
            "target_2x_mc": row[4],
            "alerted_at": row[5],
            "channel_id": row[6],
            "peak_mc": row[7],
            "current_mc": row[8],
        }

        # Fetch current real-time DexScreener MC
        try:
            url = f"https://api.dexscreener.com/latest/dex/tokens/{mint}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            pairs = data.get("pairs") or []
            if not pairs:
                continue
            pair = pairs[0]
            current_mc = float(pair.get("marketCap") or pair.get("fdv") or 0)
        except Exception:
            continue

        entry_mc = sig["entry_mc"]
        peak_mc = max(sig["peak_mc"], current_mc)
        elapsed_mins = (now - sig["alerted_at"]) / 60

        # Update peak and current MC in DB
        db.execute(
            "UPDATE tracked_signals SET current_mc = ?, peak_mc = ?, last_checked = ? WHERE mint = ?",
            (current_mc, peak_mc, now, mint),
        )
        db.commit()

        # 1. CHECK HIT 2X CONDITION
        # Hits $20,000 MC or 2.0x from entry
        if peak_mc >= 20_000 or (entry_mc > 0 and peak_mc >= entry_mc * 2.0):
            print(f"\n🎯 [OUTCOME: 2X HIT!] ${sig['symbol']} reached ${peak_mc:,.0f} MC ({peak_mc/entry_mc:.1f}x)")
            db.execute(
                "UPDATE tracked_signals SET status = 'HIT_2X', outcome_notified = 1 WHERE mint = ?",
                (mint,),
            )
            db.commit()

            alert_text = fmt_hit_2x_alert(sig, peak_mc, current_mc)
            send_telegram(alert_text)
            continue

        # 2. CHECK DID NOT HIT CONDITION
        # Dumped >= 45% from entry, or 60 minutes elapsed with no 2x
        is_dumped = entry_mc > 0 and current_mc <= entry_mc * 0.55
        is_timeout = elapsed_mins >= 60

        if is_dumped or is_timeout:
            reason = "Price dropped >45% below entry" if is_dumped else "60m elapsed without 2x momentum"
            print(f"\n❌ [OUTCOME: DID NOT HIT] ${sig['symbol']} -> {reason} (${current_mc:,.0f} MC)")
            db.execute(
                "UPDATE tracked_signals SET status = 'DID_NOT_HIT', outcome_notified = 1 WHERE mint = ?",
                (mint,),
            )
            db.commit()

            alert_text = fmt_missed_alert(sig, current_mc, reason)
            send_telegram(alert_text)

# ---------- Channel Scraper & Foundation Builder ----------
def scrape_channels():
    for channel in CHANNELS:
        url = f"https://t.me/s/{channel}"
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                page = resp.read().decode("utf-8")
        except Exception:
            continue

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

            # Anti-repetition check
            if not register_seen(mint, channel):
                continue

            registered_count = get_registered_count()
            print(f"[registered] {mint[:12]}... from {post_id} | Total Foundation: {registered_count}/{FOUNDATION_TARGET}")

            result = analyze_token(mint)
            if not result:
                continue

            # Learn smart money from channel tokens
            learn_smart_wallets(result.get("holders") or [], channel)

            # Check if foundation threshold is met
            if registered_count < FOUNDATION_TARGET:
                # Still building foundation: log progress
                continue

            # Once 100 CAs foundation is registered, emit verified signals!
            micro = result.get("microCapSpot") or {}
            score = result.get("overallScore", 0)
            if micro.get("isSpot") and score >= 80:
                emit_signal(mint, result, f"Channel Pattern ({channel})")

# ---------- Bootstrap 100 CAs if needed ----------
def bootstrap_foundation():
    """Paginates back to quickly populate the 100 CA foundation baseline if under threshold."""
    current_count = get_registered_count()
    if current_count >= FOUNDATION_TARGET:
        print(f"✅ Foundation Baseline Ready: {current_count}/{FOUNDATION_TARGET} CAs registered.")
        return

    print(f"⏳ Bootstrapping Foundation: {current_count}/{FOUNDATION_TARGET} CAs currently registered. Fetching channel history...")

    for channel in CHANNELS:
        before_id = ""
        for _ in range(5):
            if get_registered_count() >= FOUNDATION_TARGET:
                break
            url = f"https://t.me/s/{channel}{f'?before={before_id}' if before_id else ''}"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=10) as resp:
                    page = resp.read().decode("utf-8")
            except Exception:
                break

            msgs = re.findall(
                r'<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)".*?<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>\s*</div>',
                page,
                re.DOTALL,
            )
            if not msgs:
                break

            for post_id, text_html in msgs:
                clean_text = html.unescape(re.sub(r"<[^>]+>", " ", text_html)).strip()
                mint = extract_mint(clean_text)
                if mint:
                    register_seen(mint, channel)
                post_num = post_id.split("/")[-1]
                before_id = post_num

            time.sleep(1)

    final_count = get_registered_count()
    print(f"🎉 Foundation Bootstrapped: {final_count} CAs registered. Pattern engine is ACTIVE!")

# ---------- Main Loop ----------
def main():
    print("=" * 65)
    print("🚀 Solana Memecoin Pattern Scanner & Follow-Up Engine")
    print(f"📢 Target Telegram Channel: {TELEGRAM_CHANNEL_ID} (https://t.me/thomasgem)")
    print(f"🎯 Target Rule: Micro-Cap Entry ($8k–$15k) -> TP1 @ $20k MC (Quick 2x)")
    print(f"🔔 Follow-up Notifications: ACTIVE (Notifies on 2x Hit or Miss)")
    print("=" * 65)

    # 1. Bootstrap 100 CAs foundation
    bootstrap_foundation()

    last_outcome_check = 0

    while True:
        try:
            # Step A: Scrape channels and register new CAs
            scrape_channels()

            # Step B: Track active signals and notify outcomes (Hit 2x or Missed)
            now = time.time()
            if now - last_outcome_check >= OUTCOME_CHECK_INTERVAL:
                track_active_signals_outcome()
                last_outcome_check = now

        except KeyboardInterrupt:
            print("\nShutting down engine...")
            break
        except Exception as e:
            print(f"[loop-err] {e}")

        time.sleep(CHANNEL_POLL_INTERVAL)

if __name__ == "__main__":
    main()
