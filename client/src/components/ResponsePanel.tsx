import { VerdictStrip } from "./Verdict";
import { DotLoader } from "./ui";
import { useMemo, useState } from "react";
import { formatBytes, formatMs, tryPrettyJson } from "../lib/format";
import type { ExecutionResult, HeaderPair, RunOutcome } from "../lib/types";
import { StatusBadge } from "./Badges";
import { CodeView } from "./CodeView";
import { AiSummaryCard } from "./AiSummaryCard";
import { ContractResult } from "./ContractBits";

type Tab = "body" | "headers" | "request" | "contract" | "ai";

interface Props {
  result: ExecutionResult | null;
  loading: boolean;
  error: string | null;
  unresolvedVariables: string[];
  contract?: RunOutcome["contract"];
  // Generates a contract from this response (shown for JSON bodies)
  onCreateContract?: () => void;
  // History entry for this response; enables the AI explanation tab
  historyId?: string | null;
}

export const ResponsePanel = ({ result, loading, error, unresolvedVariables, contract, onCreateContract, historyId }: Props) => {
  const [tab, setTab] = useState<Tab>("body");

  if (loading) {
    return (
      <div className="panel response empty-state">
        <DotLoader large />
        <p>Sending request…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel response empty-state">
        <p className="error-text">{error}</p>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="panel response empty-state">
        <p className="muted">
          Enter a URL and press <kbd>Send</kbd>
          <span className="kbd-only">
            {" "}
            or <kbd>{/Mac/i.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd>+<kbd>Enter</kbd>
          </span>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="panel response">
      <div className="response-meta">
        <StatusBadge status={result.status} errorCode={result.error?.code} />
        {result.status > 0 && <span className="muted">{result.statusText}</span>}
        <span className="meta-item" title={`Time to first byte: ${formatMs(result.timings.ttfbMs)}`}>
          <span className="muted">Time</span> {formatMs(result.timings.totalMs)}
        </span>
        <span className="meta-item">
          <span className="muted">Size</span> {formatBytes(result.sizeBytes)}
        </span>
        {result.redirected && <span className="chip">redirected</span>}
        {result.truncated && <span className="chip warn">truncated</span>}
        {contract && (
          <button
            type="button"
            className={`chip ${contract.valid ? "chip-ok" : contract.skipped && !contract.errors.length ? "" : "chip-danger"}`}
            onClick={() => setTab("contract")}
          >
            {contract.valid ? "contract ✓" : contract.skipped && !contract.errors.length ? "contract skipped" : `contract ✗ ${contract.errors.length}`}
          </button>
        )}
      </div>
      <VerdictStrip result={result} contract={contract} />
      {unresolvedVariables.length > 0 && (
        <div className="banner warn">Unresolved variables: {unresolvedVariables.map((v) => `{{${v}}}`).join(", ")}. They were sent literally.</div>
      )}
      {result.error && (
        <div className="banner error">
          <span>
            <strong>{result.error.code.replace(/_/g, " ")}</strong>: {result.error.message}
          </span>
        </div>
      )}
      <div className="tabs" role="tablist">
        {(["body", "headers", "request", ...(contract ? (["contract"] as const) : []), ...(historyId ? (["ai"] as const) : [])] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>
            {t === "body" ? "Body" : t === "headers" ? "Headers" : t === "request" ? "Request" : t === "contract" ? "Contract" : "Explain"}
            {t === "headers" && <span className="tab-badge">{result.headers.length}</span>}
          </button>
        ))}
      </div>
      <div className="tab-body response-body">
        {tab === "body" && <BodyView result={result} onCreateContract={onCreateContract} />}
        {tab === "contract" && contract && <ContractResult result={contract} name={contract.name} />}
        {tab === "ai" && historyId && <AiSummaryCard target={{ targetType: "history", targetId: historyId }} auto title="Response explained" />}
        {tab === "headers" && <HeaderTable headers={result.headers} empty="No response headers." />}
        {tab === "request" && (
          <div className="stack">
            <div className="mono request-line">
              <strong>{result.request.method}</strong> {result.request.url}
            </div>
            <HeaderTable headers={result.request.headers} empty="No headers sent." />
            {result.request.body && <CodeView text={result.request.body} language="text" />}
          </div>
        )}
      </div>
    </div>
  );
};

const BodyView = ({ result, onCreateContract }: { result: ExecutionResult; onCreateContract?: () => void }) => {
  const [mode, setMode] = useState<"pretty" | "raw">("pretty");
  const [copied, setCopied] = useState(false);
  const pretty = useMemo(() => (result.bodyEncoding === "utf8" ? tryPrettyJson(result.body) : null), [result]);

  if (result.bodyEncoding === "base64") {
    if (result.contentType.startsWith("image/") && !result.truncated) {
      return <img className="preview-image" alt="Response" src={`data:${result.contentType};base64,${result.body}`} />;
    }
    return (
      <p className="muted">
        Binary response ({result.contentType || "unknown type"}, {formatBytes(result.sizeBytes)}).
      </p>
    );
  }
  if (!result.body) return <p className="muted">Empty response body.</p>;

  const text = mode === "pretty" && pretty ? pretty : result.body;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="segmented small">
          <button className={mode === "pretty" ? "active" : ""} onClick={() => setMode("pretty")} disabled={!pretty}>
            Pretty
          </button>
          <button className={mode === "raw" ? "active" : ""} onClick={() => setMode("raw")}>
            Raw
          </button>
        </div>
        <span className="muted small truncate">{result.contentType}</span>
        <span className="toolbar-actions">
          {pretty && onCreateContract && (
            <button className="link-btn" onClick={onCreateContract} title="Generate a JSON Schema contract from this response">
              Create contract
            </button>
          )}
          <button className="link-btn" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </div>
      <CodeView text={text} language={mode === "pretty" && pretty ? "json" : "text"} />
    </div>
  );
};

const HeaderTable = ({ headers, empty }: { headers: HeaderPair[]; empty: string }) => {
  if (headers.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="table headers-table">
      <tbody>
        {headers.map((h, i) => (
          <tr key={i}>
            <td className="mono header-key">{h.key}</td>
            <td className="mono">{h.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
