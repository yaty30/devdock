from .common import *
from .build_model import BuildProgress, build_maven_command
from .widgets.text_pane import TextPane
from .widgets.build_status_panel import BuildStatusPanel
from .widgets.settings_dialog import ConfigEditorDialog
from .widgets.git_terminal import GitTerminalTab


def _sync_config_globals():
    """Keep split modules aligned after app.config is reloaded."""
    import dashboard.common as common
    import dashboard.widgets.git_terminal as git_terminal
    import dashboard.widgets.settings_dialog as settings_dialog

    names = [
        "APP_CONFIG", "LOG_PATH_FILE", "GIT_PROJECT_DIR",
        "FRONTEND_NAME", "FRONTEND_DIR", "FRONTEND_COMMAND",
        "WILDFLY_DIR", "WILDFLY_COMMAND", "BUILD_WORK_DIR",
        "BUILDER_CONFIG", "BUILDERS", "LAYOUT_CONFIG", "CONFIG_FILE", "ACTIVE_PROJECT_ID",
    ]
    for module in (common, git_terminal, settings_dialog):
        for name in names:
            if name in globals():
                setattr(module, name, globals()[name])


class DashboardApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Dashboard")
        self.root.configure(bg=BG)
        saved_geometry = (LAYOUT_CONFIG or {}).get("window_geometry", "")
        if saved_geometry:
            try:
                self.root.geometry(saved_geometry)
            except Exception:
                self.root.geometry("1600x1080")
        else:
            self.root.geometry("1600x1080")
        self.root.minsize(1200, 860)

        try:
            self.root.option_add("*Font", "Calibri 10")
        except Exception:
            pass
        self._configure_scrollbar_style()

        self.stop_event = threading.Event()
        self.queues = {
            "wildfly": queue.Queue(),
            "vite": queue.Queue(),
            "build": queue.Queue(),
            "log": queue.Queue(),
        }
        # Project-scoped runtime/config state.  A visible pane only shows the
        # active project's buffer, but services/log tailers keep running for
        # every configured project.
        self.project_configs = {p.id: load_app_config(p.id) for p in get_project_registry()}
        self.project_output_buffers: dict[tuple[str, str], str] = {}
        self.project_current_log_paths: dict[str, str] = {}
        self.project_runtime_status: dict[str, dict] = {}
        self.processes = {}
        self.service_ready = {}
        self.process_lock = threading.Lock()
        self.build_process = None
        self.build_stop_requested = False
        self.build_lock = threading.Lock()
        self.progress = BuildProgress()
        self.current_log_path = ""
        self.log_window_size = 1000
        self.log_history_step = 200
        self.log_window_start_line = 0
        self.log_window_end_line = 0
        self._log_history_loading = False

        self._build_ui()

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.root.after(POLL_MS, self.flush_queues)
        self.root.after(500, self.refresh_timers)
        # Start services only after the first paint. WildFly can emit a lot of
        # startup output, so deferring keeps the window responsive at launch.
        self.root.after(450, self._start_background_workers)

    def _configure_scrollbar_style(self):
        """Use a slim, low-contrast scrollbar style similar to Safari/macOS."""
        self.style = ttk.Style(self.root)
        try:
            self.style.theme_use("clam")
        except Exception:
            pass

        for style_name in ("Safari.Vertical.TScrollbar", "Safari.Horizontal.TScrollbar"):
            self.style.configure(
                style_name,
                gripcount=0,
                background="#5f6875",
                darkcolor=TEXT_BG,
                lightcolor=TEXT_BG,
                troughcolor=TEXT_BG,
                bordercolor=TEXT_BG,
                arrowcolor="#5f6875",
                relief="flat",
                borderwidth=0,
                width=9,
            )
            self.style.map(
                style_name,
                background=[("active", "#7a8492")],
                arrowcolor=[("active", "#7a8492")],
            )

        # Notebook tabs tuned for the app's dark theme.
        self.style.configure(
            "Dashboard.TNotebook",
            background=BG,
            borderwidth=0,
            relief="flat",
            tabmargins=(0, 0, 0, 0),
        )
        # Remove the theme's notebook client border around the tab content area.
        try:
            self.style.layout("Dashboard.TNotebook", [("Notebook.client", {"sticky": "nswe"})])
        except Exception:
            pass
        self.style.configure(
            "Dashboard.TNotebook.Tab",
            background=PANEL_BG,
            foreground=MUTED,
            borderwidth=0,
            relief="flat",
            padding=(16, 7),
            font=("Calibri", 10, "bold"),
            focuscolor=BG,
            bordercolor=BG,
            lightcolor=PANEL_BG,
            darkcolor=PANEL_BG,
        )
        self.style.map(
            "Dashboard.TNotebook.Tab",
            background=[("selected", BTN_ACTIVE), ("active", BTN_BG)],
            foreground=[("selected", "#f8fafc"), ("active", TEXT_FG)],
            bordercolor=[("selected", BG), ("active", BG), ("!active", BG)],
            lightcolor=[("selected", BTN_ACTIVE), ("active", BTN_BG), ("!active", PANEL_BG)],
            darkcolor=[("selected", BTN_ACTIVE), ("active", BTN_BG), ("!active", PANEL_BG)],
        )

    def reload_app_config(self, announce: bool = False):
        global APP_CONFIG, LOG_PATH_FILE, GIT_PROJECT_DIR
        global FRONTEND_NAME, FRONTEND_DIR, FRONTEND_COMMAND, WILDFLY_DIR, WILDFLY_COMMAND
        global BUILD_WORK_DIR, BUILDER_CONFIG, BUILDERS, LAYOUT_CONFIG, CONFIG_FILE, ACTIVE_PROJECT_ID
        CONFIG_FILE = get_config_file_for_project(ACTIVE_PROJECT_ID)
        APP_CONFIG = load_app_config(ACTIVE_PROJECT_ID)
        self.project_configs[ACTIVE_PROJECT_ID] = APP_CONFIG
        LOG_PATH_FILE = APP_CONFIG["log_path_file"]
        GIT_PROJECT_DIR = APP_CONFIG["git_project_dir"]
        FRONTEND_NAME = APP_CONFIG["frontend_name"]
        FRONTEND_DIR = APP_CONFIG["frontend_dir"]
        FRONTEND_COMMAND = APP_CONFIG["frontend_command"]
        WILDFLY_DIR = APP_CONFIG["wildfly_dir"]
        WILDFLY_COMMAND = APP_CONFIG["wildfly_command"]
        BUILD_WORK_DIR = APP_CONFIG["build_work_dir"]
        BUILDER_CONFIG = APP_CONFIG["builder_config"]
        BUILDERS = APP_CONFIG["builders"]
        LAYOUT_CONFIG = APP_CONFIG.get("layout", LAYOUT_CONFIG)
        _sync_config_globals()
        if hasattr(self, "footer_var"):
            self.footer_var.set(f"Project: {self.current_project.name}  |  Git directory: {GIT_PROJECT_DIR}  |  Log file: {LOG_PATH_FILE or 'not set'}  |  Builders: {len(BUILDERS)}  |  Config: {CONFIG_FILE}")
        if hasattr(self, "vite_pane"):
            self.vite_pane.title_var.set(FRONTEND_NAME or "Frontend")
        if hasattr(self, "build_button_frame"):
            self.rebuild_build_buttons()
        if announce:
            self.enqueue("log", f"\n[{time.strftime('%H:%M:%S')}] Settings saved for {self.current_project.name}.\n", project_id=ACTIVE_PROJECT_ID)
        if hasattr(self, "git_terminal"):
            self.git_terminal.refresh_config_labels()

    @property
    def current_project(self) -> DashboardProject:
        return get_project_by_id(ACTIVE_PROJECT_ID)

    def _service_process_key(self, project_id: str, service_key: str) -> str:
        return f"{project_id}:{service_key}"

    def _append_project_buffer(self, project_id: str, key: str, text: str, max_chars: int = 300000):
        if key not in ("wildfly", "vite", "log"):
            return
        buffer_key = (project_id, key)
        existing = self.project_output_buffers.get(buffer_key, "")
        combined = existing + text
        if len(combined) > max_chars:
            combined = combined[-max_chars:]
        self.project_output_buffers[buffer_key] = combined

    def _get_project_buffer(self, project_id: str, key: str) -> str:
        return self.project_output_buffers.get((project_id, key), "")

    def _set_project_visible(self, project_id: str):
        """Refresh all visible project-scoped panes from the selected project."""
        project = get_project_by_id(project_id)
        config = self.project_configs.get(project_id) or load_app_config(project_id)
        self.project_configs[project_id] = config

        if hasattr(self, "project_name_var"):
            self.project_name_var.set(project.name)
        if hasattr(self, "footer_var"):
            self.footer_var.set(
                f"Project: {project.name}  |  Git directory: {config.get('git_project_dir', '')}  |  "
                f"Log file: {config.get('log_path_file') or 'not set'}  |  Builders: {len(config.get('builders', []))}  |  "
                f"Config: {get_config_file_for_project(project_id)}"
            )
        if hasattr(self, "vite_pane"):
            self.vite_pane.title_var.set(config.get("frontend_name") or "Frontend")
        if hasattr(self, "build_button_frame"):
            self.rebuild_build_buttons()

        # The visible panes must never show another project's output.
        for pane_name, pane in (("wildfly", getattr(self, "wildfly_pane", None)),
                                ("vite", getattr(self, "vite_pane", None)),
                                ("log", getattr(self, "log_pane", None))):
            if pane is None:
                continue
            pane.clear()
            buffered = self._get_project_buffer(project_id, pane_name)
            if buffered:
                pane.append(buffered)
        if hasattr(self, "log_pane"):
            if not self._get_project_buffer(project_id, "log"):
                self.log_pane.append(
                    f"[{time.strftime('%H:%M:%S')}] Showing logs for {project.name} ({project.id})\n"
                    f"[{time.strftime('%H:%M:%S')}] Log file: {config.get('log_path_file') or 'not set'}\n"
                )
            self.current_log_path = self.project_current_log_paths.get(project_id, config.get("log_path_file", ""))
            self.log_pane.set_status(os.path.basename(self.current_log_path) if self.current_log_path else "No log file", BLUE if self.current_log_path else MUTED)
        if hasattr(self, "git_terminal"):
            self.git_terminal.refresh_config_labels()
        self._refresh_active_service_status()

    def set_active_project_id(self, project_id: str):
        global ACTIVE_PROJECT_ID
        selected = get_project_by_id(project_id)
        ACTIVE_PROJECT_ID = set_active_project_id(selected.id)
        self.reload_app_config(announce=False)
        self._set_project_visible(selected.id)
        self.enqueue("log", f"\n[{time.strftime('%H:%M:%S')}] Switched to {selected.name} ({selected.id})\n", project_id=selected.id)

    def on_project_select(self, _event=None):
        selected_name = self.project_name_var.get().strip()
        for p in get_project_registry():
            if p.name == selected_name:
                self.set_active_project_id(p.id)
                return

    def open_settings(self):
        ConfigEditorDialog(self)

    def open_war_folder(self):
        war_path = self.progress.war_path
        if not war_path:
            messagebox.showinfo("WAR Not Detected", "No WAR file path has been detected in the build log yet.", parent=self.root)
            return
        folder = os.path.dirname(war_path)
        if not folder or not os.path.isdir(folder):
            messagebox.showerror("WAR Folder Not Found", f"The WAR folder does not exist:\n{folder}", parent=self.root)
            return
        try:
            open_folder_in_explorer(folder)
        except Exception as e:
            messagebox.showerror("Could Not Open Folder", str(e), parent=self.root)

    def open_current_log_file(self):
        path = self.current_log_path or ""
        if not path and os.path.exists(LOG_PATH_FILE):
            try:
                with open(LOG_PATH_FILE, "r", encoding="utf-8", errors="replace") as f:
                    path = f.read().strip()
            except Exception:
                path = ""
        if not path:
            messagebox.showinfo("Log File Not Available", "No current log file path has been detected yet.", parent=self.root)
            return
        if not os.path.isfile(path):
            messagebox.showerror("Log File Not Found", f"The log file does not exist:\n{path}", parent=self.root)
            return
        try:
            open_file_native(path)
        except Exception as e:
            messagebox.showerror("Could Not Open Log File", str(e), parent=self.root)

    def open_build_log_file(self):
        if not hasattr(self, "build_log_pane"):
            return
        content = self.build_log_pane.get_text().strip()
        if not content:
            messagebox.showinfo("Build Log Empty", "There is no build log content to open yet.", parent=self.root)
            return
        try:
            path = os.path.join(tempfile.gettempdir(), "dashboard_build_log.txt")
            with open(path, "w", encoding="utf-8", errors="replace") as f:
                f.write(content + "\n")
            open_file_native(path)
        except Exception as e:
            messagebox.showerror("Could Not Open Build Log", str(e), parent=self.root)

    def _build_ui(self):
        outer = tk.Frame(self.root, bg=BG)
        outer.pack(fill="both", expand=True, padx=10, pady=10)

        toolbar = tk.Frame(outer, bg=BG)
        toolbar.pack(fill="x", pady=(0, 8))

        def button(parent, text, cmd, bg=BTN_BG, active_bg=BTN_ACTIVE):
            return tk.Button(
                parent, text=text, command=cmd, bg=bg, fg=BTN_FG, activebackground=active_bg,
                activeforeground=BTN_FG, relief="flat", padx=12, pady=6,
                font=("Calibri", 10, "bold"), highlightthickness=1, highlightbackground=BORDER
            )

        self.toolbar_button_factory = button
        project_box = tk.Frame(toolbar, bg=BG)
        project_box.pack(side="left", padx=(0, 10))
        tk.Label(project_box, text="Project", bg=BG, fg=MUTED, font=("Calibri", 10, "bold")).pack(side="left", padx=(0, 6))
        self.project_name_var = tk.StringVar(value=self.current_project.name)
        self.project_selector = ttk.Combobox(
            project_box,
            textvariable=self.project_name_var,
            values=[p.name for p in get_project_registry()],
            state="readonly",
            width=16,
        )
        self.project_selector.pack(side="left")
        self.project_selector.bind("<<ComboboxSelected>>", self.on_project_select)
        button(toolbar, "Restart WildFly", lambda: self.restart_service_for_project(ACTIVE_PROJECT_ID, "wildfly")).pack(side="left", padx=(0, 6))
        button(toolbar, f"Restart {FRONTEND_NAME or 'Frontend'}", lambda: self.restart_service_for_project(ACTIVE_PROJECT_ID, "vite")).pack(side="left", padx=6)

        self.build_button_frame = tk.Frame(toolbar, bg=BG)
        self.build_button_frame.pack(side="left", padx=(18, 0))
        self.rebuild_build_buttons()

        button(toolbar, "Stop Build", self.stop_build).pack(side="left", padx=6)
        button(toolbar, "Clear Build Log", lambda: self.build_log_pane.clear()).pack(side="left", padx=(18, 6))
        button(toolbar, "Clear Log Tail", lambda: self.log_pane.clear()).pack(side="left", padx=6)
        button(toolbar, "Settings", self.open_settings).pack(side="right", padx=(6, 0))

        self.notebook = ttk.Notebook(outer, style="Dashboard.TNotebook")
        self.notebook.pack(fill="both", expand=True, ipadx=0, ipady=0)

        dashboard_tab = tk.Frame(self.notebook, bg=BG)
        self.notebook.add(dashboard_tab, text="Dashboard")

        content = tk.Frame(dashboard_tab, bg=BG)
        content.pack(fill="both", expand=True, padx=0, pady=(8, 0))

        # Three-column dashboard layout:
        #   left   = WildFly
        #   middle = Frontend + Log Tail
        #   right  = Build Status + Build Log
        # All columns are horizontally adjustable. The middle and right columns are vertically adjustable.
        self.dashboard_pane = tk.PanedWindow(
            content,
            orient="horizontal",
            bg=BG,
            bd=0,
            sashwidth=8,
            sashrelief="flat",
            opaqueresize=True,
            showhandle=True,
            handlepad=3,
            handlesize=12,
        )
        self.dashboard_pane.pack(fill="both", expand=True)

        self.wildfly_pane = TextPane(self.dashboard_pane, "WildFly", self)
        self.dashboard_pane.add(self.wildfly_pane.frame, minsize=360, stretch="always", padx=0, pady=0)

        middle = tk.Frame(self.dashboard_pane, bg=BG)
        self.dashboard_pane.add(middle, minsize=320, stretch="always", padx=8, pady=0)

        build_col = tk.Frame(self.dashboard_pane, bg=BG)
        self.dashboard_pane.add(build_col, minsize=260, stretch="never", padx=0, pady=0)

        self.middle_pane = tk.PanedWindow(
            middle,
            orient="vertical",
            bg=BG,
            bd=0,
            sashwidth=8,
            sashrelief="flat",
            opaqueresize=True,
            showhandle=True,
            handlepad=3,
            handlesize=12,
        )
        self.middle_pane.pack(fill="both", expand=True)

        self.vite_pane = TextPane(self.middle_pane, FRONTEND_NAME or "Frontend", self, compact=True)
        self.middle_pane.add(self.vite_pane.frame, minsize=120, stretch="never", padx=0, pady=0)

        self.log_pane = TextPane(
            self.middle_pane,
            "Log Tail",
            self,
            compact=False,
            actions=[("Open Log File", self.open_current_log_file)],
        )
        self.middle_pane.add(self.log_pane.frame, minsize=180, stretch="always", padx=0, pady=8)

        self.build_pane = tk.PanedWindow(
            build_col,
            orient="vertical",
            bg=BG,
            bd=0,
            sashwidth=8,
            sashrelief="flat",
            opaqueresize=True,
            showhandle=True,
            handlepad=3,
            handlesize=12,
        )
        self.build_pane.pack(fill="both", expand=True)

        self.build_status_panel = BuildStatusPanel(self.build_pane, self.progress, app=self)
        self.build_pane.add(self.build_status_panel.frame, minsize=430, stretch="always", padx=0, pady=0)

        self.build_log_pane = TextPane(
            self.build_pane,
            "Build Log",
            self,
            compact=False,
            collapsible=True,
            collapsed=True,
            collapsed_height=42,
            actions=[("Open Build Log", self.open_build_log_file)],
        )
        self.build_pane.add(self.build_log_pane.frame, minsize=42, stretch="never", padx=0, pady=8)
        self._adjusting_build_pane = False
        self.build_pane.bind("<Configure>", self._on_build_pane_configure)

        self.git_terminal = GitTerminalTab(self.notebook, self)
        self.notebook.add(self.git_terminal.frame, text="Git Terminal")

        footer = tk.Frame(outer, bg=BG)
        footer.pack(fill="x", pady=(8, 0))
        self.footer_var = tk.StringVar(value=f"Project: {self.current_project.name}  |  Git directory: {GIT_PROJECT_DIR}  |  Log file: {LOG_PATH_FILE or 'not set'}  |  Builders: {len(BUILDERS)}  |  Config: {CONFIG_FILE}")
        tk.Label(footer, textvariable=self.footer_var, bg=BG, fg=MUTED, anchor="w",
                 font=("Calibri", 10)).pack(fill="x")

        self.root.after(50, self._restore_or_set_dashboard_split)
        self.root.after(250, self._restore_or_set_dashboard_split)
        self.root.after(800, self._restore_or_set_dashboard_split)

    def rebuild_build_buttons(self):
        if not hasattr(self, "build_button_frame"):
            return
        for child in self.build_button_frame.winfo_children():
            child.destroy()
        factory = getattr(self, "toolbar_button_factory", None)
        if factory is None:
            return
        for index, builder in enumerate(BUILDERS):
            profile = builder.get("profile", "")
            confirm = _bool_value(builder.get("confirm_before_run", False))
            bg = PROD_BTN_BG if confirm or profile.lower() == "prod" else BTN_BG
            active_bg = PROD_BTN_ACTIVE if confirm or profile.lower() == "prod" else BTN_ACTIVE
            label = builder.get("label") or f"Run {profile.upper()} Build"
            factory(self.build_button_frame, label, lambda b=builder: self.start_build(b), bg=bg, active_bg=active_bg).pack(side="left", padx=(0 if index == 0 else 6, 6))

    def _layout_float(self, key: str, default: float | None = None) -> float | None:
        try:
            value = (LAYOUT_CONFIG or {}).get(key, "")
            if value in (None, ""):
                return default
            return float(value)
        except Exception:
            return default

    def _restore_or_set_dashboard_split(self):
        """Restore saved layout sizing, or apply first-run defaults."""
        has_saved = any((LAYOUT_CONFIG or {}).get(k) for k in (
            "dashboard_sash_1_ratio", "dashboard_sash_2_ratio", "middle_sash_ratio", "build_sash_ratio"
        ))
        if has_saved:
            self._restore_dashboard_split()
        else:
            self._set_default_dashboard_split()

    def _restore_dashboard_split(self):
        try:
            width = self.dashboard_pane.winfo_width()
            if width > 0:
                first_ratio = self._layout_float("dashboard_sash_1_ratio", 0.40) or 0.40
                second_ratio = self._layout_float("dashboard_sash_2_ratio", 0.75) or 0.75
                first = max(300, min(width - 520, int(width * first_ratio)))
                second = max(first + 300, min(width - 220, int(width * second_ratio)))
                self.dashboard_pane.sash_place(0, first, 0)
                self.dashboard_pane.sash_place(1, second, 0)
        except Exception:
            pass

        try:
            middle_h = self.middle_pane.winfo_height()
            if middle_h > 0:
                ratio = self._layout_float("middle_sash_ratio", 0.30) or 0.30
                self.middle_pane.sash_place(0, 0, max(120, min(middle_h - 180, int(middle_h * ratio))))
        except Exception:
            pass

        try:
            collapsed = _bool_value((LAYOUT_CONFIG or {}).get("build_log_collapsed", "true"), True)
            if collapsed:
                self.build_log_pane.collapse()
                self._apply_build_log_collapsed_size()
            else:
                self.build_log_pane.expand()
                ratio = self._layout_float("build_sash_ratio", None)
                if ratio is not None:
                    build_h = self.build_pane.winfo_height()
                    if build_h > 0:
                        status_h = max(260, min(build_h - 180, int(build_h * ratio)))
                        log_h = max(180, build_h - status_h - 10)
                        self.build_pane.paneconfigure(self.build_status_panel.frame, minsize=260, height=status_h, stretch="always")
                        self.build_pane.paneconfigure(self.build_log_pane.frame, minsize=180, height=log_h, stretch="always")
                        self.build_log_pane.frame.configure(height=log_h)
                        self.build_pane.sash_place(0, 0, status_h)
                else:
                    self._apply_build_log_expanded_size()
        except Exception:
            pass

    def _collect_layout_config(self) -> dict:
        """Return layout sizing as normalized ratios so it survives screen-size changes."""
        layout = {}
        try:
            layout["window_geometry"] = self.root.geometry()
        except Exception:
            layout["window_geometry"] = ""

        try:
            width = self.dashboard_pane.winfo_width()
            if width > 0:
                x1, _ = self.dashboard_pane.sash_coord(0)
                x2, _ = self.dashboard_pane.sash_coord(1)
                layout["dashboard_sash_1_ratio"] = f"{x1 / width:.6f}"
                layout["dashboard_sash_2_ratio"] = f"{x2 / width:.6f}"
        except Exception:
            pass

        try:
            height = self.middle_pane.winfo_height()
            if height > 0:
                _, y = self.middle_pane.sash_coord(0)
                layout["middle_sash_ratio"] = f"{y / height:.6f}"
        except Exception:
            pass

        try:
            height = self.build_pane.winfo_height()
            if height > 0:
                _, y = self.build_pane.sash_coord(0)
                layout["build_sash_ratio"] = f"{y / height:.6f}"
        except Exception:
            pass

        try:
            layout["build_log_collapsed"] = _bool_text(self.build_log_pane.collapsed, True)
        except Exception:
            layout["build_log_collapsed"] = "true"
        return layout

    def _set_default_dashboard_split(self):
        """Set default layout to 40% WildFly, 35% middle, 25% build column.

        The middle column gives Frontend 30% of the content height. Build Log stays
        collapsed by default so Build Status can show all rows.
        """
        try:
            width = self.dashboard_pane.winfo_width()
            if width > 0:
                first = int(width * 0.40)
                second = int(width * 0.75)
                self.dashboard_pane.sash_place(0, first, 0)
                self.dashboard_pane.sash_place(1, second, 0)
        except Exception:
            pass

        try:
            middle_h = self.middle_pane.winfo_height()
            if middle_h > 0:
                self.middle_pane.sash_place(0, 0, max(150, int(middle_h * 0.30)))
        except Exception:
            pass

        try:
            if hasattr(self, "build_log_pane"):
                self.build_log_pane.collapse()
            self._apply_build_log_collapsed_size()
        except Exception:
            pass

    def _is_build_running(self) -> bool:
        try:
            return self.build_process is not None or bool(self.progress.running)
        except Exception:
            return False

    def _on_build_pane_configure(self, _event=None):
        """Keep the right column sane when the window is created or resized."""
        if getattr(self, "_adjusting_build_pane", False):
            return
        if not hasattr(self, "build_log_pane"):
            return
        if self.build_log_pane.collapsed:
            self.root.after_idle(self._apply_build_log_collapsed_size)

    def _apply_build_log_collapsed_size(self):
        """Keep the Build Log as a bottom title bar when collapsed."""
        if getattr(self, "_adjusting_build_pane", False):
            return
        try:
            self._adjusting_build_pane = True
            self.root.update_idletasks()
            build_h = self.build_pane.winfo_height()
            if build_h <= 0:
                return
            collapsed_h = getattr(self.build_log_pane, "collapsed_height", 42)
            status_h = max(430, build_h - collapsed_h - 10)
            self.build_pane.paneconfigure(self.build_status_panel.frame, minsize=430, height=status_h, stretch="always")
            self.build_pane.paneconfigure(self.build_log_pane.frame, minsize=collapsed_h, height=collapsed_h, stretch="never")
            self.build_log_pane.frame.configure(height=collapsed_h)
            self.build_pane.sash_place(0, 0, min(status_h, max(0, build_h - collapsed_h - 10)))
        except Exception:
            pass
        finally:
            self._adjusting_build_pane = False

    def _apply_build_log_expanded_size(self):
        """Make Build Log readable when expanded. During builds, reserve at least 40%."""
        if getattr(self, "_adjusting_build_pane", False):
            return
        try:
            self._adjusting_build_pane = True
            self.root.update_idletasks()
            build_h = self.build_pane.winfo_height()
            if build_h <= 0:
                return
            log_ratio = 0.40 if self._is_build_running() else 0.32
            log_h = max(180, int(build_h * log_ratio))
            status_h = max(260, build_h - log_h - 10)
            self.build_pane.paneconfigure(self.build_status_panel.frame, minsize=260, height=status_h, stretch="always")
            self.build_pane.paneconfigure(self.build_log_pane.frame, minsize=180, height=log_h, stretch="always")
            self.build_log_pane.frame.configure(height=log_h)
            self.build_pane.sash_place(0, 0, min(status_h, max(0, build_h - log_h - 10)))
        except Exception:
            pass
        finally:
            self._adjusting_build_pane = False

    def on_text_pane_expanded(self, pane):
        if hasattr(self, "build_log_pane") and pane is self.build_log_pane:
            self.root.after(0, self._apply_build_log_expanded_size)

    def on_text_pane_collapsed(self, pane):
        if hasattr(self, "build_log_pane") and pane is self.build_log_pane:
            self.root.after(0, self._apply_build_log_collapsed_size)

    def _start_background_workers(self):
        if self.stop_event.is_set():
            return
        self._start_services()
        self._start_log_tail()

    def _safe_set_status(self, pane: TextPane, text: str, color=MUTED):
        """Set a TextPane status safely from worker threads."""
        try:
            self.root.after(0, lambda p=pane, t=text, c=color: p.set_status(t, c))
        except Exception:
            pass

    def _start_services(self):
        # Start configured services for every project independently.
        for project in get_project_registry():
            config = self.project_configs.get(project.id) or load_app_config(project.id)
            self.project_configs[project.id] = config
            self.start_service_for_project(project.id, "wildfly")
            self.start_service_for_project(project.id, "vite")

    def _service_config(self, project_id: str, key: str) -> tuple[str, str, TextPane | None]:
        config = self.project_configs.get(project_id) or load_app_config(project_id)
        self.project_configs[project_id] = config
        if key == "wildfly":
            return config.get("wildfly_command", ""), config.get("wildfly_dir", ""), getattr(self, "wildfly_pane", None)
        return config.get("frontend_command", ""), config.get("frontend_dir", ""), getattr(self, "vite_pane", None)

    def start_service_for_project(self, project_id: str, key: str):
        command, cwd, pane = self._service_config(project_id, key)
        if not command or not cwd:
            self.enqueue(key, f"[{time.strftime('%H:%M:%S')}] {key} not configured; skipped.\n", project_id=project_id)
            return
        process_key = self._service_process_key(project_id, key)
        with self.process_lock:
            if process_key in self.processes:
                return
            self.service_ready[process_key] = False
        if project_id == ACTIVE_PROJECT_ID and pane is not None:
            pane.set_status("Starting", YELLOW)
        project = get_project_by_id(project_id)
        self.enqueue(key, f"[{time.strftime('%H:%M:%S')}] [{project.name}] Starting: {command}\n", project_id=project_id)
        self.enqueue(key, f"[{time.strftime('%H:%M:%S')}] [{project.name}] Working directory: {cwd}\n", project_id=project_id)
        t = threading.Thread(target=self._run_process_thread, args=(project_id, key, command, cwd, False), daemon=True)
        t.start()

    def restart_service_for_project(self, project_id: str, key: str):
        self.stop_named_process(key, project_id=project_id)
        if project_id == ACTIVE_PROJECT_ID:
            pane = self.wildfly_pane if key == "wildfly" else self.vite_pane
            pane.clear()
        self.start_service_for_project(project_id, key)

    def start_service(self, key: str, command: str, cwd: str, pane: TextPane):
        # Backward-compatible wrapper for older callbacks.
        self.start_service_for_project(ACTIVE_PROJECT_ID, key)

    def restart_service(self, key: str, command: str, cwd: str, pane: TextPane):
        self.restart_service_for_project(ACTIVE_PROJECT_ID, key)

    def start_build(self, builder: dict):
        build_name = (builder.get("profile") or "build").strip() or "build"
        command = builder.get("command") or build_maven_command(builder, BUILDER_CONFIG)
        branch, branch_error = get_current_git_branch(GIT_PROJECT_DIR)

        requires_confirm = _bool_value(builder.get("confirm_before_run", False)) or build_name.lower() == "prod"
        if requires_confirm:
            if not branch:
                messagebox.showerror(
                    f"{build_name.upper()} Build Blocked",
                    f"Cannot detect the current Git branch, so the {build_name.upper()} build was cancelled.\n\n"
                    f"Git directory: {GIT_PROJECT_DIR}\n"
                    f"Reason: {branch_error or 'unknown'}",
                    parent=self.root,
                )
                return
            proceed = messagebox.askyesno(
                f"Confirm {build_name.upper()} Build",
                f"You are about to run a {build_name.upper()} build.\n\n"
                f"Current branch: {branch}\n"
                f"Command: {command}\n\n"
                "Continue?",
                parent=self.root,
            )
            if not proceed:
                self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] {build_name.upper()} build cancelled by user. Branch: {branch}\n")
                return

        with self.build_lock:
            if self.build_process is not None:
                self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] Another build is already running.\n")
                return
            self.build_stop_requested = False
            self.build_log_pane.clear()
            self.build_log_pane.set_status("Starting...", YELLOW)
            if not self.build_log_pane.collapsed:
                self._apply_build_log_expanded_size()
            self.progress.start(build_name, branch or "unavailable", branch_error or "")
            self.build_status_panel.refresh()
            self.enqueue("build", f"[{time.strftime('%H:%M:%S')}] Starting {build_name} build: {command}\n")
            self.enqueue("build", f"[{time.strftime('%H:%M:%S')}] Git branch: {branch or 'unavailable'}\n")
            if branch_error:
                self.enqueue("build", f"[{time.strftime('%H:%M:%S')}] Branch detection warning: {branch_error}\n")
            cwd = BUILD_WORK_DIR if BUILD_WORK_DIR and os.path.isdir(BUILD_WORK_DIR) else APP_DIR
            t = threading.Thread(target=self._run_process_thread, args=(ACTIVE_PROJECT_ID, "build", command, cwd, True), daemon=True)
            t.start()

    def stop_build(self):
        with self.build_lock:
            proc = self.build_process
            if proc is not None:
                self.build_stop_requested = True
        if proc is not None:
            self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] Stopping build...\n")
            self.build_log_pane.set_status("Stopping...", YELLOW)
            if self.progress.running:
                self.progress.current_status = f"Stopping {self.progress.build_name.upper()} build..."
            kill_process_tree(proc.pid)
        else:
            self.build_log_pane.set_status("Idle", MUTED)

    def stop_named_process(self, key: str, project_id: str | None = None):
        pid = project_id or ACTIVE_PROJECT_ID
        process_key = self._service_process_key(pid, key)
        with self.process_lock:
            self.service_ready[process_key] = False
            proc = self.processes.get(process_key)
        if proc is not None:
            self.enqueue(key, f"\n[{time.strftime('%H:%M:%S')}] Stopping {key}...\n", project_id=pid)
            kill_process_tree(proc.pid)

    def _is_wildfly_ready_line(self, line: str) -> bool:
        low = (line or "").lower()
        ready_tokens = (
            "wflysrv0025",
            "wflysrv0026",
            "wildfly full" and "started in",
            "admin console listening",
            "http management interface listening",
        )
        return (
            "wflysrv0025" in low
            or "wflysrv0026" in low
            or ("wildfly" in low and "started in" in low)
            or "admin console listening" in low
            or "http management interface listening" in low
        )

    def _run_process_thread(self, project_id: str, key: str, command: str, cwd: str, is_build: bool):
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cmd = command
        proc = None
        process_key = self._service_process_key(project_id, key) if not is_build else "build"
        pane = self.build_log_pane if is_build else (self.wildfly_pane if key == "wildfly" else self.vite_pane)
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                creationflags=creationflags,
                shell=True,
            )
            if is_build:
                with self.build_lock:
                    self.build_process = proc
            else:
                with self.process_lock:
                    self.processes[process_key] = proc

            if is_build:
                self._safe_set_status(pane, "Running", GREEN)
            elif key == "wildfly":
                if project_id == ACTIVE_PROJECT_ID:
                    self._safe_set_status(pane, "Starting", YELLOW)
            else:
                with self.process_lock:
                    self.service_ready[process_key] = True
                if project_id == ACTIVE_PROJECT_ID:
                    self._safe_set_status(pane, "Running", GREEN)

            assert proc.stdout is not None
            while not self.stop_event.is_set():
                raw = proc.stdout.readline()
                if not raw:
                    if proc.poll() is not None:
                        break
                    time.sleep(0.05)
                    continue
                line = decode_bytes(raw)
                self.enqueue(key, line, project_id=project_id)
                if is_build:
                    self.progress.parse_line(line)
                elif key == "wildfly" and self._is_wildfly_ready_line(line):
                    with self.process_lock:
                        self.service_ready[process_key] = True
                    if project_id == ACTIVE_PROJECT_ID:
                        self._safe_set_status(pane, "Running", GREEN)

            exit_code = proc.wait(timeout=2) if proc.poll() is None else proc.returncode
            if is_build:
                with self.build_lock:
                    stopped_by_user = self.build_stop_requested
                if self.progress.running:
                    if exit_code == 0 and not stopped_by_user:
                        self.progress.mark_frontend_skipped_if_needed()
                        self.progress.finish(True)
                    else:
                        self.progress.finish(False)
                        if stopped_by_user:
                            self.progress.current_status = f"{self.progress.build_name.upper()} build stopped"
                if stopped_by_user:
                    self._safe_set_status(pane, "Stopped", YELLOW)
                    self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] Build stopped by user. Exit code: {exit_code}\n")
                elif exit_code == 0:
                    self._safe_set_status(pane, "Completed", GREEN)
                    self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] Build command completed with code {exit_code}\n")
                else:
                    self._safe_set_status(pane, "Failed", RED)
                    self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] Build command exited with code {exit_code}\n")
                with self.build_lock:
                    self.build_process = None
                    self.build_stop_requested = False
            else:
                color = GREEN if exit_code == 0 else RED
                text = "Stopped" if self.stop_event.is_set() else f"Exited ({exit_code})"
                if project_id == ACTIVE_PROJECT_ID:
                    self._safe_set_status(pane, text, color)
                self.enqueue(key, f"\n[{time.strftime('%H:%M:%S')}] Command exited with code {exit_code}\n", project_id=project_id)
                with self.process_lock:
                    self.service_ready[process_key] = False
                    if self.processes.get(process_key) is proc:
                        self.processes.pop(process_key, None)

        except Exception as e:
            self.enqueue(key, f"\n[{time.strftime('%H:%M:%S')}] ERROR: {e}\n", project_id=project_id)
            if is_build:
                self.progress.finish(False)
                self._safe_set_status(pane, "Error", RED)
                with self.build_lock:
                    self.build_process = None
                    self.build_stop_requested = False
            else:
                if project_id == ACTIVE_PROJECT_ID:
                    self._safe_set_status(pane, "Error", RED)
                with self.process_lock:
                    self.service_ready[process_key] = False
                    self.processes.pop(process_key, None)

    def _start_log_tail(self):
        for project in get_project_registry():
            threading.Thread(target=self._tail_log_path_worker, args=(project.id,), daemon=True).start()

    def _tail_log_path_worker(self, project_id: str):
        """Tail the configured application log file directly.

        Older dashboard versions used LOG_PATH_FILE as a pointer file whose
        contents were the real log path. The current config stores the exact
        application log file path. Reading the log file itself as a pointer on
        every poll can become extremely expensive during WildFly startup and
        can make the UI appear frozen.
        """
        current_log_path = None
        file_handle = None
        position = 0
        missing_reported = False
        max_read_per_tick = 32768

        while not self.stop_event.is_set():
            try:
                config = self.project_configs.get(project_id) or load_app_config(project_id)
                self.project_configs[project_id] = config
                desired_path = os.path.expandvars(os.path.expanduser((config.get("log_path_file") or "").strip().strip('"')))

                if not desired_path:
                    if current_log_path is not None:
                        if file_handle:
                            try:
                                file_handle.close()
                            except Exception:
                                pass
                        file_handle = None
                        current_log_path = None
                    self.project_current_log_paths[project_id] = ""
                    if project_id == ACTIVE_PROJECT_ID:
                        self.current_log_path = ""
                        self._safe_set_status(self.log_pane, "No log file", MUTED)
                    time.sleep(1.0)
                    continue

                if desired_path != current_log_path:
                    if file_handle:
                        try:
                            file_handle.close()
                        except Exception:
                            pass
                    file_handle = None
                    current_log_path = desired_path
                    self.project_current_log_paths[project_id] = current_log_path
                    if project_id == ACTIVE_PROJECT_ID:
                        self.current_log_path = current_log_path
                        self._safe_set_status(self.log_pane, os.path.basename(current_log_path), BLUE)
                    missing_reported = False
                    self.enqueue("log", f"[{time.strftime('%H:%M:%S')}] Tailing: {current_log_path}\n", project_id=project_id)
                    self._reset_log_window()

                if not os.path.exists(current_log_path):
                    if not missing_reported:
                        self.enqueue("log", f"[{time.strftime('%H:%M:%S')}] Log file not found yet: {current_log_path}\n", project_id=project_id)
                        missing_reported = True
                    if file_handle:
                        try:
                            file_handle.close()
                        except Exception:
                            pass
                        file_handle = None
                    position = 0
                    time.sleep(1.0)
                    continue

                if file_handle is None:
                    file_handle = open(current_log_path, "rb")
                    # Start at the end so startup does not render an existing huge file.
                    position = os.path.getsize(current_log_path)
                    file_handle.seek(position)
                    missing_reported = False

                file_size = os.path.getsize(current_log_path)
                if file_size < position:
                    file_handle.close()
                    file_handle = open(current_log_path, "rb")
                    position = 0
                    self.enqueue("log", f"[{time.strftime('%H:%M:%S')}] Log rotated/truncated. Reopening.\n", project_id=project_id)
                    file_size = os.path.getsize(current_log_path)

                if file_size > position:
                    file_handle.seek(position)
                    to_read = min(file_size - position, max_read_per_tick)
                    chunk = file_handle.read(to_read)
                    position = file_handle.tell()
                    if chunk:
                        text_chunk = decode_bytes(chunk)
                        self.enqueue("log", text_chunk, project_id=project_id)
                        self.log_window_end_line += text_chunk.count("\n")
                        self.log_window_start_line = max(0, self.log_window_end_line - self.log_window_size)

                time.sleep(LOG_TAIL_SLEEP)
            except FileNotFoundError:
                try:
                    if file_handle:
                        file_handle.close()
                except Exception:
                    pass
                file_handle = None
                position = 0
                time.sleep(1.0)
            except Exception as e:
                self.enqueue("log", f"[{time.strftime('%H:%M:%S')}] Log tail error: {e}\n", project_id=project_id)
                time.sleep(1.0)

        if file_handle:
            try:
                file_handle.close()
            except Exception:
                pass

    def _reset_log_window(self):
        self.log_window_start_line = 0
        self.log_window_end_line = 0

    def _read_log_line_window(self, path: str, start_line: int, end_line: int) -> str:
        if end_line <= start_line:
            return ""
        out = []
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for idx, line in enumerate(f):
                if idx < start_line:
                    continue
                if idx >= end_line:
                    break
                out.append(line)
        return "".join(out)

    def on_text_pane_scroll(self, pane: TextPane):
        if pane is not self.log_pane or self._log_history_loading:
            return
        if not pane.is_near_top():
            return
        path = self.current_log_path or ""
        if not path or not os.path.isfile(path):
            return
        if self.log_window_end_line <= 0:
            return
        new_start = max(0, self.log_window_start_line - self.log_history_step)
        if new_start == self.log_window_start_line:
            return
        self._log_history_loading = True
        try:
            text = self._read_log_line_window(path, new_start, self.log_window_end_line)
            if not text:
                return
            self.log_pane.clear()
            self.log_pane.append(text)
            self.log_window_start_line = new_start
            self.enqueue("log", f"[{time.strftime('%H:%M:%S')}] Loaded older log rows {self.log_window_start_line}-{self.log_window_end_line}\n")
            self.root.after_idle(lambda: self.log_pane.text.yview_moveto(0.12))
        finally:
            self._log_history_loading = False

    def enqueue(self, key: str, text: str, project_id: str | None = None):
        pid = project_id or (ACTIVE_PROJECT_ID if key in ("wildfly", "vite", "log") else None)
        if pid and key in ("wildfly", "vite", "log"):
            self._append_project_buffer(pid, key, text)
            self.queues[key].put((pid, text))
        else:
            self.queues[key].put(text)

    def flush_queues(self):
        pane_map = {
            "wildfly": self.wildfly_pane,
            "vite": self.vite_pane,
            "build": self.build_log_pane,
            "log": self.log_pane,
        }
        for key, pane in pane_map.items():
            pieces = []
            total_chars = 0
            try:
                while True:
                    item = self.queues[key].get_nowait()
                    if isinstance(item, tuple):
                        project_id, piece = item
                        if project_id != ACTIVE_PROJECT_ID:
                            continue
                    else:
                        piece = item
                    pieces.append(piece)
                    total_chars += len(piece)
                    # Keep each UI tick small. Tk Text insertion + coloring is
                    # relatively expensive, especially during WildFly startup.
                    if len(pieces) >= 15 or total_chars >= 12000:
                        break
            except queue.Empty:
                pass
            if pieces:
                pane.append("".join(pieces))

        self.build_status_panel.refresh()
        if not self.stop_event.is_set():
            self.root.after(POLL_MS, self.flush_queues)

    def _runtime_status_for(self, project_id: str) -> dict:
        wildfly_key = self._service_process_key(project_id, "wildfly")
        vite_key = self._service_process_key(project_id, "vite")
        with self.process_lock:
            wildfly_running = wildfly_key in self.processes
            wildfly_ready = self.service_ready.get(wildfly_key, False)
            vite_running = vite_key in self.processes
            vite_ready = self.service_ready.get(vite_key, False)
        runtime_state = "Running" if wildfly_running and wildfly_ready else ("Starting" if wildfly_running else "Stopped")
        return {
            "runtime": runtime_state,
            "wildfly": "Running" if wildfly_running else "Stopped",
            "frontend": "Running" if vite_running else "Stopped",
            "wildfly_ready": wildfly_ready,
            "frontend_ready": vite_ready,
        }

    def get_runtime_status_for_project(self, project_id: str) -> dict:
        status = self._runtime_status_for(project_id)
        self.project_runtime_status[project_id] = status
        return status

    def _refresh_active_service_status(self):
        status = self.get_runtime_status_for_project(ACTIVE_PROJECT_ID)
        wildfly_running = status["wildfly"] == "Running"
        wildfly_ready = status.get("wildfly_ready", False)
        vite_running = status["frontend"] == "Running"
        vite_ready = status.get("frontend_ready", False)

        if hasattr(self, "wildfly_pane"):
            self.wildfly_pane.set_status("Running" if wildfly_ready else ("Starting" if wildfly_running else "Stopped"), GREEN if wildfly_ready else (YELLOW if wildfly_running else MUTED))
        if hasattr(self, "vite_pane"):
            self.vite_pane.set_status("Running" if vite_ready else ("Starting" if vite_running else "Stopped"), GREEN if vite_ready else (YELLOW if vite_running else MUTED))

    def refresh_timers(self):
        self.build_status_panel.refresh()
        for project in get_project_registry():
            self.project_runtime_status[project.id] = self._runtime_status_for(project.id)
        self._refresh_active_service_status()

        if not self.stop_event.is_set():
            self.root.after(500, self.refresh_timers)

    def on_close(self):
        try:
            save_layout_config(self._collect_layout_config())
        except Exception:
            pass
        self.stop_event.set()

        with self.build_lock:
            build_proc = self.build_process
        if build_proc is not None:
            kill_process_tree(build_proc.pid)

        with self.process_lock:
            procs = list(self.processes.values())

        for proc in procs:
            try:
                kill_process_tree(proc.pid)
            except Exception:
                pass

        # Give Windows a moment to finish taskkill tree termination.
        deadline = time.time() + 2.5
        while time.time() < deadline:
            alive = False
            with self.process_lock:
                for proc in list(self.processes.values()):
                    if proc.poll() is None:
                        alive = True
                        break
            if build_proc is not None and build_proc.poll() is None:
                alive = True
            if not alive:
                break
            self.root.update_idletasks()
            time.sleep(0.12)

        self.root.destroy()
