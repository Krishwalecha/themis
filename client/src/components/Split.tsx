import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import { storage } from "../lib/storage";

type Shown = "both" | "first" | "second";
type Saved = { ratio: number; shown: Shown };

const MIN = 0.22;
const DEFAULT: Saved = { ratio: 0.46, shown: "both" };
const clamp = (r: number) => Math.min(1 - MIN, Math.max(MIN, r));

// two panes with a draggable divider; either pane folds into a slim tab
export const Split = ({
  id,
  first,
  second,
  labels,
  stackBelow = 940,
}: {
  id: string;
  first: ReactNode;
  second: ReactNode;
  labels: [string, string];
  stackBelow?: number;
}) => {
  const key = `themis.split.${id}`;
  const [state, setState] = useState<Saved>(() => ({ ...DEFAULT, ...storage.getJson<Saved>(key) }));
  const [stacked, setStacked] = useState(false);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => storage.set(key, JSON.stringify(state)), [key, state]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStacked(e.contentRect.width < stackBelow));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stackBelow]);

  const show = (shown: Shown) => setState((s) => ({ ...s, shown }));
  const setRatio = (ratio: number) => setState((s) => ({ ...s, ratio: clamp(ratio) }));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button") || state.shown !== "both") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging || !root.current) return;
    const r = root.current.getBoundingClientRect();
    setRatio(stacked ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.03;
    const back = stacked ? "ArrowUp" : "ArrowLeft";
    const fwd = stacked ? "ArrowDown" : "ArrowRight";
    if (e.key === back) setRatio(state.ratio - step);
    else if (e.key === fwd) setRatio(state.ratio + step);
    else if (e.key === "Home") setRatio(MIN);
    else if (e.key === "End") setRatio(1 - MIN);
    else return;
    e.preventDefault();
  };

  const { ratio, shown } = state;
  // same track shape in every state so the browser can animate between them
  const [a, b] = shown === "first" ? [1, 0] : shown === "second" ? [0, 1] : [ratio, 1 - ratio];
  const track = `minmax(34px, ${a}fr) 12px minmax(34px, ${b}fr)`;
  const [Back, Fwd] = stacked ? [ChevronUp, ChevronDown] : [ChevronLeft, ChevronRight];

  const pane = (which: 0 | 1, content: ReactNode) => {
    const hidden = shown === (which === 0 ? "second" : "first");
    return (
      <div className={`split-pane${hidden ? " folded" : ""}`}>
        <div className="split-content" inert={hidden}>
          {content}
        </div>
        <button
          className="split-fold"
          onClick={() => show("both")}
          title={`Show ${labels[which].toLowerCase()}`}
          tabIndex={hidden ? 0 : -1}
          aria-hidden={!hidden}
        >
          {which === 0 ? <Fwd size={13} /> : <Back size={13} />}
          <span>{labels[which]}</span>
        </button>
      </div>
    );
  };

  return (
    <div
      ref={root}
      className={`pane-split${stacked ? " stacked" : ""}${dragging ? " dragging" : ""}`}
      style={stacked ? { gridTemplateRows: track } : { gridTemplateColumns: track }}
    >
      {pane(0, first)}
      <div
        className="split-handle"
        role="separator"
        aria-orientation={stacked ? "horizontal" : "vertical"}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label={`Resize ${labels[0].toLowerCase()} and ${labels[1].toLowerCase()}`}
        tabIndex={shown === "both" ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => setState(DEFAULT)}
        onKeyDown={onKeyDown}
        title="Drag to resize · double-click to reset"
      >
        <span className="split-grip" />
        <span className="split-btns">
          {shown !== "second" && (
            <button
              aria-label={`Hide ${labels[0].toLowerCase()}`}
              title={`Hide ${labels[0].toLowerCase()}`}
              onClick={() => show(shown === "first" ? "both" : "second")}
            >
              <Back size={12} />
            </button>
          )}
          {shown !== "first" && (
            <button
              aria-label={`Hide ${labels[1].toLowerCase()}`}
              title={`Hide ${labels[1].toLowerCase()}`}
              onClick={() => show(shown === "second" ? "both" : "first")}
            >
              <Fwd size={12} />
            </button>
          )}
        </span>
      </div>
      {pane(1, second)}
    </div>
  );
};
