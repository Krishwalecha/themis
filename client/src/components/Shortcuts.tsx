import { useEffect, useState } from "react";
import { X } from "lucide-react";

const MOD = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

const GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Anywhere",
    keys: [
      [[MOD, "K"], "Search pages, collections and monitors"],
      [[MOD, "B"], "Collapse or expand the sidebar"],
      [["?"], "Show these shortcuts"],
      [["Esc"], "Close menus, dialogs and selections"],
    ],
  },
  {
    title: "Workspace",
    keys: [
      [[MOD, "Enter"], "Send the request"],
      [["Paste curl"], "Paste a curl command into the URL bar to fill in the request"],
    ],
  },
  {
    title: "Import",
    keys: [[[MOD, "Enter"], "Import what's in the box"]],
  },
];

const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// "?" opens a sheet listing every keyboard shortcut
export const Shortcuts = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !typing(e.target)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="dialog framed shortcuts" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
        <div className="shortcuts-head">
          <span className="eyebrow">Keyboard shortcuts</span>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
            <X size={14} />
          </button>
        </div>
        {GROUPS.map((g) => (
          <section key={g.title} className="shortcuts-group">
            <h3>{g.title}</h3>
            <ul>
              {g.keys.map(([keys, label]) => (
                <li key={label}>
                  <span>{label}</span>
                  <span className="shortcuts-keys">
                    {keys.map((k) => (
                      <kbd key={k}>{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
};
