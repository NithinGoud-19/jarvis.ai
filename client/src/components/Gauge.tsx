/** Circular gauge (0–100). Turns amber/red when high (or low, for battery). */
export function Gauge({
  label,
  value,
  detail,
  lowIsBad = false,
}: {
  label: string;
  value: number | null;
  detail?: string;
  lowIsBad?: boolean;
}) {
  const v = value ?? 0;
  const r = 34;
  const circumference = 2 * Math.PI * r;
  const danger = lowIsBad ? v <= 15 : v >= 90;
  const warn = lowIsBad ? v <= 30 : v >= 75;
  const color = value === null ? "#475569" : danger ? "#f87171" : warn ? "#fbbf24" : "#22d3ee";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(34,211,238,0.12)" strokeWidth="5" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - v / 100)}
            style={{ transition: "stroke-dashoffset 0.8s ease, stroke 0.4s", filter: `drop-shadow(0 0 4px ${color})` }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-hud text-lg" style={{ color }}>
            {value === null ? "—" : `${v}%`}
          </span>
        </div>
      </div>
      <span className="font-hud text-[10px] tracking-[0.25em] text-slate-400">{label}</span>
      {detail && <span className="text-[11px] text-slate-500">{detail}</span>}
    </div>
  );
}
