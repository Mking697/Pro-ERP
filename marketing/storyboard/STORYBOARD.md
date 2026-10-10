# STORYBOARD.md — Pro ERP 75-90s Product Explainer

Audio source: `marketing/voice/full-voiceover.mp3` (83.16s, edge-tts, local/free).
Segment files: `marketing/voice/0X-*.mp3` for per-scene timing reference.
UI assets: `marketing/screenshots/*.png` (1920x1080 desktop, 390x844 mobile).

| # | Timestamp | Scene purpose | UI asset | Voiceover | On-screen text | Animation | Camera | Transition | SFX |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 0:00-0:06 | The problem — fragmentation | Dark gradient title card, no UI yet | "Running a manufacturing business means juggling leads, orders, inventory..." | "Leads. Orders. Inventory. Accounts." (words appear staggered) | Kinetic typography, words fade/slide in one at a time | Static, slow zoom out 102%→100% | Hard cut in | Soft low whoosh under title |
| 2 | 0:06-0:14 | The product — reveal | `02-dashboard.png` | "Pro ERP brings it all into one connected system..." | "Pro ERP" logo mark + tagline | Screen slides up from bottom with slight 3D tilt (2.5D), settles flat | Push-in dolly, 100%→108% over 8s | Cross-dissolve from title | UI whoosh + soft chime on settle |
| 3 | 0:14-0:24 | The differentiator — FMS | `09-fms-templates.png` | "At its core is a no-code workflow engine..." | "Build any process. No code." | Parallax: sidebar slides in from left, content fades in after | Slow pan left→right across the nav | Whip-pan from scene 2 | Subtle mechanical "build" tick sfx |
| 4 | 0:24-0:30 | Lead → Pipeline | `03-leads.png` | "Capture a lead, move it through your pipeline..." | "Lead → Pipeline → Quotation" | UI zoom into the pipeline tab row | Push-in on the status tabs | Match-cut (sidebar persists) | Soft click |
| 5 | 0:30-0:36 | Order → Stock reserved | `04-orders.png` | "...Pro ERP reserves your stock automatically..." | "Stock reserved automatically" | Number counter animation overlay (mocked, not real DOM) | Static with subtle Ken Burns | Cross-dissolve | Data-tick sfx |
| 6 | 0:36-0:42 | PDI → TMS → Dispatch | `05-pdi.png`, `07-dispatch.png` (quick 2-up) | "Inspect before you dispatch. Plan your transport. Issue the gate pass." | "Inspect. Transport. Dispatch." | Fast sequential cuts, each 2s, slight zoom per cut | Push-in each | Hard cuts (beat-synced) | 3x soft clicks |
| 7 | 0:42-0:46 | Chain closes | Composite: small thumbnails of scenes 3-6 connected by lines | "Every handoff happens inside one system..." | "One connected system" | Lines draw between thumbnails | Static | Cross-dissolve | Connective chime |
| 8 | 0:46-0:58 | Accounts / GL | `08-accounts.png` | "Underneath it all is real double-entry accounting..." | "Real double-entry accounting" | UI zoom into GL table rows | Slow push-in | Cross-dissolve | Low confident hum |
| 9 | 0:58-1:04 | WhatsApp notify | Stylized WhatsApp bubble graphic (not real screenshot — no real phone numbers) | "Your team gets WhatsApp updates..." | "Instant WhatsApp alerts" | Bubble pops in with bounce | Static | Cross-dissolve | Notification pop sfx |
| 10 | 1:04-1:08 | AI Chatbot | Stylized chat UI graphic referencing `/chat` module (generic, no real conversation shown) | "...an AI assistant answers using only your own data." | "Grounded. Never a guess." | Typing-indicator animation | Static | Cross-dissolve | Typing sfx |
| 11 | 1:08-1:15 | CTA | `15-dashboard-mobile.png` + `02-dashboard.png` side by side | "Pro ERP. One system, for your entire operation..." | "Start your free trial — Pro ERP" + URL | Both screens slide in from opposite sides, logo stamps center | Pull-back to reveal both | Cross-dissolve | Rising outro chime, fade to silence |

## Aspect-ratio recomposition notes (per PHASE 7 requirement)

- **16:9 (1920x1080)**: as storyboarded above — full desktop screenshots fill frame with Ken Burns.
- **9:16 (1080x1920)**: desktop screenshots are cropped to their top ~60% (nav + primary content),
  presented inside a rounded "device frame" card centered in frame with generous top/bottom margin
  for captions; scene 11 uses the mobile screenshot full-bleed instead of the desktop pair.
- **1:1 (1080x1080)**: screenshots inset into a centered card (not full-bleed) with on-screen text
  above/below the card rather than overlaid on it, since square leaves no safe overlay margin on
  a 16:9-shaped screenshot.

## Safe areas

Keep all on-screen text within the inner 90% of frame on every ratio; captions never overlap the
browser chrome / nav sidebar in the source screenshots.
