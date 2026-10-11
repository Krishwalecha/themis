import type React from "react";

// app pages load per route; Layout warms them all once the app is idle
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, key: K) => async () => ({ Component: (await load())[key] });

export const pages = {
  ContractPage: page(() => import("./pages/ContractPage"), "ContractPage"),
  ContractsPage: page(() => import("./pages/ContractsPage"), "ContractsPage"),
  DashboardPage: page(() => import("./pages/DashboardPage"), "DashboardPage"),
  EnvironmentsPage: page(() => import("./pages/EnvironmentsPage"), "EnvironmentsPage"),
  HistoryPage: page(() => import("./pages/HistoryPage"), "HistoryPage"),
  IncidentsPage: page(() => import("./pages/IncidentsPage"), "IncidentsPage"),
  MonitorDetailPage: page(() => import("./pages/MonitorDetailPage"), "MonitorDetailPage"),
  MonitorFormPage: page(() => import("./pages/MonitorFormPage"), "MonitorFormPage"),
  MonitorsPage: page(() => import("./pages/MonitorsPage"), "MonitorsPage"),
  CliPage: page(() => import("./pages/CliPage"), "CliPage"),
  CollectionPage: page(() => import("./pages/CollectionPage"), "CollectionPage"),
  CollectionsPage: page(() => import("./pages/CollectionsPage"), "CollectionsPage"),
  WorkspacePage: page(() => import("./pages/WorkspacePage"), "WorkspacePage"),
  SettingsPage: page(() => import("./pages/SettingsPage"), "SettingsPage"),
  StatusPage: page(() => import("./pages/StatusPage"), "StatusPage"),
  TryPage: page(() => import("./pages/TryPage"), "TryPage"),
  PrivacyPage: page(() => import("./pages/LegalPage"), "PrivacyPage"),
  TermsPage: page(() => import("./pages/LegalPage"), "TermsPage"),
};

export const prefetchPages = () => Object.values(pages).forEach((load) => void load());
