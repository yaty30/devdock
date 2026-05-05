import type { ReactNode } from "react";
export type {
  ActivityKind,
  ActivityRecord,
  ActivityTone,
  BuildQueryOptions,
  BuildQueryResult,
  BuildQuerySortKey,
  BuildOutcomeType,
  BuildProfileRecord,
  DashboardEvent,
  GitStatusRecord,
  LogChannel,
  LogSearchResult,
  ProjectDashboardSummary,
  ProjectRecord,
  ProjectRuntimeState,
  ProjectSettingsRecord,
  RecentBuildRecord,
  ServiceAction,
  ServiceConfig,
  ServiceName,
  ServiceState,
  ServiceStatusRecord,
  Sheet,
  SheetContentJson,
  SheetUpdate,
  ShutdownEntry,
} from "../../shared/dashboardTypes";

export type AppSection = "dashboard" | "project";
export type DashboardTab = "dashboard" | "monitor" | "git-terminal" | "notes";
export type FontSizeMode = "large" | "regular" | "small";
export type SettingsTab = "general" | "services" | "git" | "builders";
export type Theme = "light" | "dark";

export type BuildStage = {
  label: string;
  time: string;
  state: "complete" | "current" | "pending" | "failed";
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
  commit: string;
  profile: string;
  status: "Running" | "Success" | "Failed";
  duration: string;
  completed: string;
};

export type ActivityItem = {
  title: string;
  meta: string;
  time: string;
  tone: "success" | "accent" | "info" | "neutral" | "error";
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
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "danger" | "warning";
  confirmDisabled?: boolean;
};
