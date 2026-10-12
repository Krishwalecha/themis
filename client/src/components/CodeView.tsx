import { useMemo } from "react";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
const MAX_HIGHLIGHT_CHARS = 400_000;

// Lightweight JSON syntax highlighter (falls back to plain text for very large payloads)
const highlight = (json: string): React.ReactNode[] => {
  if (json.length > MAX_HIGHLIGHT_CHARS) return [json];
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of json.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push(json.slice(last, start));
    if (m[1] !== undefined) {
      out.push(
        <span key={i++} className={m[2] ? "tok-key" : "tok-string"}>
          {m[1]}
        </span>,
      );
      if (m[2]) out.push(m[2]);
    } else if (m[3] !== undefined) {
      out.push(<span key={i++} className={m[3] === "null" ? "tok-null" : "tok-bool"}>{m[3]}</span>);
    } else {
      out.push(<span key={i++} className="tok-number">{m[4]}</span>);
    }
    last = start + m[0].length;
  }
  if (last < json.length) out.push(json.slice(last));
  return out;
};

export const CodeView = ({ text, language }: { text: string; language: "json" | "text" }) => {
  const content = useMemo(() => (language === "json" ? highlight(text) : text), [text, language]);
  const lines = useMemo(() => text.split("\n").length, [text]);
  return (
    <div className="code">
      <pre className="code-gutter" aria-hidden>
        {Array.from({ length: Math.min(lines, 50_000) }, (_, i) => i + 1).join("\n")}
      </pre>
      <pre className="code-body">{content}</pre>
    </div>
  );
};
