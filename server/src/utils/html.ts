/**
 * Job descriptions arrive as HTML ("<p>We are <b>hiring</b>&amp; ...</p>").
 * We store plain text: smaller, easy to search, and safe to give to the AI.
 *
 * 📘 "HTML entities" are codes for special characters: &amp; = &, &lt; = <, &#39; = '
 * Greenhouse even sends HTML that is itself entity-encoded, so we decode first, then strip tags.
 */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', bull: "•", hellip: "…",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code.toLowerCase()] ?? whole;
  });
}

export function htmlToText(html: string | null | undefined, maxLength = 20_000): string | null {
  if (!html) return null;
  let s = decodeEntities(html); // Greenhouse: "&lt;p&gt;" → "<p>"
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>|<\/(p|div|li|ul|ol|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s)
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s ? s.slice(0, maxLength) : null;
}
