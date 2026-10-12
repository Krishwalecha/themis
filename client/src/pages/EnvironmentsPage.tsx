import { Copy, Lock, LockOpen, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useConfirm, useToast } from "../components/Feedback";
import { KeyValueEditor } from "../components/KeyValueEditor";
import { EmptyState, Eyebrow } from "../components/ui";
import { api } from "../lib/api";
import { useEnvironments } from "../lib/environments";
import type { EnvironmentVariable } from "../lib/types";

const blankVar = (): EnvironmentVariable => ({ key: "", value: "", enabled: true, secret: false });

interface Form {
  id: string | null;
  name: string;
  variables: EnvironmentVariable[];
}

export const EnvironmentsPage = () => {
  const { environments, activeId, setActiveId, refresh } = useEnvironments();
  const confirm = useConfirm();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Select the first environment once loaded.
  useEffect(() => {
    if (selected === null && environments.length > 0 && !form) setSelected(environments[0]._id);
  }, [environments, selected, form]);

  // Secret values never come back from the server; their fields show dots, and typing replaces them.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setError(null);
    api.environments
      .get(selected)
      .then((env) => {
        if (cancelled) return;
        setForm({ id: env._id, name: env.name, variables: env.variables });
        setDirty(false);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const confirmDiscard = async () =>
    !dirty ||
    confirm({
      title: "Discard unsaved changes?",
      body: "Edits to this environment haven't been saved yet.",
      confirmLabel: "Discard",
      danger: true,
    });

  const select = async (id: string) => {
    if (id === selected || !(await confirmDiscard())) return;
    setSelected(id);
  };

  const startNew = async () => {
    if (!(await confirmDiscard())) return;
    setSelected(null);
    setForm({ id: null, name: "", variables: [{ key: "baseUrl", value: "", enabled: true, secret: false }] });
    setDirty(true);
    setError(null);
  };

  const update = (patch: Partial<Form>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const body = { name: form.name, variables: form.variables.filter((v) => v.key.trim()) };
      const env = form.id ? await api.environments.update(form.id, body) : await api.environments.create(body);
      await refresh();
      setForm({ id: env._id, name: env.name, variables: env.variables });
      setSelected(env._id);
      setDirty(false);
      toast(form.id ? "Environment saved" : "Environment created", { body: env.name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    if (!form?.id) return;
    try {
      const copy = await api.environments.duplicate(form.id);
      await refresh();
      setSelected(copy._id);
      toast("Environment duplicated", { body: copy.name });
    } catch (e) {
      toast("Couldn't duplicate", { tone: "error", body: (e as Error).message });
    }
  };

  const remove = async () => {
    if (!form?.id) return;
    const ok = await confirm({
      title: "Delete this environment?",
      body: (
        <>
          <strong>{form.name}</strong> and its {form.variables.length} variable{form.variables.length === 1 ? "" : "s"} will be removed. Requests
          that reference them will send the raw <code>{"{{name}}"}</code> text.
        </>
      ),
      confirmLabel: "Delete environment",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.environments.remove(form.id);
      if (activeId === form.id) setActiveId(null);
      await refresh();
      toast("Environment deleted", { body: form.name });
      setForm(null);
      setSelected(null);
      setDirty(false);
    } catch (e) {
      toast("Couldn't delete environment", { tone: "error", body: (e as Error).message });
    }
  };

  const varCount = form?.variables.filter((v) => v.key.trim()).length ?? 0;
  const secretCount = form?.variables.filter((v) => v.key.trim() && v.secret).length ?? 0;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>API testing</Eyebrow>
          <h1>Environments</h1>
          <p className="muted">
            Define variables once, reference them anywhere as <code>{"{{name}}"}</code>.
          </p>
        </div>
        {(form || environments.length > 0) && (
          <button className="btn primary" onClick={() => void startNew()}>
            <Plus size={14} /> New environment
          </button>
        )}
      </header>

      <div className={`panel env-shell${form ? "" : " is-empty"}`}>
        {form && (
          <aside className="env-rail">
            <div className="env-rail-head">
              <span className="eyebrow">Environments</span>
              <span className="eyebrow faint">{environments.length}</span>
            </div>
            <ul className="env-list">
              {!form?.id && form && (
                <li>
                  <span className="env-item selected">
                    <span className="env-item-name">{form.name.trim() || "Untitled"}</span>
                    <span className="env-item-meta">draft</span>
                  </span>
                </li>
              )}
              {environments.map((env) => (
                <li key={env._id}>
                  <button className={`env-item${env._id === selected ? " selected" : ""}`} onClick={() => void select(env._id)}>
                    <span className="env-item-name">
                      {env._id === activeId && <i className="env-active-dot" title="Active environment" />}
                      {env.name}
                    </span>
                    <span className="env-item-meta">{env.variables.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        )}

        {form ? (
          <section className="env-editor">
            <div className="env-editor-head">
              <label className="field env-name">
                <span className="label">Name</span>
                <input
                  className="input"
                  placeholder="e.g. Production"
                  value={form.name}
                  maxLength={100}
                  autoFocus={!form.id}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <div className="env-editor-actions">
                {form.id &&
                  (form.id === activeId ? (
                    <span className="chip active-chip">Active</span>
                  ) : (
                    <button className="btn ghost small" onClick={() => setActiveId(form.id)}>
                      Set active
                    </button>
                  ))}
                {form.id && (
                  <button className="icon-btn" title="Duplicate" aria-label="Duplicate environment" onClick={() => void duplicate()}>
                    <Copy size={14} strokeWidth={1.75} />
                  </button>
                )}
                {form.id && (
                  <button className="icon-btn danger" title="Delete" aria-label="Delete environment" onClick={() => void remove()}>
                    <Trash2 size={14} strokeWidth={1.75} />
                  </button>
                )}
              </div>
            </div>

            <div className="env-section">
              <div className="env-section-head">
                <Eyebrow>Variables</Eyebrow>
                <span className="muted small">
                  {varCount} defined{secretCount > 0 && ` · ${secretCount} secret`}
                </span>
              </div>

              {error && <div className="banner error">{error}</div>}

              <KeyValueEditor
                rows={form.variables}
                blank={blankVar}
                keyPlaceholder="variableName"
                headers={["Variable", "Value", "Secret"]}
                onChange={(variables) => update({ variables })}
                valueType={(row) => (row.secret ? "password" : "text")}
                renderExtra={(row, patch) => (
                  <button
                    type="button"
                    className={`icon-btn secret-toggle${row.secret ? " on" : ""}`}
                    aria-pressed={row.secret}
                    aria-label={row.secret ? "Secret: masked" : "Not secret"}
                    title={row.secret ? "Masked in lists and logs" : "Mark as secret"}
                    onClick={() => patch({ secret: !row.secret })}
                  >
                    {row.secret ? <Lock size={13} strokeWidth={1.75} /> : <LockOpen size={13} strokeWidth={1.75} />}
                  </button>
                )}
              />
            </div>

            <footer className="env-editor-foot">
              <span className={`save-state${dirty ? " dirty" : ""}`}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
              <button className="btn primary" disabled={saving || !form.name.trim() || !dirty} onClick={() => void save()}>
                {saving ? "Saving…" : form.id ? "Save changes" : "Create environment"}
              </button>
            </footer>
          </section>
        ) : (
          <EmptyState
            title={environments.length ? "Pick an environment" : "Add your first environment"}
            action={
              <button className="btn primary" onClick={() => void startNew()}>
                <Plus size={14} /> New environment
              </button>
            }
          >
            Keep URLs, tokens and IDs in one place. Create one like <code>staging</code>, add <code>baseUrl</code>, then send{" "}
            <code>{"{{baseUrl}}/users"}</code> from the workspace.
          </EmptyState>
        )}
      </div>
    </div>
  );
};
