import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import { ArrowDown, ArrowUpRight, Braces, Gauge, KeyRound, Mail, Menu, Plus, ServerCog, X, ArrowRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import { DitherShader } from "./DitherShader";
import { DitherWordmark } from "./DitherWordmark";
import { comment, PROMPT, preferredShell, rememberShell, SHELLS, toCommand, type Req, type Shell } from "../lib/shell";
import { API_BASE, cn } from "./lib";
import { CopyButton, Logo, Note, SectionLabel, SmartLink, buttonClass } from "./primitives";
import { CountUp, DitherReveal, FadeIn, RevealText } from "./reveal";
import { MATRIX } from "./shaders";

import { WorkspaceDemo } from "./WorkspaceDemo";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#verdict", label: "Why Themis" },
  { href: "#cli", label: "API" },
  { href: "#faq", label: "FAQ" },
];

const STATUS_LINES = ["all monitors green", "judging 1,204 responses", "p95 142 ms · calm", "0 incidents · suspicious", "contracts holding"];

// The nav's status line keeps talking: one dry remark every few seconds
const NavStatus = () => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % STATUS_LINES.length), 3800);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="relative inline-flex h-4 w-[24ch] overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={i}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -12, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="absolute whitespace-nowrap"
        >
          {STATUS_LINES[i]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
};

export const Nav = () => {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [menu, setMenu] = useState(false);
  const { user, status } = useAuth();
  const cta = user ? { href: "/dashboard", label: "Open dashboard" } : { href: "/signup", label: "Start testing" };

  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    setScrolled(y > 24);
    setHidden(y > prev && y > 560 && !menu);
  });

  return (
    <motion.header className="fixed inset-x-0 top-0 z-50" animate={{ y: hidden ? "-100%" : "0%" }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
      <div
        className={cn(
          "border-b transition-[background-color,border-color,backdrop-filter] duration-300",
          scrolled || menu ? "border-paper/10 bg-ink/95" : "border-transparent bg-transparent",
        )}
      >
        <nav aria-label="Primary" className="container-x flex h-[var(--nav-h)] items-center gap-8">
          <SmartLink href="#top" aria-label="Themis home" className="shrink-0">
            <Logo />
          </SmartLink>
          <ul className="hidden items-center gap-1 font-mono text-[12.5px] lg:flex">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <SmartLink href={l.href} className="rounded-[4px] px-2.5 py-1.5 text-paper/55 transition-colors hover:bg-paper/5 hover:text-paper">
                  {l.label.toLowerCase()}
                </SmartLink>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <span className="mr-2 hidden items-center gap-2 font-mono text-[11.5px] text-paper/45 xl:flex">
              <span className="relative flex size-1.5">
                <span className="absolute inset-0 animate-ping bg-add opacity-60" />
                <span className="relative size-1.5 bg-add" />
              </span>
              <NavStatus />
            </span>
            {status !== "loading" && !user && (
              <a href="/login" className="hidden h-9 items-center rounded-[4px] px-3 text-[13.5px] text-paper/60 transition-colors hover:text-paper md:flex">
                Sign in
              </a>
            )}
            <a href={cta.href} className={cn(buttonClass("accent"), "hidden sm:inline-flex", status === "loading" && "invisible")}>
              {cta.label}
              <ArrowUpRight size={14} strokeWidth={2.4} />
            </a>
            <button
              type="button"
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
              className="grid size-9 place-items-center rounded-[4px] border border-paper/12 text-paper/80 lg:hidden"
            >
              {menu ? <X size={16} /> : <Menu size={16} />}
            </button>
          </div>
        </nav>
        <AnimatePresence>
          {menu && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="container-x overflow-hidden lg:hidden"
            >
              {[...NAV_LINKS, cta].map((l) => (
                <li key={l.href} className="border-t border-paper/8 first:border-t-0">
                  <SmartLink href={l.href} onClick={() => setMenu(false)} className="type-title flex h-14 items-center text-2xl text-paper/85">
                    {l.label}
                  </SmartLink>
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
};

const TICKS = [
  { method: "GET", path: "/v1/orders", status: 200, ms: 84, pass: true },
  { method: "POST", path: "/v1/auth/login", status: 200, ms: 142, pass: true },
  { method: "PATCH", path: "/v1/invoices/inv_12", status: 500, ms: 1310, pass: false },
  { method: "GET", path: "/v1/users/me", status: 200, ms: 61, pass: true },
  { method: "GET", path: "/healthz", status: 200, ms: 12, pass: true },
  { method: "DELETE", path: "/v1/carts/c_81", status: 204, ms: 97, pass: true },
  { method: "BREW", path: "/coffee", status: 418, ms: 3, pass: true },
];

// A live-looking log line that rolls over every couple of seconds
const VerdictTicker = ({ onTick }: { onTick?: (tick: (typeof TICKS)[number]) => void }) => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % TICKS.length), 2200);
    return () => clearInterval(id);
  }, []);
  useEffect(() => onTick?.(TICKS[i]), [i, onTick]);
  const t = TICKS[i];
  return (
    <div className="inline-flex h-8 max-w-full items-center gap-3 overflow-hidden rounded-[4px] border border-paper/12 bg-ink/90 pl-1 pr-3 font-mono text-[12px]">
      <span className="rounded-[2px] bg-paper/8 px-1.5 py-0.5 text-[10.5px] text-paper/50">live</span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={i}
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -14, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center gap-3 whitespace-nowrap"
        >
          <span className="text-paper/45">{t.method}</span>
          <span className="text-paper/85">{t.path}</span>
          <span className={t.status < 400 ? "text-add" : "text-del"}>{t.status}</span>
          <span className="hidden text-paper/35 sm:inline">{t.ms}ms</span>
          <span className={cn("rounded-[2px] px-1.5 py-px text-[10.5px] font-medium text-ink", t.pass ? "bg-add" : "bg-accent")}>
            {t.pass ? "PASS" : "FAIL"}
          </span>
        </motion.span>
      </AnimatePresence>
    </div>
  );
};

// Primary call to action, aware of whether you're already signed in
const PrimaryCta = ({ size = "lg" }: { size?: "md" | "lg" }) => {
  const { user } = useAuth();
  return (
    <a href={user ? "/workspace" : "/signup"} className={buttonClass("accent", size)}>
      {user ? "Open workspace" : "Start testing free"}
      <ArrowUpRight size={16} strokeWidth={2.4} />
    </a>
  );
};

// signed out: try it right away, no account; signed in: the curl section
const SecondaryCta = () => {
  const { user } = useAuth();
  return user ? (
    <SmartLink href="#cli" className={buttonClass("ghost-dark", "lg")}>
      <span className="font-mono text-[13px] text-accent">$</span>
      Use it from curl
      <ArrowDown size={15} />
    </SmartLink>
  ) : (
    <a href="/try" className={buttonClass("ghost-dark", "lg")}>
      Try it without signing up
      <ArrowRight size={15} />
    </a>
  );
};

const cellAt = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const size = (5 * Math.max(1, Math.round(3 * dpr))) / dpr;
  const x = Math.floor((clientX - r.left) / size);
  const y = Math.floor((r.bottom - clientY) / size);
  return { x, y };
};

export const Hero = () => {
  const artRef = useRef<HTMLDivElement>(null);
  const ping = useRef({ x: -99, y: -99, at: -1e9 });
  const uniforms = useRef<Record<string, number[] | (() => number[])>>({
    u_ping: () => [ping.current.x, ping.current.y, (performance.now() - ping.current.at) / 1000],
  });

  // when the ticker reports a failure, it lands on a cell in the matrix
  const onTick = useCallback((tick: (typeof TICKS)[number]) => {
    const canvas = artRef.current?.querySelector("canvas");
    if (tick.pass || !canvas) return;
    const r = artRef.current!.getBoundingClientRect();
    const c = cellAt(canvas, r.left + r.width * (0.62 + Math.random() * 0.3), r.top + r.height * (0.2 + Math.random() * 0.4));
    ping.current = { x: c.x, y: c.y, at: performance.now() };
  }, []);

  const stageRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: stageRef, offset: ["start end", "start 0.2"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], [18, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [0.9, 1]);

  return (
    <section id="top" className="relative bg-ink text-paper">
      <div ref={artRef} className="relative">
        {/* the lanes run on behind the window's top edge */}
        <DitherShader
          fragment={MATRIX}
          pixel={3}
          extra={uniforms}
          className="absolute inset-x-0 top-0 -bottom-[clamp(9rem,16vh,12rem)] [mask-image:linear-gradient(to_bottom,transparent_45%,black_75%)] md:[mask-image:none]"
        />

        <div className="container-x relative pt-[calc(var(--nav-h)+clamp(2.5rem,9vh,6.5rem))]">
          <FadeIn y={8}>
            <VerdictTicker onTick={onTick} />
          </FadeIn>

          <h1 className="type-display mt-8 text-[clamp(2.9rem,8.6vw,8.25rem)]">
            <RevealText lines={["Every response", "gets a verdict."]} delay={0.1} lineClassNames={[undefined, "text-paper/35"]} />
          </h1>

          <div className="mt-9 grid gap-8 md:mt-11 md:grid-cols-[minmax(0,46ch)_auto] md:items-end md:justify-between">
            <FadeIn delay={0.45}>
              <p className="text-[17px] leading-[1.55] text-fog md:text-[18px]">
                I'm Themis, an API testing and monitoring workspace. I test your API, watch it while you sleep and hold every response to the contract you wrote.
                When something breaks, I tell you what changed. You won't have to read the logs. I already did.
              </p>
            </FadeIn>
            <FadeIn delay={0.55}>
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryCta />
                <SecondaryCta />
              </div>
            </FadeIn>
          </div>
        </div>
      </div>

      <div ref={stageRef} className="container-x relative mt-[clamp(3rem,8vh,5rem)] [perspective:1800px]">
        <motion.div
          style={{ rotateX, scale, transformOrigin: "50% 0%", willChange: "transform" }}
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.6 }}
        >
          <WorkspaceDemo />
        </motion.div>
      </div>
    </section>
  );
};

const METRICS = [
  { key: "monitor.interval", value: 10, unit: "s", label: "The tightest schedule I run on. I don't nap.", seed: 1 },
  { key: "uptime.window", value: 99.9, decimals: 1, unit: "%", label: "Uptime, tracked to the minute. I don't round up.", seed: 2 },
  { key: "tools.replaced", value: 4, prefix: "×", label: "Tools I replace, including whoever reads the logs.", seed: 3 },
  { key: "self_host.cost", value: 0, prefix: "$", label: "To self-host me. Bring a server, I travel light.", seed: 4 },
];

// A tiny status strip under each metric: steady bars with the odd ember blip
const MiniPulse = ({ seed }: { seed: number }) => {
  return (
    <span aria-hidden className="mt-6 flex h-5 items-end gap-[3px]">
      {Array.from({ length: 28 }, (_, i) => {
        const h = 0.45 + 0.3 * Math.abs(Math.sin(i * 0.7 + seed * 1.9)) + 0.15 * Math.sin(i * 2.3 + seed);
        const blip = (i + seed * 5) % 23 === 0;
        return (
          <span
            key={i}
            className={cn("w-[3px] transition-colors duration-300", blip ? "bg-accent" : "bg-paper/20 group-hover:bg-paper/45")}
            style={{ height: `${Math.round((blip ? 1 : h) * 100)}%` }}
          />
        );
      })}
    </span>
  );
};

export const Metrics = () => {
  return (
    <section aria-label="Themis by the numbers" className="bg-ink pb-20 pt-20 text-paper md:pb-24 md:pt-28">
      <div className="container-x">
        <div className="mb-5 flex items-center gap-3 font-mono text-[11.5px] text-paper/40">
          <span className="size-1.5 bg-add" />
          themis status --summary
          <span aria-hidden className="h-px flex-1 bg-paper/10" />
          <span>4 / 4 ok</span>
        </div>
        <Note className="mb-6">the short version, in four numbers.</Note>
        <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-[6px] border border-paper/10 bg-paper/10 sm:grid-cols-2 lg:grid-cols-4">
          {METRICS.map((m, i) => (
            <FadeIn key={m.key} delay={i * 0.08} className="group bg-ink p-6 transition-colors duration-300 hover:bg-ink-2">
              <dt className="flex items-center justify-between font-mono text-[11px] text-paper/40">
                <span>{m.key}</span>
                <span className="text-add opacity-0 transition-opacity duration-300 group-hover:opacity-100">ok</span>
              </dt>
              <dd>
                <div className="mt-6 text-[clamp(3rem,5vw,4.5rem)] font-[620] leading-none tracking-[-0.05em]">
                  {m.prefix && <span className="text-accent">{m.prefix}</span>}
                  <CountUp to={m.value} decimals={m.decimals} />
                  {m.unit && <span className="ml-1 text-[0.45em] text-paper/45">{m.unit}</span>}
                </div>
                <MiniPulse seed={m.seed} />
                <p className="mt-4 max-w-[26ch] text-[13.5px] leading-snug text-paper/50">{m.label}</p>
              </dd>
            </FadeIn>
          ))}
        </dl>
      </div>
    </section>
  );
};

// The old way, struck out; the Themis way, added
const DIFF: Array<[string, string]> = [
  ["A 200 means it works.", "A 200 with the wrong shape is still a broken API."],
  ["Check the dashboard every morning.", "Get told the minute a check starts failing."],
  ["Read 400 log lines to find out why.", "Read one paragraph: what changed, since when, why."],
];
const PROOF = [
  { icon: Braces, title: "Schema-aware", body: "I read OpenAPI 3.1 and JSON Schema. Every run, every field." },
  { icon: Gauge, title: "Latency budgets", body: "p50, p95 and uptime per monitor. I keep 90 days of receipts." },
  { icon: KeyRound, title: "Isolated tenants", body: "Your requests are yours. I scope every query to its owner." },
  { icon: ServerCog, title: "Self-hostable", body: "Run me on your own server, or let me host. No hard feelings." },
];

export const Manifesto = () => {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.7"] });

  return (
    <section id="verdict" className="graph-paper py-24 text-ink md:py-36">
      <div className="container-x">
        <SectionLabel>Before / After</SectionLabel>
        <div ref={ref} className="mt-10 overflow-hidden rounded-[6px] border border-ink/15 bg-paper shadow-[0_40px_80px_-60px_rgba(10,10,9,0.5)]">
          <div className="flex h-11 items-center gap-3 border-b border-ink/12 px-5 font-mono text-[12px] text-ink/55">
            <span className="text-ink">how-you-watch-apis.md</span>
            <span className="text-del">−{DIFF.length}</span>
            <span className="text-[#2f7a43]">+{DIFF.length}</span>
            <span className="ml-auto hidden sm:inline">themis left 3 comments · nit: you deserve better</span>
            <span className="rounded-[3px] bg-ink px-2 py-0.5 text-[10.5px] text-paper">approved</span>
          </div>
          <div className="py-4">
            {DIFF.map(([before, after], i) => (
              <DiffPair key={i} before={before} after={after} index={i} total={DIFF.length} progress={scrollYProgress} />
            ))}
          </div>
        </div>
        <Note tone="light" className="mt-5">
          rebased your habits onto main. no conflicts.
        </Note>
        <ul className="mt-14 grid grid-cols-1 border border-ink/12 bg-paper sm:grid-cols-2 lg:grid-cols-4">
          {PROOF.map(({ icon: Icon, title, body }, i) => (
            <FadeIn
              as="li"
              key={title}
              delay={i * 0.07}
              className="group relative border-b border-ink/12 p-6 transition-colors duration-300 last:border-b-0 hover:bg-ink hover:text-paper sm:odd:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"
            >
              <Icon size={20} className="transition-colors group-hover:text-accent" />
              <div className="type-label mt-5">{title}</div>
              <p className="mt-2 max-w-[28ch] text-[14.5px] leading-snug opacity-60">{body}</p>
            </FadeIn>
          ))}
        </ul>
      </div>
    </section>
  );
};

// One review hunk: the old line gets struck out, then the new line slides in
const DiffPair = ({
  before,
  after,
  index,
  total,
  progress,
}: {
  before: string;
  after: string;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) => {
  const start = index / total;
  const mid = start + 0.45 / total;
  const end = start + 0.9 / total;
  const strike = useTransform(progress, [start, mid], [0, 1]);
  const oldFade = useTransform(progress, [start, mid], [1, 0.45]);
  const newIn = useTransform(progress, [mid, end], [0, 1]);
  const newX = useTransform(progress, [mid, end], [-24, 0]);
  const gutter = (n: number) => <span className="w-10 shrink-0 select-none pt-[0.35em] text-right font-mono text-[12px] text-ink/30">{n}</span>;
  return (
    <div className="type-title text-[clamp(1.5rem,3.2vw,2.9rem)] leading-[1.15]">
      <motion.div className="flex gap-4 bg-del/10 py-2 pr-6" style={{ opacity: oldFade }}>
        {gutter(index * 2 + 1)}
        <span className="w-6 shrink-0 select-none text-del">−</span>
        <span className="relative text-ink/70">
          {before}
          <motion.span aria-hidden className="absolute left-0 right-0 top-[55%] h-[0.08em] origin-left bg-del" style={{ scaleX: strike }} />
        </span>
      </motion.div>
      <motion.div className="flex gap-4 bg-add/25 py-2 pr-6" style={{ opacity: newIn, x: newX }}>
        {gutter(index * 2 + 2)}
        <span className="w-6 shrink-0 select-none text-[#2f7a43]">+</span>
        <span className="text-ink">{after}</span>
      </motion.div>
    </div>
  );
};

type Line = { kind: "dim"; text: string } | { kind: "req"; req: Req } | { kind: "out" | "ok" | "bad"; text: string };

const SESSIONS: Array<{ id: string; label: string; lines: Line[] }> = [
  {
    id: "run",
    label: "run a request",
    lines: [
      { kind: "dim", text: "sign in once, the session is kept for the next calls" },
      { kind: "req", req: { path: "/api/auth/login", auth: "save", body: '{"email":"you@dev.io","password":"your-password"}' } },
      { kind: "out", text: `{"user":{"id":"66f0…","name":"You","email":"you@dev.io",…}}` },
      { kind: "dim", text: "send anything through Themis, it lands in your history" },
      { kind: "req", req: { path: "/api/requests/execute", auth: "send", body: '{"request":{"url":"https://api.github.com"}}' } },
      { kind: "ok", text: `{"historyId":"66f1c0…","result":{"status":200,…,"timings":{"ttfbMs":71,"totalMs":84}}}` },
    ],
  },
  {
    id: "contract",
    label: "validate a contract",
    lines: [
      { kind: "dim", text: "your contracts and their ids" },
      { kind: "req", req: { path: "/api/contracts", auth: "send" } },
      { kind: "out", text: `{"items":[{"_id":"66f2a1…","name":"orders.list","version":3,…}]}` },
      { kind: "dim", text: "the same call, judged against one of them" },
      {
        kind: "req",
        req: { path: "/api/requests/execute", auth: "send", body: '{"request":{"url":"https://api.acme.dev/v1/orders"},"contractId":"66f2a1…"}' },
      },
      { kind: "bad", text: `{…,"contract":{"name":"orders.list","valid":false,"errors":[{"path":"/data/1/total","message":"must be integer"}]}}` },
    ],
  },
  {
    id: "health",
    label: "watch it",
    lines: [
      { kind: "dim", text: "every monitor, with its last verdict and 24h uptime" },
      { kind: "req", req: { path: "/api/monitors", auth: "send" } },
      { kind: "ok", text: `{"items":[{"name":"orders.list","state":{"status":"up",…},"last24h":{"uptimePct":100,…}},…]}` },
      { kind: "dim", text: "public, no session needed" },
      { kind: "req", req: { path: "/api/health" } },
      { kind: "ok", text: `{"status":"ok","version":"1.0.0","db":"connected","uptimeSec":86400,"scheduler":"running"}` },
    ],
  },
];

const LINE_TONE: Record<Line["kind"], string> = {
  req: "text-paper",
  out: "text-paper/60",
  ok: "text-add",
  bad: "text-del",
  dim: "text-paper/30",
};

export const Cli = () => {
  const [active, setActive] = useState(0);
  const [shell, setShell] = useState<Shell>(preferredShell);
  const session = SESSIONS[active];
  const text = (l: Line) => (l.kind === "req" ? toCommand(l.req, shell, API_BASE) : l.kind === "dim" ? comment(l.text, shell) : l.text);
  const commands = session.lines
    .filter((l) => l.kind === "req")
    .map(text)
    .join("\n\n");
  const pickShell = (s: Shell) => {
    setShell(s);
    rememberShell(s);
  };

  return (
    <section id="cli" className="bg-ink py-24 text-paper md:py-32">
      <div className="container-x grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <SectionLabel>API</SectionLabel>
          <h2 className="type-display mt-8 text-[clamp(2.5rem,5vw,4.75rem)]">
            <RevealText lines={["No SDK.", "Just curl."]} lineClassNames={[undefined, "text-paper/35"]} />
          </h2>
          <FadeIn delay={0.2}>
            <p className="mt-8 max-w-[40ch] text-[17px] leading-[1.55] text-fog">
              Under the hood I'm just JSON over HTTP. Sign in once and script me from a terminal, a cron job or CI. I won't judge your bash. I will judge your
              500s.
            </p>
            <ul className="mt-8 space-y-2.5 font-mono text-[12.5px] text-paper/55">
              {["Same session as the app", "Every run lands in history", "macOS, Linux and Windows"].map((f) => (
                <li key={f} className="flex items-center gap-3">
                  <span className="size-1.5 bg-accent" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-10 hidden md:block">
              <Note>these run against your own server. copy, paste, judge.</Note>
            </div>
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="hidden md:block lg:col-span-7">
          <DitherReveal scale={5} duration={1000} className="overflow-hidden rounded-[8px] border border-paper/10 bg-ink-2">
            <div className="flex min-h-11 flex-wrap items-center gap-1 border-b border-paper/8 px-2 py-1.5">
              {SESSIONS.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(i)}
                  className={cn(
                    "relative h-8 shrink-0 rounded-[4px] px-3 font-mono text-[12px] transition-colors",
                    i === active ? "bg-paper/8 text-paper" : "text-paper/45 hover:text-paper/80",
                  )}
                >
                  {s.label}
                </button>
              ))}
              <CopyButton text={commands} className="ml-auto shrink-0" />
            </div>
            <div className="flex items-center gap-1 border-b border-paper/8 px-2 py-1.5" role="tablist" aria-label="Shell">
              {SHELLS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={s.id === shell}
                  title={s.hint}
                  onClick={() => pickShell(s.id)}
                  className={cn(
                    "h-7 rounded-[4px] px-2.5 font-mono text-[11px] transition-colors",
                    s.id === shell ? "bg-accent/15 text-accent" : "text-paper/40 hover:text-paper/75",
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.pre
                key={`${session.id}-${shell}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="min-h-[380px] p-5 text-[11.5px] leading-[1.8] lg:text-[12.5px]"
              >
                {session.lines.map((l, i) => (
                  <div
                    key={i}
                    className={cn(
                      "whitespace-pre-wrap [overflow-wrap:anywhere]",
                      LINE_TONE[l.kind],
                      (l.kind === "req" || l.kind === "dim") && i > 0 && session.lines[i - 1].kind !== "dim" && "mt-3",
                    )}
                  >
                    {l.kind === "req" && <span className="mr-2 select-none text-accent">{PROMPT[shell]}</span>}
                    {text(l)}
                  </div>
                ))}
                <span className="mt-3 inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] animate-[blink_1s_steps(1)_infinite] bg-accent" />
              </motion.pre>
            </AnimatePresence>
          </DitherReveal>
        </FadeIn>
      </div>
    </section>
  );
};

const GITHUB_URL = "https://github.com/Krishwalecha/themis";

const FAQ: Array<{ q: string; a: ReactNode }> = [
  {
    q: "What is Themis, and why use it?",
    a: "I'm one workspace for the whole life of an API: send requests, group them into collections, monitor them on a schedule and check every response against your OpenAPI or JSON Schema contract. Instead of juggling an API client, an uptime monitor and a schema checker, you get one place that gives every response a clear pass or fail, and tells you what broke, since when and how to fix it. Free to self-host.",
  },
  {
    q: "Can I import my Postman collections?",
    a: "Yes. Import a Postman collection or an OpenAPI file and I turn it into a collection, an environment and, for OpenAPI, a contract. You can also paste any curl command straight into the URL bar.",
  },
  {
    q: "Can I self-host it?",
    a: (
      <>
        Yes. The code and setup live on{" "}
        <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-ink underline decoration-accent underline-offset-4 hover:text-accent">
          GitHub
        </a>
        . If you can run a Node app, you can run me.
      </>
    ),
  },
  {
    q: "How do monitors run?",
    a: "A monitor is a saved request, or a whole collection, on a schedule: as often as every 10 seconds, at set times like weekdays at 09:00, or on a cron expression. I record the latency and every assertion, open an incident when it fails, alert Slack or Discord, and close it when it recovers.",
  },
  {
    q: "What does contract validation check?",
    a: "Every response, against the OpenAPI 3.1 or JSON Schema version you pin. Upload a new version and I'll flag anything breaking before your users find it.",
  },
  {
    q: "Who writes the summaries?",
    a: "An AI model, working only from checks and incidents I actually recorded. If I didn't see it, it isn't in the summary.",
  },
  {
    q: "Is my data kept separate?",
    a: "Yes. Everything I store belongs to your account, and every query I run is scoped to you. Nobody else sees your requests.",
  },
];

export const Faq = () => {
  const [open, setOpen] = useState<number | null>(0);
  const id = useId();
  return (
    <section id="faq" className="graph-paper py-24 text-ink md:py-32">
      <div className="container-x grid grid-cols-1 gap-12 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <SectionLabel>FAQ</SectionLabel>
          <h2 className="type-display mt-8 text-[clamp(2.5rem,4.6vw,4.25rem)]">
            <RevealText lines={["Questions,", "answered."]} lineClassNames={[undefined, "text-ink/35"]} />
          </h2>
          <Note tone="light" className="mt-8">
            ask me anything. I log everything anyway.
          </Note>
        </div>
        <ul className="border-t border-ink/15 lg:col-span-8">
          {FAQ.map((item, i) => {
            const isOpen = open === i;
            return (
              <li key={item.q} className="border-b border-ink/15">
                <h3>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`${id}-${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                    className="group flex w-full items-center gap-6 py-6 text-left"
                  >
                    <span className={cn("font-mono text-[12px] transition-colors", isOpen ? "text-accent" : "text-ink/35")}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="type-title flex-1 text-[clamp(1.15rem,1.8vw,1.4rem)]">{item.q}</span>
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-[4px] border transition-colors",
                        isOpen ? "border-accent bg-accent text-ink" : "border-ink/15 group-hover:border-ink/40",
                      )}
                    >
                      <Plus size={14} strokeWidth={2.6} className={cn("transition-transform duration-300", isOpen && "rotate-45")} />
                    </span>
                  </button>
                </h3>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`${id}-${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="mb-7 ml-[calc(12px+2.25rem)] max-w-[64ch] border-l-2 border-accent pl-4 pr-14 text-[16px] leading-[1.65] text-ink/65">
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};

export const FinalCta = () => {
  return (
    <section id="start" className="bg-ink pt-24 text-paper md:pt-32">
      <div className="container-x">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
          <h2 className="type-display text-[clamp(2.5rem,5.3vw,4.9rem)] lg:col-span-7">
            <RevealText lines={["Point me at an API.", "I'll take it from here."]} lineClassNames={[undefined, "text-paper/35"]} />
          </h2>
          <FadeIn delay={0.2} className="self-end lg:col-span-5">
            <div className="flex flex-wrap gap-3">
              <PrimaryCta />
              <SignInLink />
            </div>
            <Note className="mt-6">I'll be watching. the APIs, not you.</Note>
          </FadeIn>
        </div>
        <div className="mt-20 md:mt-28">
          <DitherWordmark text="themis." />
        </div>
      </div>
    </section>
  );
};

const SignInLink = () => {
  const { user } = useAuth();
  if (user) return null;
  return (
    <a href="/login" className={buttonClass("ghost-dark", "lg")}>
      Sign in
    </a>
  );
};

const FOOTER_COLUMNS = [
  {
    title: "Product",
    links: [
      ["Workspace", "#product"],
      ["Monitors", "#product"],
      ["Contracts", "#product"],
      ["Summaries", "#product"],
    ],
  },
  {
    title: "Developers",
    links: [
      ["curl API", "#cli"],
      ["FAQ", "#faq"],
      ["Self-hosting", GITHUB_URL],
    ],
  },
  {
    title: "Account",
    links: [
      ["Sign in", "/login"],
      ["Create account", "/signup"],
      ["Dashboard", "/dashboard"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ],
  },
] as const;

export const Footer = () => {
  return (
    <footer className="bg-ink text-paper">
      <div className="container-x">
        <div className="grid grid-cols-1 gap-12 border-t border-paper/10 py-16 md:grid-cols-12">
          <div className="md:col-span-6">
            <Logo />
            <p className="mt-4 max-w-[36ch] text-[14px] leading-relaxed text-mute">I test, watch and judge your APIs, so you can get some sleep.</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title} className="md:col-span-2">
              <div className="type-label text-mute">{col.title}</div>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <SmartLink href={href} className="text-fog transition-colors hover:text-accent">
                      {label}
                    </SmartLink>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-paper/10 py-6 font-mono text-[11.5px] text-mute md:flex-row md:items-center md:gap-6">
          <span>© 2026 themis</span>
          <span className="leading-relaxed">
            built by{" "}
            <a
              href="https://github.com/krishwalecha"
              target="_blank"
              rel="noreferrer"
              className="text-fog underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Krish
            </a>
            , who got paged at 3 a.m. one too many times
          </span>
          <div className="flex items-center justify-between gap-6 md:ml-auto">
            <a
              href="mailto:hello@usethemis.dev"
              className="flex items-center gap-2 text-fog transition-colors hover:text-accent"
              aria-label="Email support at hello@usethemis.dev"
            >
              <Mail size={14} strokeWidth={1.6} />
              hello@usethemis.dev
            </a>
            <span className="flex items-center gap-2">
              <span className="size-1.5 bg-add" />
              all monitors green
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
