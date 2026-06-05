import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AppSection, DashboardTab, ToolId } from "../types";

type NavigationState = {
  activeSection: AppSection;
  activeTool: ToolId;
  activeProjectTab: DashboardTab;
};

const initialState: NavigationState = {
  activeSection: "dashboard",
  activeTool: "comparing",
  activeProjectTab: "dashboard",
};

const navigationSlice = createSlice({
  name: "navigation",
  initialState,
  reducers: {
    setActiveSection(state, action: PayloadAction<AppSection>) {
      state.activeSection = action.payload;
    },
    setActiveTool(state, action: PayloadAction<ToolId>) {
      state.activeTool = action.payload;
    },
    setActiveProjectTab(state, action: PayloadAction<DashboardTab>) {
      state.activeProjectTab = action.payload;
    },
    openDashboard(state) {
      state.activeSection = "dashboard";
    },
    openProject(state, action: PayloadAction<DashboardTab | undefined>) {
      state.activeSection = "project";
      if (action.payload) {
        state.activeProjectTab = action.payload;
      }
    },
    openTool(state, action: PayloadAction<ToolId>) {
      state.activeSection = "tools";
      state.activeTool = action.payload;
    },
  },
});

export const navigationActions = navigationSlice.actions;
export const navigationReducer = navigationSlice.reducer;
