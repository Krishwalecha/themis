import { setPageMeta } from "../lib/meta";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Wordmark } from "../components/ui";

export const NotFoundPage = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    setPageMeta("Page not found · Themis", false);
  }, []);

  return (
    <div className="nf">
      <Link to="/" className="nf-brand" aria-label="Themis home">
        <Wordmark />
      </Link>
      <main className="nf-main">
        <div className="nf-code" aria-hidden>
          404
        </div>
        <div className="nf-verdict">
          <span className="nf-method">GET</span>
          <span className="nf-path">{pathname}</span>
          <span className="nf-status">404</span>
          <span className="nf-tag">FAIL</span>
        </div>
        <h1>Nothing lives at this address.</h1>
        <p className="muted">The page moved, never existed, or the link has a typo. Every response gets a verdict, and this one's in.</p>
        <div className="nf-actions">
          <Link className="btn primary" to={user ? "/dashboard" : "/"}>
            {user ? "Open dashboard" : "Go home"}
          </Link>
          <button type="button" className="btn ghost" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} />
            Go back
          </button>
        </div>
      </main>
    </div>
  );
};
