import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Layers } from "lucide-react";
import { useEnvironments } from "../lib/environments";

// environment switcher for the collapsed rail: an icon that opens a menu beside it
export const EnvRail = () => {
  const { environments, activeId, setActiveId } = useEnvironments();
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = environments.find((e) => e._id === activeId);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: PointerEvent) => !menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node) && setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) return setPos(null);
    const r = button.current!.getBoundingClientRect();
    setPos({ left: r.right + 10, bottom: window.innerHeight - r.bottom });
  };

  const pick = (id: string | null) => {
    setActiveId(id);
    setPos(null);
  };

  return (
    <>
      <button
        ref={button}
        className={`rail-env${active ? " set" : ""}`}
        aria-label="Switch environment"
        aria-expanded={Boolean(pos)}
        title={pos ? undefined : `Environment · ${active?.name ?? "none"}`}
        onClick={toggle}
      >
        <Layers size={16} strokeWidth={1.6} />
      </button>
      {pos &&
        createPortal(
          <div ref={menu} className="rail-env-menu" role="menu" style={{ left: pos.left, bottom: pos.bottom }}>
            <div className="rail-env-head">Environment</div>
            {[{ _id: "", name: "No environment" }, ...environments].map((e) => {
              const on = (activeId ?? "") === e._id;
              return (
                <button key={e._id || "none"} role="menuitemradio" aria-checked={on} className={on ? "on" : ""} onClick={() => pick(e._id || null)}>
                  <span>{e.name}</span>
                  {on && <Check size={13} strokeWidth={2} />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
};
