import {
  CheckCircle2,
  FileText,
  Globe2,
  Layers3,
  Package,
  Play,
  SquareTerminal,
} from "lucide-react";
import type {
  ActivityItem,
  BuildProfile,
  BuildStage,
  MonitorCard,
  Project,
  RecentBuild,
} from "../types";

export const projects: Project[] = [];

export const branchInfo = {};

export const consoleLinks = {};

export const frontendLogs = [];

export const wildFlyLogs = [];

export const buildStages: BuildStage[] = [];

export const buildLog = [];

export const tailLogs = [];

export const monitorCards: MonitorCard[] = [
  {
    title: "Frontend",
    icon: <SquareTerminal size={26} />,
    rows: [],
  },
  {
    title: "WildFly",
    icon: <Layers3 size={26} />,
    rows: [],
  },
  {
    title: "Consoles",
    icon: <Globe2 size={26} />,
    rows: [],
  },
  {
    title: "Last Build",
    icon: <CheckCircle2 size={26} />,
    rows: [],
  },
];

export const recentBuilds: RecentBuild[] = [];

export const activityFeed: ActivityItem[] = [];

export const gitTerminalLines = [];

export const quickGitCommands = [];

export const buildProfiles: BuildProfile[] = [];
