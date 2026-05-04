/// <reference types="vite/client" />

import type { DashboardApi } from "../../shared/dashboardTypes";

declare const __APP_VERSION__: string;

declare global {
  interface Window {
    ivsDashboard: DashboardApi;
  }
}
