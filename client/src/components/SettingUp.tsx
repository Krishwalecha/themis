import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImportPanel, useOpenImport } from "./ImportPanel";

const LINES = ["checking session", "loading monitors", "syncing environments", "ready"];
// the tiled T from the logo, in build order, then the dot
const T = [0, 1, 2, 3, 4, 7, 12, 17, 22];
const DOT = 24;

export const SettingUp = ({ next, name, isNew }: { next: string; name: string; isNew: boolean }) => {
  const navigate = useNavigate();
  const [line, setLine] = useState(0);
  // new accounts get an optional "bring your API in" step after the animation
  const [importing, setImporting] = useState(false);
  const openImport = useOpenImport();
  const total = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 800 : 3000;

  useEffect(() => {
    const step = total / LINES.length;
    const timers = LINES.slice(1).map((_, i) => window.setTimeout(() => setLine(i + 1), step * (i + 1)));
    timers.push(window.setTimeout(() => (isNew ? setImporting(true) : navigate(next, { replace: true })), total));
    return () => timers.forEach(clearTimeout);
  }, [navigate, next, total, isNew]);

  const first = name.trim().split(/\s+/)[0] || "there";
  const done = line === LINES.length - 1;

  if (importing)
    return (
      <div className="setup onboard">
        <div className="onboard-card">
          <span className="eyebrow">Optional</span>
          <h1>
            Bring your API in<span className="wordmark-dot">.</span>
          </h1>
          <p className="muted">
            Paste a curl command, or import a Postman collection or an OpenAPI file. Themis turns it into a collection you can run, monitor and validate. You can
            always do this later from Collections.
          </p>
          <ImportPanel
            autoFocus
            onImported={openImport}
            actions={
              <button type="button" className="btn ghost" onClick={() => navigate(next, { replace: true })}>
                Skip for now
              </button>
            }
          />
        </div>
      </div>
    );

  return (
    <div className="setup" role="status" aria-live="polite" style={{ ["--setup-ms" as string]: `${total}ms` }}>
      <div className="setup-tiles" aria-hidden>
        {Array.from({ length: 25 }, (_, i) => {
          const order = T.indexOf(i);
          const cls = i === DOT ? "dot" : order >= 0 ? "on" : "";
          const delay = i === DOT ? 0.78 : order >= 0 ? (order / T.length) * 0.7 : 0;
          return <i key={i} className={cls} style={{ animationDelay: `calc(var(--setup-ms) * ${delay})` }} />;
        })}
      </div>
      <h1>
        {isNew ? "Setting up" : "Welcome back"}, {first}
        <span className="wordmark-dot">.</span>
      </h1>
      <p className="setup-line mono">
        <span className="muted">GET</span> /{LINES[line].replace(/ /g, "-")}
        <span className={`setup-tag${done ? " ok" : ""}`}>{done ? "200 PASS" : "···"}</span>
      </p>
    </div>
  );
};
