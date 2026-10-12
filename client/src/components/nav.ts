import { Activity, FileCheck2, FolderOpen, History, LayoutGrid, Send, Settings, Siren, SquareTerminal, Variable, type LucideIcon } from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  section: "Overview" | "Build";
  badge?: "monitors" | "incidents" | "contracts";
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid, section: "Overview" },
  { to: "/monitors", label: "Monitors", icon: Activity, section: "Overview", badge: "monitors" },
  { to: "/incidents", label: "Incidents", icon: Siren, section: "Overview", badge: "incidents" },
  { to: "/workspace", label: "Workspace", icon: Send, section: "Build" },
  { to: "/collections", label: "Collections", icon: FolderOpen, section: "Build" },
  { to: "/contracts", label: "Contracts", icon: FileCheck2, section: "Build", badge: "contracts" },
  { to: "/history", label: "History", icon: History, section: "Build" },
  { to: "/environments", label: "Environments", icon: Variable, section: "Build" },
  { to: "/cli", label: "CLI", icon: SquareTerminal, section: "Build" },
];

const SETTINGS: NavItem = { to: "/settings", label: "Settings", icon: Settings, section: "Overview" };

// Page title for the breadcrumb, from the current path
export const pageFor = (pathname: string): NavItem => {
  if (pathname.startsWith(SETTINGS.to)) return SETTINGS;
  return NAV_ITEMS.find((n) => pathname.startsWith(n.to)) ?? NAV_ITEMS[0];
};
