import type { ReactNode } from "react";
export type {
  ActivityKind,
  ActivityRecord,
  ActivityTone,
  ApiTesterRequest,
  ApiTesterFormDataPart,
  ApiTesterResponse,
  ApiTesterResponseHeader,
  BuildQueryOptions,
  BuildQueryResult,
  BuildQuerySortKey,
  BuildOutcomeType,
  BuildProfileRecord,
  DashboardEvent,
  DatabaseColumn,
  DatabaseColumnMetadata,
  DatabaseConnection,
  DatabaseConnectionStatus,
  DatabaseConnectionTestResult,
  DatabaseConnectionType,
  DatabaseExecutionRecord,
  DatabaseExecutionBatchResult,
  DatabaseIndex,
  DatabaseMetadata,
  DatabasePartition,
  DatabaseQueryColumn,
  DatabaseQueryValue,
  DatabaseSslMode,
  DatabaseStatementExecutionResult,
  DatabaseTable,
  DatabaseTrigger,
  DatabaseWorksheet,
  DatabaseWorksheetState,
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
  OracleConnectionMode,
} from "../../shared/dashboardTypes";
export type {
  ChatAttachment,
  ChatConversation,
  ChatEvent,
  ChatMessage,
  ChatMessagePage,
  ChatNativeNotification,
  ChatServiceConfig,
  ChatUser,
  ChatUserProfile,
} from "../../shared/chatTypes";

export type AppSection = "dashboard" | "project" | "database" | "tools";
export type ToolId = "comparing" | "api-tester" | "cryptographic";
export type DashboardTab = "dashboard" | "monitor" | "git-terminal" | "notes";
export type DatabaseWorkspaceTab = "connection" | "monitor";
export type FontSizeMode =
  | "50"
  | "70"
  | "90"
  | "100"
  | "120"
  | "140"
  | "160";
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
