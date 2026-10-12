import { createContext, useContext, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type Ref } from "react";
import { useEnvironments } from "../lib/environments";

// pins suggestions to one environment (e.g. a monitor's own), instead of the sidebar's active one
export const VarScope = createContext<string | null | undefined>(undefined);

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  wrapClassName?: string;
};

type Token = { start: number; query: string; braced: boolean };

// the variable-ish token right before the caret: an open "{{name" or a bare word of 2+ letters
const tokenAt = (text: string, caret: number): Token | null => {
  const before = text.slice(0, caret);
  const braced = /\{\{\s*([\w.-]*)$/.exec(before);
  if (braced) return { start: braced.index, query: braced[1], braced: true };
  const bare = /(?:^|[^\w.{-])([A-Za-z_][\w.-]+)$/.exec(before);
  return bare ? { start: caret - bare[1].length, query: bare[1], braced: false } : null;
};

export const VarInput = ({ value, onChange, inputRef, wrapClassName, onKeyDown, onBlur, ...rest }: Props) => {
  const { active: sidebarEnv, environments } = useEnvironments();
  const scoped = useContext(VarScope);
  const active = scoped === undefined ? sidebarEnv : (environments.find((e) => e._id === scoped) ?? null);
  const local = useRef<HTMLInputElement | null>(null);
  const [token, setToken] = useState<Token | null>(null);
  const [index, setIndex] = useState(0);

  const vars = useMemo(() => (active?.variables ?? []).filter((v) => v.enabled && v.key), [active]);
  const matches = useMemo(() => {
    if (!token) return [];
    const q = token.query.toLowerCase();
    const hits = vars.filter((v) => v.key.toLowerCase().includes(q) && (token.braced || v.key.toLowerCase() !== q));
    // a bare word only suggests when it starts a variable name, so normal typing isn't interrupted
    return hits
      .filter((v) => token.braced || v.key.toLowerCase().startsWith(q))
      .sort((a, b) => Number(!a.key.toLowerCase().startsWith(q)) - Number(!b.key.toLowerCase().startsWith(q)))
      .slice(0, 6);
  }, [token, vars]);
  const open = matches.length > 0;

  const track = (el: HTMLInputElement) => {
    setToken(tokenAt(el.value, el.selectionStart ?? el.value.length));
    setIndex(0);
  };

  const accept = (name: string) => {
    const el = local.current;
    if (!el || !token) return;
    const caret = el.selectionStart ?? value.length;
    const after = value.slice(caret).replace(/^[\w.-]*\s*\}\}/, "");
    const insert = `{{${name}}}`;
    onChange(value.slice(0, token.start) + insert + after);
    setToken(null);
    requestAnimationFrame(() => {
      const at = token.start + insert.length;
      el.setSelectionRange(at, at);
    });
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        accept(matches[index].key);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setToken(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <span className={`var-input${wrapClassName ? ` ${wrapClassName}` : ""}`}>
      <input
        {...rest}
        ref={(el) => {
          local.current = el;
          if (typeof inputRef === "function") inputRef(el);
          else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
        }}
        value={value}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        onChange={(e) => {
          onChange(e.target.value);
          track(e.target);
        }}
        onKeyDown={keyDown}
        onClick={(e) => track(e.currentTarget)}
        onBlur={(e) => {
          setToken(null);
          onBlur?.(e);
        }}
      />
      {open && (
        <ul className="var-menu" role="listbox" aria-label={`Variables in ${active?.name ?? "environment"}`}>
          {matches.map((v, i) => (
            <li
              key={v.key}
              role="option"
              aria-selected={i === index}
              className={i === index ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(v.key);
              }}
              onMouseEnter={() => setIndex(i)}
            >
              <span className="var-name">{`{{${v.key}}}`}</span>
              <span className="var-value">{v.secret ? "••••••" : v.value || "empty"}</span>
            </li>
          ))}
          <li className="var-foot" aria-hidden>
            {active?.name} · ↵ insert · esc close
          </li>
        </ul>
      )}
    </span>
  );
};
