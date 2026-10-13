import { timeAgo } from "../lib/format";
import type { ContractChange, ContractValidation, ContractVerdict } from "../lib/types";
import { AiSummaryCard } from "./AiSummaryCard";

// Pass / fail / skipped summary plus violations and drift for one validation
// Is the API keeping this contract right now? Taken from the newest check, which must be against the current version
export const ContractStatus = ({ verdict, version }: { verdict?: ContractVerdict | null; version: number }) => {
  const when = verdict ? `last checked ${timeAgo(verdict.at)}` : undefined;
  if (!verdict)
    return (
      <span className="pill pill-pending" title="Send a request with this contract, or validate a response below">
        <span className="pill-dot" aria-hidden />
        Not checked yet
      </span>
    );
  if ((verdict.contractVersion ?? 0) < version)
    return (
      <span className="pill pill-pending" title={`The newest check was against v${verdict.contractVersion}; ${when}`}>
        <span className="pill-dot" aria-hidden />
        Not checked against v{version} yet
      </span>
    );
  return verdict.valid ? (
    <span className="pill pill-up" title={when}>
      <span className="pill-dot" aria-hidden />
      API matches v{version}
    </span>
  ) : (
    <span className="pill pill-down" title={when}>
      <span className="pill-dot" aria-hidden />
      {verdict.errorCount} error{verdict.errorCount === 1 ? "" : "s"} against v{version}
    </span>
  );
};

export const ContractResult = ({ result, name }: { result: ContractValidation; name?: string }) => {
  const state = result.skipped && result.errors.length === 0 ? "skipped" : result.valid ? "pass" : "fail";
  return (
    <div className={`contract-result contract-${state}`}>
      <div className="contract-result-head">
        <span className={`pill ${state === "pass" ? "pill-up" : state === "fail" ? "pill-down" : "pill-pending"}`}>
          <span className="pill-dot" aria-hidden />
          {state === "pass"
            ? "Matches contract"
            : state === "fail"
              ? `${result.errors.length} violation${result.errors.length === 1 ? "" : "s"}`
              : "Not checked"}
        </span>
        {name && <span className="strong small">{name}</span>}
        {result.matched && (
          <span className="mono small muted">
            {result.matched.method} {result.matched.path} → {result.matched.status}
          </span>
        )}
      </div>
      {result.skipped && <p className="hint">{result.skipped}</p>}
      {result.errors.length > 0 && (
        <ul className="violation-list">
          {result.errors.map((e, i) => (
            <li key={i}>
              <span className="mono">{e.path}</span> {e.message}
            </li>
          ))}
        </ul>
      )}
      {result.drift.length > 0 && (
        <div className="drift">
          <div className="small strong">
            Drift: {result.drift.length} undocumented field{result.drift.length === 1 ? "" : "s"}
          </div>
          <ul className="violation-list drift-list">
            {result.drift.map((d, i) => (
              <li key={i}>
                <span className="mono">{d.path}</span> is returned but not in the contract
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.validationId && (!result.valid || result.drift.length > 0) && (
        <AiSummaryCard target={{ targetType: "contractValidation", targetId: result.validationId }} title="Explain this violation" compact />
      )}
    </div>
  );
};

// what kind of edit a change is, in words
const CHANGE_LABEL: Record<string, string> = {
  "type-changed": "Type",
  "format-changed": "Format",
  "enum-changed": "Values",
  "property-added": "Added",
  "property-removed": "Removed",
  "required-added": "Now required",
  "required-removed": "Optional",
  "parameter-added": "Parameter",
  "parameter-removed": "Parameter",
  "parameter-required": "Parameter",
  "operation-added": "Endpoint",
  "operation-removed": "Endpoint",
  "response-added": "Response",
  "response-removed": "Response",
};

// Changes between two contract versions. "Breaking" is about compatibility, not health: it means code written
// against the previous version may need updating. Whether the API passes is the version's own verdict.
export const ChangeList = ({ changes }: { changes: ContractChange[] }) => {
  if (!changes.length) return <p className="muted small">No changes.</p>;
  return (
    <ul className="change-list">
      {changes.map((c, i) => (
        <li key={i}>
          <span className="chip">{CHANGE_LABEL[c.type] ?? "Changed"}</span>
          {c.location && <span className="mono small muted">{c.location}</span>}
          {c.path && <span className="mono small">{c.path}</span>}
          <span className="small">{c.message}</span>
          {c.breaking && (
            <span className="change-compat small" title="Clients written for the previous version may need updating">
              affects older clients
            </span>
          )}
        </li>
      ))}
    </ul>
  );
};
