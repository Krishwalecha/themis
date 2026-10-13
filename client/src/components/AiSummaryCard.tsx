import { DotLoader } from "./ui";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { AiLevel, AiSummary, AiTarget } from "../lib/types";

const LEVEL_LABEL: Record<AiLevel, string> = { ok: "Healthy", info: "Info", warning: "Warning", critical: "Critical" };

const targetKey = (t: AiTarget): string => {
  return JSON.stringify(t);
};

interface Props {
  target: AiTarget;
  // Generate on mount instead of waiting for a click
  auto?: boolean;
  title?: string;
  compact?: boolean;
}

// "Explain with AI" card: structured summary from Groq, or the rule-based fallback
export const AiSummaryCard = ({ target, auto = false, title = "AI summary", compact = false }: Props) => {
  const [data, setData] = useState<AiSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = targetKey(target);

  const run = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.ai.summarize(target, refresh));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // New target → clear the old summary (and regenerate if auto).
  useEffect(() => {
    setData(null);
    setError(null);
    if (auto) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, auto]);

  if (!data && !loading && !error) {
    return (
      <div className={`ai-card ai-empty${compact ? " compact" : ""}`}>
        <span className="ai-mark" aria-hidden>
          AI
        </span>
        <span className="ai-title">{title}</span>
        <button className="btn ghost small" onClick={() => void run()}>
          Generate
        </button>
      </div>
    );
  }

  return (
    <div className={`ai-card${compact ? " compact" : ""}${data ? ` ai-${data.summary.severity}` : ""}`} aria-busy={loading}>
      <div className="ai-head">
        <span className="ai-mark" aria-hidden>
          AI
        </span>
        <span className="ai-title">{title}</span>
        {data && (
          <span className="muted small ai-meta">
            {data.source === "groq" ? data.model : "Rule-based"} · {data.cached ? timeAgo(data.createdAt) : "just now"}
          </span>
        )}
        <button className="link-btn" disabled={loading} onClick={() => void run(true)}>
          {loading ? "Thinking…" : "Regenerate"}
        </button>
      </div>

      {loading && !data && <DotLoader large />}
      {error && <div className="banner error">{error}</div>}

      {data && (
        <>
          <div className="ai-headline">
            <span className={`ai-badge ai-badge-${data.summary.severity}`}>{LEVEL_LABEL[data.summary.severity]}</span>
            <strong>{data.summary.headline}</strong>
          </div>
          <p className="ai-text">{data.summary.summary}</p>
          {data.summary.highlights.length > 0 && (
            <ul className="ai-highlights">
              {data.summary.highlights.map((h, i) => (
                <li key={i} className={`ai-hl-${h.level}`}>
                  <span className="ai-hl-icon" role="img" aria-label={LEVEL_LABEL[h.level]} />
                  {h.text}
                </li>
              ))}
            </ul>
          )}
          {data.summary.recommendations.length > 0 && (
            <div className="ai-recs">
              <div className="small strong">Next steps</div>
              <ol>
                {data.summary.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </div>
          )}
          {data.note && <p className="hint">{data.note}</p>}
        </>
      )}
    </div>
  );
};
