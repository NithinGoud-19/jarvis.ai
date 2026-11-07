/** The animated JARVIS "arc reactor" core. Changes with what JARVIS is doing. */
export type CoreState =
  | "idle"
  | "listening" // recording your voice
  | "transcribing" // turning your voice into text
  | "thinking" // waiting for the AI / running tools
  | "responding" // AI text is streaming in
  | "talking" // playing JARVIS's voice
  | "offline";

const LABELS: Record<CoreState, string> = {
  idle: "ONLINE",
  listening: "LISTENING",
  transcribing: "PROCESSING VOICE",
  thinking: "THINKING",
  responding: "RESPONDING",
  talking: "SPEAKING",
  offline: "OFFLINE",
};

export function Core({
  state,
  level = 0,
  size = 160,
  showLabel = true,
}: {
  state: CoreState;
  level?: number;
  size?: number;
  showLabel?: boolean;
}) {
  const offline = state === "offline";
  const listening = state === "listening";
  const fast = state === "thinking" || state === "transcribing";
  const color = offline ? "#f87171" : listening ? "#34d399" : "#22d3ee";
  const scale = listening ? 1 + level * 0.45 : 1;

  // 60 tick marks around the outer ring
  const ticks = Array.from({ length: 60 }, (_, i) => {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    const r1 = long ? 86 : 89;
    return (
      <line
        key={i}
        x1={100 + Math.cos(a) * r1}
        y1={100 + Math.sin(a) * r1}
        x2={100 + Math.cos(a) * 94}
        y2={100 + Math.sin(a) * 94}
        stroke={color}
        strokeOpacity={long ? 0.8 : 0.35}
        strokeWidth={long ? 1.6 : 1}
      />
    );
  });

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 200 200" className="absolute inset-0 h-full w-full">
          <g className={`core-ring ${fast ? "core-ring-fast" : ""}`}>{ticks}</g>
          <g className={`core-ring-rev ${fast ? "core-ring-fast" : ""}`}>
            <circle cx="100" cy="100" r="74" fill="none" stroke={color} strokeOpacity="0.55" strokeWidth="2" strokeDasharray="70 18 8 18" />
          </g>
          <g className={`core-ring ${fast ? "core-ring-fast" : ""}`}>
            <circle cx="100" cy="100" r="60" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 6" />
          </g>
        </svg>
        {/* glowing centre */}
        <div
          className={`absolute rounded-full ${listening ? "" : "core-pulse"} ${state === "talking" ? "animate-pulse" : ""}`}
          style={{
            inset: "30%",
            transform: `scale(${scale})`,
            transition: "transform 80ms linear",
            background: `radial-gradient(circle, #ffffff 0%, ${color} 35%, ${color}33 70%, transparent 72%)`,
            boxShadow: `0 0 40px 12px ${color}55`,
          }}
        />
      </div>
      {showLabel && (
        <span className="font-hud text-[11px] tracking-[0.35em] glow-text" style={{ color }}>
          {LABELS[state]}
        </span>
      )}
    </div>
  );
}
