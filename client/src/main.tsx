import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { FeedbackProvider } from "./components/Feedback";
import { TooltipLayer } from "./components/Tooltip";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { AuthProvider } from "./lib/auth";
import { AuthPage } from "./pages/AuthPage";
import { EnvironmentProvider } from "./lib/environments";
import { NotFoundPage } from "./pages/NotFoundPage";
import { pages } from "./pages";
import "./index.css";

// The landing page carries its own Tailwind stylesheet, so it only loads on "/".
const LandingPage = lazy(() => import("./landing/LandingPage"));

const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0a09" }} />}>
        <LandingPage />
      </Suspense>
    ),
  },
  { path: "/login", element: <AuthPage mode="login" /> },
  { path: "/signup", element: <AuthPage mode="signup" /> },
  // public, no sign-in
  { path: "/status/:slug", lazy: pages.StatusPage },
  // send requests without an account
  { path: "/try", lazy: pages.TryPage },
  { path: "/privacy", lazy: pages.PrivacyPage },
  { path: "/terms", lazy: pages.TermsPage },
  {
    element: (
      <RequireAuth>
        <EnvironmentProvider>
          <Layout />
        </EnvironmentProvider>
      </RequireAuth>
    ),
    children: [
      { path: "workspace", lazy: pages.WorkspacePage },
      { path: "collections", lazy: pages.CollectionsPage },
      { path: "collections/:id", lazy: pages.CollectionPage },
      { path: "history", lazy: pages.HistoryPage },
      { path: "environments", lazy: pages.EnvironmentsPage },
      { path: "dashboard", lazy: pages.DashboardPage },
      { path: "monitors", lazy: pages.MonitorsPage },
      { path: "monitors/new", lazy: pages.MonitorFormPage },
      { path: "monitors/:id", lazy: pages.MonitorDetailPage },
      { path: "monitors/:id/edit", lazy: pages.MonitorFormPage },
      { path: "incidents", lazy: pages.IncidentsPage },
      { path: "contracts", lazy: pages.ContractsPage },
      { path: "contracts/new", lazy: pages.ContractPage },
      { path: "contracts/:id", lazy: pages.ContractPage },
      { path: "cli", lazy: pages.CliPage },
      { path: "settings", lazy: pages.SettingsPage },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <FeedbackProvider>
        <RouterProvider router={router} />
        <TooltipLayer />
      </FeedbackProvider>
    </AuthProvider>
  </StrictMode>,
);
