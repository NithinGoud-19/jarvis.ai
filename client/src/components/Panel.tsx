import type { ReactNode } from "react";

/** A glowing HUD panel with corner brackets and an optional title bar. */
export function Panel({
  title,
  right,
  children,
  className = "",
  scan = false,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  scan?: boolean;
}) {
  return (
    <section className={`hud-panel fade-up flex min-h-0 flex-col overflow-hidden ${scan ? "scanline" : ""} ${className}`}>
      <span className="hud-corner tl" />
      <span className="hud-corner tr" />
      <span className="hud-corner bl" />
      <span className="hud-corner br" />
      {title && (
        <header className="flex items-center justify-between border-b border-jarvis-cyan/10 px-4 py-2.5">
          <h2 className="font-hud text-[11px] tracking-[0.25em] text-jarvis-cyan/90">{title}</h2>
          {right}
        </header>
      )}
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>
  );
}
