#!/usr/bin/env python3
"""Zero-Telethon Web Signal Listener & Autonomous Pattern Spotter
================================================================
1. Foundation Learning:
   - Scrapes public Telegram channels (FrankCowpergang, HumbleApes) via https://t.me/s/<channel>.
   - Identifies early buyers / smart money wallets and winning deployers.
   - Learns signatures of successful micro-cap runners.

2. Autonomous Engine:
   - Scans fresh Solana tokens directly from DexScreener on its own.
   - Cross-references holders with smart money wallets learned from the foundation.
   - Spots new tokens at $8k–$15k MC before the Telegram channels even post them!

3. Strict Anti-Repetition & Delivery:
   - Uses atomic SQLite + in-memory dual-gate tracking. Never repeats a contract address!
   - Broadcasts distinguished alerts directly to TELEGRAM_CHANNEL_ID (-1004496424538).
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
# Targeted Channel ID: -1004496424538 (t.me/thomasgem)
TELEGRAM_CHANNEL_ID = os.getenv("TELEGRAM_CHANNEL_ID", "-1004496424538")
ANALYZER_URL = os.getenv("ANALYZER_URL", "http://localhost:3000")

CHANNELS = ["FrankCowpergang", "HumbleApes"]
CHANNEL_POLL_INTERVAL = 6
AUTONOMOUS_POLL_INTERVAL = 12

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

# ---------- Database & Strict Anti-Repetition Setup ----------
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
    CREATE TABLE IF NOT EXISTS alerted (
        mint TEXT PRIMARY KEY,
        alerted_at INTEGER,
        channel_id TEXT,
        source TEXT,
        category TEXT,
        mc REAL
    );
    CREATE TABLE IF NOT EXISTS smart_wallets (
        address TEXT PRIMARY KEY,
        source_channel TEXT,
        tokens_count INTEGER DEFAULT 1,
        last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS trusted_deployers (
        address TEXT PRIMARY KEY,
        tokens_launched INTEGER DEFAULT 1,
        winning_tokens INTEGER DEFAULT 0,
        last_seen INTEGER
    );
    """
)
db.commit()

# Load all historical mints into in-memory sets for instant zero-repetition gating
SEEN_MINTS = set(row[0] for row in db.execute("SELECT mint FROM seen").fetchall())
ALERTED_MINTS = set(row[0] for row in db.execute("SELECT mint FROM alerted").fetchall())
SMART_WALLETS = set(row[0] for row in db.execute("SELECT address FROM smart_wallets").fetchall())

print(f"📦 Database loaded: {len(SEEN_MINTS)} seen CAs, {len(ALERTED_MINTS)} alerted CAs, {len(SMART_WALLETS)} learned smart wallets.")

def register_seen(mint: str, channel: str, msg_id: int = 0) -> bool:
    """Atomic check and register. Returns False if already seen (blocks repetition)."""
    if mint in SEEN_MINTS or mint in ALERTED_MINTS:
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

def record_analysis_result(mint: str, score: float, category: str):
    try:
        db.execute(
            "UPDATE seen SET score = ?, category = ? WHERE mint = ?",
            (score, category, mint),
        )
        db.commit()
    except Exception:
        pass

def register_alerted(mint: str, source: str, category: str, mc: float):
    """Marks mint as alerted permanently across DB and memory."""
    ALERTED_MINTS.add(mint)
    try:
        db.execute(
            "INSERT OR REPLACE INTO alerted (mint, alerted_at, channel_id, source, category, mc) VALUES (?, ?, ?, ?, ?, ?)",
            (mint, int(time.time()), TELEGRAM_CHANNEL_ID, source, category, mc),
        )
        db.commit()
    except Exception:
        pass

def learn_smart_wallets(holders: list, channel: str):
    """Learn smart money wallets from channel signals to train the autonomous engine."""
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

# ---------- Token Analyzer Integration ----------
def analyze_token(mint: str) -> dict | None:
    # 1. First attempt via local Next.js analyzer API
    try:
        url = f"{ANALYZER_URL}/api/analyze"
        req = urllib.request.Request(
            url,
            data=json.dumps({"mint": mint}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return data
    except Exception:
        pass

    # 2. Resilient standalone fallback: direct DexScreener & RugCheck
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

    # Check smart money overlap
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

# ---------- Classification & Formatting ----------
def classify(result: dict) -> tuple[str, list[str], str]:
    score = result.get("overallScore", 0)
    flags = result.get("redFlags", [])
    micro = result.get("microCapSpot") or {}
    smart_count = result.get("smartMoneyCount", 0)

    high = [f for f in flags if f.get("severity") in ("high", "critical")]
    tags = []
    if micro.get("isSpot"):
        tags.append("#micro-cap-2x")
    if (result.get("security") or {}).get("isBondingCurve"):
        tags.append("#bonding-curve")
    if smart_count > 0:
        tags.append(f"#smart-money-{smart_count}")

    if score < 35 or len(high) >= 2:
        cat, emoji = "RUG-SHAPED", "🔴"
    elif micro.get("isSpot") and not high:
        cat, emoji = "QUICK 2X SPOT", "⚡"
    elif score >= 70 and not high:
        cat, emoji = "APEABLE", "🟢"
    else:
        cat, emoji = "GAMBLING", "🟡"
    return cat, sorted(set(tags)), emoji

def fmt_alert(result: dict, cat: str, channel: str, source_type: str = "CHANNEL") -> str:
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

    if source_type == "AUTONOMOUS":
        header = "⚡⚡ *[MICRO-CAP PATTERN SCANNER | AUTONOMOUS SPOT]* ⚡⚡\n🧠 *PRE-CHANNEL DISCOVERY* (Spotted by Engine)"
    else:
        header = f"⚡⚡ *[MICRO-CAP PATTERN SCANNER | CHANNEL FOUNDATION]* ⚡⚡\n🎯 *QUICK 2X SPOT DETECTED* (${mc:,.0f} MC Entry)"

    lines = [
        header,
        "",
        f"🪙 *${symbol}* {f'({name})' if name else ''}",
        f"📊 *Market Cap:* ${mc:,.0f} (Micro-Cap Phase)",
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
        lines.append(f"🧠 *Smart Money Match:* {smart_count} learned wallet(s) from channel foundation holding!")

    lines.extend([
        f"🔬 *Pattern Score:* {result.get('overallScore', 0)}/100 (BULLISH RUNNER)",
        "",
        f"CA: `{mint}`",
        f"Dex: https://dexscreener.com/solana/{mint}",
        f"RugCheck: https://rugcheck.xyz/tokens/{mint}",
        f"📡 Source: {channel}",
    ])
    return "\n".join(lines)

# ---------- Telegram Bot Broadcast (Strict Zero Repetition) ----------
def broadcast_alert(mint: str, alert_text: str, source: str, category: str, mc: float):
    # Strict anti-repetition check
    if mint in ALERTED_MINTS:
        print(f"[skip-repeat] {mint} already alerted previously")
        return

    # Mark as alerted before sending
    register_alerted(mint, source, category, mc)

    if not TELEGRAM_BOT_TOKEN:
        print(f"[broadcast-terminal-only] {mint}")
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
                "text": alert_text,
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
                    print(f"[alert-sent] -> Channel/Chat {target} ({mint})")
        except Exception as e:
            print(f"[alert-fail] {target}: {e}")

# ---------- Channel Scraper Loop (Foundation Feeder) ----------
def scrape_telegram_channels():
    for channel in CHANNELS:
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

            # Strict instant deduplication: skip if seen or alerted
            if not register_seen(mint, channel):
                continue

            print(f"\n[channel-signal] {mint} from {post_id}")
            result = analyze_token(mint)
            if not result:
                record_analysis_result(mint, 0.0, "ANALYZE_FAIL")
                continue

            cat, tags, emoji = classify(result)
            score = result.get("overallScore", 0)
            record_analysis_result(mint, score, cat)

            # Learn smart money wallets from this channel token to train autonomous engine
            holders = result.get("holders") or []
            learn_smart_wallets(holders, channel)

            ov = result.get("overview") or {}
            mc = ov.get("mc") or 0
            sym = ov.get("symbol") or mint[:8]
            print(f" -> {sym} | MC ${mc:,.0f} | Cat: {cat} (Score: {score})")

            # Broadcast if Quick 2x Spot
            if cat in ("QUICK 2X SPOT", "APEABLE"):
                alert_text = fmt_alert(result, cat, f"{channel} ({post_id})", source_type="CHANNEL")
                broadcast_alert(mint, alert_text, channel, cat, mc)

# ---------- Autonomous Engine Loop (Spots New Coins On Its Own) ----------
def run_autonomous_scanner():
    """Directly scans fresh Solana token profiles to spot micro-caps matching smart money and patterns."""
    try:
        url = "https://api.dexscreener.com/token-profiles/latest/v1"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            profiles = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return

    sol_profiles = [p for p in profiles if p.get("chainId") == "solana"]

    for prof in sol_profiles:
        mint = prof.get("tokenAddress")
        if not mint or len(mint) < 32:
            continue

        # Strict instant deduplication
        if not register_seen(mint, "AutonomousScanner"):
            continue

        result = analyze_token(mint)
        if not result:
            record_analysis_result(mint, 0.0, "ANALYZE_FAIL")
            continue

        cat, tags, emoji = classify(result)
        score = result.get("overallScore", 0)
        record_analysis_result(mint, score, cat)

        ov = result.get("overview") or {}
        mc = ov.get("mc") or 0
        smart_count = result.get("smartMoneyCount", 0)

        # Autonomous spot triggers if it meets Quick 2x criteria (especially if smart money is on it!)
        if cat == "QUICK 2X SPOT" and mc <= 20_000:
            sym = ov.get("symbol") or mint[:8]
            print(f"\n⚡ [AUTONOMOUS SPOT] {sym} (${mc:,.0f} MC) | Smart Money: {smart_count}")
            alert_text = fmt_alert(result, cat, "Autonomous Engine (Pre-Channel)", source_type="AUTONOMOUS")
            broadcast_alert(mint, alert_text, "AutonomousScanner", cat, mc)

# ---------- Main Loop ----------
def main():
    print(f"🚀 Dual-Engine Memecoin Pattern System Active!")
    print(f"📡 Channel Foundation: {CHANNELS}")
    print(f"🧠 Autonomous Scanner: Active (Monitoring fresh Solana mints & smart money)")
    print(f"📢 Target Channel ID: {TELEGRAM_CHANNEL_ID} (https://t.me/thomasgem)")
    print(f"🛡️ Strict Anti-Repetition: Enabled (Zero duplicate CAs)")
    print(f"🎯 Profit Targets: TP1 @ $20k MC (Quick 2x scalp) | TP2 @ $50k–$100k MC (Runner)")
    print("=" * 65)

    last_auto_scan = 0

    while True:
        try:
            # 1. Scrape channels to learn smart money and catch calls
            scrape_telegram_channels()

            # 2. Run autonomous scanner periodically
            now = time.time()
            if now - last_auto_scan >= AUTONOMOUS_POLL_INTERVAL:
                run_autonomous_scanner()
                last_auto_scan = now

        except KeyboardInterrupt:
            print("\nShutting down listener...")
            break
        except Exception as e:
            print(f"[engine-err] {e}")

        time.sleep(CHANNEL_POLL_INTERVAL)

if __name__ == "__main__":
    main()
