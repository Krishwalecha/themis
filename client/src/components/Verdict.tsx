import { useEffect, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Minus, X } from "lucide-react";
import { formatBytes, formatMs } from "../lib/format";
import type { ExecutionResult, RunOutcome } from "../lib/types";

// Latency budget for the workspace verdict; monitors carry their own thresholds
const LATENCY_BUDGET_MS = 1000;

type CheckRow = { label: string; ok: boolean | null; note: string };

// Pure: the checks Themis can judge from a single response
const judgeResponse = (result: ExecutionResult, contract: RunOutcome["contract"]): CheckRow[] => {
  if (result.error) return [{ label: "request completed", ok: false, note: result.error.code }];
  const checks: CheckRow[] = [
    { label: "status is 2xx", ok: result.status >= 200 && result.status < 300, note: String(result.status) },
    { label: `latency < ${LATENCY_BUDGET_MS}ms`, ok: result.timings.totalMs < LATENCY_BUDGET_MS, note: formatMs(result.timings.totalMs) },
  ];
  if (/json/i.test(result.contentType)) {
    let ok = true;
    try {
      JSON.parse(result.body);
    } catch {
      ok = false;
    }
    checks.push({ label: "body is valid JSON", ok: result.truncated ? null : ok, note: result.truncated ? "truncated" : formatBytes(result.sizeBytes) });
  }
  if (contract) {
    checks.push(
      contract.skipped
        ? { label: `matches ${contract.name}`, ok: null, note: "no matching path" }
        : {
            label: `matches ${contract.name}`,
            ok: contract.valid,
            note: contract.valid ? "valid" : contract.errors[0]?.path || `${contract.errors.length} errors`,
          },
    );
  }
  return checks;
};

// The verdict, inline above the response: a stamp, one dot per check, and the checks on demand
export const VerdictStrip = ({ result, contract }: { result: ExecutionResult; contract: RunOutcome["contract"] }) => {
  const checks = judgeResponse(result, contract);
  const failed = checks.filter((c) => c.ok === false).length;
  const passed = checks.filter((c) => c.ok === true).length;
  // a failure opens itself so the reason is visible without a click
  const [open, setOpen] = useState(failed > 0);
  useEffect(() => setOpen(failed > 0), [result, failed]);

  return (
    <div className={`verdict-strip${failed ? " fail" : ""}`}>
      <button type="button" className="verdict-strip-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`stamp ${failed ? "fail" : "pass"}`}>{failed ? `FAIL ${failed}` : "PASS"}</span>
        <span className="verdict-dots" aria-hidden>
          {checks.map((c) => (
            <i key={c.label} className={c.ok === null ? "na" : c.ok ? "ok" : "bad"} />
          ))}
        </span>
        <span className="muted small">
          {passed}/{checks.length} checks
        </span>
        <ChevronDown size={14} className="verdict-strip-chevron" />
      </button>
      {open && (
        <ul className="verdict-checks">
          {checks.map((c, i) => (
            <li key={c.label} style={{ "--i": i } as CSSProperties}>
              <span className={`verdict-mark ${c.ok === null ? "na" : c.ok ? "ok" : "bad"}`}>
                {c.ok === null ? <Minus size={10} strokeWidth={3} /> : c.ok ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
              </span>
              <span className="verdict-label">{c.label}</span>
              <span className="verdict-note">{c.note}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
