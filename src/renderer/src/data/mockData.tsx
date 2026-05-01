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

export const projects: Project[] = [
  { id: "iap", name: "Project IAP", code: "IAP" },
  { id: "ivs-core", name: "Project IVS Core", code: "IVS" },
];

export const branchInfo = {
  branch: "feature/dashboard-prototype",
  commit: "a8c42f1",
};

export const consoleLinks = {
  admin: "http://localhost:9990/management",
  kmu: "http://localhost:8080/iap",
};

export const frontendLogs = [
  "10:24:51 [vite] server started",
  "10:24:51 Local: http://localhost:5173/",
  "10:24:51 Network: use --host to expose",
  "10:24:51 working directory: C:\\projects\\iap\\frontend",
  "10:24:51 ready in 1.2s",
  "10:25:07 [warn] Large chunk size detected: vendor.js",
];

export const wildFlyLogs = [
  "10:22:15 Starting WildFly 28.0.1.Final",
  "10:22:16 WFLYCTL0184: WildFly Core 28.0.1.Final",
  "10:22:17 Server configuration: standalone.xml",
  "10:22:19 Management interface listening on port 9990",
  "10:22:20 HTTP management interface listening on port 9990",
  '10:22:21 Deployed "iap.war" runtime-name: iap.war',
  "10:22:22 WildFly started in 3,642ms - Started 517 of 817",
];

export const buildStages: BuildStage[] = [
  { label: "Build started", time: "09:34:21 AM" },
  { label: "Clean project", time: "09:34:24 AM" },
  { label: "Backend compile", time: "09:34:48 AM" },
  { label: "Frontend build", time: "09:36:12 AM" },
  { label: "Package WAR", time: "09:37:05 AM" },
  { label: "Deploying", time: "09:40:10 AM" },
  { label: "Completed", time: "09:41:03 AM", current: true },
];

export const buildLog = [
  "10:24:12 [INFO] Cleaning project...",
  "10:24:13 [INFO] Deleting C:\\projects\\iap\\target",
  "10:24:14 [INFO] Compiling backend modules...",
  "10:24:22 [INFO] Running tests...",
  "10:24:31 [INFO] --- frontend: install dependencies ---",
  "10:24:33 added 523 packages, and audited 524 packages in 2s",
  "10:24:33 found 0 vulnerabilities",
  "10:24:33 [INFO] Running npm build...",
  "10:24:34 > iap-frontend@1.0.0 build",
  "10:24:34 > vite build",
  "10:24:34 vite v5.2.1 building for production...",
  "10:24:36 234 modules transformed.",
  "10:24:37 dist/index.html 0.62 kB | gzip: 0.34 kB",
  "10:24:37 dist/assets/index-abc123.js 142.31 kB | gzip: 45.12 kB",
  "10:24:37 dist/assets/vendor-def456.js 512.88 kB | gzip: 160.32 kB",
  "10:24:37 built in 2.28s",
  "10:24:38 [INFO] Packaging iap.war",
  "10:24:40 [INFO] Artifact deployed to KMU 10.10.20.15",
  "10:24:40 [INFO] BUILD SUCCESS",
  "10:24:40 [INFO] Total time: 00:06 min",
  "10:24:40 [INFO] Finished at: 2025-05-12T10:24:40-04:00",
];

export const tailLogs = [
  "10:24:59 frontend healthcheck ok",
  "10:25:03 cache warmed",
  "10:25:06 WAR checksum verified",
  "10:25:09 deployment ping success",
  "10:25:12 session cleanup completed",
  "10:25:15 user sessions: 128 active",
  '10:25:18 background job "report-export" started',
  '10:25:21 background job "report-export" completed',
  "10:25:24 metrics pushed to Prometheus",
  "10:25:27 database connection pool healthy",
  '10:25:30 scheduled task "daily-summary" triggered',
  "10:25:33 daily-summary completed in 842ms",
  "10:25:36 message queue depth: 0",
  "10:25:40 all systems operational",
];

export const monitorCards: MonitorCard[] = [
  {
    title: "Frontend",
    icon: <SquareTerminal size={26} />,
    rows: [
      {
        label: "Status",
        value: <span className="status-pill success">Running</span>,
      },
      { label: "Port", value: "5173" },
      { label: "Last Restart", value: "May 12, 2025 10:24 AM" },
    ],
  },
  {
    title: "WildFly",
    icon: <Layers3 size={26} />,
    rows: [
      {
        label: "Status",
        value: <span className="status-pill success">Running</span>,
      },
      { label: "Port", value: "8080" },
      { label: "Uptime", value: "2d 14h 37m" },
    ],
  },
  {
    title: "Consoles",
    icon: <Globe2 size={26} />,
    rows: [
      { label: "Admin Console", value: consoleLinks.admin },
      { label: "KMU", value: consoleLinks.kmu },
    ],
  },
  {
    title: "Last Build",
    icon: <CheckCircle2 size={26} />,
    rows: [
      {
        label: "Status",
        value: <span className="status-pill success">Success</span>,
      },
      { label: "Duration", value: "6m 42s" },
      { label: "Completed", value: "May 12, 2025 09:41 AM" },
    ],
  },
];

export const recentBuilds: RecentBuild[] = [
  {
    id: "#10245",
    branch: "main",
    commit: "a8c42f1",
    environment: "Production",
    triggeredBy: "Caitlyn Kling",
    status: "Success",
    duration: "6m 42s",
    completed: "May 12, 2025 09:41 AM",
  },
  {
    id: "#10244",
    branch: "develop",
    commit: "b7d9e3c",
    environment: "SIT",
    triggeredBy: "James Patel",
    status: "Success",
    duration: "5m 18s",
    completed: "May 12, 2025 08:15 AM",
  },
  {
    id: "#10243",
    branch: "feature/auth",
    commit: "c3f1a9d",
    environment: "SIT",
    triggeredBy: "Maya Chen",
    status: "Success",
    duration: "4m 55s",
    completed: "May 11, 2025 06:32 PM",
  },
  {
    id: "#10242",
    branch: "main",
    commit: "d4e5f6a",
    environment: "Production",
    triggeredBy: "Caitlyn Kling",
    status: "Failed",
    duration: "3m 21s",
    completed: "May 11, 2025 04:11 PM",
  },
  {
    id: "#10241",
    branch: "release/1.8.0",
    commit: "e5f6g7h",
    environment: "SIT",
    triggeredBy: "James Patel",
    status: "Success",
    duration: "6m 01s",
    completed: "May 11, 2025 02:47 PM",
  },
];

export const activityFeed: ActivityItem[] = [
  {
    title: "Frontend service restarted",
    meta: "",
    time: "10:24 AM",
    tone: "success",
    icon: <SquareTerminal size={18} />,
  },
  {
    title: "WAR deployed",
    meta: "iap.war - Build #10245",
    time: "09:41 AM",
    tone: "success",
    icon: <Package size={18} />,
  },
  {
    title: "Production build completed",
    meta: "Build #10245 - Success",
    time: "09:41 AM",
    tone: "accent",
    icon: <Play size={18} />,
  },
  {
    title: "SIT build triggered",
    meta: "Build #10244 - develop",
    time: "08:10 AM",
    tone: "accent",
    icon: <Play size={18} />,
  },
  {
    title: "Wildfly started",
    meta: "",
    time: "08:15 AM",
    tone: "success",
    icon: <SquareTerminal size={18} />,
  },
  {
    title: "Wildfly stopped",
    meta: "",
    time: "08:05 AM",
    tone: "error",
    icon: <SquareTerminal size={18} />,
  },
];

export const gitTerminalLines = [
  "[00:48:51] Git terminal for Project IAP (iap)",
  "[00:48:51] Git commands run in: C:\\Users\\yipsy1\\iap",
  "Only commands beginning with 'git' are allowed. Type commands in the input field below.",
  "[00:48:51] Branch detection warning: Git Project Directory does not exist: C:\\Users\\yipsy1\\iap",
];

export const quickGitCommands = [
  "status",
  "branch",
  "log --oneline",
  "fetch",
  "pull",
  "diff",
];

export const buildProfiles: BuildProfile[] = [
  {
    buttonName: "Local",
    profileName: "local",
    goal: "clean install",
    confirm: false,
  },
  {
    buttonName: "SIT",
    profileName: "sit",
    goal: "clean package",
    confirm: false,
  },
  {
    buttonName: "Production",
    profileName: "prod",
    goal: "clean package",
    confirm: true,
  },
];
