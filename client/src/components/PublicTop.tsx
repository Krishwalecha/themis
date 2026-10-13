import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Wordmark } from "./ui";

// The top bar of public pages outside the app shell (/try, privacy, terms)
export const PublicTop = () => {
  const { status } = useAuth();
  return (
    <header className="public-top">
      <Link to="/" className="public-brand" aria-label="Themis home">
        <Wordmark />
      </Link>
      <nav className="public-auth">
        {status === "signed-in" ? (
          <Link to="/dashboard" className="btn primary small">
            Open dashboard
          </Link>
        ) : (
          <>
            <Link to="/login" className="btn ghost small">
              Sign in
            </Link>
            <Link to="/signup?next=/workspace" className="btn primary small">
              Create free account
            </Link>
          </>
        )}
      </nav>
    </header>
  );
};
