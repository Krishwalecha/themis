import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { API_BASE, PROMPT, preferredShell, rememberShell, SHELLS, toCommand, type Req, type Shell } from "../lib/shell";
import type { ContractListItem, Monitor, CollectionSummary } from "../lib/types";
import { Eyebrow, Select } from "../components/ui";

type Recipe = { title: string; note: string; req: Req };

const CopyCode = ({ text }: { text: string }) => {
  const [done, setDone] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(text).then(() => {
      setDone(true);
      window.setTimeout(() => setDone(false), 1400);
    });
  return (
    <button type="button" className="icon-btn cli-copy" onClick={copy} aria-label="Copy" title="Copy">
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
};

const Code = ({ text, prompt }: { text: string; prompt?: string }) => (
  <div className="cli-code">
    <pre>
      {prompt && <span className="cli-prompt">{prompt} </span>}
      {text}
    </pre>
    <CopyCode text={text} />
  </div>
);

const Block = ({ recipe, shell, children }: { recipe: Recipe; shell: Shell; children?: ReactNode }) => (
  <section className="cli-block">
    <div className="cli-block-head">
      <div>
        <h3>{recipe.title}</h3>
        <p className="muted">{recipe.note}</p>
      </div>
      {children}
    </div>
    <Code text={toCommand(recipe.req, shell, API_BASE)} prompt={PROMPT[shell]} />
  </section>
);

const ciStep = (base: string, monitorId: string, contractId: string, collectionId: string) => `- name: Themis gate
  env:
    THEMIS: ${/^https?:\/\//.test(base) ? base : `http://${base}`}
  run: |
    curl -sf -c .themis -H 'content-type: application/json' \\
      -d '{"email":"\${{ secrets.THEMIS_EMAIL }}","password":"\${{ secrets.THEMIS_PASSWORD }}"}' \\
      "$THEMIS/api/auth/login" > /dev/null
    # fails the job if the monitor isn't up
    curl -sf -b .themis -X POST "$THEMIS/api/monitors/${monitorId}/run?strict=1"
    # fails the job if any request in the collection fails
    curl -sf -b .themis -X POST "$THEMIS/api/collections/${collectionId}/run?strict=1"
    # fails the job if the response breaks the contract
    curl -sf -b .themis -H 'content-type: application/json' \\
      -d '{"request":{"url":"https://api.example.com/v1/orders"},"contractId":"${contractId}"}' \\
      "$THEMIS/api/requests/execute?strict=1"`;

export const CliPage = () => {
  const { user } = useAuth();

  const [shell, setShell] = useState<Shell>(preferredShell);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [monitorId, setMonitorId] = useState("");
  const [contractId, setContractId] = useState("");
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [collectionId, setCollectionId] = useState("");

  useEffect(() => {
    api.monitors
      .list()
      .then(({ items }) => {
        setMonitors(items);
        setMonitorId((id) => id || items[0]?._id || "");
      })
      .catch(() => {});
    api.contracts
      .list()
      .then(({ items }) => {
        setContracts(items);
        setContractId((id) => id || items[0]?._id || "");
      })
      .catch(() => {});
    api.collections
      .list()
      .then(({ items }) => {
        setCollections(items);
        setCollectionId((id) => id || items[0]?._id || "");
      })
      .catch(() => {});
  }, []);

  const pick = (s: Shell) => {
    setShell(s);
    rememberShell(s);
  };

  const monitor = monitorId || "MONITOR_ID";
  const contract = contractId || "CONTRACT_ID";
  const collection = collectionId || "COLLECTION_ID";
  const recipes = useMemo(
    () =>
      ({
        login: {
          title: "Sign in",
          note: "Once per terminal or CI job. Every command below reuses the session.",
          req: { path: "/api/auth/login", auth: "save", fail: true, body: JSON.stringify({ email: user?.email ?? "you@dev.io", password: "your-password" }) },
        },
        me: { title: "Who am I", note: "Check the session works before scripting anything else.", req: { path: "/api/auth/me", auth: "send", fail: true } },
        smoke: {
          title: "Smoke-test after a deploy",
          note: "Runs the monitor now. With strict, a down or degraded result exits non-zero, so your deploy script stops.",
          req: { method: "POST", path: `/api/monitors/${monitor}/run?strict=1`, auth: "send", fail: true },
        },
        suite: {
          title: "Run a collection",
          note: "Runs every saved request in order. Strict exits non-zero if any request errors, returns 4xx/5xx or breaks its contract.",
          req: { method: "POST", path: `/api/collections/${collection}/run?strict=1`, auth: "send", fail: true },
        },
        gate: {
          title: "Contract gate",
          note: "Calls your API and checks the response against the contract. Fails on any violation.",
          req: {
            path: "/api/requests/execute?strict=1",
            auth: "send",
            fail: true,
            body: JSON.stringify({ request: { url: "https://api.example.com/v1/orders" }, contractId: contract }),
          },
        },
        check: {
          title: "Check any endpoint",
          note: "One-off request, judged and saved to history. Strict exits non-zero on errors and 4xx/5xx.",
          req: { path: "/api/requests/execute?strict=1", auth: "send", fail: true, body: '{"request":{"url":"https://api.github.com"}}' },
        },
        incidents: {
          title: "What's broken right now",
          note: "Open incidents, for status bars, chat bots or a morning script.",
          req: { path: "/api/incidents?status=open", auth: "send" },
        },
        monitors: { title: "Monitors and their ids", note: "Every monitor with its state and 24h uptime.", req: { path: "/api/monitors", auth: "send" } },
        history: { title: "Recent runs", note: "Your last 10 requests, newest first.", req: { path: "/api/history?limit=10", auth: "send" } },
        health: { title: "Is Themis up?", note: "Public, no session needed.", req: { path: "/api/health", fail: true } },
        logout: { title: "Sign out", note: "Ends the session on the server. Run it at the end of a CI job.", req: { method: "POST", path: "/api/auth/logout", auth: "send" } },
      }) satisfies Record<string, Recipe>,
    [user?.email, monitor, contract, collection],
  );

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Eyebrow>CLI</Eyebrow>
          <h1>Script it</h1>
          <p className="muted">
            Gate deploys, check contracts in CI and query incidents from any terminal. Commands are filled in for your account and
            run against <span className="mono">{API_BASE}</span>.
          </p>
        </div>
      </header>

      <div className="cli-shells" role="tablist" aria-label="Shell">
        {SHELLS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === shell} className={s.id === shell ? "active" : ""} title={s.hint} onClick={() => pick(s.id)}>
            {s.label}
          </button>
        ))}
        <span className="cli-shell-hint">{SHELLS.find((s) => s.id === shell)?.hint}</span>
      </div>

      <div className="cli-grid">
        <Block recipe={recipes.login} shell={shell} />
        <Block recipe={recipes.me} shell={shell} />
        <Block recipe={recipes.smoke} shell={shell}>
          {monitors.length > 0 && (
            <Select size="small" label="Monitor" value={monitorId} onChange={setMonitorId} options={monitors.map((m) => ({ value: m._id, label: m.name }))} />
          )}
        </Block>
        <Block recipe={recipes.suite} shell={shell}>
          {collections.length > 0 && (
            <Select size="small" label="Collection" value={collectionId} onChange={setCollectionId} options={collections.map((c) => ({ value: c._id, label: c.name }))} />
          )}
        </Block>
        <Block recipe={recipes.gate} shell={shell}>
          {contracts.length > 0 && (
            <Select size="small" label="Contract" value={contractId} onChange={setContractId} options={contracts.map((c) => ({ value: c._id, label: c.name }))} />
          )}
        </Block>
        <Block recipe={recipes.check} shell={shell} />
        <Block recipe={recipes.incidents} shell={shell} />
        <Block recipe={recipes.monitors} shell={shell} />
        <Block recipe={recipes.history} shell={shell} />
        <Block recipe={recipes.health} shell={shell} />
        <Block recipe={recipes.logout} shell={shell} />
      </div>

      <section className="cli-block cli-ci">
        <div className="cli-block-head">
          <div>
            <h3>GitHub Actions</h3>
            <p className="muted">
              Drop this step into a workflow. Store your email and password as <span className="mono">THEMIS_EMAIL</span> and{" "}
              <span className="mono">THEMIS_PASSWORD</span> secrets. The job fails when the monitor is down, a collection request fails or the contract breaks.
            </p>
          </div>
        </div>
        <Code text={ciStep(API_BASE, monitor, contract, collection)} />
      </section>

      <p className="muted cli-foot">
        Output is pretty-printed for curl. PowerShell keeps the session in <span className="mono">$themis</span>; bash and cmd keep it in a{" "}
        <span className="mono">.themis</span> file in the current folder.
      </p>
    </div>
  );
};
