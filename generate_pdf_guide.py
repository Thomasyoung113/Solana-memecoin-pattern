#!/usr/bin/env python3
"""Generate Solana Memecoin Pattern Termux Guide PDF into Download folder."""
import os
import shutil
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

output_dir = "/sdcard/Download"
os.makedirs(output_dir, exist_ok=True)
pdf_path = os.path.join(output_dir, "Solana_Memecoin_Pattern_Termux_Guide.pdf")

doc = SimpleDocTemplate(
    pdf_path,
    pagesize=letter,
    rightMargin=36,
    leftMargin=36,
    topMargin=36,
    bottomMargin=36,
)

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "DocTitle",
    parent=styles["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=20,
    leading=24,
    textColor=colors.HexColor("#0f5132"),
    spaceAfter=4,
)

subtitle_style = ParagraphStyle(
    "DocSubtitle",
    parent=styles["Normal"],
    fontName="Helvetica-Bold",
    fontSize=10,
    leading=14,
    textColor=colors.HexColor("#495057"),
    spaceAfter=12,
)

h1_style = ParagraphStyle(
    "H1",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=13,
    leading=17,
    textColor=colors.HexColor("#1a1a1a"),
    spaceBefore=10,
    spaceAfter=5,
)

body_style = ParagraphStyle(
    "Body",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=9,
    leading=13,
    textColor=colors.HexColor("#212529"),
    spaceAfter=4,
)

code_style = ParagraphStyle(
    "CodeBlock",
    parent=styles["Code"],
    fontName="Courier-Bold",
    fontSize=8,
    leading=11,
    textColor=colors.HexColor("#1b1e21"),
    backColor=colors.HexColor("#e9ecef"),
    borderColor=colors.HexColor("#ced4da"),
    borderWidth=1,
    borderPadding=5,
    spaceBefore=3,
    spaceAfter=6,
)

story = []

# Header
story.append(Paragraph("SOLANA MEMECOIN PATTERN SCANNER", title_style))
story.append(Paragraph("Termux Operations &amp; Execution Guide &bull; Micro-Cap 2x Spotting &bull; Outcome Tracking", subtitle_style))

# Core Mission Summary
overview = (
    "<b>MISSION:</b> Spot micro-cap runners between <b>$8k – $15k MC</b>, take primary 2x profit at "
    "<b>TP1 ($20k – $25k MC)</b>, and runner profit at <b>TP2 ($50k – $100k MC)</b>. The system uses a "
    "dual-engine: (1) Telegram channels (FrankCowpergang &amp; HumbleApes) build the 100 CA foundation baseline, "
    "and (2) Active outcome tracking notifies the Telegram channel (-1004496424538) when signals Hit 2x or Miss."
)
story.append(Paragraph(overview, body_style))
story.append(Spacer(1, 6))

# Section 1
story.append(Paragraph("1. Starting the Background Daemon (Zero-Telethon)", h1_style))
story.append(Paragraph("Run the listener and outcome tracker as a persistent background daemon:", body_style))
story.append(Paragraph("cd ~/Solana-memecoin-pattern<br/>nohup python3 -u signal-listener.py &gt; listener.log 2&gt;&amp;1 &amp;", code_style))

story.append(Paragraph("Run the Next.js Web UI &amp; Pattern Dashboard (Port 3000):", body_style))
story.append(Paragraph("cd ~/Solana-memecoin-pattern<br/>nohup npm run start &gt; web.log 2&gt;&amp;1 &amp;", code_style))

# Section 2
story.append(Paragraph("2. Process Management &amp; Log Monitoring", h1_style))
story.append(Paragraph("View live signal listener activity and outcome updates in real-time:", body_style))
story.append(Paragraph("tail -f ~/Solana-memecoin-pattern/listener.log", code_style))

story.append(Paragraph("Verify active background daemons:", body_style))
story.append(Paragraph("ps aux | grep -E 'signal-listener|next'", code_style))

story.append(Paragraph("Stop the listener daemon cleanly:", body_style))
story.append(Paragraph("pkill -f signal-listener.py", code_style))

# Section 3
story.append(Paragraph("3. Foundation &amp; Database Inspection (SQLite)", h1_style))
story.append(Paragraph("Check registration progress towards the 100 CA foundation threshold:", body_style))
story.append(Paragraph('python3 -c "import sqlite3; db=sqlite3.connect(\'signals.db\'); print(\'Registered:\', db.execute(\'SELECT COUNT(*) FROM seen\').fetchone()[0])"', code_style))

story.append(Paragraph("Inspect currently active tracked signals being monitored for 2x outcome:", body_style))
story.append(Paragraph('python3 -c "import sqlite3; db=sqlite3.connect(\'signals.db\'); print(db.execute(\'SELECT symbol, entry_mc, peak_mc, status FROM tracked_signals\').fetchall())"', code_style))

# Section 4
story.append(Paragraph("4. Cron Job Automation (Periodic Behavior Monitor)", h1_style))
story.append(Paragraph("To run the historical outcome behavior monitor automatically every 15 minutes:", body_style))
story.append(Paragraph("crontab -e", code_style))
story.append(Paragraph("Add this line inside crontab:", body_style))
story.append(Paragraph("*/15 * * * * cd /data/data/com.termux/files/home/Solana-memecoin-pattern &amp;&amp; python3 monitor.py &gt;&gt; monitor.log 2&gt;&amp;1", code_style))

# Section 5: Strategy Table
story.append(Paragraph("5. Strategy &amp; Execution Matrix", h1_style))
data = [
    ["Parameter", "Target Value", "Core Rationale"],
    ["Optimal Entry", "$8,000 – $15,000 MC", "Early bonding curve / micro liquidity breakout stage."],
    ["TP1 (Quick 2x)", "$20,000 – $25,000 MC", "Take-profit scalp. De-risks position / pulls initial capital."],
    ["TP2 (Runner Exit)", "$50,000 – $100,000 MC", "Moonbag hold towards Pump.fun curve graduation."],
    ["Dev Holding Bag", "&le; 8.0% (0.0% optimal)", "Guarantees developer cannot dump and crash the coin."],
    ["Contract Security", "Mint &amp; Freeze Revoked", "Zero honeypot / wallet freezing risk (via RugCheck)."],
    ["100 CA Baseline", "100 Registered CAs", "Statistical foundation built before pattern signals trigger."],
    ["Outcome Alerts", "Hit 2x or Did Not Hit", "Automated follow-up notification sent to Channel ID."],
]

table = Table(data, colWidths=[1.5*72, 1.8*72, 3.7*72])
table.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#0f5132")),
    ("TEXTCOLOR", (0,0), (-1,0), colors.white),
    ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE", (0,0), (-1,-1), 8),
    ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ("TOPPADDING", (0,0), (-1,-1), 3),
    ("GRID", (0,0), (-1,-1), 0.5, colors.HexColor("#ced4da")),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#f8f9fa")]),
]))
story.append(table)

doc.build(story)
print(f"✅ Generated PDF at: {pdf_path}")

# Also copy to ~/storage/downloads if available
alt_path = "/data/data/com.termux/files/home/storage/downloads/Solana_Memecoin_Pattern_Termux_Guide.pdf"
try:
    shutil.copyfile(pdf_path, alt_path)
    print(f"✅ Also copied to: {alt_path}")
except Exception as e:
    pass
