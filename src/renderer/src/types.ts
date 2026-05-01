import type { ReactNode } from "react";

export type AppSection = "dashboard" | "settings";
export type DashboardTab = "dashboard" | "monitor" | "git-terminal";
export type SettingsTab = "general" | "services" | "git" | "builders";
export type Theme = "light" | "dark";

export type BuildStage = {
  label: string;
  time: string;
  current?: boolean;
};

export type Project = {
  id: string;
  name: string;
  code: string;
};

export type MonitorCard = {
  title: string;
  icon: ReactNode;
  rows: Array<{
    label: string;
    value: ReactNode;
  }>;
};

export type RecentBuild = {
  id: string;
  branch: string;
  environment: "Production" | "SIT";
  triggeredBy: string;
  status: "Success" | "Failed";
  duration: string;
  completed: string;
};

export type ActivityItem = {
  title: string;
  meta: string;
  time: string;
  tone: "success" | "accent" | "neutral";
  icon: ReactNode;
};

export type BuildProfile = {
  buttonName: string;
  profileName: string;
  goal: string;
  confirm: boolean;
};

export type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
};
