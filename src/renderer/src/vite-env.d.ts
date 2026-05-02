/// <reference types="vite/client" />

import type { DashboardApi } from "../../shared/dashboardTypes";

declare global {
  interface Window {
    ivsDashboard: DashboardApi;
  }
}
