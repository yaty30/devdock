from ..common import *

class ConfigEditorDialog:
    def __init__(self, app):
        self.app = app
        self.root = app.root
        self.window = tk.Toplevel(self.root)
        self.window.title("Settings")
        self.window.configure(bg=BG)
        self.window.resizable(True, True)
        self.window.transient(self.root)
        self.window.grab_set()

        self.values = load_config_values_for_edit()
        self.entries: dict[str, tk.StringVar] = {}
        self.builder_rows: list[dict] = []
        self._observed_project_id = get_active_project_id()

        container = tk.Frame(self.window, bg=BG)
        container.pack(fill="both", expand=True, padx=18, pady=16)

        tk.Label(container, text="Dashboard Settings", bg=BG, fg="#f8fafc",
                 font=("Calibri", 14, "bold"), anchor="w").pack(fill="x", pady=(0, 6))
        tk.Label(container, text="Saved to app.config. Builder commands are generated from Maven config + build profiles, so custom wrapper .bat files are not required.",
                 bg=BG, fg=MUTED, font=("Calibri", 10), anchor="w", wraplength=760, justify="left").pack(fill="x", pady=(0, 10))
        active_project = get_project_by_id(get_active_project_id())
        self.active_project_banner_var = tk.StringVar(
            value=f"Current project: {active_project.name} ({active_project.id})"
        )
        tk.Label(
            container,
            textvariable=self.active_project_banner_var,
            bg=BG,
            fg=BLUE,
            font=("Calibri", 10, "bold"),
            anchor="w",
        ).pack(fill="x", pady=(0, 8))

        self.status_var = tk.StringVar(value="")
        tk.Label(container, textvariable=self.status_var, bg=BG, fg=YELLOW,
                 font=("Calibri", 10), anchor="w", wraplength=760, justify="left").pack(fill="x", pady=(0, 10))

        self.tabs = ttk.Notebook(container, style="Dashboard.TNotebook")
        self.tabs.pack(fill="both", expand=True)

        self.general_tab = tk.Frame(self.tabs, bg=BG)
        self.builders_tab = tk.Frame(self.tabs, bg=BG)
        self.tabs.add(self.general_tab, text="General / Services")
        self.tabs.add(self.builders_tab, text="Builders")

        self._build_general_tab()
        self._build_builders_tab()

        button_row = tk.Frame(container, bg=BG)
        button_row.pack(fill="x", pady=(14, 0))
        tk.Button(button_row, text="Cancel", command=self.window.destroy, bg=BTN_BG, fg=BTN_FG,
                  activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat", padx=14, pady=5,
                  font=("Calibri", 10, "bold")).pack(side="right", padx=(8, 0))
        tk.Button(button_row, text="Save", command=self.save, bg=BLUE, fg="#ffffff",
                  activebackground="#4b95dd", activeforeground="#ffffff", relief="flat", padx=16, pady=5,
                  font=("Calibri", 10, "bold")).pack(side="right")
        tk.Button(button_row, text="Validate", command=self.validate_and_report, bg=BTN_BG, fg=BTN_FG,
                  activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat", padx=14, pady=5,
                  font=("Calibri", 10, "bold")).pack(side="right", padx=(0, 8))

        self.window.update_idletasks()
        width = max(860, self.window.winfo_width())
        height = max(720, self.window.winfo_height())
        x = self.root.winfo_rootx() + max(0, (self.root.winfo_width() - width) // 2)
        y = self.root.winfo_rooty() + max(0, (self.root.winfo_height() - height) // 3)
        self.window.geometry(f"{width}x{height}+{x}+{y}")
        self.window.bind("<Escape>", lambda _event: self.window.destroy())

    def _add_field(self, parent, row: int, key: str, label: str, browse_type: str = "text", width: int = 70):
        tk.Label(parent, text=label, bg=BG, fg=TEXT_FG, font=("Calibri", 10, "bold"), anchor="w").grid(row=row, column=0, sticky="w", padx=(0, 10), pady=5)
        var = tk.StringVar(value=self.values.get(key, ""))
        entry = tk.Entry(parent, textvariable=var, width=width, bg=TEXT_BG, fg=TEXT_FG,
                         insertbackground=TEXT_FG, relief="flat", highlightthickness=1,
                         highlightbackground=BORDER, highlightcolor=BLUE, font=("Calibri", 10))
        entry.grid(row=row, column=1, sticky="ew", pady=5)
        self.entries[key] = var
        if browse_type == "text":
            tk.Label(parent, text="", bg=BG).grid(row=row, column=2, sticky="ew", padx=(8, 0), pady=5)
        else:
            tk.Button(parent, text="Browse", command=lambda k=key, t=browse_type: self.browse(k, t),
                      bg=BTN_BG, fg=BTN_FG, activebackground=BTN_ACTIVE, activeforeground=BTN_FG,
                      relief="flat", padx=10, pady=3, font=("Calibri", 9, "bold")).grid(row=row, column=2, sticky="ew", padx=(8, 0), pady=5)

    def _build_general_tab(self):
        form = tk.Frame(self.general_tab, bg=BG)
        form.pack(fill="both", expand=True, padx=10, pady=12)
        self._build_current_project_section(form)
        fields = [
            ("log_file_path", "Application Log File Path", "file"),
            ("git_project_dir", "Git Project Directory", "dir"),
            ("frontend_name", "Frontend Display Name", "text"),
            ("frontend_dir", "Frontend Directory", "dir"),
            ("frontend_command", "Frontend Command", "text"),
            ("wildfly_dir", "WildFly Bin Directory", "dir"),
            ("wildfly_command", "WildFly Start Command", "text"),
        ]
        for idx, (key, label, browse_type) in enumerate(fields, start=7):
            self._add_field(form, idx, key, label, browse_type)
        form.grid_columnconfigure(1, weight=1)

    def _build_current_project_section(self, parent):
        panel = tk.Frame(parent, bg=PANEL_BG, highlightthickness=1, highlightbackground=BORDER)
        panel.grid(row=0, column=0, columnspan=3, sticky="ew", pady=(0, 12))
        tk.Label(panel, text="Current Project", bg=PANEL_BG, fg="#f8fafc", font=("Calibri", 12, "bold"), anchor="w").grid(row=0, column=0, columnspan=2, sticky="ew", padx=10, pady=(10, 6))
        self.current_project_vars = {
            "name": tk.StringVar(value=""),
            "id": tk.StringVar(value=""),
            "root": tk.StringVar(value=""),
            "config": tk.StringVar(value=""),
            "runtime": tk.StringVar(value=""),
            "port": tk.StringVar(value=""),
        }
        labels = [("Project", "name"), ("Project ID", "id"), ("Root Path", "root"), ("Config", "config"), ("Runtime", "runtime"), ("Port", "port")]
        for row, (label, key) in enumerate(labels, start=1):
            tk.Label(panel, text=f"{label}:", bg=PANEL_BG, fg=MUTED, font=("Calibri", 10, "bold"), anchor="w").grid(row=row, column=0, sticky="nw", padx=(10, 8), pady=2)
            tk.Label(panel, textvariable=self.current_project_vars[key], bg=PANEL_BG, fg=TEXT_FG, font=("Calibri", 10), anchor="w", justify="left", wraplength=620).grid(row=row, column=1, sticky="ew", padx=(0, 10), pady=2)
        panel.grid_columnconfigure(1, weight=1)
        self._refresh_current_project_section()
        self.window.after(800, self._poll_active_project)

    def _extract_wildfly_port(self, command: str) -> str:
        cmd = (command or "").strip()
        match = re.search(r"(?:jboss\.socket\.binding\.port-offset|jboss\.http\.port)\s*=?\s*(\d+)", cmd, re.IGNORECASE)
        if not match:
            return "Not available"
        if "port-offset" in cmd.lower():
            try:
                return str(8080 + int(match.group(1)))
            except Exception:
                return "Not available"
        return match.group(1)

    def _refresh_current_project_section(self):
        project_id = get_active_project_id()
        project = get_project_by_id(project_id)
        values = self.values or {}
        if not project:
            for var in self.current_project_vars.values():
                var.set("No project selected. Add or select a project to configure settings.")
            return
        runtime = "Unknown"
        if hasattr(self.app, "get_runtime_status_for_project"):
            runtime = self.app.get_runtime_status_for_project(project.id).get("runtime", "Unknown")
        self.current_project_vars["name"].set(project.name)
        self.current_project_vars["id"].set(project.id)
        self.current_project_vars["root"].set(values.get("git_project_dir", ""))
        self.current_project_vars["config"].set(get_config_file_for_project(project.id))
        self.current_project_vars["runtime"].set(runtime)
        self.current_project_vars["port"].set(self._extract_wildfly_port(values.get("wildfly_command", "")))

    def _poll_active_project(self):
        if not self.window.winfo_exists():
            return
        current = get_active_project_id()
        if current != self._observed_project_id:
            self._observed_project_id = current
            self.values = load_config_values_for_edit()
            self._refresh_current_project_section()
        else:
            self._refresh_current_project_section()
        self.window.after(800, self._poll_active_project)

    def _build_builders_tab(self):
        outer = tk.Frame(self.builders_tab, bg=BG)
        outer.pack(fill="both", expand=True, padx=10, pady=12)

        maven_group = tk.Frame(outer, bg=PANEL_BG, highlightthickness=1, highlightbackground=BORDER)
        maven_group.pack(fill="x", pady=(0, 10))
        tk.Label(maven_group, text="Maven Config", bg=PANEL_BG, fg="#f8fafc",
                 font=("Calibri", 12, "bold"), anchor="w").grid(row=0, column=0, columnspan=3, sticky="ew", padx=10, pady=(10, 4))
        self._add_field(maven_group, 1, "mvn_cmd", "mvn.cmd Location", "file")
        self._add_field(maven_group, 2, "settings_xml", "settings.xml Path", "file")
        self._add_field(maven_group, 3, "pom_xml", "pom.xml Path", "file")
        self.skip_tests_var = tk.BooleanVar(value=_bool_value(self.values.get("skip_tests", "true"), True))
        tk.Checkbutton(maven_group, text="Skip tests (-D skipTests)", variable=self.skip_tests_var,
                       bg=PANEL_BG, fg=TEXT_FG, activebackground=PANEL_BG, activeforeground=TEXT_FG,
                       selectcolor=TEXT_BG, font=("Calibri", 10, "bold")).grid(row=4, column=1, sticky="w", pady=(2, 10))
        maven_group.grid_columnconfigure(1, weight=1)

        header = tk.Frame(outer, bg=BG)
        header.pack(fill="x", pady=(4, 6))
        tk.Label(header, text="Build Profiles", bg=BG, fg="#f8fafc",
                 font=("Calibri", 12, "bold")).pack(side="left")
        tk.Button(header, text="Add Builder", command=self.add_builder_row, bg=BLUE, fg="#ffffff",
                  activebackground="#4b95dd", activeforeground="#ffffff", relief="flat", padx=12, pady=4,
                  font=("Calibri", 9, "bold")).pack(side="right")

        labels = tk.Frame(outer, bg=BG)
        labels.pack(fill="x", padx=4)
        tk.Label(labels, text="Profile name", bg=BG, fg=MUTED, font=("Calibri", 9, "bold"), width=22, anchor="w").pack(side="left", padx=(0, 8))
        tk.Label(labels, text="Goal", bg=BG, fg=MUTED, font=("Calibri", 9, "bold"), anchor="w").pack(side="left", fill="x", expand=True)
        tk.Label(labels, text="Confirm", bg=BG, fg=MUTED, font=("Calibri", 9, "bold"), width=10, anchor="center").pack(side="left", padx=(8, 8))
        tk.Label(labels, text="", bg=BG, width=10).pack(side="left")

        rows_container = tk.Frame(outer, bg=BG)
        rows_container.pack(fill="both", expand=True, pady=(0, 4))
        self.builder_rows_canvas = tk.Canvas(rows_container, bg=BG, highlightthickness=0, bd=0)
        self.builder_rows_scrollbar = ttk.Scrollbar(rows_container, orient="vertical", style="Safari.Vertical.TScrollbar", command=self.builder_rows_canvas.yview)
        self.builder_rows_canvas.configure(yscrollcommand=self.builder_rows_scrollbar.set)
        self.builder_rows_scrollbar.pack(side="right", fill="y")
        self.builder_rows_canvas.pack(side="left", fill="both", expand=True)
        self.builder_rows_frame = tk.Frame(self.builder_rows_canvas, bg=BG)
        self.builder_rows_window = self.builder_rows_canvas.create_window((0, 0), window=self.builder_rows_frame, anchor="nw")

        def _sync_builder_scroll_region(_event=None):
            self.builder_rows_canvas.configure(scrollregion=self.builder_rows_canvas.bbox("all"))
            self.builder_rows_canvas.itemconfigure(self.builder_rows_window, width=self.builder_rows_canvas.winfo_width())

        self.builder_rows_frame.bind("<Configure>", _sync_builder_scroll_region)
        self.builder_rows_canvas.bind("<Configure>", _sync_builder_scroll_region)
        self.builder_rows_canvas.bind("<MouseWheel>", lambda e: self.builder_rows_canvas.yview_scroll(int(-1 * (e.delta / 120)), "units"))

        for builder in self.values.get("builders", []) or _default_builder_sections():
            self.add_builder_row(builder)

        hint = tk.Label(outer, text="Example: profile name = sit, goal = clean package. The dashboard button becomes Run SIT Build.",
                        bg=BG, fg=MUTED, font=("Calibri", 9), anchor="w")
        hint.pack(fill="x", pady=(8, 0))

    def add_builder_row(self, builder: dict | None = None):
        builder = builder or {"profile": "", "goal": "clean package", "confirm_before_run": "false"}
        row = tk.Frame(self.builder_rows_frame, bg=PANEL_BG, highlightthickness=1, highlightbackground=BORDER)
        row.pack(fill="x", pady=4)
        profile_var = tk.StringVar(value=(builder.get("profile") or "").strip())
        goal_var = tk.StringVar(value=(builder.get("goal") or "clean package").strip())
        confirm_var = tk.BooleanVar(value=_bool_value(builder.get("confirm_before_run", False)))
        tk.Entry(row, textvariable=profile_var, width=22, bg=TEXT_BG, fg=TEXT_FG, insertbackground=TEXT_FG,
                 relief="flat", highlightthickness=1, highlightbackground=BORDER, highlightcolor=BLUE,
                 font=("Calibri", 10)).pack(side="left", padx=(8, 8), pady=8)
        tk.Entry(row, textvariable=goal_var, bg=TEXT_BG, fg=TEXT_FG, insertbackground=TEXT_FG,
                 relief="flat", highlightthickness=1, highlightbackground=BORDER, highlightcolor=BLUE,
                 font=("Calibri", 10)).pack(side="left", fill="x", expand=True, pady=8)
        tk.Checkbutton(row, variable=confirm_var, bg=PANEL_BG, activebackground=PANEL_BG,
                       selectcolor=TEXT_BG).pack(side="left", padx=(8, 8), pady=8)
        row_data = {"frame": row, "profile": profile_var, "goal": goal_var, "confirm": confirm_var}
        tk.Button(row, text="Remove", command=lambda item=row_data: self.remove_builder_row(item),
                  bg=BTN_BG, fg=BTN_FG, activebackground=BTN_ACTIVE, activeforeground=BTN_FG,
                  relief="flat", padx=10, pady=3, font=("Calibri", 9, "bold")).pack(side="left", padx=(0, 8), pady=8)
        self.builder_rows.append(row_data)
        if hasattr(self, "builder_rows_canvas"):
            self.window.after_idle(lambda: self.builder_rows_canvas.configure(scrollregion=self.builder_rows_canvas.bbox("all")))

    def remove_builder_row(self, row_data: dict):
        if len(self.builder_rows) <= 1:
            messagebox.showinfo("Builder Required", "Keep at least one build profile.", parent=self.window)
            return
        row_data["frame"].destroy()
        self.builder_rows = [row for row in self.builder_rows if row is not row_data]
        if hasattr(self, "builder_rows_canvas"):
            self.window.after_idle(lambda: self.builder_rows_canvas.configure(scrollregion=self.builder_rows_canvas.bbox("all")))

    def browse(self, key: str, browse_type: str):
        initial_dir = APP_DIR
        if browse_type == "dir":
            selected = filedialog.askdirectory(parent=self.window, initialdir=initial_dir, title="Select Directory")
        elif browse_type == "file":
            filetypes = [("All files", "*.*")]
            if key == "settings_xml":
                filetypes = [("XML files", "*.xml"), ("All files", "*.*")]
            elif key == "pom_xml":
                filetypes = [("Maven POM", "pom.xml"), ("XML files", "*.xml"), ("All files", "*.*")]
            elif key == "mvn_cmd":
                filetypes = [("Maven command", "mvn.cmd"), ("Command files", "*.cmd *.bat *.exe"), ("All files", "*.*")]
            elif key in ("log_file_path", "log_path_file"):
                filetypes = [("Log/Text files", "*.log *.txt"), ("All files", "*.*")]
            selected = filedialog.askopenfilename(parent=self.window, initialdir=initial_dir, title="Select File", filetypes=filetypes)
        else:
            return
        if not selected:
            return
        # Store exact paths from the file picker. This avoids hidden base-directory resolution.
        self.entries[key].set(selected)

    def _collect_values(self) -> dict:
        values = {key: var.get().strip() for key, var in self.entries.items()}
        values["skip_tests"] = _bool_text(self.skip_tests_var.get(), True)
        builders = []
        for row in self.builder_rows:
            builders.append({
                "profile": row["profile"].get().strip(),
                "goal": row["goal"].get().strip(),
                "confirm_before_run": _bool_text(row["confirm"].get()),
            })
        values["builders"] = builders
        return values

    def _validate_values(self, values: dict) -> tuple[list[str], list[str]]:
        errors: list[str] = []
        warnings: list[str] = []

        def resolve_for_validation(value: str) -> str:
            value = os.path.expandvars(os.path.expanduser((value or "").strip()))
            if value and not is_absolute_path(value):
                value = os.path.abspath(os.path.join(APP_DIR, value))
            return value

        log_value = values.get("log_file_path", values.get("log_path_file", ""))
        if not log_value:
            warnings.append("Application Log File Path is empty; Log Tail will not know which file to follow.")
        else:
            resolved_log = resolve_for_validation(log_value)
            if not os.path.isfile(resolved_log):
                warnings.append(f"Application Log File does not exist: {resolved_log}")

        for key, label in (("git_project_dir", "Git Project Directory"), ("frontend_dir", "Frontend Directory"), ("wildfly_dir", "WildFly Bin Directory")):
            value = values.get(key, "")
            if not value:
                errors.append(f"{label} is required.")
                continue
            resolved = resolve_for_validation(value)
            if not os.path.isdir(resolved):
                warnings.append(f"{label} does not exist: {resolved}")

        for key, label in (("frontend_command", "Frontend Command"), ("wildfly_command", "WildFly Start Command")):
            if not values.get(key, "").strip():
                errors.append(f"{label} is required.")

        for key, label in (("mvn_cmd", "mvn.cmd Location"), ("settings_xml", "settings.xml Path"), ("pom_xml", "pom.xml Path")):
            value = values.get(key, "")
            if not value:
                errors.append(f"{label} is required.")
                continue
            if key == "mvn_cmd" and value.strip().lower() == "mvn":
                continue
            resolved = resolve_for_validation(value)
            if not os.path.isfile(resolved):
                warnings.append(f"{label} does not exist: {resolved}")

        builders = values.get("builders", []) or []
        valid_builders = 0
        seen_profiles = set()
        for idx, builder in enumerate(builders, start=1):
            profile = (builder.get("profile") or "").strip()
            goal = (builder.get("goal") or "").strip()
            if not profile and not goal:
                continue
            if not profile:
                errors.append(f"Builder row {idx}: Profile name is required.")
                continue
            if not goal:
                errors.append(f"Builder row {idx}: Goal is required.")
                continue
            if profile.lower() in seen_profiles:
                warnings.append(f"Duplicate builder profile: {profile}")
            seen_profiles.add(profile.lower())
            valid_builders += 1
        if valid_builders == 0:
            errors.append("At least one build profile is required.")
        return errors, warnings

    def validate_and_report(self):
        values = self._collect_values()
        errors, warnings = self._validate_values(values)
        if errors:
            self.status_var.set("Please fix: " + "  ".join(errors))
            messagebox.showerror("Settings Need Attention", "\n".join(errors), parent=self.window)
        elif warnings:
            self.status_var.set("Warnings: " + "  ".join(warnings))
            messagebox.showwarning("Settings Warnings", "\n".join(warnings), parent=self.window)
        else:
            self.status_var.set("All configured paths and builders look valid.")
            messagebox.showinfo("Settings Valid", "All configured paths and builders look valid.", parent=self.window)

    def save(self):
        values = self._collect_values()
        errors, warnings = self._validate_values(values)
        if errors:
            self.status_var.set("Please fix: " + "  ".join(errors))
            messagebox.showerror("Cannot Save Yet", "\n".join(errors), parent=self.window)
            return
        if warnings:
            proceed = messagebox.askyesno(
                "Save With Warnings?",
                "Some paths could not be verified:\n\n" + "\n".join(warnings) + "\n\nSave anyway?",
                parent=self.window,
            )
            if not proceed:
                self.status_var.set("Warnings: " + "  ".join(warnings))
                return
        save_app_config(values)
        self.app.reload_app_config()
        self.window.destroy()
        messagebox.showinfo("Settings Saved", "Settings were saved to app.config.", parent=self.root)
