import { ProfileHover } from "./ProfileCard";
import { LogOut, Mail, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { setPageMeta } from "../lib/meta";
import { storage } from "../lib/storage";
import { useAuth } from "../lib/auth";
import { environmentOptions, useEnvironments } from "../lib/environments";
import { CommandPalette } from "./CommandPalette";
import { EnvRail } from "./EnvRail";
import { Shortcuts } from "./Shortcuts";
import { NAV_ITEMS, pageFor } from "./nav";
import { prefetchPages } from "../pages";
import { Eyebrow, Logo, Select, Wordmark } from "./ui";

interface Counts {
  monitors: number;
  incidents: number;
  contracts: number;
}

const SIDEBAR_KEY = "themis.sidebar";
const RAIL = 56;

// sidebar items that may shift or appear when the sidebar switches between full and rail
const RAIL_ITEMS = ".brand .logo, .search-trigger, .nav-link, .nav-section, .support-link, .rail-env, .user-chip .avatar";

// FLIP: snapshot positions, then after the layout switch glide each item from where it was; newcomers fade in
const glide = (root: HTMLElement, opts: KeyframeAnimationOptions) => {
  const before = new Map([...root.querySelectorAll<HTMLElement>(RAIL_ITEMS)].map((el) => [el, el.getBoundingClientRect()]));
  return () =>
    root.querySelectorAll<HTMLElement>(RAIL_ITEMS).forEach((el) => {
      const was = before.get(el);
      const now = el.getBoundingClientRect();
      if (!now.width) return;
      if (!was) return void el.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, fill: "none" });
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.abs(dx) + Math.abs(dy) < 0.5) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { ...opts, fill: "none" });
    });
};

// animation flags live in data-sb, which React never rewrites (it owns className)
const flag = (el: HTMLElement, name: string, on: boolean) => {
  const set = new Set((el.dataset.sb ?? "").split(" ").filter(Boolean));
  if (on) set.add(name);
  else set.delete(name);
  el.dataset.sb = [...set].join(" ");
};

// sidebar, palette and status polling re-render the layout; the page itself shouldn't re-render with them
const Page = memo(() => <Outlet />);
const MOBILE = "(max-width: 820px)";

const useIsMobile = () => {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(MOBILE);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(MOBILE).matches,
  );
};

export const Layout = () => {
  const { environments, activeId, setActiveId } = useEnvironments();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // every app page gets its own tab title; none of them belong in search results
  useEffect(() => {
    const item = [...NAV_ITEMS].sort((a, b) => b.to.length - a.to.length).find((n) => location.pathname.startsWith(n.to));
    const label = location.pathname === "/settings" ? "Settings" : (item?.label ?? "Themis");
    setPageMeta(`${label} · Themis`, false);
  }, [location.pathname]);
  const [apiUp, setApiUp] = useState<boolean | null>(null);
  const [ai, setAi] = useState<{ enabled: boolean; model: string } | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => storage.get(SIDEBAR_KEY) === "collapsed");

  useEffect(() => storage.set(SIDEBAR_KEY, collapsed ? "collapsed" : "open"), [collapsed]);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const animating = useRef(false);
  const running = useRef<Animation[]>([]);
  // the Ctrl+B listener is registered once, so it reads the live value from here
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // layout changes once; the page slides with a transform and the sidebar is clipped, so no frame re-lays out the page
  const slideSidebar = () => {
    const shell = shellRef.current;
    const sidebar = shell?.querySelector<HTMLElement>(".sidebar");
    const content = shell?.querySelector<HTMLElement>(".content");
    if (animating.current) {
      // a second press mid-slide jumps to the end, then reverses
      running.current.forEach((a) => a.finish());
      requestAnimationFrame(slideSidebar);
      return;
    }
    if (!shell || !sidebar || !content || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCollapsed((c) => !c);
      return;
    }
    animating.current = true;
    // fill holds the end frame until the state commit swaps in the real layout, so nothing flashes in between
    const opts: KeyframeAnimationOptions = { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" };
    // the commit frame snaps: no leftover child transitions trail the slide
    const commit = (next: boolean) => {
      flag(shell, "instant", true);
      flushSync(() => setCollapsed(next));
      flag(shell, "collapsing", false);
      void shell.offsetWidth;
      requestAnimationFrame(() => flag(shell, "instant", false));
    };
    const finish = () => {
      flag(shell, "collapsing", false);
      running.current.forEach((a) => a.cancel());
      running.current = [];
      animating.current = false;
    };
    if (!collapsedRef.current) {
      // switch to the rail up front: rail layout at full width, content padded to the rail column and clipped closed
      const full = sidebar.offsetWidth;
      const delta = full - RAIL;
      shell.style.setProperty("--sb-delta", `${delta}px`);
      shell.style.setProperty("--sb-full", `${full}px`);
      const settle = glide(sidebar, opts);
      flag(shell, "collapsing", true);
      flag(shell, "instant", true);
      flushSync(() => setCollapsed(true));
      void shell.offsetWidth;
      settle();
      requestAnimationFrame(() => flag(shell, "instant", false));
      const slide = content.animate([{ transform: `translateX(${delta}px)` }, { transform: "none" }], opts);
      const clip = sidebar.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: `inset(0 ${delta}px 0 0)` }], opts);
      running.current = [slide, clip];
      // only the width changes at the end, and that part is already clipped away
      clip.finished.then(() => {
        flag(shell, "instant", true);
        finish();
        void shell.offsetWidth;
        requestAnimationFrame(() => flag(shell, "instant", false));
      }, finish);
    } else {
      const settle = glide(sidebar, opts);
      commit(false);
      settle();
      const delta = sidebar.offsetWidth - RAIL;
      const slide = content.animate([{ transform: `translateX(${-delta}px)` }, { transform: "none" }], opts);
      const clip = sidebar.animate([{ clipPath: `inset(0 ${delta}px 0 0)` }, { clipPath: "inset(0 0 0 0)" }], opts);
      running.current = [slide, clip];
      clip.finished.then(finish, finish);
    }
  };
  // set when the workspace collapsed the sidebar itself, so leaving it can put things back
  const autoCollapsed = useRef(false);
  const toggleSidebar = () => {
    autoCollapsed.current = false;
    if (isMobile) setDrawerOpen((o) => !o);
    else slideSidebar();
  };

  // the workspace wants the room: collapse on the way in, restore on the way out unless the user took over
  useEffect(() => {
    if (isMobile) return;
    const inWorkspace = location.pathname.startsWith("/workspace");
    // a frame later: the slide commits state synchronously, which React doesn't allow inside an effect
    const raf = requestAnimationFrame(() => {
      if (inWorkspace && !collapsedRef.current) {
        autoCollapsed.current = true;
        slideSidebar();
      } else if (!inWorkspace && autoCollapsed.current) {
        autoCollapsed.current = false;
        if (collapsedRef.current) slideSidebar();
      }
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, isMobile]);

  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
    idle(prefetchPages);
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const h = await api.health();
        if (!alive) return;
        setApiUp(h.db === "connected");
        const [m, i, c] = await Promise.all([api.monitors.list(), api.incidents.list({ status: "open", limit: 100 }), api.contracts.list()]);
        if (alive) setCounts({ monitors: m.items.length, incidents: i.items.length, contracts: c.items.length });
      } catch {
        if (alive) setApiUp(false);
      }
    };
    void poll();
    api.ai
      .status()
      .then((s) => alive && setAi(s))
      .catch(() => undefined);
    const t = setInterval(poll, 20_000);
    // a bulk delete fires one change per call, so wait for the burst to settle
    let soon = 0;
    const onChange = () => {
      clearTimeout(soon);
      soon = window.setTimeout(() => void poll(), 150);
    };
    window.addEventListener("themis:counts", onChange);
    return () => {
      alive = false;
      clearInterval(t);
      clearTimeout(soon);
      window.removeEventListener("themis:counts", onChange);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // Navigating closes the mobile drawer; so does Escape.
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const page = pageFor(location.pathname);
  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);

  return (
    <div ref={shellRef} className={`shell${collapsed && !isMobile ? " sidebar-collapsed" : ""}${drawerOpen && isMobile ? " mobile-open" : ""}`}>
      {drawerOpen && isMobile && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden />}
      <nav className="sidebar" aria-label="Main">
        <Link
          to="/"
          className="brand"
          title={
            apiUp === false
              ? "API unreachable"
              : counts && counts.incidents > 0
                ? `${counts.incidents} open incident${counts.incidents === 1 ? "" : "s"}`
                : "All systems operational"
          }
        >
          <Logo live status={apiUp === false ? "down" : counts && counts.incidents > 0 ? "degraded" : "up"} />
          <span>
            <Wordmark live status={apiUp === false ? "down" : counts && counts.incidents > 0 ? "degraded" : "up"} />
            <span className="brand-sub">API reliability</span>
          </span>
        </Link>
        {!isMobile && !collapsed && (
          <button
            className="icon-btn brand-collapse"
            aria-label="Collapse sidebar"
            title={`Collapse sidebar (${isMac ? "⌘" : "Ctrl"} B)`}
            onClick={toggleSidebar}
          >
            <PanelLeftClose size={15} strokeWidth={1.6} />
          </button>
        )}

        <button
          className="search-trigger"
          onClick={() => {
            setDrawerOpen(false);
            setPaletteOpen(true);
          }}
          title={collapsed ? "Search" : undefined}
        >
          <Search size={14} />
          <span>Search</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>

        {(["Overview", "Build"] as const).map((section) => (
          <div key={section}>
            <div className="nav-section">{section}</div>
            <ul className="nav">
              {NAV_ITEMS.filter((n) => n.section === section).map((n) => {
                const count = n.badge && counts ? counts[n.badge] : 0;
                return (
                  <li key={n.to}>
                    <NavLink
                      to={n.to}
                      title={collapsed ? n.label : undefined}
                      className={({ isActive }: { isActive: boolean }) => `nav-link${isActive ? " active" : ""}`}
                    >
                      <n.icon size={16} strokeWidth={1.6} />
                      <span>{n.label}</span>
                      {count > 0 && <span className={`nav-badge${n.badge === "incidents" ? " alert" : ""}`}>{count}</span>}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className="sidebar-bottom">
          <a className="support-link" href="mailto:hello@usethemis.dev" title={collapsed ? "Email support · hello@usethemis.dev" : undefined}>
            <Mail size={16} strokeWidth={1.6} />
            <span>hello@usethemis.dev</span>
          </a>
          {!isMobile && collapsed && <EnvRail />}
          <div className="env-switch">
            <Eyebrow>Environment</Eyebrow>
            <Select
              block
              label="Active environment"
              value={activeId ?? ""}
              onChange={(v) => setActiveId(v || null)}
              options={environmentOptions(environments)}
            />
          </div>
          {user && (
            <div className="user-chip">
              <ProfileHover>
                <span className="avatar" tabIndex={0} aria-label="Show profile">
                  {user.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="user-meta">
                  <b>{user.name}</b>
                  <span>{user.username ? `@${user.username}` : user.email}</span>
                </span>
              </ProfileHover>
              <button
                className="icon-btn"
                title="Sign out"
                aria-label="Sign out"
                onClick={async () => {
                  await logout();
                  navigate("/login", { replace: true });
                }}
              >
                <LogOut size={14} strokeWidth={1.7} />
              </button>
            </div>
          )}
          <div className="sidebar-status">
            <span className="status-line">
              <span className={`health ${apiUp === null ? "" : apiUp ? "up" : "down"}`} />
              {apiUp === null ? "connecting" : apiUp ? "operational" : "api unreachable"}
            </span>
            {ai && <span title={ai.enabled ? `Summaries by Groq (${ai.model})` : "Set GROQ_API_KEY for AI summaries"}>{ai.enabled ? "ai on" : "ai off"}</span>}
          </div>
        </div>
      </nav>

      <div className="content">
        <header className="topbar">
          {isMobile ? (
            <button className="icon-btn sidebar-toggle" aria-label="Open menu" aria-expanded={drawerOpen} onClick={toggleSidebar}>
              <Menu size={17} strokeWidth={1.7} />
            </button>
          ) : (
            // open: the button lives in the sidebar's brand row; collapsed: it slides out here
            <button
              className={`icon-btn sidebar-toggle desk${collapsed ? " shown" : ""}`}
              aria-label="Expand sidebar"
              aria-hidden={!collapsed}
              tabIndex={collapsed ? 0 : -1}
              title={collapsed ? `Expand sidebar (${isMac ? "⌘" : "Ctrl"} B)` : undefined}
              onClick={toggleSidebar}
            >
              <PanelLeftOpen size={15} strokeWidth={1.6} />
            </button>
          )}
          <div className="crumbs">
            <span>{user ? user.name.split(/\s+/)[0].toLowerCase() : "themis"}</span>
            <span className="sep">/</span>
            <span>{environments.find((e) => e._id === activeId)?.name ?? "no env"}</span>
            <span className="sep">/</span>
            <span className="current">
              <page.icon size={13} strokeWidth={1.8} />
              {page.label.toLowerCase()}
            </span>
          </div>
          <div className="topbar-actions">
            {counts && (
              <Link to={counts.incidents > 0 ? "/incidents" : "/monitors"} className={`live-count${counts.incidents > 0 ? " alert" : ""}`}>
                <span className="live-square" />
                {counts.incidents > 0
                  ? `${counts.incidents} open incident${counts.incidents === 1 ? "" : "s"}`
                  : counts.monitors === 0
                    ? "no monitors yet"
                    : `${counts.monitors} monitor${counts.monitors === 1 ? "" : "s"} live`}
              </Link>
            )}
            <button className="icon-btn" aria-label="Search" onClick={() => setPaletteOpen(true)}>
              <Search size={15} strokeWidth={1.6} />
            </button>
          </div>
        </header>
        <main className="main">
          {/* Keyed by path so each page change replays the enter transition. */}
          <div className="route" key={location.pathname}>
            <Page />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Shortcuts />
    </div>
  );
};
