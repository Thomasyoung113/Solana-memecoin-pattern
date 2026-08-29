#!/usr/bin/env python3
"""Behavior monitor — snapshots every tracked CA over time to build outcome
ground truth (did the signal pump or rug?).

Snapshots each CA at ~1h, 6h, 24h, and 72h after first sighting, then marks
it complete. Safe to run repeatedly via cron — only takes due snapshots.

Run: python3 monitor.py
Cron (every 15 min): */15 * * * * python3 ~/memecoin-pattern/monitor.py >> ~/memecoin-pattern/monitor.log 2>&1
"""
import json
import os
import sqlite3
import sys
import time

import httpx

ANALYZER_URL = os.getenv("ANALYZER_URL", "http://localhost:3000")
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "signals.db")

# Hours after first sighting when a snapshot is due
SNAPSHOT_SCHEDULE = [1, 6, 24, 72]
# If a token loses this fraction of its MC vs first snapshot, flag as rugged
RUG_DROP = 0.80

db = sqlite3.connect(DB_FILE)
db.row_factory = sqlite3.Row
db.executescript(
    """
    CREATE TABLE IF NOT EXISTS ca_history (
        mint TEXT NOT NULL,
        channel TEXT,
        first_seen INTEGER NOT NULL,
        age_hours REAL NOT NULL,       -- hours since first_seen at snapshot
        price REAL,
        mc REAL,
        liquidity REAL,
        volume24h REAL,
        price_change_1h REAL,
        overall_score REAL,
        verdict TEXT,
        raw TEXT,                      -- full analyze JSON for reference
        PRIMARY KEY (mint, age_hours)
    );
    CREATE TABLE IF NOT EXISTS outcomes (
        mint TEXT PRIMARY KEY,
        channel TEXT,
        first_seen INTEGER,
        first_mc REAL,
        peak_mc REAL,
        final_mc REAL,
        peak_multiplier REAL,          -- peak_mc / first_mc
        rugged INTEGER,                -- 1 if lost >= RUG_DROP fraction from peak
        category TEXT,                 -- WINNER / DEAD / RUGGED / STILL_MOVING
        complete INTEGER DEFAULT 0     -- all snapshots taken
    );
    """
)
db.commit()


async def analyze_mint(mint: str) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{ANALYZER_URL}/api/analyze", json={"mint": mint})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        print(f"[analyze-fail] {mint}: {e}")
        return None


def snapshot(mint: str, age_h: float, result: dict, channel: str):
    ov = result.get("overview") or {}
    db.execute(
        """INSERT OR REPLACE INTO ca_history
           (mint, channel, first_seen, age_hours, price, mc, liquidity,
            volume24h, price_change_1h, overall_score, verdict, raw)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            mint, channel,
            _first_seen[mint],
            age_h,
            ov.get("price"), ov.get("mc"), ov.get("liquidity"),
            ov.get("volume24h"), ov.get("priceChange24h"),
            result.get("overallScore"), result.get("verdict"),
            json.dumps(result)[:8000],
        ),
    )


def update_outcome(mint: str):
    rows = db.execute(
        "SELECT * FROM ca_history WHERE mint=? ORDER BY age_hours", (mint,)
    ).fetchall()
    if not rows:
        return
    first = rows[0]
    mcs = [r["mc"] or 0 for r in rows]
    first_mc = first["mc"] or 0
    peak_mc = max(mcs) if mcs else 0
    final_row = rows[-1]
    final_mc = final_row["mc"] or 0
    mult = (peak_mc / first_mc) if first_mc > 0 else 0
    rugged = 1 if (peak_mc > 0 and final_mc <= peak_mc * (1 - RUG_DROP)) else 0

    all_taken = all(
        any(abs(r["age_hours"] - h) < 0.25 for r in rows)
        for h in SNAPSHOT_SCHEDULE
    )
    if first_mc == 0 and final_mc == 0:
        category = "DEAD"
    elif not all_taken:
        # young token — no final verdict until the full snapshot schedule is in
        category = "STILL_MOVING"
    elif rugged:
        # peaked then collapsed — the end state defines it, not the peak
        category = "RUGGED"
    elif mult >= 2:
        category = "WINNER"
    else:
        category = "DEAD" if final_mc < first_mc else "STILL_MOVING"

    db.execute(
        """INSERT OR REPLACE INTO outcomes
           (mint, channel, first_seen, first_mc, peak_mc, final_mc,
            peak_multiplier, rugged, category, complete)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (mint, first["channel"], first["first_seen"], first_mc, peak_mc,
         final_mc, round(mult, 2), rugged, category, 1 if all_taken else 0),
    )


async def main():
    # CAs from signals.db (listener dedupe table) that aren't fully monitored
    global _first_seen, MINT
    try:
        seen = db.execute(
            "SELECT mint, channel, first_seen FROM seen ORDER BY first_seen DESC LIMIT 500"
        ).fetchall()
    except sqlite3.OperationalError:
        sys.exit("No signals.db / seen table — run signal-listener first")

    now = time.time()
    _first_seen = {r["mint"]: r["first_seen"] for r in seen}

    for row in seen:
        mint = row["mint"]
        MINT = mint
        first_seen = row["first_seen"] or now
        elapsed_h = (now - first_seen) / 3600

        done = db.execute(
            "SELECT complete FROM outcomes WHERE mint=?", (mint,)
        ).fetchone()
        if done and done["complete"]:
            continue

        due = [h for h in SNAPSHOT_SCHEDULE if elapsed_h >= h]
        have = {
            r["age_hours"] for r in db.execute(
                "SELECT age_hours FROM ca_history WHERE mint=?", (mint,))
        }
        todo = [h for h in due if not any(abs(x - h) < 0.25 for x in have)]
        if not todo:
            update_outcome(mint)
            continue

        result = await analyze_mint(mint)
        if not result:
            continue
        for h in todo:
            snapshot(mint, h, result, row["channel"] or "")
            print(f"[snap] {mint} @{h}h")
        update_outcome(mint)

    # summary
    stats = db.execute(
        "SELECT category, COUNT(*) n FROM outcomes GROUP BY category"
    ).fetchall()
    total = db.execute("SELECT COUNT(*) n FROM ca_history").fetchone()["n"]
    print(f"[done] snapshots={total} outcomes=" +
          ", ".join(f"{r['category']}:{r['n']}" for r in stats))


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
