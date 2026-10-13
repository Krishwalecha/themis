import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Check, FileCode2, LoaderCircle, Menu, Play, ScrollText, Search, Send, X } from "lucide-react";
import { cn } from "./lib";

type Assertion = { label: string; ok: boolean; note: string };
type Req = {
  id: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  status: number;
  ms: number;
  body: string[];
  checks: Assertion[];
  summary: string;
};

const REQUESTS: Req[] = [
  {
    id: "orders",
    method: "GET",
    path: "/v1/orders?limit=2",
    status: 200,
    ms: 84,
    body: [
      "{",
      '  "data": [',
      '    { "id": "ord_9f2", "total": 4200, "currency": "usd" },',
      '    { "id": "ord_a71", "total": "18.50", "currency": "usd" }',
      "  ],",
      '  "has_more": true',
      "}",
    ],
    checks: [
      { label: "status is 2xx", ok: true, note: "200" },
      { label: "matches orders.list@v3", ok: false, note: "data[1].total" },
      { label: "latency < 300ms", ok: true, note: "84ms" },
      { label: "has_more is boolean", ok: true, note: "true" },
    ],
    summary: "data[1].total came back as a string. Contract v3 says integer cents; the serializer for legacy orders still formats money as decimals.",
  },
  {
    id: "login",
    method: "POST",
    path: "/v1/auth/login",
    status: 200,
    ms: 142,
    body: ["{", '  "user": { "id": "usr_31c", "email": "ada@acme.dev" },', '  "expires_in": 604800', "}"],
    checks: [
      { label: "status is 2xx", ok: true, note: "200" },
      { label: "matches auth.login@v1", ok: true, note: "6 fields" },
      { label: "sets session cookie", ok: true, note: "httpOnly" },
      { label: "latency < 300ms", ok: true, note: "142ms" },
    ],
    summary: "Clean run. Response matches the contract, the session cookie is httpOnly and SameSite=Lax, and latency is well inside budget.",
  },
  {
    id: "invoice",
    method: "PATCH",
    path: "/v1/invoices/inv_12",
    status: 500,
    ms: 1310,
    body: ["{", '  "error": "internal_error",', '  "request_id": "req_7c0e"', "}"],
    checks: [
      { label: "status is 2xx", ok: false, note: "500" },
      { label: "matches invoices.update@v2", ok: false, note: "missing data" },
      { label: "latency < 300ms", ok: false, note: "1310ms" },
      { label: "has request_id", ok: true, note: "req_7c0e" },
    ],
    summary: "Failing since 14:02. The monitor caught three 500s in a row; all share a timeout talking to the tax service before the write.",
  },
];

const METHOD_TONE = { GET: "text-add", POST: "text-accent", PATCH: "text-[#d8b4fe]" } as const;

// Themis's request workspace in miniature: pick a request, send it, watch the verdict land
export const WorkspaceDemo = () => {
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("done");
  const [shown, setShown] = useState(REQUESTS[0].checks.length);
  const timers = useRef<number[]>([]);
  const req = REQUESTS[active];
  const pass = req.checks.every((c) => c.ok);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const send = (index = active) => {
    clear();
    setActive(index);
    setPhase("sending");
    setShown(0);
    const n = REQUESTS[index].checks.length;
    timers.current.push(window.setTimeout(() => setPhase("done"), 650));
    for (let i = 1; i <= n; i++) timers.current.push(window.setTimeout(() => setShown(i), 650 + i * 160));
  };

  useEffect(() => clear, []);

  return (
    <div className="overflow-hidden rounded-[12px] border border-paper/10 bg-ink text-paper shadow-[0_60px_120px_-40px_rgba(0,0,0,0.9)]">
      {/* phones: the app's own mobile top bar */}
      <div className="flex h-12 items-center gap-3 border-b border-paper/8 px-4 sm:hidden">
        <Menu size={16} className="text-paper/60" />
        <span className="flex items-center gap-1.5 font-mono text-[12px] text-paper">
          <Send size={12} className="text-accent" />
          workspace
        </span>
        <span className="ml-auto flex items-center gap-1.5 rounded-[5px] border border-paper/10 px-2 py-1 font-mono text-[10.5px] text-paper/55">
          <span className="size-1.5 bg-add" />
          12 live
        </span>
        <Search size={15} className="text-paper/60" />
      </div>
      {/* tablet and desktop: window chrome */}
      <div className="hidden h-11 items-center gap-2.5 border-b border-paper/8 px-4 sm:flex">
        <span className="flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-2.5 rounded-full bg-paper/10" />
          ))}
        </span>
        <span className="ml-3 text-[13.5px] font-[640] tracking-[-0.03em]">
          themis<span className="text-accent">.</span>
        </span>
        <span className="font-mono text-[11px] text-paper/30">/ acme-api / production</span>
        <span className="ml-auto flex items-center gap-2 whitespace-nowrap font-mono text-[11px] text-paper/40">
          <span className="size-1.5 bg-add" /> 12 monitors live
        </span>
      </div>

      {/* phones and tablets without the sidebar: requests as chips */}
      <div className="flex flex-wrap gap-1.5 border-b border-paper/8 px-3 py-2.5 md:hidden">
        {REQUESTS.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onClick={() => send(i)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[5px] border px-2.5 py-1.5 font-mono text-[11px] transition-colors",
              i === active ? "border-paper/20 bg-paper/[0.06] text-paper" : "border-paper/8 text-paper/50",
              // two fit on a phone in one row: one failing, one passing
              i > 1 && "hidden sm:flex",
            )}
          >
            <span className={cn("text-[9.5px] font-medium", METHOD_TONE[r.method])}>{r.method}</span>
            {r.path.split("?")[0].replace("/v1/", "")}
            <span className={cn("size-[6px]", r.checks.every((c) => c.ok) ? "bg-add" : "bg-accent")} />
          </button>
        ))}
      </div>

      <div className="grid min-h-0 grid-cols-1 sm:min-h-[460px] md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* collection */}
        <aside className="hidden border-r border-paper/8 p-2.5 md:block">
          <div className="type-label px-2 pb-2 pt-1 text-paper/30">Collection</div>
          <ul className="space-y-0.5 font-mono text-[11.5px]">
            {REQUESTS.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => send(i)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[5px] px-2 py-2 text-left transition-colors",
                    i === active ? "bg-paper/[0.06] text-paper" : "text-paper/55 hover:bg-paper/[0.03] hover:text-paper",
                  )}
                >
                  <span className={cn("w-10 shrink-0 text-[10px] font-medium", METHOD_TONE[r.method])}>{r.method}</span>
                  <span className="truncate">{r.path.split("?")[0]}</span>
                  <span className={cn("ml-auto size-[7px] shrink-0", r.checks.every((c) => c.ok) ? "bg-add" : "bg-accent")} />
                </button>
              </li>
            ))}
          </ul>
          <div className="type-label mt-6 px-2 pb-2 text-paper/30">Contracts</div>
          <ul className="space-y-0.5 font-mono text-[11.5px] text-paper/45">
            {["orders.list@v3", "auth.login@v1", "invoices.update@v2"].map((c) => (
              <li key={c} className="flex items-center gap-2 px-2 py-1.5">
                <FileCode2 size={13} className="shrink-0 text-paper/30" />
                {c}
              </li>
            ))}
          </ul>
        </aside>

        {/* request + response */}
        <section className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2 border-b border-paper/8 p-3">
            <div className="flex h-9 min-w-0 flex-1 items-center gap-3 rounded-[6px] border border-paper/10 bg-ink-2 px-3 font-mono text-[12.5px]">
              <span className={cn("font-medium", METHOD_TONE[req.method])}>{req.method}</span>
              <span className="truncate text-paper/80">
                <span className="text-paper/35">{"{{base}}"}</span>
                {req.path}
              </span>
            </div>
            <button
              type="button"
              onClick={() => send()}
              className="flex h-9 shrink-0 items-center gap-2 rounded-[6px] bg-paper px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-accent"
            >
              {phase === "sending" ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={12} fill="currentColor" />}
              Send
            </button>
          </div>
          <div className="flex items-center gap-4 border-b border-paper/8 px-4 py-2 font-mono text-[11px] text-paper/40">
            <span className="text-paper/70">Response</span>
            {phase === "done" && (
              <>
                <span className={req.status < 300 ? "text-add" : "text-del"}>{req.status}</span>
                <span>{req.ms} ms</span>
                <span>{req.body.join("").length * 3} B</span>
              </>
            )}
          </div>
          <div className="relative min-h-[170px] flex-1 overflow-hidden sm:min-h-[260px]">
            {phase === "sending" ? (
              <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
                <span className="block h-full w-1/3 animate-[scan_0.9s_linear_infinite] bg-accent" />
              </div>
            ) : (
              <motion.pre
                key={`${req.id}-${phase}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden p-3 font-mono text-[11px] leading-[1.7] sm:p-4 sm:text-[12.5px] sm:leading-[1.75]"
              >
                {req.body.map((line, i) => {
                  const bad = !pass && req.id === "orders" && line.includes('"18.50"');
                  return (
                    <div key={i} className={cn("flex", bad && "-mx-4 bg-del/10 px-4")}>
                      <span className="mr-3 w-4 shrink-0 select-none text-right text-paper/20 sm:mr-4 sm:w-5">{i + 1}</span>
                      <span className={cn("min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]", bad ? "text-del" : "text-paper/75")}>{line}</span>
                    </div>
                  );
                })}
              </motion.pre>
            )}
          </div>
        </section>

        {/* verdict */}
        <aside className="hidden border-l border-paper/8 lg:flex lg:flex-col">
          <div className="flex items-center gap-2.5 border-b border-paper/8 px-4 py-3">
            <span className="type-label text-paper/40">Verdict</span>
            <AnimatePresence mode="wait">
              {phase === "done" && shown === req.checks.length && (
                <motion.span
                  key={req.id}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className={cn("ml-auto rounded-[4px] px-2 py-0.5 font-mono text-[11px] font-medium text-ink", pass ? "bg-add" : "bg-accent")}
                >
                  {pass ? "PASS" : `FAIL ${req.checks.filter((c) => !c.ok).length}`}
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          <ul className="space-y-1 p-3 text-[12.5px]">
            {req.checks.map((c, i) => (
              <li
                key={`${req.id}-${c.label}`}
                className={cn("flex items-center gap-2.5 rounded-[5px] px-2 py-2 transition-opacity duration-300", i < shown ? "opacity-100" : "opacity-15")}
              >
                <span className={cn("grid size-4 shrink-0 place-items-center rounded-[3px]", c.ok ? "bg-add/15 text-add" : "bg-accent/15 text-accent")}>
                  {c.ok ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                </span>
                <span className="truncate text-paper/80">{c.label}</span>
                <span className="ml-auto shrink-0 font-mono text-[10.5px] text-paper/35">{c.note}</span>
              </li>
            ))}
          </ul>
          <div className="mx-3 mt-auto mb-3 rounded-[7px] border border-paper/8 bg-paper/[0.03] p-3">
            <div className="flex items-center gap-2 text-[11px] text-paper/45">
              <ScrollText size={12} className="text-accent" />
              <span className="type-label">Summary</span>
              <span className="ml-auto font-mono">ai</span>
            </div>
            <p
              className={cn("mt-2 text-[12.5px] leading-[1.55] text-paper/70 transition-opacity duration-500", phase === "done" ? "opacity-100" : "opacity-0")}
            >
              {req.summary}
            </p>
          </div>
        </aside>
      </div>

      {/* below desktop the verdict docks at the bottom, like the app's verdict sheet */}
      <div className="flex items-center gap-2.5 border-t border-paper/8 px-4 py-3 lg:hidden">
        <span className="type-label text-paper/40">Verdict</span>
        <span className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-paper/60">
          {phase === "done" ? `${req.checks.filter((c) => c.ok).length} of ${req.checks.length} checks passed` : "judging…"}
        </span>
        {phase === "done" && (
          <span className={cn("ml-auto shrink-0 rounded-[4px] px-2 py-0.5 font-mono text-[11px] font-medium text-ink", pass ? "bg-add" : "bg-accent")}>
            {pass ? "PASS" : `FAIL ${req.checks.filter((c) => !c.ok).length}`}
          </span>
        )}
      </div>

      {/* monitor strip */}
      <div className="hidden items-center gap-3 border-t border-paper/8 px-4 py-2.5 font-mono text-[11px] text-paper/40 sm:flex">
        <Activity size={12} className="text-accent" />
        <span className="shrink-0">orders.list · every 1m</span>
        <span className="flex min-w-0 flex-1 items-end gap-[3px] overflow-hidden">
          {Array.from({ length: 64 }, (_, i) => {
            const down = i === 41 || i === 42;
            return <span key={i} className={cn("h-3 w-[3px] shrink-0", down ? "bg-accent" : "bg-add/60")} />;
          })}
        </span>
        <span className="shrink-0 text-paper/60">99.97%</span>
      </div>
    </div>
  );
};
