import { SettingUp } from "../components/SettingUp";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { safeNext } from "../components/RequireAuth";
import { Marks, WaveLoader, Wordmark } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { setPageMeta } from "../lib/meta";
import { SEO } from "../seo";
import { useAuth } from "../lib/auth";
import { USERNAME, useUsernameCheck } from "../lib/username";
import "../styles/auth.css";

type Mode = "login" | "signup";

// 0–4 rough strength score: length and character variety
const strength = (pw: string): number => {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.max(1, s);
};
const STRENGTH = ["", "weak", "fair", "good", "strong"];

const FEED = [
  ["payments-api", "200", "142ms"],
  ["auth", "200", "88ms"],
  ["search", "200", "212ms"],
  ["orders", "503", "30.0s"],
  ["users", "200", "61ms"],
] as const;

// The always-dark side panel: a live-looking instrument so the page has a pulse
const SidePanel = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1800);
    return () => clearInterval(t);
  }, []);
  const bars = useMemo(() => Array.from({ length: 48 }, (_, i) => (i === 31 ? "down" : i === 12 || i === 40 ? "warn" : "up")), []);
  const [name, code, ms] = FEED[tick % FEED.length];

  return (
    <aside className="auth-side">
      <div className="auth-side-grid" aria-hidden />
      <div className="auth-side-inner">
        <span className="eyebrow">
          <span className="live-dot" /> live
        </span>
        <h2>
          Know your APIs are slow <em>before</em> your users do.
        </h2>
        <div className="auth-meter framed">
          <Marks />
          <div className="auth-meter-top">
            <span className="eyebrow">uptime · 24h</span>
            <span className="auth-feed" key={tick}>
              {name} <b className={code === "200" ? "ok" : "bad"}>{code}</b> {ms}
            </span>
          </div>
          <div className="auth-big">
            99<small>.982%</small>
          </div>
          <div className="auth-bars">
            {bars.map((b, i) => (
              <i key={i} className={b} style={{ "--i": i } as CSSProperties} />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
};

// Google's "G", in its own colours, as Google's sign-in guidelines ask
const GoogleMark = () => (
  <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.9 6.2C12.5 13.6 17.8 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z" />
    <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.2C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.9-6.2z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.2C6.6 42.6 14.6 48 24 48z" />
  </svg>
);

export const AuthPage = ({ mode }: { mode: Mode }) => {
  const { status, user, login, register } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get("next"));
  // set after sign-up, only to show the "account created" note
  const welcome = params.get("welcome") === "1";

  const [name, setName] = useState("");
  // on sign-in this holds an email or a username
  const [email, setEmail] = useState(() => (mode === "login" ? (params.get("email") ?? "") : ""));
  const [username, setUsername] = useState("");
  const avail = useUsernameCheck(mode === "signup" ? username : "", "");
  const [firstSignIn, setFirstSignIn] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [entering, setEntering] = useState<string | null>(null);
  useEffect(() => {
    const page = SEO[mode === "signup" ? "/signup" : "/login"];
    setPageMeta(page.title, true, page.description);
  }, [mode]);
  // "Continue with Google" shows only when the server has it set up
  const [google, setGoogle] = useState(false);
  useEffect(() => {
    api.auth
      .config()
      .then((c) => setGoogle(c.google))
      .catch(() => undefined);
  }, []);
  // back from Google: ?oauth=1 when signed in, ?oauthError=… when not
  const oauth = params.get("oauth") === "1";
  const oauthError = params.get("oauthError");

  useEffect(() => {
    setError(null);
    setFieldErrors({});
    // the password never carries over between sign-up and sign-in
    setPassword("");
    if (mode === "login" && params.get("email")) setEmail(params.get("email")!);
  }, [mode, params]);

  if (entering !== null) return <SettingUp next={next} name={entering} isNew={firstSignIn} />;
  if (oauth && status === "signed-in" && user) return <SettingUp next={next} name={user.name} isNew={params.get("first") === "1"} />;
  if (status === "signed-in") return <Navigate to={next} replace />;

  const isSignup = mode === "signup";
  const score = strength(password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const local: Record<string, string> = {};
    if (isSignup && !name.trim()) local.name = "Tell us your name";
    if (isSignup && !USERNAME.test(username.trim().toLowerCase())) local.username = "Use 3 to 20 letters, numbers or underscores";
    else if (isSignup && avail.state === "bad") local.username = avail.reason ?? "That username is taken";
    if (isSignup && !/^\S+@\S+\.\S+$/.test(email.trim())) local.email = "Enter a valid email";
    if (!isSignup && !email.trim()) local.email = "Enter your email or username";
    if (isSignup && password.length < 8) local.password = "Use at least 8 characters";
    if (!isSignup && !password) local.password = "Enter your password";
    if (Object.keys(local).length) {
      setFieldErrors(local);
      return;
    }
    setBusy(true);
    try {
      if (isSignup) {
        await register(name.trim(), email.trim(), username.trim().toLowerCase(), password);
        const q = new URLSearchParams({ email: email.trim(), welcome: "1" });
        if (params.get("next")) q.set("next", params.get("next")!);
        navigate(`/login?${q}`, { replace: true });
        return;
      }
      const res = await login(email.trim(), password);
      setFirstSignIn(res.firstSignIn);
      setEntering(res.user.name);
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        setFieldErrors(Object.fromEntries(err.details.map((d) => [d.path, d.message])));
      } else {
        setError(err instanceof ApiError ? err.message : "Can't reach the server. Is the API running?");
      }
    } finally {
      setBusy(false);
    }
  };

  const qs = params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : "";

  return (
    <div className="auth">
      <main className="auth-main">
        <Link to="/" className="auth-brand">
          <Wordmark />
        </Link>

        <div className="auth-card" key={mode}>
          <span className="eyebrow">{isSignup ? "Create account" : "Sign in"}</span>
          <h1>{isSignup ? "Start watching your APIs." : "Welcome back."}</h1>
          <p className="muted">{isSignup ? "Your monitors, contracts and history stay private to your account." : "Pick up where your monitors left off."}</p>

          {welcome && !isSignup && !error && <div className="banner success">Account created. Sign in to finish setting up.</div>}
          {(error || oauthError) && (
            <div className="banner error" role="alert">
              {error ?? oauthError}
            </div>
          )}

          {google && (
            <>
              <a className="btn ghost auth-google" href={`/api/auth/google?${new URLSearchParams({ next })}`}>
                <GoogleMark />
                Continue with Google
              </a>
              <div className="auth-or" aria-hidden>
                <span>or</span>
              </div>
            </>
          )}

          <form className="auth-form" onSubmit={submit} noValidate>
            {isSignup && (
              <label className={`field${fieldErrors.name ? " invalid" : ""}`}>
                <span>Name</span>
                <input className="input" autoComplete="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" />
                {fieldErrors.name && <em className="field-error">{fieldErrors.name}</em>}
              </label>
            )}
            {isSignup && (
              <label className={`field${fieldErrors.username || avail.state === "bad" ? " invalid" : ""}`}>
                <span>Username</span>
                <span className={`auth-handle ${avail.state}`}>
                  <i aria-hidden>@</i>
                  <input
                    className="input"
                    autoComplete="username"
                    spellCheck={false}
                    maxLength={20}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="ada_l"
                  />
                </span>
                {fieldErrors.username ? (
                  <em className="field-error">{fieldErrors.username}</em>
                ) : (
                  avail.state !== "idle" && (
                    <em className={`field-hint ${avail.state}`}>
                      {avail.state === "checking" ? "Checking…" : avail.state === "ok" ? "Available" : avail.reason}
                    </em>
                  )
                )}
              </label>
            )}
            <label className={`field${fieldErrors.email ? " invalid" : ""}`}>
              <span>{isSignup ? "Email" : "Email or username"}</span>
              <input
                className="input"
                type={isSignup ? "email" : "text"}
                autoComplete={isSignup ? "email" : "username"}
                autoFocus={!isSignup && !email}
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isSignup ? "you@company.com" : "you@company.com or ada_l"}
              />
              {fieldErrors.email && <em className="field-error">{fieldErrors.email}</em>}
            </label>
            <label className={`field${fieldErrors.password ? " invalid" : ""}`}>
              <span>Password</span>
              <span className="pw">
                <input
                  className="input"
                  type={show ? "text" : "password"}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  autoFocus={!isSignup && Boolean(email)}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignup ? "At least 8 characters" : "••••••••"}
                />
                <button type="button" className="icon-btn" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)}>
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </span>
              {isSignup && password && (
                <span className={`pw-meter s${score}`} aria-label={`Password strength: ${STRENGTH[score]}`}>
                  <i />
                  <i />
                  <i />
                  <i />
                  <b>{STRENGTH[score]}</b>
                </span>
              )}
              {fieldErrors.password && <em className="field-error">{fieldErrors.password}</em>}
            </label>

            <button className="btn primary auth-submit" disabled={busy}>
              {busy ? (
                <WaveLoader label={isSignup ? "Creating account" : "Signing in"} />
              ) : (
                <>
                  {isSignup ? "Create account" : "Sign in"} <ArrowRight size={15} className="nudge" />
                </>
              )}
            </button>
          </form>

          <p className="auth-switch">
            {isSignup ? (
              <>
                Already have an account? <Link to={`/login${qs}`}>Sign in</Link>
              </>
            ) : (
              <>
                New to Themis? <Link to={`/signup${qs}`}>Create an account</Link>
              </>
            )}
          </p>
        </div>

        <footer className="auth-foot">
          <span>
            By continuing you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.
          </span>
        </footer>
      </main>
      <SidePanel />
    </div>
  );
};
