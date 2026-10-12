import { useEffect, useState, type FormEvent } from "react";
import { SquareArrowOutUpRight } from "lucide-react";
import { useConfirm, useToast } from "../components/Feedback";
import { Eyebrow } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Monitor, StatusPageSettings } from "../lib/types";
import { useUsernameCheck } from "../lib/username";

const ProfileSection = () => {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [saving, setSaving] = useState(false);
  const avail = useUsernameCheck(username, user?.username ?? "");
  if (!user) return null;

  const nextName = name.trim();
  const nextUsername = username.trim().toLowerCase();
  const dirty = nextName !== user.name || nextUsername !== (user.username ?? "");
  const blocked = !nextName || avail.state === "bad" || avail.state === "checking";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || blocked) return;
    setSaving(true);
    try {
      const body: { name?: string; username?: string } = {};
      if (nextName !== user.name) body.name = nextName;
      if (nextUsername !== (user.username ?? "")) body.username = nextUsername;
      const { user: updated } = await api.auth.updateProfile(body);
      setUser(updated);
      setUsername(updated.username ?? "");
      toast("Profile saved");
    } catch (err) {
      toast("Couldn't save your profile", { tone: "error", body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings-section" onSubmit={(e) => void save(e)}>
      <div className="settings-head">
        <span className="eyebrow">Profile</span>
        <p className="muted">How you appear across Themis.</p>
      </div>
      <label className="field">
        <span>Name</span>
        <input className="input" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Username</span>
        <div className={`settings-handle ${avail.state}`}>
          <span className="settings-at">@</span>
          <input
            className="input"
            value={username}
            maxLength={20}
            spellCheck={false}
            autoComplete="username"
            placeholder="your_handle"
            aria-invalid={avail.state === "bad"}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <span className={`settings-hint ${avail.state}`} role="status">
          {avail.state === "checking" ? "Checking…" : avail.state === "ok" ? "Available" : avail.state === "bad" ? avail.reason : "Leave empty to remove it."}
        </span>
      </label>
      <label className="field">
        <span>Email</span>
        <input className="input" value={user.email} disabled />
      </label>
      <div className="settings-actions">
        <button className="btn primary" type="submit" disabled={!dirty || blocked || saving}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
};

const PasswordSection = () => {
  const { user, setUser } = useAuth();
  // accounts made with Google set their first password without a current one
  const hasPassword = user?.hasPassword !== false;
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const mismatch = repeat.length > 0 && next !== repeat;
  const short = next.length > 0 && next.length < 8;
  const ready = (current || !hasPassword) && next.length >= 8 && next === repeat;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    try {
      await api.auth.changePassword({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      if (user && !hasPassword) setUser({ ...user, hasPassword: true });
      toast(hasPassword ? "Password changed" : "Password set", {
        body: hasPassword ? "Other sessions were signed out." : "You can now also sign in with your email and password.",
      });
    } catch (err) {
      toast("Couldn't change your password", { tone: "error", body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="settings-section" onSubmit={(e) => void save(e)}>
      <div className="settings-head">
        <span className="eyebrow">Password</span>
        <p className="muted">
          {hasPassword ? "Changing it signs out every other session." : "You sign in with Google. Set a password to also sign in with your email."}
        </p>
      </div>
      {hasPassword && (
        <label className="field">
          <span>Current password</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>New password</span>
        <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        {short && <span className="settings-hint bad">Use at least 8 characters.</span>}
      </label>
      <label className="field">
        <span>Repeat new password</span>
        <input className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {mismatch && <span className="settings-hint bad">Passwords don't match.</span>}
      </label>
      <div className="settings-actions">
        <button className="btn primary" type="submit" disabled={!ready || saving}>
          {saving ? "Saving…" : hasPassword ? "Change password" : "Set password"}
        </button>
      </div>
    </form>
  );
};

const StatusPageSection = () => {
  const { user } = useAuth();
  const toast = useToast();
  const [saved, setSaved] = useState<StatusPageSettings | null>(null);
  const [form, setForm] = useState<StatusPageSettings>({ enabled: false, slug: "", title: "", monitorIds: [] });
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.statusPage.get(), api.monitors.list()])
      .then(([page, { items }]) => {
        const start = page.slug ? page : { ...page, slug: user?.username?.replace(/_/g, "-") ?? "" };
        setSaved(page);
        setForm(start);
        setMonitors(items);
      })
      .catch(() => undefined);
  }, [user?.username]);

  const set = (patch: Partial<StatusPageSettings>) => setForm((f) => ({ ...f, ...patch }));
  const toggle = (id: string) => set({ monitorIds: form.monitorIds.includes(id) ? form.monitorIds.filter((x) => x !== id) : [...form.monitorIds, id] });
  const slugOk = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(form.slug);
  const dirty = JSON.stringify(saved) !== JSON.stringify(form);
  const url = `${window.location.origin}/status/${form.slug}`;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!slugOk) return;
    setSaving(true);
    try {
      const next = await api.statusPage.save(form);
      setSaved(next);
      setForm(next);
      toast(next.enabled ? "Status page is live" : "Status page saved", { body: next.enabled ? url : "It stays private until you turn it on." });
    } catch (err) {
      toast("Couldn't save the status page", { tone: "error", body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!saved) return null;
  return (
    <form className="settings-section" onSubmit={(e) => void save(e)}>
      <div className="settings-head">
        <span className="eyebrow">Status page</span>
        <p className="muted">A public page with the health and uptime of the monitors you pick. It shows names and timing only, never URLs or error details.</p>
      </div>
      <label className="field checkbox-field">
        <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Publish the page</span>
      </label>
      <label className="field">
        <span>Address</span>
        <div className="settings-prefix">
          <span className="settings-prefix-text mono">{window.location.host}/status/</span>
          <input
            className="input mono"
            value={form.slug}
            maxLength={40}
            spellCheck={false}
            placeholder="acme"
            aria-invalid={Boolean(form.slug) && !slugOk}
            onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
          />
        </div>
        {form.slug && !slugOk && (
          <span className="settings-hint bad">Use 3 to 40 letters, numbers or dashes, starting and ending with a letter or number.</span>
        )}
      </label>
      <label className="field">
        <span>Title</span>
        <input className="input" placeholder="Acme status" maxLength={80} value={form.title} onChange={(e) => set({ title: e.target.value })} />
      </label>
      <div className="field">
        <span>Monitors shown</span>
        {monitors.length === 0 ? (
          <p className="muted small">No monitors yet.</p>
        ) : (
          <div className="settings-checklist">
            {monitors.map((m) => (
              <label key={m._id} className="field checkbox-field">
                <input type="checkbox" checked={form.monitorIds.includes(m._id)} onChange={() => toggle(m._id)} />
                <span className="truncate">{m.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="settings-actions">
        {saved.enabled && saved.slug && (
          <a className="btn ghost" href={`/status/${saved.slug}`} target="_blank" rel="noreferrer">
            <SquareArrowOutUpRight size={14} />
            Open page
          </a>
        )}
        <button className="btn primary" type="submit" disabled={!dirty || !slugOk || saving}>
          {saving ? "Saving…" : "Save status page"}
        </button>
      </div>
    </form>
  );
};

const DangerSection = () => {
  const { user } = useAuth();
  // without a password, typing the account's email confirms instead
  const hasPassword = user?.hasPassword !== false;
  const confirm = useConfirm();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    const ok = await confirm({
      title: "Delete your account?",
      body: "Every monitor, contract, collection, environment and history entry goes with it. This can't be undone.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.auth.deleteAccount(hasPassword ? { password } : { email: password });
      window.location.assign("/");
    } catch (err) {
      toast("Couldn't delete your account", { tone: "error", body: (err as Error).message });
      setBusy(false);
    }
  };

  return (
    <form className="settings-section danger" onSubmit={(e) => void remove(e)}>
      <div className="settings-head">
        <span className="eyebrow">Delete account</span>
        <p className="muted">Removes your account and everything in it, for good.</p>
      </div>
      <label className="field">
        <span>{hasPassword ? "Confirm with your password" : `Type ${user?.email ?? "your email"} to confirm`}</span>
        <input
          className="input"
          type={hasPassword ? "password" : "email"}
          autoComplete={hasPassword ? "current-password" : "off"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <div className="settings-actions">
        <button className="btn destructive" type="submit" disabled={!password || busy}>
          {busy ? "Deleting…" : "Delete account"}
        </button>
      </div>
    </form>
  );
};

export const SettingsPage = () => {
  return (
    <div className="page settings-page">
      <header className="page-header">
        <div>
          <Eyebrow>Account</Eyebrow>
          <h1>Settings</h1>
          <p className="muted">Your profile, password, status page and account.</p>
        </div>
      </header>
      <div className="panel settings-panel">
        <ProfileSection />
        <PasswordSection />
        <StatusPageSection />
        <DangerSection />
      </div>
    </div>
  );
};
