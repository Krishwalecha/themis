import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Link, Navigate } from "react-router-dom";
import { METHOD_OPTIONS } from "../components/Badges";
import { RequestEditor, withUrl } from "../components/RequestEditor";
import { ResponsePanel } from "../components/ResponsePanel";
import { Split } from "../components/Split";
import { VarInput } from "../components/VarInput";
import { PublicTop } from "../components/PublicTop";
import { Select, WaveLoader } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { GuestEnvironments } from "../lib/environments";
import { withoutFileData } from "../lib/files";
import { setPageMeta } from "../lib/meta";
import { SEO } from "../seo";
import { storage } from "../lib/storage";
import { emptyRequest, type ExecutionResult, type HttpMethod, type RequestSpec } from "../lib/types";

const DRAFT_KEY = "themis.try";
const SAMPLE: RequestSpec = { ...emptyRequest(), url: "https://api.github.com/repos/facebook/react" };

// Send requests without an account. Nothing is saved on the server; the draft stays in this browser only.
export const TryPage = () => {
  const { status } = useAuth();
  const [spec, setSpec] = useState<RequestSpec>(() => ({ ...SAMPLE, ...storage.getJson<RequestSpec>(DRAFT_KEY) }));
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setPageMeta(SEO["/try"].title, true, SEO["/try"].description), []);
  useEffect(() => storage.setJson(DRAFT_KEY, withoutFileData(spec)), [spec]);

  const send = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!spec.url.trim() || sending) return;
      setSending(true);
      setError(null);
      try {
        const out = await api.guestExecute(spec);
        setResult(out.result);
        setUnresolved(out.unresolvedVariables);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSending(false);
      }
    },
    [spec, sending],
  );

  // signed-in people get the full workspace
  if (status === "signed-in") return <Navigate to="/workspace" replace />;

  return (
    <GuestEnvironments>
      <div className="public">
        <PublicTop />

        <main className="try-main">
          <div className="try-note">
            <span className="eyebrow">Guest mode</span>
            <p>
              Send a request to any public API. Nothing is saved. <Link to="/signup?next=/workspace">Create a free account</Link> to keep history, use
              environments, group requests into collections, and monitor them on a schedule.
            </p>
          </div>

          <form className="request-bar" onSubmit={(e) => void send(e)}>
            <Select mono label="HTTP method" value={spec.method} options={METHOD_OPTIONS} onChange={(m) => setSpec({ ...spec, method: m as HttpMethod })} />
            <VarInput
              wrapClassName="url-wrap"
              className="url-input mono"
              placeholder="https://api.example.com/users"
              value={spec.url}
              spellCheck={false}
              autoFocus
              onChange={(url) => setSpec(withUrl(spec, url))}
            />
            <button className="btn primary" type="submit" disabled={sending || !spec.url.trim()}>
              {sending ? <WaveLoader label="Sending" /> : "Send"}
            </button>
          </form>

          <Split
            id="try"
            labels={["Request", "Response"]}
            first={<RequestEditor spec={spec} onChange={setSpec} />}
            second={<ResponsePanel result={result} loading={sending} error={error} unresolvedVariables={unresolved} />}
          />

          <p className="try-foot muted small">
            Guests can send 20 requests a minute to public addresses, with a 15 second timeout.{" "}
            <Link to="/signup?next=/workspace">
              Sign up for the full workspace <ArrowRight size={12} />
            </Link>
          </p>
        </main>
      </div>
    </GuestEnvironments>
  );
};
