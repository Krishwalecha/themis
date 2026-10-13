import { useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useLenis } from "lenis/react";
import { Check, Copy } from "lucide-react";
import { cn, copyText } from "./lib";
import { Scramble } from "./reveal";

// `PRODUCT ----` : a ruled heading like a section in a spec sheet
export const SectionLabel = ({ children, className }: { children: string; className?: string }) => {
  return (
    <div className={cn("type-label flex items-center gap-2.5", className)}>
      <Scramble text={children} />
      <span aria-hidden className="ml-2 h-px max-w-24 flex-1 bg-current opacity-20" />
    </div>
  );
};

type Variant = "accent" | "light" | "ghost-dark";

const VARIANTS: Record<Variant, string> = {
  accent: "bg-accent text-ink hover:bg-paper",
  light: "bg-paper text-ink hover:bg-accent",
  "ghost-dark": "border border-paper/15 bg-ink/80 text-paper backdrop-blur-sm hover:border-paper/40 hover:bg-ink",
};

export const buttonClass = (variant: Variant = "accent", size: "md" | "lg" = "md") =>
  cn(
    "group inline-flex select-none items-center justify-center gap-2 rounded-[4px] font-medium tracking-[-0.01em] transition-[background-color,border-color,color,transform] duration-200 active:translate-y-px",
    size === "lg" ? "h-12 px-5 text-[15px]" : "h-9 px-3.5 text-[13.5px]",
    VARIANTS[variant],
  );

// Themis's margin notes: a code-review comment left beside the page, in mono italic, with a dashed leader
export const Note = ({ children, tone = "dark", className, lead = "left" }: { children: ReactNode; tone?: "dark" | "light"; className?: string; lead?: "left" | "up" }) => {
  return (
    <motion.p
      initial={{ opacity: 0, y: 6 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
      className={cn(
        "flex max-w-[34ch] items-start gap-2.5 font-mono text-[12px] italic leading-[1.55]",
        tone === "dark" ? "text-paper/45" : "text-ink/50",
        className,
      )}
    >
      <span aria-hidden className={cn("mt-[0.7em] shrink-0 border-t border-dashed border-accent/70", lead === "left" ? "w-6" : "w-3")} />
      <span>
        <span className="not-italic text-accent">// </span>
        {children}
      </span>
    </motion.p>
  );
};

// The small mark: a tiled "T" and its orange full stop (same as the favicon)
const LogoGlyph = ({ size = 18, className }: { size?: number; className?: string }) => {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className={className}>
      <g fill="var(--paper)"><path d="M20 40A20 20 0 0 1 40 20H60A20 20 0 0 1 80 40H60V80A20 20 0 0 1 40 60V40Z" /></g>
      <rect x="64" y="64" width="16" height="16" rx="3" fill="var(--accent)" />
    </svg>
  );
};

// The wordmark: "themis" with an orange full stop
export const Logo = ({ className }: { className?: string }) => {
  return (
    <span className={cn("inline-block text-[19px] font-[640] leading-none tracking-[-0.045em]", className)}>
      themis<span className="text-accent">.</span>
    </span>
  );
};

// An anchor that smooth-scrolls (through Lenis) when it points at a section on this page
export const SmartLink = ({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => {
  const lenis = useLenis();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || !href.startsWith("#")) return;
    const el = document.getElementById(href.slice(1));
    if (!el) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(el, { duration: 1.2 });
    else el.scrollIntoView({ behavior: "smooth" });
  };
  const external = /^https?:/.test(href) ? { target: "_blank", rel: "noreferrer" } : {};
  return <a href={href} onClick={handle} {...external} {...props} />;
};

export const CopyButton = ({ text, className }: { text: string; className?: string }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (!(await copyText(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label="Copy to clipboard"
      className={cn("relative grid size-7 shrink-0 place-items-center rounded-[4px] bg-paper/5 text-paper/60 transition-colors hover:bg-paper/10 hover:text-paper", className)}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "y" : "n"}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.18 }}
        >
          {copied ? <Check size={14} strokeWidth={3} className="text-accent" /> : <Copy size={14} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
};

// Dark product surface used by every feature visual
export const Panel = ({ title, meta, footer, children }: { title: string; meta?: ReactNode; footer?: ReactNode; children: ReactNode }) => {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[8px] border border-ink/10 bg-ink text-paper shadow-[0_50px_90px_-50px_rgba(10,10,9,0.6)]">
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-paper/8 px-4">
        <LogoGlyph size={14} />
        <span className="type-label text-paper/55">{title}</span>
        {meta && <span className="ml-auto font-mono text-[11px] text-paper/35">{meta}</span>}
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
      {footer && (
        <div className="flex min-h-10 shrink-0 items-center gap-3 border-t border-paper/8 px-4 py-2 font-mono text-[11px] text-paper/40">{footer}</div>
      )}
    </div>
  );
};
