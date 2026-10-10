import React from "react";
import {
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Easing,
  Audio,
} from "remotion";

export const FPS = 30;

// ---------------------------------------------------------------------------
// Real per-segment voiceover durations (ffprobe-measured, seconds -> frames @30fps)
// Scene cuts are locked to these so audio and visuals never drift.
// ---------------------------------------------------------------------------
const SEG = {
  problem: Math.round(10.44 * FPS),
  product: Math.round(10.176 * FPS),
  differentiator: Math.round(14.184 * FPS),
  workflows: Math.round(24.048 * FPS),
  accounts: Math.round(11.832 * FPS),
  supporting: Math.round(10.464 * FPS),
  cta: Math.round(7.728 * FPS),
};

export const TOTAL_DURATION_FRAMES =
  SEG.problem + SEG.product + SEG.differentiator + SEG.workflows + SEG.accounts + SEG.supporting + SEG.cta;

type Ratio = "16:9" | "9:16" | "1:1";

const COLORS = {
  bg: "#0a0e14",
  bg2: "#111826",
  accent: "#3b82f6",
  accent2: "#7dd3fc",
  text: "#f5f7fa",
  muted: "#8a96a8",
  caption: "#e8edf5",
};

const FONT = "'Segoe UI', -apple-system, 'Helvetica Neue', Arial, sans-serif";

function fadeIn(frame: number, start: number, dur: number) {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
}

function pushIn(frame: number, start: number, dur: number, fromScale = 1, toScale = 1.08) {
  return interpolate(frame, [start, start + dur], [fromScale, toScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  });
}

/** Slide-in-from-side transition wrapper — replaces plain cross-dissolve cuts. */
const SlideIn: React.FC<{
  children: React.ReactNode;
  direction?: "left" | "right" | "up";
  durationFrames?: number;
}> = ({ children, direction = "right", durationFrames = 14 }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, durationFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const offset = (1 - progress) * 60;
  const translate =
    direction === "left" ? `${offset}px 0` : direction === "right" ? `${-offset}px 0` : `0 ${offset}px`;
  return <AbsoluteFill style={{ opacity: progress, translate }}>{children}</AbsoluteFill>;
};

/** Animated cursor dot that moves to a target point and "clicks" with a ripple. */
const CursorClick: React.FC<{
  from: [number, number];
  to: [number, number];
  clickAtFrame: number;
}> = ({ from, to, clickAtFrame }) => {
  const frame = useCurrentFrame();
  const moveDur = Math.max(clickAtFrame - 8, 1);
  const x = interpolate(frame, [0, moveDur], [from[0], to[0]], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  });
  const y = interpolate(frame, [0, moveDur], [from[1], to[1]], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  });
  const op = fadeIn(frame, 0, 8);
  const ripple = interpolate(frame, [clickAtFrame, clickAtFrame + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });
  const pressed = frame >= clickAtFrame && frame < clickAtFrame + 6;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: COLORS.accent2,
          opacity: op * (pressed ? 0.6 : 1),
          scale: pressed ? 0.8 : 1,
          boxShadow: "0 2px 10px rgba(125,211,252,0.6)",
          translate: "-50% -50%",
        }}
      />
      {ripple > 0 && ripple < 1 && (
        <div
          style={{
            position: "absolute",
            left: x,
            top: y,
            width: 40 * ripple + 18,
            height: 40 * ripple + 18,
            borderRadius: "50%",
            border: `2px solid ${COLORS.accent2}`,
            opacity: 1 - ripple,
            translate: "-50% -50%",
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/** Burned-in caption bar — short synced phrase, safe-area positioned. */
const Caption: React.FC<{ text: string; ratio: Ratio; show: boolean }> = ({ text, ratio, show }) => {
  const frame = useCurrentFrame();
  if (!show) return null;
  const op = fadeIn(frame, 0, 8);
  return (
    <div
      style={{
        position: "absolute",
        left: "6%",
        right: "6%",
        bottom: ratio === "16:9" ? "4%" : "15%",
        textAlign: "center",
        opacity: op,
      }}
    >
      <span
        style={{
          fontFamily: FONT,
          fontWeight: 600,
          fontSize: ratio === "16:9" ? 25 : 21,
          color: COLORS.caption,
          background: "rgba(10,14,20,0.72)",
          padding: "8px 18px",
          borderRadius: 10,
          lineHeight: 1.5,
        }}
      >
        {text}
      </span>
    </div>
  );
};

/** A full-bleed screenshot with Ken-Burns push-in, optional cursor-click overlay, caption. */
const ScreenshotScene: React.FC<{
  src: string;
  ratio: Ratio;
  label: string;
  sub: string;
  caption: string;
  durationFrames: number;
  cursor?: { from: [number, number]; to: [number, number]; clickAtFrame: number };
  slideDir?: "left" | "right" | "up";
}> = ({ src, ratio, label, sub, caption, durationFrames, cursor, slideDir = "right" }) => {
  const frame = useCurrentFrame();
  const scale = pushIn(frame, 0, durationFrames, 1.0, 1.06);
  const isPortraitFrame = ratio !== "16:9";

  return (
    <SlideIn direction={slideDir}>
      <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
        <AbsoluteFill style={{ overflow: "hidden" }}>
          {isPortraitFrame ? (
            <AbsoluteFill
              style={{ justifyContent: "center", alignItems: "center", padding: ratio === "1:1" ? 90 : 70 }}
            >
              <div
                style={{
                  width: "100%",
                  aspectRatio: "16 / 10",
                  borderRadius: 28,
                  overflow: "hidden",
                  boxShadow: "0 40px 100px rgba(0,0,0,0.55)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  scale,
                  position: "relative",
                }}
              >
                <Img
                  src={src}
                  style={{ width: "100%", height: "161%", objectFit: "cover", objectPosition: "top" }}
                />
              </div>
            </AbsoluteFill>
          ) : (
            <Img
              src={src}
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", scale }}
            />
          )}
        </AbsoluteFill>

        {cursor && ratio === "16:9" && (
          <CursorClick from={cursor.from} to={cursor.to} clickAtFrame={cursor.clickAtFrame} />
        )}

        <AbsoluteFill
          style={{
            background:
              "linear-gradient(to top, rgba(10,14,20,0.92) 0%, rgba(10,14,20,0.35) 35%, rgba(10,14,20,0) 60%)",
          }}
        />
        <div style={{ position: "absolute", left: "5%", right: "5%", bottom: isPortraitFrame ? "8%" : "7%" }}>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 700,
              fontSize: ratio === "16:9" ? 56 : 44,
              color: COLORS.text,
              letterSpacing: -0.5,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 400,
              fontSize: ratio === "16:9" ? 26 : 22,
              color: COLORS.muted,
              marginTop: 8,
            }}
          >
            {sub}
          </div>
        </div>
        <Caption text={caption} ratio={ratio} show={!!caption} />
      </AbsoluteFill>
    </SlideIn>
  );
};

const TitleScene: React.FC<{ ratio: Ratio; words: string[]; caption: string }> = ({ ratio, words, caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bgScale = interpolate(frame, [0, 6 * fps], [1.02, 1.0], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, justifyContent: "center", alignItems: "center", scale: bgScale }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${COLORS.bg2} 0%, ${COLORS.bg} 70%)` }} />
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: ratio === "16:9" ? 20 : 14,
          maxWidth: "80%",
          position: "relative",
        }}
      >
        {words.map((w, i) => {
          const start = i * 6;
          const op = fadeIn(frame, start, 12);
          const y = interpolate(frame, [start, start + 12], [20, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
          return (
            <span
              key={i}
              style={{
                fontFamily: FONT,
                fontWeight: 700,
                fontSize: ratio === "16:9" ? 64 : 46,
                color: COLORS.text,
                opacity: op,
                translate: `0 ${y}px`,
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
      <Caption text={caption} ratio={ratio} show={!!caption} />
    </AbsoluteFill>
  );
};

/** Stylized WhatsApp-style chat bubble graphic (no real phone numbers/data). */
const WhatsAppScene: React.FC<{ ratio: Ratio; caption: string }> = ({ ratio, caption }) => {
  const frame = useCurrentFrame();
  const bubbleScale = interpolate(frame, [6, 20], [0.7, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.elastic(1),
  });
  const op = fadeIn(frame, 0, 10);
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, #0f2418 0%, ${COLORS.bg} 70%)` }} />
      <div
        style={{
          opacity: op,
          scale: bubbleScale,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: ratio === "16:9" ? 480 : 340,
        }}
      >
        <div
          style={{
            background: "#1f2c34",
            borderRadius: "18px 18px 18px 4px",
            padding: "14px 20px",
            fontFamily: FONT,
            color: "#e9edef",
            fontSize: ratio === "16:9" ? 20 : 17,
            alignSelf: "flex-start",
            maxWidth: "85%",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          ✅ Step completed — FMS: QC Review
        </div>
        <div
          style={{
            background: "#005c4b",
            borderRadius: "18px 18px 4px 18px",
            padding: "14px 20px",
            fontFamily: FONT,
            color: "#e9edef",
            fontSize: ratio === "16:9" ? 20 : 17,
            alignSelf: "flex-end",
            maxWidth: "85%",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          ⚠️ Stock shortage — Order needs review
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: "28%",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: ratio === "16:9" ? 48 : 36,
          color: COLORS.text,
          opacity: op,
        }}
      >
        Instant WhatsApp alerts
      </div>
      <Caption text={caption} ratio={ratio} show={!!caption} />
    </AbsoluteFill>
  );
};

/** Stylized AI chat UI with a typing indicator. */
const ChatbotScene: React.FC<{ ratio: Ratio; caption: string }> = ({ ratio, caption }) => {
  const frame = useCurrentFrame();
  const op = fadeIn(frame, 0, 10);
  const dotPhase = (i: number) => {
    const t = (frame + i * 6) % 30;
    return interpolate(t, [0, 10, 20, 30], [0.3, 1, 0.3, 0.3]);
  };
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, #0d1b2e 0%, ${COLORS.bg} 70%)` }} />
      <div style={{ opacity: op, textAlign: "center" }}>
        <div
          style={{
            display: "inline-flex",
            gap: 8,
            background: "#15202b",
            borderRadius: 24,
            padding: "16px 24px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ width: 12, height: 12, borderRadius: "50%", background: COLORS.accent2, opacity: dotPhase(i) }}
            />
          ))}
        </div>
        <div
          style={{
            marginTop: 28,
            fontFamily: FONT,
            fontWeight: 800,
            fontSize: ratio === "16:9" ? 48 : 36,
            color: COLORS.text,
          }}
        >
          Grounded. Never a guess.
        </div>
      </div>
      <Caption text={caption} ratio={ratio} show={!!caption} />
    </AbsoluteFill>
  );
};

/** Logo outro with wordmark reveal + CTA. */
const OutroScene: React.FC<{ ratio: Ratio }> = ({ ratio }) => {
  const frame = useCurrentFrame();
  const op = fadeIn(frame, 0, 15);
  const scale = interpolate(frame, [0, 20], [0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, justifyContent: "center", alignItems: "center" }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 50%, ${COLORS.bg2} 0%, ${COLORS.bg} 75%)` }} />
      <div style={{ textAlign: "center", opacity: op, scale }}>
        <div style={{ fontFamily: FONT, fontWeight: 900, fontSize: ratio === "16:9" ? 88 : 60, color: COLORS.text, letterSpacing: -2 }}>
          Pro<span style={{ color: COLORS.accent2 }}>ERP</span>
        </div>
        <div style={{ fontFamily: FONT, fontWeight: 500, fontSize: ratio === "16:9" ? 28 : 22, color: COLORS.muted, marginTop: 18 }}>
          Start your free trial today
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Timeline — locked to real per-segment voiceover durations
// ---------------------------------------------------------------------------

export const ProErpExplainer: React.FC<{ ratio: Ratio }> = ({ ratio }) => {
  const { fps } = useVideoConfig();
  const shot = (name: string) => staticFile(`screenshots/${name}.png`);
  const sfx = (name: string) => staticFile(`sfx/${name}.wav`);
  const voice = (name: string) => staticFile(`voice/${name}.mp3`);

  let cursor = 0;
  const marks: Record<string, number> = {};
  for (const [key, dur] of Object.entries(SEG)) {
    marks[key] = cursor;
    cursor += dur;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg }}>
      <Audio src={staticFile("sfx/music-bed.wav")} volume={0.16} premountFor={fps} />

      {/* ---------- 00: Problem (title card) ---------- */}
      <Sequence from={marks.problem} durationInFrames={SEG.problem} premountFor={fps}>
        <Audio src={voice("00-problem")} premountFor={fps} />
        <TitleScene
          ratio={ratio}
          words={["Leads.", "Orders.", "Inventory.", "Accounts."]}
          caption="Running a manufacturing business means juggling it all."
        />
      </Sequence>
      <Sequence from={marks.problem + SEG.problem - 10} durationInFrames={12}>
        <Audio src={sfx("whoosh")} volume={0.5} />
      </Sequence>

      {/* ---------- 01: Product (dashboard reveal) ---------- */}
      <Sequence from={marks.product} durationInFrames={SEG.product} premountFor={fps}>
        <Audio src={voice("01-product")} premountFor={fps} />
        <ScreenshotScene
          src={shot("02-dashboard")}
          ratio={ratio}
          label="Pro ERP"
          sub="One connected system for your entire operation."
          caption="Pro ERP brings it all into one connected system."
          durationFrames={SEG.product}
          slideDir="up"
        />
      </Sequence>
      <Sequence from={marks.product + 10} durationInFrames={20}>
        <Audio src={sfx("chime")} volume={0.35} />
      </Sequence>

      {/* ---------- 02: Differentiator (FMS, with cursor click) ---------- */}
      <Sequence from={marks.differentiator} durationInFrames={SEG.differentiator} premountFor={fps}>
        <Audio src={voice("02-differentiator")} premountFor={fps} />
        <ScreenshotScene
          src={shot("09-fms-templates")}
          ratio={ratio}
          label="Build any process. No code."
          sub="Role-gated steps, working-hours-aware deadlines, real stock actions."
          caption="At its core is a no-code workflow engine."
          durationFrames={SEG.differentiator}
          cursor={{ from: [300, 500], to: [660, 420], clickAtFrame: 60 }}
        />
      </Sequence>
      <Sequence from={marks.differentiator + 52} durationInFrames={10}>
        <Audio src={sfx("click")} volume={0.5} />
      </Sequence>
      <Sequence from={marks.differentiator + SEG.differentiator - 10} durationInFrames={12}>
        <Audio src={sfx("whoosh")} volume={0.45} />
      </Sequence>

      {/* ---------- 03: Workflows (4 sub-scenes inside one long segment) ---------- */}
      {(() => {
        const base = marks.workflows;
        const leadsLen = 190;
        const ordersLen = 190;
        const pdiLen = 160;
        const dispatchLen = SEG.workflows - leadsLen - ordersLen - pdiLen;
        return (
          <>
            <Sequence from={base} durationInFrames={leadsLen} premountFor={fps}>
              <ScreenshotScene
                src={shot("03-leads")}
                ratio={ratio}
                label="Lead -> Pipeline -> Quotation"
                sub="Capture, qualify, and quote in minutes."
                caption="Capture a lead, move it through your pipeline..."
                durationFrames={leadsLen}
                cursor={{ from: [250, 480], to: [400, 400], clickAtFrame: 40 }}
              />
            </Sequence>
            <Sequence from={base + leadsLen - 8} durationInFrames={10}>
              <Audio src={sfx("whoosh")} volume={0.35} />
            </Sequence>

            <Sequence from={base + leadsLen} durationInFrames={ordersLen} premountFor={fps}>
              <ScreenshotScene
                src={shot("04-orders")}
                ratio={ratio}
                label="Stock reserved automatically"
                sub="Free stock, accounted for in real time."
                caption="...Pro ERP reserves your stock automatically."
                durationFrames={ordersLen}
                slideDir="left"
              />
            </Sequence>
            <Sequence from={base + leadsLen + ordersLen - 8} durationInFrames={10}>
              <Audio src={sfx("whoosh")} volume={0.35} />
            </Sequence>

            <Sequence from={base + leadsLen + ordersLen} durationInFrames={pdiLen} premountFor={fps}>
              <ScreenshotScene
                src={shot("05-pdi")}
                ratio={ratio}
                label="Inspect. Then transport."
                sub="Before anything ships."
                caption="Inspect before you dispatch. Plan your transport."
                durationFrames={pdiLen}
                slideDir="right"
              />
            </Sequence>
            <Sequence from={base + leadsLen + ordersLen + pdiLen - 8} durationInFrames={10}>
              <Audio src={sfx("whoosh")} volume={0.35} />
            </Sequence>

            <Sequence from={base + leadsLen + ordersLen + pdiLen} durationInFrames={dispatchLen} premountFor={fps}>
              <ScreenshotScene
                src={shot("07-dispatch")}
                ratio={ratio}
                label="Dispatch."
                sub="Gate pass, the one real stock movement."
                caption="Every handoff happens inside one system — nothing falls through the cracks."
                durationFrames={dispatchLen}
                slideDir="up"
              />
            </Sequence>
          </>
        );
      })()}
      <Sequence from={marks.workflows + SEG.workflows - 10} durationInFrames={12}>
        <Audio src={sfx("whoosh")} volume={0.45} />
      </Sequence>

      {/* ---------- 04: Accounts ---------- */}
      <Sequence from={marks.accounts} durationInFrames={SEG.accounts} premountFor={fps}>
        <Audio src={voice("04-accounts")} premountFor={fps} />
        <ScreenshotScene
          src={shot("08-accounts")}
          ratio={ratio}
          label="Real double-entry accounting"
          sub="GST tracked correctly. Receivables you can trust."
          caption="Underneath it all is real double-entry accounting."
          durationFrames={SEG.accounts}
          slideDir="up"
        />
      </Sequence>
      <Sequence from={marks.accounts + SEG.accounts - 10} durationInFrames={12}>
        <Audio src={sfx("whoosh")} volume={0.4} />
      </Sequence>

      {/* ---------- 05: Supporting (WhatsApp + Chatbot) ---------- */}
      {(() => {
        const base = marks.supporting;
        const waLen = 157;
        const botLen = SEG.supporting - waLen;
        return (
          <>
            <Sequence from={base} durationInFrames={waLen} premountFor={fps}>
              <WhatsAppScene ratio={ratio} caption="Your team gets WhatsApp updates the moment something needs attention." />
            </Sequence>
            <Sequence from={base + 15} durationInFrames={14}>
              <Audio src={sfx("pop")} volume={0.45} />
            </Sequence>
            <Sequence from={base + 60} durationInFrames={14}>
              <Audio src={sfx("pop")} volume={0.4} />
            </Sequence>
            <Sequence from={base + waLen - 8} durationInFrames={10}>
              <Audio src={sfx("whoosh")} volume={0.35} />
            </Sequence>

            <Sequence from={base + waLen} durationInFrames={botLen} premountFor={fps}>
              <Audio src={voice("05-supporting")} premountFor={fps} />
              <ChatbotScene ratio={ratio} caption="An AI assistant answers using only your own data, never a guess." />
            </Sequence>
          </>
        );
      })()}

      {/* ---------- 06: CTA ---------- */}
      <Sequence from={marks.cta} durationInFrames={SEG.cta} premountFor={fps}>
        <Audio src={voice("06-cta")} premountFor={fps} />
        <OutroScene ratio={ratio} />
      </Sequence>
      <Sequence from={marks.cta + 10} durationInFrames={24}>
        <Audio src={sfx("chime")} volume={0.4} />
      </Sequence>
    </AbsoluteFill>
  );
};
