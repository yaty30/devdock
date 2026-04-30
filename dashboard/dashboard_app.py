from .common import *
from .build_model import BuildProgress, build_maven_command
from .widgets.text_pane import TextPane
from .widgets.build_status_panel import BuildStatusPanel
from .widgets.settings_dialog import ConfigEditorDialog
from .widgets.git_terminal import GitTerminalTab
import webbrowser



class _ToolTip:
    def __init__(self, widget, text: str):
        self.widget = widget
        self.text = text
        self.tip = None
        widget.bind("<Enter>", self._show)
        widget.bind("<Leave>", self._hide)

    def _show(self, _event=None):
        if self.tip or not self.text:
            return
        try:
            self.tip = tk.Toplevel(self.widget)
            self.tip.wm_overrideredirect(True)
            label = tk.Label(
                self.tip,
                text=self.text,
                bg="#111827",
                fg="#f8fafc",
                relief="solid",
                borderwidth=1,
                padx=6,
                pady=3,
                font=("Calibri", 9),
            )
            label.pack()
            self.tip.update_idletasks()

            # Keep tooltips inside the visible screen. The Settings icon is at
            # the far right of the toolbar, so naive placement can overflow.
            margin = 8
            preferred_x = self.widget.winfo_rootx() + 18
            preferred_y = self.widget.winfo_rooty() + self.widget.winfo_height() + 8
            tip_w = self.tip.winfo_reqwidth()
            tip_h = self.tip.winfo_reqheight()
            screen_w = self.widget.winfo_screenwidth()
            screen_h = self.widget.winfo_screenheight()
            x = min(max(margin, preferred_x), max(margin, screen_w - tip_w - margin))
            y = min(max(margin, preferred_y), max(margin, screen_h - tip_h - margin))
            self.tip.wm_geometry(f"+{x}+{y}")
        except Exception:
            try:
                if self.tip:
                    self.tip.destroy()
            except Exception:
                pass
            self.tip = None

    def _hide(self, _event=None):
        if self.tip:
            try:
                self.tip.destroy()
            except Exception:
                pass
            self.tip = None

SVG_ICON_PATHS = {
    "start": "M8 5v14l11-7z",
    "stop": "M6 6h12v12H6z",
    "restart": "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8",
    "add": "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z",
    "settings": "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6",
    "toggle_left": "M46,8H6c-1.1,0-2,0.9-2,2v32c0,1.1,0.9,2,2,2h40c1.1,0,2-0.9,2-2V10C48,8.9,47.1,8,46,8z M44,40H8V12h36V40z M21,38h-9.9c-0.6,0-1-0.4-1-1V15c0-0.6,0.4-1,1-1H21c0.6,0,1,0.4,1,1v22C22,37.6,21.6,38,21,38z",
    "toggle_right": "M46,8H6c-1.1,0-2,0.9-2,2v32c0,1.1,0.9,2,2,2h40c1.1,0,2-0.9,2-2V10C48,8.9,47.1,8,46,8z M44,40H8V12h36V40z M21,38h-9.9c-0.6,0-1-0.4-1-1V15c0-0.6,0.4-1,1-1H21c0.6,0,1,0.4,1,1v22C22,37.6,21.6,38,21,38z",
}


def _svg_tokens(path: str):
    return re.findall(r"[MmLlHhVvCcSsZz]|-?\d*\.?\d+(?:e[-+]?\d+)?", path)


def _sample_svg_path(path: str, samples: int = 12):
    """Return subpaths sampled from a small Material-style SVG path.

    Tk does not render SVG natively, so the dashboard stores the original SVG
    path data above and rasterizes it into a PhotoImage at runtime. This parser
    supports the commands used by the Material icons provided by the user.
    """
    toks = _svg_tokens(path)
    i = 0
    cmd = None
    x = y = 0.0
    sx = sy = 0.0
    last_c = None
    paths = []
    current = []

    def is_cmd(v): return len(v) == 1 and v.isalpha()
    def num():
        nonlocal i
        v = float(toks[i]); i += 1; return v
    def add_point(px, py):
        current.append((px, py))
    def close_current():
        nonlocal current
        if current:
            if current[0] != current[-1]:
                current.append(current[0])
            paths.append(current)
            current = []

    while i < len(toks):
        if is_cmd(toks[i]):
            cmd = toks[i]; i += 1
        if cmd is None:
            break
        rel = cmd.islower(); c = cmd.upper()
        try:
            if c == 'M':
                # First pair is move, subsequent pairs are line-to.
                nx, ny = num(), num()
                if rel: nx, ny = x + nx, y + ny
                close_current()
                current = [(nx, ny)]
                x = sx = nx; y = sy = ny; last_c = None
                while i < len(toks) and not is_cmd(toks[i]):
                    nx, ny = num(), num()
                    if rel: nx, ny = x + nx, y + ny
                    add_point(nx, ny); x, y = nx, ny
            elif c == 'L':
                while i < len(toks) and not is_cmd(toks[i]):
                    nx, ny = num(), num()
                    if rel: nx, ny = x + nx, y + ny
                    add_point(nx, ny); x, y = nx, ny
                last_c = None
            elif c == 'H':
                while i < len(toks) and not is_cmd(toks[i]):
                    nx = num(); nx = x + nx if rel else nx
                    add_point(nx, y); x = nx
                last_c = None
            elif c == 'V':
                while i < len(toks) and not is_cmd(toks[i]):
                    ny = num(); ny = y + ny if rel else ny
                    add_point(x, ny); y = ny
                last_c = None
            elif c == 'C':
                while i < len(toks) and not is_cmd(toks[i]):
                    x1,y1,x2,y2,x3,y3 = num(),num(),num(),num(),num(),num()
                    if rel:
                        x1,y1,x2,y2,x3,y3 = x+x1,y+y1,x+x2,y+y2,x+x3,y+y3
                    x0,y0 = x,y
                    for step in range(1, samples+1):
                        t = step / samples; mt = 1-t
                        px = mt**3*x0 + 3*mt**2*t*x1 + 3*mt*t**2*x2 + t**3*x3
                        py = mt**3*y0 + 3*mt**2*t*y1 + 3*mt*t**2*y2 + t**3*y3
                        add_point(px, py)
                    x,y = x3,y3; last_c = (x2,y2)
            elif c == 'S':
                while i < len(toks) and not is_cmd(toks[i]):
                    if last_c:
                        x1,y1 = 2*x-last_c[0], 2*y-last_c[1]
                    else:
                        x1,y1 = x,y
                    x2,y2,x3,y3 = num(),num(),num(),num()
                    if rel:
                        x2,y2,x3,y3 = x+x2,y+y2,x+x3,y+y3
                    x0,y0 = x,y
                    for step in range(1, samples+1):
                        t = step / samples; mt = 1-t
                        px = mt**3*x0 + 3*mt**2*t*x1 + 3*mt*t**2*x2 + t**3*x3
                        py = mt**3*y0 + 3*mt**2*t*y1 + 3*mt*t**2*y2 + t**3*y3
                        add_point(px, py)
                    x,y = x3,y3; last_c = (x2,y2)
            elif c == 'Z':
                if current:
                    add_point(sx, sy)
                close_current(); x,y = sx,sy; last_c = None
            else:
                break
        except (IndexError, ValueError):
            break
    close_current()
    return paths


def _point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi):
            inside = not inside
        j = i
    return inside


def _make_svg_photo(icon_name: str, fg: str, bg: str, size: int = 24, pad: int = 3):
    path = SVG_ICON_PATHS[icon_name]
    paths = _sample_svg_path(path)
    viewbox = 52.0 if icon_name in ("toggle_left", "toggle_right") else 24.0
    usable = size - pad * 2
    scaled = []
    for poly in paths:
        pts = []
        for x, y in poly:
            if icon_name == "toggle_right":
                x = viewbox - x
            pts.append((pad + (x / viewbox) * usable, pad + (y / viewbox) * usable))
        scaled.append(pts)
    img = tk.PhotoImage(width=size, height=size)
    img.put(bg, to=(0, 0, size, size))
    for yy in range(size):
        # Build row chunks to keep PhotoImage.put reasonably quick.
        row = []
        for xx in range(size):
            px, py = xx + 0.5, yy + 0.5
            inside = False
            for poly in scaled:
                if _point_in_poly(px, py, poly):
                    inside = not inside
            row.append(fg if inside else bg)
        img.put("{" + " ".join(row) + "}", to=(0, yy))
    return img


class _StateAwareButton(tk.Button):
    def __init__(self, *args, **kwargs):
        self._normal_cursor = kwargs.pop("normal_cursor", "hand2")
        self._disabled_cursor = kwargs.pop("disabled_cursor", "")
        super().__init__(*args, **kwargs)
        self._sync_cursor()

    def configure(self, cnf=None, **kwargs):
        result = super().configure(cnf, **kwargs)
        if cnf is not None or kwargs:
            self._sync_cursor()
        return result

    config = configure

    def _sync_cursor(self):
        try:
            state = str(super().cget("state"))
            super().configure(cursor=self._normal_cursor if state != "disabled" else self._disabled_cursor)
        except Exception:
            pass


class _SvgIconButton(_StateAwareButton):
    def __init__(self, master, icon_name: str, command, tooltip: str, image_cache: dict, size: int = 24):
        normal_key = (icon_name, "normal", size)
        disabled_key = (icon_name, "disabled", size)
        if normal_key not in image_cache:
            image_cache[normal_key] = _make_svg_photo(icon_name, BTN_FG, BTN_BG, size=size)
        if disabled_key not in image_cache:
            image_cache[disabled_key] = _make_svg_photo(icon_name, MUTED, BTN_BG, size=size)

        # tkinter.Button does not support a `disabledimage` option.
        # Keep both PhotoImage references and swap `image` manually whenever
        # state changes instead.
        self._image_ref = image_cache[normal_key]
        self._disabled_image_ref = image_cache[disabled_key]

        super().__init__(
            master,
            image=self._image_ref,
            command=command,
            bg=BTN_BG,
            activebackground=BTN_ACTIVE,
            relief="flat",
            padx=5,
            pady=4,
            width=size + 8,
            height=size + 8,
            highlightthickness=1,
            highlightbackground=BORDER,
            bd=0,
            normal_cursor="hand2",
            disabled_cursor="",
        )
        self._sync_image()
        _ToolTip(self, tooltip)

    def configure(self, cnf=None, **kwargs):
        result = super().configure(cnf, **kwargs)
        self._sync_image()
        return result

    config = configure

    def _sync_image(self):
        try:
            if str(super().cget("state")) == "disabled":
                super().configure(image=self._disabled_image_ref)
            else:
                super().configure(image=self._image_ref)
        except Exception:
            pass


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
        self.project_service_links: dict[str, dict[str, str]] = {}
        self._icon_image_cache: dict[tuple[str, str, int], tk.PhotoImage] = {}
        self.left_panel_visible = True
        self.right_panel_visible = True
        # Preserve user-adjusted side-panel widths across left/right panel toggles.
        # Stored as normalized ratios of the dashboard pane width.
        self._last_left_panel_ratio = self._layout_float("dashboard_left_panel_ratio", self._layout_float("dashboard_sash_1_ratio", 0.33)) or 0.33
        right_ratio = self._layout_float("dashboard_right_panel_ratio", None)
        if right_ratio is None:
            second_ratio = self._layout_float("dashboard_sash_2_ratio", 0.67) or 0.67
            right_ratio = max(0.12, 1.0 - second_ratio)
        self._last_right_panel_ratio = right_ratio
        self._footer_default_text = ""
        self.processes = {}
        self.service_ready = {}
        self.process_lock = threading.Lock()
        self.build_lock = threading.Lock()
        self.build_sessions: dict[str, dict] = {}
        self.progress = self._build_session_for(ACTIVE_PROJECT_ID)["progress"]
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
            self._set_footer(f"Project: {self.current_project.name}  |  Git directory: {GIT_PROJECT_DIR}  |  Log file: {LOG_PATH_FILE or 'not set'}  |  Builders: {len(BUILDERS)}  |  Config: {CONFIG_FILE}")
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

    def _build_session_for(self, project_id: str) -> dict:
        session = self.build_sessions.get(project_id)
        if session is None:
            session = {"process": None, "stop_requested": False, "progress": BuildProgress(), "buffer": "", "builder": None}
            self.build_sessions[project_id] = session
        return session

    def _append_build_buffer(self, project_id: str, text: str, max_chars: int = 300000):
        if not text:
            return
        session = self._build_session_for(project_id)
        combined = session.get("buffer", "") + text
        if len(combined) > max_chars:
            combined = combined[-max_chars:]
        session["buffer"] = combined

    def _active_build_session(self) -> dict:
        return self._build_session_for(ACTIVE_PROJECT_ID)

    def _active_build_running(self) -> bool:
        session = self._active_build_session()
        return session.get("process") is not None or bool(session["progress"].running)

    def _set_active_build_session_visible(self):
        session = self._active_build_session()
        self.progress = session["progress"]
        if hasattr(self, "build_status_panel"):
            self.build_status_panel.progress = self.progress
            self.build_status_panel.refresh()
        if hasattr(self, "build_log_pane"):
            self.build_log_pane.clear()
            if session.get("buffer"):
                self.build_log_pane.append(session["buffer"])
            if self._active_build_running():
                self.build_log_pane.set_status("Running", GREEN)
            else:
                color = GREEN if self.progress.success is True else (RED if self.progress.success is False else MUTED)
                self.build_log_pane.set_status(self.progress.current_status or "Idle", color)
        self._refresh_build_controls()

    def _refresh_build_controls(self):
        running = self._active_build_running()
        if hasattr(self, "build_button_frame"):
            for child in self.build_button_frame.winfo_children():
                try:
                    child.configure(state="disabled" if running else "normal")
                except Exception:
                    pass
        if hasattr(self, "stop_build_btn"):
            self.stop_build_btn.configure(state="normal" if running else "disabled")

    def _append_project_buffer(self, project_id: str, key: str, text: str, max_chars: int = 300000):
        if key not in ("wildfly", "vite", "log"):
            return
        buffer_key = (project_id, key)
        existing = self.project_output_buffers.get(buffer_key, "")
        combined = existing + text
        if len(combined) > max_chars:
            combined = combined[-max_chars:]
        self.project_output_buffers[buffer_key] = combined
        if key == "wildfly":
            self._extract_service_links_from_text(project_id, text)

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
            self._set_footer(
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
            self.current_log_path = self.project_current_log_paths.get(project_id, config.get("log_path_file", ""))
            self.log_pane.set_status(os.path.basename(self.current_log_path) if self.current_log_path else "No log file", BLUE if self.current_log_path else MUTED)
        if hasattr(self, "git_terminal"):
            self.git_terminal.refresh_config_labels()
        self._set_active_build_session_visible()
        self._refresh_service_link_buttons()
        self._refresh_active_service_status()

    def _refresh_project_selector(self):
        if not hasattr(self, "project_selector"):
            return
        projects = get_project_registry()
        self.project_selector.configure(values=[p.name for p in projects])
        active = get_project_by_id(ACTIVE_PROJECT_ID)
        self.project_name_var.set(active.name)

    def set_active_project_id(self, project_id: str):
        global ACTIVE_PROJECT_ID
        selected = get_project_by_id(project_id)
        ACTIVE_PROJECT_ID = set_active_project_id(selected.id)
        self.reload_app_config(announce=False)
        self._refresh_project_selector()
        self._set_project_visible(selected.id)

    def on_project_select(self, _event=None):
        selected_name = self.project_name_var.get().strip()
        for p in get_project_registry():
            if p.name == selected_name:
                self.set_active_project_id(p.id)
                return

    def open_add_project_dialog(self):
        dialog = tk.Toplevel(self.root)
        dialog.title("Add Project")
        dialog.configure(bg=BG)
        dialog.transient(self.root)
        dialog.grab_set()
        dialog.resizable(False, False)

        container = tk.Frame(dialog, bg=BG)
        container.pack(fill="both", expand=True, padx=16, pady=16)

        tk.Label(container, text="Add Project", bg=BG, fg=TEXT_FG,
                 font=("Calibri", 14, "bold")).grid(row=0, column=0, columnspan=2, sticky="w", pady=(0, 12))

        name_var = tk.StringVar()
        preview_var = tk.StringVar(value="Project folder and app.config will be created automatically after you enter a name.")

        tk.Label(container, text="Project name", bg=BG, fg=MUTED, font=("Calibri", 10, "bold")).grid(
            row=1, column=0, sticky="w", padx=(0, 8), pady=6
        )
        name_entry = tk.Entry(container, textvariable=name_var, bg=TEXT_BG, fg=TEXT_FG,
                              insertbackground=TEXT_FG, relief="flat", width=58,
                              highlightthickness=1, highlightbackground=BORDER, highlightcolor=BLUE)
        name_entry.grid(row=1, column=1, sticky="ew", pady=6)

        preview_label = tk.Label(container, textvariable=preview_var, bg=BG, fg=MUTED,
                                 justify="left", wraplength=560)
        preview_label.grid(row=2, column=0, columnspan=2, sticky="w", pady=(8, 12))

        def refresh_preview(*_args):
            name = name_var.get().strip()
            if not name:
                preview_var.set("Project folder and app.config will be created automatically after you enter a name.")
                return
            try:
                project_id = make_unique_project_id(name)
                project_root = get_default_project_root(project_id)
                config_path = get_default_project_config_path(project_root)
                preview_var.set(
                    "The dashboard will create:\n"
                    f"Project ID: {project_id}\n"
                    f"Project folder: {project_root}\n"
                    f"Config: {config_path}\n\n"
                    "You can edit Git, log, WildFly, frontend, and builder settings after switching to this project."
                )
            except Exception:
                preview_var.set("Project folder and app.config will be created automatically.")

        name_var.trace_add("write", refresh_preview)

        buttons = tk.Frame(container, bg=BG)
        buttons.grid(row=3, column=0, columnspan=2, sticky="e")
        _StateAwareButton(buttons, text="Cancel", command=dialog.destroy, bg=BTN_BG, fg=BTN_FG,
                  activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
                  padx=14, pady=5, normal_cursor="hand2", disabled_cursor="").pack(side="right", padx=(8, 0))

        def save():
            try:
                project = add_project(name_var.get())
                self.project_configs[project.id] = load_app_config(project.id)
                self.project_output_buffers.setdefault((project.id, "wildfly"), "")
                self.project_output_buffers.setdefault((project.id, "vite"), "")
                self.project_output_buffers.setdefault((project.id, "log"), "")
                self._build_session_for(project.id)
                dialog.destroy()
                self._refresh_project_selector()
                self.set_active_project_id(project.id)
                self.start_service_for_project(project.id, "wildfly")
                self.start_service_for_project(project.id, "vite")
                threading.Thread(target=self._tail_log_path_worker, args=(project.id,), daemon=True).start()
                messagebox.showinfo(
                    "Project Added",
                    f"Created {project.name}. Configure Git, log, WildFly, frontend, and builders in Settings if needed.",
                    parent=self.root,
                )
            except Exception as e:
                messagebox.showerror("Could Not Add Project", str(e), parent=dialog)

        _StateAwareButton(buttons, text="Add Project", command=save, bg=BLUE, fg="#ffffff",
                  activebackground="#4b95dd", activeforeground="#ffffff", relief="flat",
                  padx=16, pady=5, font=("Calibri", 10, "bold"),
                  normal_cursor="hand2", disabled_cursor="").pack(side="right")

        container.grid_columnconfigure(1, weight=1)
        name_entry.focus_set()
        dialog.bind("<Return>", lambda _event: save())
        dialog.bind("<Escape>", lambda _event: dialog.destroy())

        try:
            self.root.update_idletasks()
            x = self.root.winfo_rootx() + max(60, (self.root.winfo_width() - 640) // 2)
            y = self.root.winfo_rooty() + max(60, (self.root.winfo_height() - 220) // 2)
            dialog.geometry(f"640x220+{x}+{y}")
        except Exception:
            pass

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
        outer.pack(fill="both", expand=True, padx=5, pady=5)

        toolbar = tk.Frame(outer, bg=BG)
        toolbar.pack(fill="x", pady=(0, 4))

        def button(parent, text, cmd, bg=BTN_BG, active_bg=BTN_ACTIVE):
            return _StateAwareButton(
                parent, text=text, command=cmd, bg=bg, fg=BTN_FG, activebackground=active_bg,
                activeforeground=BTN_FG, relief="flat", padx=12, pady=6,
                font=("Calibri", 10, "bold"), highlightthickness=1, highlightbackground=BORDER,
                normal_cursor="hand2", disabled_cursor=""
            )

        self.toolbar_button_factory = button

        def icon_button(parent, icon_name, cmd, tooltip):
            return _SvgIconButton(parent, icon_name, cmd, tooltip, self._icon_image_cache)

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
        icon_button(project_box, "add", self.open_add_project_dialog, "Add Project").pack(side="left", padx=(8, 0))

        runtime_box = tk.Frame(toolbar, bg=BG)
        runtime_box.pack(side="left", padx=(0, 12))
        tk.Label(runtime_box, text="WildFly", bg=BG, fg=MUTED, font=("Calibri", 10, "bold")).pack(side="left", padx=(0, 4))
        self.wildfly_start_btn = icon_button(runtime_box, "start", lambda: self.start_service_for_project(ACTIVE_PROJECT_ID, "wildfly"), "Start WildFly")
        self.wildfly_start_btn.pack(side="left", padx=(0, 2))
        self.wildfly_stop_btn = icon_button(runtime_box, "stop", lambda: self.stop_named_process("wildfly", project_id=ACTIVE_PROJECT_ID), "Terminate WildFly")
        self.wildfly_stop_btn.pack(side="left", padx=2)
        self.wildfly_restart_btn = icon_button(runtime_box, "restart", lambda: self.restart_service_for_project(ACTIVE_PROJECT_ID, "wildfly"), "Restart WildFly")
        self.wildfly_restart_btn.pack(side="left", padx=(2, 10))
        tk.Label(runtime_box, text="Frontend", bg=BG, fg=MUTED, font=("Calibri", 10, "bold")).pack(side="left", padx=(0, 4))
        self.frontend_start_btn = icon_button(runtime_box, "start", lambda: self.start_service_for_project(ACTIVE_PROJECT_ID, "vite"), "Start Frontend")
        self.frontend_start_btn.pack(side="left", padx=(0, 2))
        self.frontend_stop_btn = icon_button(runtime_box, "stop", lambda: self.stop_named_process("vite", project_id=ACTIVE_PROJECT_ID), "Terminate Frontend")
        self.frontend_stop_btn.pack(side="left", padx=2)
        self.frontend_restart_btn = icon_button(runtime_box, "restart", lambda: self.restart_service_for_project(ACTIVE_PROJECT_ID, "vite"), "Restart Frontend")
        self.frontend_restart_btn.pack(side="left", padx=(2, 10))

        self.maintenance_btn = button(runtime_box, "KMU", lambda: self.open_service_link("maintenance"))
        self.maintenance_btn.pack(side="left", padx=(0, 2))
        _ToolTip(self.maintenance_btn, "Open KMU")
        self.management_console_btn = button(runtime_box, "Admin Console", lambda: self.open_service_link("management_console"))
        self.management_console_btn.pack(side="left", padx=(2, 0))
        _ToolTip(self.management_console_btn, "Open Admin Console")
        self._refresh_service_link_buttons()

        self.build_button_frame = tk.Frame(toolbar, bg=BG)
        self.build_button_frame.pack(side="left", padx=(18, 0))
        self.rebuild_build_buttons()

        self.stop_build_btn = button(toolbar, "Stop Build", self.stop_build)
        self.stop_build_btn.pack(side="left", padx=6)
        self.stop_build_btn.configure(state="disabled")
        button(toolbar, "Clear Build Log", lambda: self.build_log_pane.clear()).pack(side="left", padx=(18, 6))
        button(toolbar, "Clear Log Tail", lambda: self.log_pane.clear()).pack(side="left", padx=6)
        icon_button(toolbar, "settings", self.open_settings, "Settings").pack(side="right", padx=(6, 0))
        self.toggle_right_btn = icon_button(toolbar, "toggle_right", self.toggle_right_panel, "Toggle right panel")
        self.toggle_right_btn.pack(side="right", padx=(4, 0))
        self.toggle_left_btn = icon_button(toolbar, "toggle_left", self.toggle_left_panel, "Toggle left panel")
        self.toggle_left_btn.pack(side="right", padx=(4, 0))

        self.notebook = ttk.Notebook(outer, style="Dashboard.TNotebook")
        self.notebook.pack(fill="both", expand=True, ipadx=0, ipady=0)

        dashboard_tab = tk.Frame(self.notebook, bg=BG)
        self.notebook.add(dashboard_tab, text="Dashboard")

        content = tk.Frame(dashboard_tab, bg=BG)
        content.pack(fill="both", expand=True, padx=0, pady=(4, 0))

        # Three-column dashboard layout:
        #   left   = Frontend + Log Tail
        #   center = WildFly
        #   right  = Build Status + Build Log
        self.dashboard_pane = tk.PanedWindow(
            content, orient="horizontal", bg=BG, bd=0, sashwidth=4,
            sashrelief="flat", opaqueresize=True, showhandle=False, handlepad=0, handlesize=0,
        )
        self.dashboard_pane.pack(fill="both", expand=True)

        self.left_col = tk.Frame(self.dashboard_pane, bg=BG)
        self.center_col = tk.Frame(self.dashboard_pane, bg=BG)
        self.right_col = tk.Frame(self.dashboard_pane, bg=BG)

        self.middle_pane = tk.PanedWindow(
            self.left_col, orient="vertical", bg=BG, bd=0, sashwidth=4,
            sashrelief="flat", opaqueresize=True, showhandle=False, handlepad=0, handlesize=0,
        )
        self.middle_pane.pack(fill="both", expand=True)

        self.vite_pane = TextPane(self.middle_pane, FRONTEND_NAME or "Frontend", self, compact=True)
        self.middle_pane.add(self.vite_pane.frame, minsize=120, stretch="never", padx=0, pady=0)

        self.log_pane = TextPane(
            self.middle_pane, "Log Tail", self, compact=False,
            actions=[("Open Log File", self.open_current_log_file)],
        )
        self.middle_pane.add(self.log_pane.frame, minsize=180, stretch="always", padx=0, pady=4)

        self.wildfly_pane = TextPane(self.center_col, "WildFly", self)
        self.wildfly_pane.frame.pack(fill="both", expand=True)

        self.build_pane = tk.PanedWindow(
            self.right_col, orient="vertical", bg=BG, bd=0, sashwidth=4,
            sashrelief="flat", opaqueresize=True, showhandle=False, handlepad=0, handlesize=0,
        )
        self.build_pane.pack(fill="both", expand=True)

        self.build_status_panel = BuildStatusPanel(self.build_pane, self.progress, app=self)
        self.build_pane.add(self.build_status_panel.frame, minsize=360, stretch="always", padx=0, pady=0)

        self.build_log_pane = TextPane(
            self.build_pane, "Build Log", self, compact=False, collapsible=True,
            collapsed=True, collapsed_height=42, actions=[("Open Build Log", self.open_build_log_file)],
        )
        self.build_pane.add(self.build_log_pane.frame, minsize=42, stretch="never", padx=0, pady=4)
        self._adjusting_build_pane = False
        self.build_pane.bind("<Configure>", self._on_build_pane_configure)
        self._apply_panel_visibility()

        self.git_terminal = GitTerminalTab(self.notebook, self)
        self.notebook.add(self.git_terminal.frame, text="Git Terminal")

        # Bottom status bar and bottom-right version tag are intentionally hidden.
        # Keep footer_var as a non-visible status sink so existing code can continue
        # to call _set_footer without creating a bottom UI strip. Version remains
        # visible in Settings.
        self.footer_var = tk.StringVar(value=f"Project: {self.current_project.name}  |  Git directory: {GIT_PROJECT_DIR}  |  Log file: {LOG_PATH_FILE or 'not set'}  |  Builders: {len(BUILDERS)}  |  Config: {CONFIG_FILE}")
        self._footer_default_text = self.footer_var.get()

        self.root.after(50, self._restore_or_set_dashboard_split)
        self.root.after(250, self._restore_or_set_dashboard_split)
        self.root.after(800, self._restore_or_set_dashboard_split)

    def _set_footer(self, text: str):
        self._footer_default_text = text
        if hasattr(self, "footer_var"):
            self.footer_var.set(text)

    def _show_version_footer_info(self, _event=None):
        if hasattr(self, "footer_var"):
            self.footer_var.set(f"IVS Dashboard {APP_VERSION}  |  App data: {APP_DATA_DIR}  |  Project limit: {MAX_PROJECTS}")

    def _restore_footer_info(self, _event=None):
        if hasattr(self, "footer_var"):
            self.footer_var.set(self._footer_default_text or self.footer_var.get())

    def _tint_toggle_button(self, button, icon_name: str, enabled: bool):
        if not button:
            return
        key = (icon_name, "on" if enabled else "off", 24)
        if key not in self._icon_image_cache:
            fg = BLUE if enabled else MUTED
            self._icon_image_cache[key] = _make_svg_photo(icon_name, fg, BTN_BG, size=24)
        button.configure(image=self._icon_image_cache[key], state="normal")

    def _capture_visible_panel_widths(self):
        """Remember current side-panel widths before hiding either side panel."""
        if not hasattr(self, "dashboard_pane"):
            return
        try:
            total_width = self.dashboard_pane.winfo_width()
            if total_width <= 0:
                return
            if self.left_panel_visible and hasattr(self, "left_col") and self.left_col.winfo_ismapped():
                left_width = self.left_col.winfo_width()
                if left_width > 0:
                    self._last_left_panel_ratio = max(0.08, min(0.70, left_width / total_width))
            if self.right_panel_visible and hasattr(self, "right_col") and self.right_col.winfo_ismapped():
                right_width = self.right_col.winfo_width()
                if right_width > 0:
                    self._last_right_panel_ratio = max(0.08, min(0.70, right_width / total_width))
        except Exception:
            pass

    def _restore_visible_panel_widths(self):
        """Restore last known side-panel widths after left/right toggle changes."""
        if not hasattr(self, "dashboard_pane"):
            return
        try:
            width = self.dashboard_pane.winfo_width()
            if width <= 0:
                return
            min_left = 120
            min_center = 260
            min_right = 160
            left_w = int(width * (self._last_left_panel_ratio or 0.33))
            right_w = int(width * (self._last_right_panel_ratio or 0.25))
            left_w = max(min_left, min(left_w, max(min_left, width - min_center - min_right)))
            right_w = max(min_right, min(right_w, max(min_right, width - min_center - min_left)))

            if self.left_panel_visible and self.right_panel_visible:
                x1 = left_w
                x2 = width - right_w
                if x2 - x1 < min_center:
                    x2 = min(width - min_right, x1 + min_center)
                    if x2 > width - min_right:
                        x1 = max(min_left, x2 - min_center)
                self.dashboard_pane.sash_place(0, x1, 0)
                self.dashboard_pane.sash_place(1, x2, 0)
            elif self.left_panel_visible:
                x1 = min(left_w, width - min_center)
                self.dashboard_pane.sash_place(0, max(min_left, x1), 0)
            elif self.right_panel_visible:
                x1 = max(min_center, width - right_w)
                self.dashboard_pane.sash_place(0, min(width - min_right, x1), 0)
        except Exception:
            pass

    def _apply_panel_visibility(self, restore_saved_widths: bool = True):
        if not hasattr(self, "dashboard_pane"):
            return
        for child in (getattr(self, "left_col", None), getattr(self, "center_col", None), getattr(self, "right_col", None)):
            if child is None:
                continue
            try:
                self.dashboard_pane.forget(child)
            except Exception:
                try:
                    self.dashboard_pane.remove(child)
                except Exception:
                    pass
        if self.left_panel_visible:
            self.dashboard_pane.add(self.left_col, minsize=120, stretch="never", padx=0, pady=0)
        self.dashboard_pane.add(self.center_col, minsize=260, stretch="always", padx=2 if self.left_panel_visible else 0, pady=0)
        if self.right_panel_visible:
            self.dashboard_pane.add(self.right_col, minsize=160, stretch="never", padx=2, pady=0)
        self._tint_toggle_button(getattr(self, "toggle_left_btn", None), "toggle_left", self.left_panel_visible)
        self._tint_toggle_button(getattr(self, "toggle_right_btn", None), "toggle_right", self.right_panel_visible)
        if restore_saved_widths:
            self.root.after_idle(self._restore_visible_panel_widths)

    def toggle_left_panel(self):
        self._capture_visible_panel_widths()
        self.left_panel_visible = not self.left_panel_visible
        self._apply_panel_visibility(restore_saved_widths=True)

    def toggle_right_panel(self):
        self._capture_visible_panel_widths()
        self.right_panel_visible = not self.right_panel_visible
        self._apply_panel_visibility(restore_saved_widths=True)

    def delete_active_project(self):
        projects = get_project_registry()
        if len(projects) <= 1:
            messagebox.showinfo("Cannot Delete Project", "Keep at least one project in the dashboard.", parent=self.root)
            return
        project = get_project_by_id(ACTIVE_PROJECT_ID)
        if not messagebox.askyesno(
            "Delete Project?",
            f"Remove {project.name} from this dashboard?\n\nThis will stop this project's services/build and remove it from the dashboard registry. It will not delete project files from disk.",
            parent=self.root,
        ):
            return
        for key in ("wildfly", "vite"):
            self.stop_named_process(key, project_id=project.id)
        with self.build_lock:
            proc = self._build_session_for(project.id).get("process")
            if proc is not None:
                try:
                    kill_process_tree(proc.pid)
                except Exception:
                    pass
        try:
            removed, remaining = remove_project(project.id)
            self.project_configs.pop(project.id, None)
            for key in list(self.project_output_buffers):
                if key[0] == project.id:
                    self.project_output_buffers.pop(key, None)
            self.build_sessions.pop(project.id, None)
            self.project_service_links.pop(project.id, None)
            self._refresh_project_selector()
            if remaining:
                self.set_active_project_id(remaining[0].id)
            else:
                self._set_footer("No project selected. Add a project to begin.")
            messagebox.showinfo("Project Removed", f"Removed {removed.name} from the dashboard.", parent=self.root)
        except Exception as e:
            messagebox.showerror("Could Not Delete Project", str(e), parent=self.root)


    def _extract_service_links_from_text(self, project_id: str, text: str):
        if not text:
            return
        links = self.project_service_links.setdefault(project_id, {})
        for raw_line in text.splitlines():
            line = raw_line.strip()
            low = line.lower()
            urls = re.findall(r"https?://[^\s\]\)\"'<>]+", line)
            if not urls:
                continue
            for url in urls:
                clean_url = url.rstrip(".,;:")
                url_low = clean_url.lower()
                if "maintenance" in low or "maintenance" in url_low or "key service" in low or "key-service" in url_low:
                    links["maintenance"] = clean_url
                if "management" in low or "console" in low or ":9990" in url_low or "/management" in url_low:
                    console_url = clean_url
                    if console_url.endswith("/management"):
                        console_url = console_url[:-len("/management")] + "/console"
                    links["management_console"] = console_url
        if project_id == ACTIVE_PROJECT_ID:
            try:
                self._refresh_service_link_buttons()
            except Exception:
                pass

    def _configured_service_url(self, project_id: str, link_key: str) -> str:
        config = self.project_configs.get(project_id) or load_app_config(project_id)
        configured = (config.get("kmu_url") if link_key == "maintenance" else config.get("admin_console_url")) or ""
        if configured.strip():
            return configured.strip()
        return (self.project_service_links.get(project_id, {}) or {}).get(link_key, "")

    def open_service_link(self, link_key: str):
        url = self._configured_service_url(ACTIVE_PROJECT_ID, link_key)
        if not url:
            label = "KMU" if link_key == "maintenance" else "Admin Console"
            messagebox.showinfo(
                "Link Not Available",
                f"No {label} URL is configured for the active project yet.",
                parent=self.root,
            )
            return
        try:
            webbrowser.open(url)
        except Exception as e:
            messagebox.showerror("Could Not Open Link", str(e), parent=self.root)

    def _refresh_service_link_buttons(self):
        for attr, key in (("maintenance_btn", "maintenance"), ("management_console_btn", "management_console")):
            btn = getattr(self, attr, None)
            if btn is not None:
                btn.configure(state="normal" if self._configured_service_url(ACTIVE_PROJECT_ID, key) else "disabled")

    def rebuild_build_buttons(self):
        if not hasattr(self, "build_button_frame"):
            return
        for child in self.build_button_frame.winfo_children():
            child.destroy()
        factory = getattr(self, "toolbar_button_factory", None)
        if factory is None:
            return
        config = self.project_configs.get(ACTIVE_PROJECT_ID) or load_app_config(ACTIVE_PROJECT_ID)
        builders = config.get("builders", [])
        for index, builder in enumerate(builders):
            profile = builder.get("profile", "")
            confirm = _bool_value(builder.get("confirm_before_run", False))
            bg = PROD_BTN_BG if confirm or profile.lower() == "prod" else BTN_BG
            active_bg = PROD_BTN_ACTIVE if confirm or profile.lower() == "prod" else BTN_ACTIVE
            label = builder.get("label") or f"Run {profile.upper()} Build"
            factory(self.build_button_frame, label, lambda b=builder: self.start_build(b), bg=bg, active_bg=active_bg).pack(side="left", padx=(0 if index == 0 else 3, 3))
        self._refresh_build_controls()

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
            left_ratio = self._layout_float("dashboard_left_panel_ratio", None)
            right_ratio = self._layout_float("dashboard_right_panel_ratio", None)
            if left_ratio is None:
                left_ratio = self._layout_float("dashboard_sash_1_ratio", 0.33) or 0.33
            if right_ratio is None:
                second_ratio = self._layout_float("dashboard_sash_2_ratio", 0.67) or 0.67
                right_ratio = max(0.12, 1.0 - second_ratio)
            self._last_left_panel_ratio = left_ratio
            self._last_right_panel_ratio = right_ratio
            self._restore_visible_panel_widths()
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
            self._capture_visible_panel_widths()
            layout["dashboard_left_panel_ratio"] = f"{self._last_left_panel_ratio:.6f}"
            layout["dashboard_right_panel_ratio"] = f"{self._last_right_panel_ratio:.6f}"
            width = self.dashboard_pane.winfo_width()
            if width > 0 and self.left_panel_visible and self.right_panel_visible:
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
            self._last_left_panel_ratio = 0.33
            self._last_right_panel_ratio = 0.33
            self._restore_visible_panel_widths()
        except Exception:
            pass

        try:
            middle_h = self.middle_pane.winfo_height()
            if middle_h > 0:
                self.middle_pane.sash_place(0, 0, max(150, int(middle_h * 0.32)))
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
            return self._active_build_running()
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
            status_h = max(360, build_h - collapsed_h - 6)
            self.build_pane.paneconfigure(self.build_status_panel.frame, minsize=360, height=status_h, stretch="always")
            self.build_pane.paneconfigure(self.build_log_pane.frame, minsize=collapsed_h, height=collapsed_h, stretch="never")
            self.build_log_pane.frame.configure(height=collapsed_h)
            self.build_pane.sash_place(0, 0, min(status_h, max(0, build_h - collapsed_h - 6)))
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
            self.build_pane.sash_place(0, 0, min(status_h, max(0, build_h - log_h - 6)))
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
        project_id = ACTIVE_PROJECT_ID
        project = get_project_by_id(project_id)
        config = self.project_configs.get(project_id) or load_app_config(project_id)
        self.project_configs[project_id] = config
        build_name = (builder.get("name") or builder.get("profile") or "build").strip() or "build"
        builder_config = config.get("builder_config", {})
        command = builder.get("command") or build_maven_command(builder, builder_config)
        git_dir = config.get("git_project_dir", "")
        build_work_dir = config.get("build_work_dir", "")
        branch, branch_error = get_current_git_branch(git_dir)

        requires_confirm = _bool_value(builder.get("confirm_before_run", False)) or build_name.lower() == "prod"
        if requires_confirm:
            if not branch:
                messagebox.showerror(
                    f"{build_name.upper()} Build Blocked",
                    f"Cannot detect the current Git branch, so the {build_name.upper()} build was cancelled.\n\n"
                    f"Git directory: {git_dir}\n"
                    f"Reason: {branch_error or 'unknown'}",
                    parent=self.root,
                )
                return
            proceed = messagebox.askyesno(
                f"Confirm {build_name.upper()} Build",
                f"You are about to run a {build_name.upper()} build for {project.name}.\n\n"
                f"Current branch: {branch}\n"
                f"Command: {command}\n\n"
                "Continue?",
                parent=self.root,
            )
            if not proceed:
                self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] {build_name.upper()} build cancelled by user. Branch: {branch}\n", project_id=project_id)
                return

        with self.build_lock:
            session = self._build_session_for(project_id)
            if session.get("process") is not None or session["progress"].running:
                self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] Another build is already running for {project.name}.\n", project_id=project_id)
                return
            session["stop_requested"] = False
            session["buffer"] = ""
            session["builder"] = build_name
            progress = session["progress"]
            progress.start(build_name, branch or "unavailable", branch_error or "")
            if project_id == ACTIVE_PROJECT_ID:
                self.progress = progress
                self.build_status_panel.progress = progress
                self.build_log_pane.clear()
                self.build_log_pane.set_status("Starting...", YELLOW)
                if not self.build_log_pane.collapsed:
                    self._apply_build_log_expanded_size()
                self.build_status_panel.refresh()
                self._refresh_build_controls()
            self.enqueue("build", f"[{time.strftime('%H:%M:%S')}] Starting {build_name} build for {project.name}: {command}\n", project_id=project_id)
            self.enqueue("build", f"[{time.strftime('%H:%M:%S')}] Git branch: {branch or 'unavailable'}\n", project_id=project_id)
            if branch_error:
                self.enqueue("build", f"[{time.strftime('%H:%M:%S')}] Branch detection warning: {branch_error}\n", project_id=project_id)
            cwd = build_work_dir if build_work_dir and os.path.isdir(build_work_dir) else APP_DIR
            t = threading.Thread(target=self._run_process_thread, args=(project_id, "build", command, cwd, True), daemon=True)
            t.start()

    def stop_build(self):
        project_id = ACTIVE_PROJECT_ID
        with self.build_lock:
            session = self._build_session_for(project_id)
            proc = session.get("process")
            if proc is not None:
                session["stop_requested"] = True
        if proc is not None:
            self.enqueue("build", f"\n[{time.strftime('%H:%M:%S')}] Stopping build...\n", project_id=project_id)
            self.build_log_pane.set_status("Stopping...", YELLOW)
            progress = self._build_session_for(project_id)["progress"]
            if progress.running:
                progress.current_status = f"Stopping {progress.build_name.upper()} build..."
                self.build_status_panel.refresh()
            self._refresh_build_controls()
            kill_process_tree(proc.pid)
        else:
            self.build_log_pane.set_status("Idle", MUTED)
            self._refresh_build_controls()

    def stop_named_process(self, key: str, project_id: str | None = None):
        pid = project_id or ACTIVE_PROJECT_ID
        process_key = self._service_process_key(pid, key)
        with self.process_lock:
            self.service_ready[process_key] = False
            proc = self.processes.get(process_key)
        if proc is not None:
            self.enqueue(key, f"\n[{time.strftime('%H:%M:%S')}] Stopping {key}...\n", project_id=pid)
            kill_process_tree(proc.pid)
        if pid == ACTIVE_PROJECT_ID:
            self._refresh_active_service_status()

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
        process_key = self._service_process_key(project_id, key) if not is_build else self._service_process_key(project_id, "build")
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
                    self._build_session_for(project_id)["process"] = proc
                if project_id == ACTIVE_PROJECT_ID:
                    self.root.after(0, self._refresh_build_controls)
            else:
                with self.process_lock:
                    self.processes[process_key] = proc

            if is_build:
                if project_id == ACTIVE_PROJECT_ID:
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
                    self._build_session_for(project_id)["progress"].parse_line(line)
                elif key == "wildfly" and self._is_wildfly_ready_line(line):
                    with self.process_lock:
                        self.service_ready[process_key] = True
                    if project_id == ACTIVE_PROJECT_ID:
                        self._safe_set_status(pane, "Running", GREEN)

            exit_code = proc.wait(timeout=2) if proc.poll() is None else proc.returncode
            if is_build:
                with self.build_lock:
                    session = self._build_session_for(project_id)
                    stopped_by_user = session.get("stop_requested", False)
                    progress = session["progress"]
                if progress.running:
                    if exit_code == 0 and not stopped_by_user:
                        progress.mark_frontend_skipped_if_needed()
                        progress.finish(True)
                    else:
                        progress.finish(False)
                        if stopped_by_user:
                            progress.current_status = f"{progress.build_name.upper()} build stopped"
                if stopped_by_user:
                    if project_id == ACTIVE_PROJECT_ID:
                        self._safe_set_status(pane, "Stopped", YELLOW)
                    self.enqueue("build", f"\n[{time.strftime('%H:%M:%S' )}] Build stopped by user. Exit code: {exit_code}\n", project_id=project_id)
                elif exit_code == 0:
                    if project_id == ACTIVE_PROJECT_ID:
                        self._safe_set_status(pane, "Completed", GREEN)
                    self.enqueue("build", f"\n[{time.strftime('%H:%M:%S' )}] Build command completed with code {exit_code}\n", project_id=project_id)
                else:
                    if project_id == ACTIVE_PROJECT_ID:
                        self._safe_set_status(pane, "Failed", RED)
                    self.enqueue("build", f"\n[{time.strftime('%H:%M:%S' )}] Build command exited with code {exit_code}\n", project_id=project_id)
                with self.build_lock:
                    session = self._build_session_for(project_id)
                    session["process"] = None
                    session["stop_requested"] = False
                if project_id == ACTIVE_PROJECT_ID:
                    self.root.after(0, self._refresh_build_controls)
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
                progress = self._build_session_for(project_id)["progress"]
                progress.finish(False)
                if project_id == ACTIVE_PROJECT_ID:
                    self._safe_set_status(pane, "Error", RED)
                with self.build_lock:
                    session = self._build_session_for(project_id)
                    session["process"] = None
                    session["stop_requested"] = False
                if project_id == ACTIVE_PROJECT_ID:
                    self.root.after(0, self._refresh_build_controls)
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
                    self._reset_log_window()

                if not os.path.exists(current_log_path):
                    if not missing_reported:
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
        pid = project_id or (ACTIVE_PROJECT_ID if key in ("wildfly", "vite", "log", "build") else None)
        if pid and key in ("wildfly", "vite", "log"):
            self._append_project_buffer(pid, key, text)
            self.queues[key].put((pid, text))
        elif pid and key == "build":
            self._append_build_buffer(pid, text)
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
        self._refresh_build_controls()
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
        self._refresh_runtime_buttons(wildfly_running, wildfly_ready, vite_running, vite_ready)

    def _refresh_runtime_buttons(self, wildfly_running: bool, wildfly_ready: bool, vite_running: bool, vite_ready: bool):
        def apply(start_btn, stop_btn, restart_btn, running: bool, ready: bool):
            try:
                if running and not ready:
                    start_state = stop_state = restart_state = "disabled"
                elif running:
                    start_state, stop_state, restart_state = "disabled", "normal", "normal"
                else:
                    start_state, stop_state, restart_state = "normal", "disabled", "disabled"
                start_btn.configure(state=start_state)
                stop_btn.configure(state=stop_state)
                restart_btn.configure(state=restart_state)
            except Exception:
                pass
        apply(getattr(self, "wildfly_start_btn", None), getattr(self, "wildfly_stop_btn", None), getattr(self, "wildfly_restart_btn", None), wildfly_running, wildfly_ready)
        apply(getattr(self, "frontend_start_btn", None), getattr(self, "frontend_stop_btn", None), getattr(self, "frontend_restart_btn", None), vite_running, vite_ready)
        self._refresh_service_link_buttons()

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
            build_procs = [session.get("process") for session in self.build_sessions.values() if session.get("process") is not None]
        for build_proc in build_procs:
            try:
                kill_process_tree(build_proc.pid)
            except Exception:
                pass

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
            for build_proc in build_procs:
                if build_proc is not None and build_proc.poll() is None:
                    alive = True
                    break
            if not alive:
                break
            self.root.update_idletasks()
            time.sleep(0.12)

        self.root.destroy()
