"""
Generates the voiceover audio for the Pro ERP marketing video using edge-tts — a free,
no-signup, no-API-key Microsoft text-to-speech client (MIT licensed Python package).
Not fully offline (it calls a Microsoft cloud TTS endpoint), but zero-cost and does not
require any account, payment, or API key — the closest available free option on this
Windows machine (no piper/espeak-ng binary installed).

Usage:
    cd G:/Pro-ERP/marketing
    py -3.13 -m pip install --user edge-tts   # already installed on this machine
    py -3.13 scripts-voice/generate-voiceover.py
"""
import asyncio
import edge_tts
import os

VOICE = "en-US-AndrewNeural"  # a calm, professional male voice; alternatives: en-US-AriaNeural (female)
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "voice")
os.makedirs(OUT_DIR, exist_ok=True)

SCRIPT_SEGMENTS = [
    ("00-problem", "Running a manufacturing business means juggling leads, orders, inventory, production, and accounts — often across spreadsheets, WhatsApp, and memory."),
    ("01-product", "Pro ERP brings it all into one connected system — built for how a real factory actually operates, from first customer enquiry to final payment."),
    ("02-differentiator", "At its core is a no-code workflow engine. Build any multi-step process yourself — with role-based steps, working-hours-aware deadlines, and actions that update your real stock — without writing a single line of code."),
    ("03-workflows", "Capture a lead, move it through your pipeline, and send a quotation in minutes. Confirm the order, and Pro ERP reserves your stock automatically — accounting for what's committed, in transit, and already promised to other orders. Inspect before you dispatch. Plan your transport. Issue the gate pass. Every handoff happens inside one system — nothing falls through the cracks."),
    ("04-accounts", "Underneath it all is real double-entry accounting — GST tracked correctly, a live general ledger, and receivables you can actually trust — not a spreadsheet reconciliation at month end."),
    ("05-supporting", "Your team gets WhatsApp updates the moment something needs attention. And when they have a question, an AI assistant answers — using only your own data, never a guess."),
    ("06-cta", "Pro ERP. One system, for your entire operation. See it running on your own data — start your free trial today."),
]

async def generate_segment(segment_id: str, text: str):
    out_path = os.path.join(OUT_DIR, f"{segment_id}.mp3")
    communicate = edge_tts.Communicate(text, VOICE, rate="-4%")
    await communicate.save(out_path)
    print(f"generated {segment_id}.mp3 ({len(text)} chars)")

async def main():
    for segment_id, text in SCRIPT_SEGMENTS:
        await generate_segment(segment_id, text)
    # Full combined script, for a single continuous track option
    full_text = " ".join(t for _, t in SCRIPT_SEGMENTS)
    await generate_segment("full-voiceover", full_text)
    print("\nAll voiceover segments generated -> marketing/voice/")

if __name__ == "__main__":
    asyncio.run(main())
