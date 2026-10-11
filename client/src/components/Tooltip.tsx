import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Tip = { text: string; x: number; y: number; below: boolean };

const DELAY = 1000;
const GAP = 8;

// one tooltip for the whole app: any element with a `title` gets the styled version instead of the browser's
export const TooltipLayer = () => {
  const [tip, setTip] = useState<Tip | null>(null);
  const [shown, setShown] = useState(false);
  const target = useRef<HTMLElement | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(hover: none)").matches) return;

    const restore = () => {
      const el = target.current;
      if (el?.dataset.tip !== undefined) {
        el.setAttribute("title", el.dataset.tip);
        delete el.dataset.tip;
      }
      target.current = null;
    };
    const close = () => {
      clearTimeout(timer.current);
      restore();
      setShown(false);
    };
    const place = (el: HTMLElement, text: string) => {
      const r = el.getBoundingClientRect();
      const below = r.top < 44;
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + GAP : r.top - GAP, below });
      setShown(true);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as HTMLElement).closest<HTMLElement>("[title], [data-tip]");
      if (el === target.current) return;
      close();
      if (!el) return;
      const text = el.getAttribute("title") ?? el.dataset.tip ?? "";
      if (!text.trim()) return;
      // keep the text, drop the native tooltip
      el.dataset.tip = text;
      el.removeAttribute("title");
      target.current = el;
      timer.current = window.setTimeout(() => target.current === el && el.isConnected && place(el, text), DELAY);
    };

    const onOut = (e: PointerEvent) => !e.relatedTarget && close();
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      close();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, []);

  // keep the bubble inside the viewport horizontally
  const bubble = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState(0);
  useEffect(() => {
    const el = bubble.current;
    if (!el || !tip) return;
    const r = el.getBoundingClientRect();
    const half = r.width / 2;
    const pad = 8;
    setNudge(tip.x - half < pad ? pad - (tip.x - half) : tip.x + half > window.innerWidth - pad ? window.innerWidth - pad - (tip.x + half) : 0);
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      className={`tip${tip.below ? " below" : ""}${shown ? " in" : ""}`}
      style={{ left: tip.x + nudge, top: tip.y, ["--nudge" as string]: `${-nudge}px` }}
    >
      {tip.text}
    </div>,
    document.body,
  );
};
