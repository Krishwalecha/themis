import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { DotLoader } from "./ui";

// Renders children for signed-in users; everyone else goes to /login and comes back afterwards
export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <div className="boot">
        <DotLoader large label="Loading your workspace" />
      </div>
    );
  }
  if (status === "signed-out") {
    const next = location.pathname + location.search;
    return <Navigate to={`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`} replace />;
  }
  return <>{children}</>;
};

// Only allows same-app relative paths as post-login destinations (no open redirects)
export const safeNext = (raw: string | null): string => {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/dashboard";
  return raw;
};
