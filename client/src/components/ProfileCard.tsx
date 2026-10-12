import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type User, type Whoami } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Wordmark } from "./ui";

const CMD = "themis whoami";

// `themis whoami`, streamed like a real command: it types itself, then prints your real numbers line by line
const WhoamiTerminal = ({ user }: { user: User }) => {
  const [me, setMe] = useState<Whoami | null>(null);
  const [failed, setFailed] = useState(false);
  const instant = useRef(window.matchMedia("(prefers-reduced-motion: reduce)").matches).current;
  const [typed, setTyped] = useState(instant ? CMD.length : 0);
  const [shown, setShown] = useState(0);

  useEffect(() => {
    let alive = true;
    api
      .whoami()
      .then((d) => alive && setMe(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const since = new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toLowerCase();
  const peak = Math.max(1, ...(me?.daily ?? []));
  const health = !me ? null : me.monitors.active === 0 ? (
    <span className="t-m">none running</span>
  ) : me.monitors.down > 0 ? (
    <span className="t-bad">● {me.monitors.down} down</span>
  ) : me.monitors.degraded > 0 ? (
    <span className="t-warn">● {me.monitors.degraded} degraded</span>
  ) : (
    <span className="t-ok">● all up</span>
  );

  const lines: ReactNode[] = [
    <>
      <span className="t-m">user    </span> <span className="t-p">{user.username ? `@${user.username}` : user.email}</span>
    </>,
    <>
      <span className="t-m">since   </span> {since}
    </>,
  ];
  if (failed) lines.push(<span className="t-bad">error: couldn&apos;t reach the API</span>);
  else if (me)
    lines.push(
      <>
        <span className="t-m">monitors</span> <span className="t-p">{me.monitors.total}</span> {health}
      </>,
      <>
        <span className="t-m">checks  </span> <span className="t-p">{me.checks.toLocaleString()}</span>{" "}
        <span className="pcard-spark" title="checks per day, last 14 days" aria-hidden>
          {me.daily.map((n, i) => (
            <i key={i} style={{ height: `${n ? 3 + Math.round((n / peak) * 9) : 1}px`, opacity: 0.45 + i / 28 }} />
          ))}
        </span>
      </>,
      <>
        <span className="t-m">pass    </span>{" "}
        {me.passRate === null ? <span className="t-m">no checks yet</span> : <span className="t-ok">{(me.passRate * 100).toFixed(1)}%</span>}
        <span className="t-m"> · 14 days</span>
      </>,
      <>
        <span className="t-m">requests</span> <span className="t-p">{me.requests.toLocaleString()}</span> <span className="t-m">judged</span>
      </>,
    );

  // type the command, then print each line once the data is in
  const ready = typed >= CMD.length && (me !== null || failed);
  useEffect(() => {
    if (typed >= CMD.length) return;
    const t = window.setTimeout(() => setTyped((n) => n + 1), 55);
    return () => clearTimeout(t);
  }, [typed]);
  useEffect(() => {
    if (!ready || shown >= lines.length) return;
    if (instant) return setShown(lines.length);
    const t = window.setTimeout(() => setShown((n) => n + 1), shown === 0 ? 320 : 150);
    return () => clearTimeout(t);
  }, [ready, shown, lines.length, instant]);
  const done = ready && shown >= lines.length;

  return (
    <div className="pcard-term" aria-live="polite">
      <div className="pcard-term-bar" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      <div>
        <span className="t-c">$</span> <span className="t-p">{CMD.slice(0, typed)}</span>
        {!done && <span className="pcard-cursor" aria-hidden />}
      </div>
      {lines.slice(0, shown).map((line, i) => (
        <div key={i} className="pcard-line">
          {line}
        </div>
      ))}
      {done && (
        <div>
          <span className="t-c">$</span> <span className="pcard-cursor" aria-hidden />
        </div>
      )}
    </div>
  );
};

// The card: name, handle, `themis whoami` with your real numbers; edits live on the settings page
export const ProfileCard = ({ user }: { user: User }) => {
  return (
    <div className="pcard">
      <div className="pcard-name">{user.name}</div>
      <div className="pcard-row">
        <span>Username</span>
        <span className="pcard-handle">{user.username ? `@${user.username}` : "not set"}</span>
      </div>
      <WhoamiTerminal user={user} />
      <div className="pcard-foot">
        <Wordmark />
        <Link to="/settings" className="pcard-settings">
          <Settings size={13} strokeWidth={1.75} />
          Settings
        </Link>
      </div>
    </div>
  );
};

// Shows the profile card while the trigger is hovered or focused
export const ProfileHover = ({ children, placement = "right" }: { children: ReactNode; placement?: "right" | "below" }) => {
  const { user } = useAuth();
  const trigger = useRef<HTMLSpanElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef(0);

  const [visible, setVisible] = useState(false);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setOpen(true);
      setVisible(true);
    }, 120);
  }, []);
  // fade out first, unmount once the exit transition is done
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setVisible(false);
      timer.current = window.setTimeout(() => {
        setOpen(false);
        setPos(null);
      }, 160);
    }, 180);
  }, []);

  // enter on the frame after placement, so there is a painted "from" state to transition out of
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!pos || !visible) return setEntered(false);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setEntered(true)));
    return () => cancelAnimationFrame(raf);
  }, [pos, visible]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // place the card against the trigger, inside the viewport; re-place whenever its size changes (data loading in)
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = card.current;
      const trig = trigger.current;
      if (!el || !trig) return;
      // the trigger is `display: contents`, so measure the union of what it wraps
      const rects = [...trig.children].map((c) => c.getBoundingClientRect());
      if (!rects.length) return;
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const pad = 12;
      // beside the sidebar, not over it
      const edge = Math.max(right, trig.closest(".sidebar")?.getBoundingClientRect().right ?? 0);
      const left = placement === "right" ? edge + 12 : right - w;
      const top = placement === "right" ? bottom - h : bottom + 12;
      setPos({
        left: Math.max(pad, Math.min(left, window.innerWidth - w - pad)),
        top: Math.max(pad, Math.min(top, window.innerHeight - h - pad)),
      });
    };
    place();
    const ro = new ResizeObserver(place);
    if (card.current) ro.observe(card.current);
    window.addEventListener("resize", place);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, placement]);


  return (
    <>
      <span ref={trigger} className="pcard-trigger" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide}>
        {children}
      </span>
      {open &&
        user &&
        createPortal(
          <div
            ref={card}
            role="dialog"
            aria-label={`${user.name}'s profile`}
            className={`pcard-pop ${placement}${entered ? " in" : ""}`}
            style={pos ?? { left: -9999, top: 0 }}
            onPointerEnter={show}
            onPointerLeave={hide}
            onKeyDown={(e) => e.key === "Escape" && (setVisible(false), setOpen(false), setPos(null))}
          >
            <ProfileCard user={user} />
          </div>,
          document.body,
        )}
    </>
  );
};
