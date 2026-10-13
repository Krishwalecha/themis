import { useEffect, useRef, useState, type ComponentType } from "react";
import { motion, useInView, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useLenis } from "lenis/react";
import { Check, ScrollText, X } from "lucide-react";
import { cn, useMediaQuery } from "./lib";
import { Note, Panel, SectionLabel } from "./primitives";
import { DitherShader } from "./DitherShader";
import { OBJ_BUBBLE, OBJ_RING, OBJ_SEAL, OBJ_SEND } from "./shaders";
import { FadeIn, RevealText } from "./reveal";

// a brighter mid-tone than the default ember-brown, so the figures read at a glance
const ILLO_INKS: [string, string, string, string] = ["var(--ink)", "#7c3317", "var(--accent)", "var(--paper)"];

type Chapter = { n: string; tag: string; illo: string; title: string; body: string; facts: string[]; Visual: ComponentType<{ active: boolean }> };

// Replays a counter while `active`, so each visual animates only when it is on stage
const useTicker = (active: boolean, every: number, max: number) => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    setTick(0);
    const id = window.setInterval(() => setTick((t) => (t + 1) % (max + 1)), every);
    return () => clearInterval(id);
  }, [active, every, max]);
  return tick;
};

const TestVisual = ({ active }: { active: boolean }) => {
  const tick = useTicker(active, 520, 7);
  const rows = [
    ["status", "== 200", true],
    ["body.data", "is array", true],
    ["body.data[*].total", "is integer", false],
    ["headers.content-type", "~ application/json", true],
    ["time", "< 300ms", true],
  ] as const;
  return (
    <Panel
      title="Request"
      meta="GET /v1/orders"
      footer={
        <span>
          {Math.min(tick, rows.length)} / {rows.length} assertions · 84 ms
        </span>
      }
    >
      <div className="space-y-1 p-4 font-mono text-[12.5px]">
        {rows.map(([path, rule, ok], i) => (
          <div
            key={path}
            className={cn(
              "flex items-center gap-3 rounded-[6px] border border-paper/8 px-3 py-3 transition-all duration-500",
              i < tick ? "opacity-100" : "translate-y-1 opacity-20",
              i < tick && !ok && "border-accent/40 bg-accent/[0.07]",
            )}
          >
            <span className={cn("grid size-5 place-items-center rounded-[4px]", ok ? "bg-add/15 text-add" : "bg-accent/20 text-accent")}>
              {ok ? <Check size={11} strokeWidth={3} /> : <X size={11} strokeWidth={3} />}
            </span>
            <span className="text-paper/85">{path}</span>
            <span className="ml-auto text-paper/40">{rule}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
};

const MonitorVisual = ({ active }: { active: boolean }) => {
  const tick = useTicker(active, 140, 48);
  const bars = Array.from({ length: 48 }, (_, i) => 30 + 22 * Math.abs(Math.sin(i * 1.7)) + (i === 31 ? 120 : i === 32 ? 90 : 0));
  return (
    <Panel
      title="Monitor"
      meta="every 1m · 3 regions"
      footer={
        <>
          <span className="size-1.5 bg-add" /> 99.97% uptime · p95 142 ms
        </>
      }
    >
      <div className="flex h-full flex-col p-5">
        <div className="flex items-baseline gap-3">
          <span className="text-[56px] font-[620] leading-none tracking-[-0.05em]">142</span>
          <span className="font-mono text-[12px] text-paper/40">ms p95</span>
        </div>
        <div className="mt-auto flex h-[60%] items-end gap-[4px]">
          {bars.map((h, i) => (
            <span
              key={i}
              className={cn("h-full flex-1 origin-bottom transition-[transform,opacity] duration-500", h > 100 ? "bg-accent" : "bg-paper/25")}
              style={{ transform: `scaleY(${i < tick ? Math.min(100, h / 1.6) / 100 : 0.02})`, opacity: i < tick ? 1 : 0.3 }}
            />
          ))}
        </div>
        <div className="mt-3 flex justify-between font-mono text-[10.5px] text-paper/30">
          <span>48m ago</span>
          <span className={cn("text-accent transition-opacity", tick > 32 ? "opacity-100" : "opacity-0")}>incident #18 opened, resolved in 2m</span>
          <span>now</span>
        </div>
      </div>
    </Panel>
  );
};

const ContractVisual = ({ active }: { active: boolean }) => {
  const tick = useTicker(active, 700, 4);
  const lines: Array<[string, " " | "+" | "-"]> = [
    ["Order:", " "],
    ["  type: object", " "],
    ["  required: [id, total, currency]", " "],
    ["  properties:", " "],
    ["    total:", " "],
    ["      type: string", "-"],
    ["      type: integer", "+"],
    ["      description: amount in cents", "+"],
    ["    currency:", " "],
    ["      enum: [usd, eur, gbp]", " "],
  ];
  return (
    <Panel title="Contract" meta="orders.list · v2 → v3" footer={<span>{tick >= 2 ? "1 breaking change · 2 endpoints affected" : "diffing versions…"}</span>}>
      <pre className="overflow-hidden whitespace-pre-wrap p-4 font-mono text-[12.5px] leading-[1.9] [overflow-wrap:anywhere]">
        {lines.map(([text, kind], i) => (
          <div
            key={i}
            className={cn(
              "-mx-4 flex px-4 transition-colors duration-500",
              tick >= 2 && kind === "-" && "bg-del/10 text-del",
              tick >= 2 && kind === "+" && "bg-add/10 text-add",
              kind === " " && "text-paper/70",
              tick < 2 && kind !== " " && "text-paper/70",
            )}
          >
            <span className="mr-3 w-3 select-none text-paper/30">{tick >= 2 ? kind : " "}</span>
            {text}
          </div>
        ))}
      </pre>
    </Panel>
  );
};

const SummaryVisual = ({ active }: { active: boolean }) => {
  const text =
    "Since 14:02, PATCH /v1/invoices returns 500 on 38% of calls. Every failure times out calling tax-svc before the write, so no invoices were half-updated. Likely cause: the tax-svc deploy at 13:58. Roll it back or raise the client timeout above 1.2s.";
  const out = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = out.current;
    if (!el) return;
    if (!active) {
      el.textContent = text;
      return;
    }
    let i = 0;
    el.textContent = "";
    const id = window.setInterval(() => {
      i = (i + 1) % (text.length + 40);
      el.textContent = text.slice(0, i);
    }, 28);
    return () => clearInterval(id);
  }, [active, text]);
  return (
    <Panel
      title="Summary"
      meta={
        <span className="flex items-center gap-1.5">
          <ScrollText size={11} className="text-accent" />
          ai summary
        </span>
      }
      footer={<span>Grounded in 41 checks and 3 incidents</span>}
    >
      <div className="p-5">
        <div className="flex items-center gap-2 font-mono text-[11px] text-paper/40">
          <span className="rounded-[3px] bg-accent px-1.5 py-0.5 text-ink">INCIDENT #18</span>
          invoices.update · production
        </div>
        <p className="mt-5 text-[17px] leading-[1.6] text-paper/85">
          <span ref={out} />
          <span className="ml-0.5 inline-block h-[1.1em] w-[0.5em] translate-y-[0.2em] animate-[blink_1s_steps(1)_infinite] bg-accent" />
        </p>
      </div>
    </Panel>
  );
};

const CHAPTERS: Chapter[] = [
  {
    n: "01",
    tag: "send",
    illo: OBJ_SEND,
    title: "Send it. I'll check everything.",
    body: "A fast request workspace with environments and history. I check every response the moment it lands, not when you remember to look.",
    facts: ["Env variables & secrets", "Assertions on any path", "Full request history"],
    Visual: TestVisual,
  },
  {
    n: "02",
    tag: "monitor",
    illo: OBJ_RING,
    title: "I watch it while you sleep.",
    body: "Turn any request into a monitor. I run it on a schedule, keep the latency and uptime, and open an incident the moment it starts failing.",
    facts: ["Cron schedules", "Latency & uptime history", "Incidents open and close themselves"],
    Visual: MonitorVisual,
  },
  {
    n: "03",
    tag: "contract",
    illo: OBJ_SEAL,
    title: "I hold the API to its word.",
    body: "Give me your OpenAPI or JSON Schema contract. I check live responses against it and diff new versions, so a breaking change reaches me before it reaches your users.",
    facts: ["OpenAPI 3.1 & JSON Schema", "Version diffs", "Breaking-change detection"],
    Visual: ContractVisual,
  },
  {
    n: "04",
    tag: "summary",
    illo: OBJ_BUBBLE,
    title: "You get the story. I read the logs.",
    body: "When something breaks I write it up in plain language: what failed, since when, and the likeliest cause, using only checks I actually ran.",
    facts: ["Plain-language write-ups", "Grounded in real checks", "Incident & run summaries"],
    Visual: SummaryVisual,
  },
];

export const Features = () => {
  const wide = useMediaQuery("(min-width: 1024px)");
  return (
    <section id="product" className="graph-paper relative text-ink">
      <div className="container-x pb-10 pt-20 md:pt-28">
        <SectionLabel>Product</SectionLabel>
        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-12">
          <h2 className="type-display text-[clamp(2.5rem,6vw,5.5rem)] lg:col-span-8">
            <RevealText lines={["One place to test,", "watch and judge."]} />
          </h2>
          <FadeIn delay={0.2} className="self-end lg:col-span-4">
            <p className="max-w-[40ch] text-[17px] leading-[1.55] text-ink/60">
              I'm the API client, the uptime monitor and the contract checker you keep switching between. One tab. One opinion. Mine.
            </p>
            <Note tone="light" className="mt-6">
              scroll. I'll run the tests while you read.
            </Note>
          </FadeIn>
        </div>
      </div>
      {/* mount only the layout on screen, so phones never compile the desktop track's canvases */}
      {wide ? (
        <HorizontalTrack />
      ) : (
        <div className="container-x space-y-20 pb-24 pt-6">
          {CHAPTERS.map((c) => (
            <StackedChapter key={c.n} chapter={c} />
          ))}
        </div>
      )}
    </section>
  );
};

// Scrolling down slides the four features sideways, like a deck
const HorizontalTrack = () => {
  const track = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: track, offset: ["start start", "end end"] });
  const n = CHAPTERS.length;
  const x = useTransform(scrollYProgress, [0, 1], ["0%", `-${((n - 1) / n) * 100}%`]);
  const [active, setActive] = useState(0);
  const live = useInView(track);
  const lenis = useLenis();
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(n - 1, Math.max(0, Math.round(v * (n - 1))))));

  const jump = (i: number) => {
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const target = top + (i / (n - 1)) * (el.offsetHeight - window.innerHeight);
    if (lenis) lenis.scrollTo(target, { duration: 1.2 });
    else window.scrollTo({ top: target, behavior: "smooth" });
  };

  return (
    <div ref={track} className="relative" style={{ height: `${n * 85}vh` }}>
      <div className="sticky top-0 flex h-svh flex-col justify-center overflow-hidden">
        <motion.div className="flex" style={{ x, width: `${n * 100}%` }}>
          {CHAPTERS.map((c, i) => (
            <div key={c.n} className="w-full px-[clamp(1.25rem,4vw,2.5rem)]" style={{ width: `${100 / n}%` }}>
              <Slide chapter={c} active={i === active && live} />
            </div>
          ))}
        </motion.div>
        <div className="container-x mt-8">
          <ol className="grid grid-cols-4 gap-3">
            {CHAPTERS.map((c, i) => (
              <li key={c.n}>
                <button type="button" onClick={() => jump(i)} className="group w-full text-left">
                  <span className="block h-[3px] w-full overflow-hidden bg-ink/10">
                    <span className={cn("block h-full bg-accent transition-transform duration-500", i <= active ? "translate-x-0" : "-translate-x-full")} />
                  </span>
                  <span
                    className={cn(
                      "mt-3 flex items-center gap-2 font-mono text-[11.5px] transition-colors",
                      i === active ? "text-ink" : "text-ink/40 group-hover:text-ink/70",
                    )}
                  >
                    <span className="text-accent">{c.n}</span>
                    {c.tag}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
};

const Slide = ({ chapter, active }: { chapter: Chapter; active: boolean }) => {
  const { Visual } = chapter;
  return (
    <article className="mx-auto grid h-[min(68vh,620px)] max-w-[1260px] grid-cols-12 overflow-hidden rounded-[10px] border border-ink/12 bg-paper shadow-[0_40px_80px_-60px_rgba(10,10,9,0.45)]">
      <div className="col-span-5 flex flex-col border-r border-ink/10">
        <div className="relative h-[46%] min-h-[200px] border-b border-ink/10 bg-ink">
          <DitherShader fragment={chapter.illo} pixel={2} inks={ILLO_INKS} paused={!active} className="absolute inset-0" />
          <span className="absolute left-4 top-3 font-mono text-[11px] text-paper/40">
            fig.{chapter.n} / {chapter.tag}
          </span>
        </div>
        <div className="flex flex-1 flex-col p-7">
          <h3 className="type-title text-[clamp(1.6rem,2.3vw,2.2rem)]">{chapter.title}</h3>
          <p className="mt-4 max-w-[44ch] text-[15.5px] leading-[1.6] text-ink/65">{chapter.body}</p>
          <ul className="mt-auto flex flex-wrap gap-2 pt-6">
            {chapter.facts.map((f) => (
              <li key={f} className="rounded-full border border-ink/15 px-3 py-1 font-mono text-[11px] text-ink/60">
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="col-span-7 bg-paper-2/60 p-6">
        <Visual active={active} />
      </div>
    </article>
  );
};

// phones: one column; tablets: words and figure beside the live panel, so nothing stretches edge to edge
const StackedChapter = ({ chapter }: { chapter: Chapter }) => {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const { Visual } = chapter;
  return (
    <div ref={ref} className="border-t border-ink/12 pt-5 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-6">
      <div className="flex flex-col">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[12px] text-ink/50">{chapter.n}</span>
          <h3 className="type-title text-[1.75rem]">{chapter.title}</h3>
        </div>
        <p className="mt-3 text-[15.5px] leading-[1.6] text-ink/65">{chapter.body}</p>
        <ul className="mt-4 hidden flex-wrap gap-2 md:flex">
          {chapter.facts.map((f) => (
            <li key={f} className="rounded-full border border-ink/15 px-3 py-1 font-mono text-[11px] text-ink/60">
              {f}
            </li>
          ))}
        </ul>
        {/* a fixed gap under the text; on tablets the figure also settles at the bottom, level with the panel beside it */}
        <div className="mt-6 md:mt-auto md:pt-6">
          <div className="relative h-[210px] overflow-hidden rounded-[8px] bg-ink md:h-auto md:aspect-[4/3]">
            <DitherShader
              fragment={`#define LITE
  ${chapter.illo}`}
              pixel={2}
              inks={ILLO_INKS}
              paused={!inView}
              className="absolute inset-0"
            />
            <span className="absolute left-3 top-2.5 font-mono text-[10.5px] text-paper/40">
              fig.{chapter.n} / {chapter.tag}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-3 h-[460px] md:mt-0 md:h-auto md:min-h-[440px]">
        <Visual active={inView} />
      </div>
    </div>
  );
};
