from ..common import *
from .text_pane import TextPane

class GitTerminalTab:
    def __init__(self, master, app, font_family="Calibri"):
        self.app = app
        self.frame = tk.Frame(master, bg=BG)
        self.project_histories: dict[str, list[str]] = {}
        self.project_history_indexes: dict[str, int] = {}
        self.project_output_buffers: dict[str, str] = {}
        self.running_projects: set[str] = set()

        top = tk.Frame(self.frame, bg=BG)
        top.pack(fill="x", padx=10, pady=(10, 8))

        self.dir_var = tk.StringVar(value="")
        tk.Label(top, textvariable=self.dir_var, bg=BG, fg=MUTED,
                 font=(font_family, 10), anchor="w").pack(side="left", fill="x", expand=True)

        tk.Button(top, text="Refresh Branch", command=self.refresh_branch, bg=BTN_BG, fg=BTN_FG,
                  activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
                  padx=10, pady=4, font=(font_family, 9, "bold")).pack(side="right", padx=(6, 0))
        tk.Button(top, text="Clear", command=self.clear, bg=BTN_BG, fg=BTN_FG,
                  activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
                  padx=10, pady=4, font=(font_family, 9, "bold")).pack(side="right")

        self.branch_var = tk.StringVar(value="Branch: unavailable")
        tk.Label(self.frame, textvariable=self.branch_var, bg=BG, fg=BLUE,
                 font=(font_family, 10, "bold"), anchor="w").pack(fill="x", padx=10, pady=(0, 8))

        self.output = TextPane(self.frame, "Git Terminal Output", app, compact=False, actions=[],
                               enable_search=True, show_line_numbers=True, read_only=True)
        self.output.frame.pack(fill="both", expand=True, padx=10, pady=(0, 8))
        self.output.set_status("Ready", GREEN)

        input_row = tk.Frame(self.frame, bg=BG)
        input_row.pack(fill="x", padx=10, pady=(0, 10))
        tk.Label(input_row, text=">", bg=BG, fg=GREEN, font=("Consolas", 11, "bold")).pack(side="left", padx=(0, 6))
        self.command_var = tk.StringVar()
        self.entry = tk.Entry(input_row, textvariable=self.command_var, bg=TEXT_BG, fg=TEXT_FG,
                              insertbackground=TEXT_FG, relief="flat", highlightthickness=1,
                              highlightbackground=BORDER, highlightcolor=BLUE, font=("Consolas", 10))
        self.entry.pack(side="left", fill="x", expand=True)
        self.entry.bind("<Return>", self.run_command)
        self.entry.bind("<Up>", self.history_up)
        self.entry.bind("<Down>", self.history_down)
        tk.Button(input_row, text="Run", command=self.run_command, bg=BLUE, fg="#ffffff",
                  activebackground="#4b95dd", activeforeground="#ffffff", relief="flat",
                  padx=12, pady=4, font=(font_family, 9, "bold")).pack(side="left", padx=(8, 0))

        self.refresh_config_labels()

    def _active_project_id(self) -> str:
        return get_active_project_id()

    def _active_project_config(self) -> dict:
        pid = self._active_project_id()
        config = getattr(self.app, "project_configs", {}).get(pid)
        if not config:
            config = load_app_config(pid)
            try:
                self.app.project_configs[pid] = config
            except Exception:
                pass
        return config

    def _git_dir_for_project(self, project_id: str) -> str:
        config = getattr(self.app, "project_configs", {}).get(project_id) or load_app_config(project_id)
        return config.get("git_project_dir", "")

    def _history_for_project(self, project_id: str) -> list[str]:
        return self.project_histories.setdefault(project_id, [])

    def _set_history_index(self, project_id: str, value: int):
        self.project_history_indexes[project_id] = value

    def _history_index(self, project_id: str) -> int:
        history = self._history_for_project(project_id)
        return self.project_history_indexes.setdefault(project_id, len(history))

    def _append_buffer(self, project_id: str, text: str, max_chars: int = 300000):
        if not text:
            return
        existing = self.project_output_buffers.get(project_id, "")
        combined = existing + text
        if len(combined) > max_chars:
            combined = combined[-max_chars:]
        self.project_output_buffers[project_id] = combined

    def append_output(self, project_id: str, text: str):
        self._append_buffer(project_id, text)
        if project_id == self._active_project_id():
            self.output.append(text)

    def _set_project_visible(self, project_id: str | None = None):
        project_id = project_id or self._active_project_id()
        project = get_project_by_id(project_id)
        git_dir = self._git_dir_for_project(project_id)
        self.dir_var.set(f"Git Project Directory: {git_dir}")
        self.output.clear()
        buffered = self.project_output_buffers.get(project_id, "")
        if buffered:
            self.output.append(buffered)
        else:
            self.output.append(f"[{time.strftime('%H:%M:%S')}] Git terminal for {project.name} ({project.id})\n")
            self.output.append(f"[{time.strftime('%H:%M:%S')}] Git commands run in: {git_dir}\n")
            self.output.append("Only commands beginning with 'git' are allowed. Type commands in the input field below.\n")
        self.refresh_branch()

    def refresh_config_labels(self):
        self._set_project_visible(self._active_project_id())

    def refresh_branch(self):
        project_id = self._active_project_id()
        git_dir = self._git_dir_for_project(project_id)
        self.dir_var.set(f"Git Project Directory: {git_dir}")
        branch, err = get_current_git_branch(git_dir)
        if branch:
            self.branch_var.set(f"Branch: {branch}")
            self.output.set_status("Running" if project_id in self.running_projects else "Ready", GREEN)
        else:
            self.branch_var.set("Branch: unavailable")
            self.output.set_status("Git unavailable", YELLOW)
            if err and not self.project_output_buffers.get(project_id):
                self.append_output(project_id, f"[{time.strftime('%H:%M:%S')}] Branch detection warning: {err}\n")

    def clear(self):
        project_id = self._active_project_id()
        self.project_output_buffers[project_id] = ""
        self.output.clear()
        project = get_project_by_id(project_id)
        git_dir = self._git_dir_for_project(project_id)
        self.output.append(f"[{time.strftime('%H:%M:%S')}] Git terminal for {project.name} ({project.id})\n")
        self.output.append(f"[{time.strftime('%H:%M:%S')}] Git commands run in: {git_dir}\n")

    def history_up(self, _event=None):
        project_id = self._active_project_id()
        history = self._history_for_project(project_id)
        if not history:
            return "break"
        index = max(0, self._history_index(project_id) - 1)
        self._set_history_index(project_id, index)
        self.command_var.set(history[index])
        self.entry.icursor("end")
        return "break"

    def history_down(self, _event=None):
        project_id = self._active_project_id()
        history = self._history_for_project(project_id)
        if not history:
            return "break"
        index = self._history_index(project_id) + 1
        if index >= len(history):
            index = len(history)
            self.command_var.set("")
        else:
            self.command_var.set(history[index])
        self._set_history_index(project_id, index)
        self.entry.icursor("end")
        return "break"

    def run_command(self, _event=None):
        project_id = self._active_project_id()
        if project_id in self.running_projects:
            return "break"
        command = self.command_var.get().strip()
        if not command:
            return "break"
        if not command.lower().startswith("git"):
            self.append_output(project_id, f"\n[{time.strftime('%H:%M:%S')}] Blocked: only git commands are allowed.\n")
            return "break"

        git_dir = self._git_dir_for_project(project_id)
        if not os.path.isdir(git_dir):
            self.append_output(project_id, f"\n[{time.strftime('%H:%M:%S')}] ERROR: Git Project Directory does not exist: {git_dir}\n")
            return "break"

        history = self._history_for_project(project_id)
        history.append(command)
        self._set_history_index(project_id, len(history))
        self.command_var.set("")
        self.entry.configure(state="disabled")
        self.running_projects.add(project_id)
        self.output.set_status("Running", YELLOW)
        self.append_output(project_id, f"\n> {command}\n")

        threading.Thread(target=self._run_command_thread, args=(project_id, command, git_dir), daemon=True).start()
        return "break"

    def _run_command_thread(self, project_id: str, command: str, git_dir: str):
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            result = subprocess.run(
                command,
                cwd=git_dir,
                shell=True,
                capture_output=True,
                text=False,
                timeout=120,
                creationflags=creationflags,
            )
            output = decode_bytes(result.stdout or b"")
            error = decode_bytes(result.stderr or b"")
            text = output + error
            if text:
                self.app.root.after(0, lambda pid=project_id, t=text: self.append_output(pid, t if t.endswith("\n") else t + "\n"))
            self.app.root.after(0, lambda pid=project_id, code=result.returncode: self.append_output(pid, f"[{time.strftime('%H:%M:%S')}] Exit code: {code}\n"))
        except subprocess.TimeoutExpired:
            self.app.root.after(0, lambda pid=project_id: self.append_output(pid, f"[{time.strftime('%H:%M:%S')}] ERROR: Git command timed out.\n"))
        except Exception as e:
            self.app.root.after(0, lambda pid=project_id, err=e: self.append_output(pid, f"[{time.strftime('%H:%M:%S')}] ERROR: {err}\n"))
        finally:
            self.app.root.after(0, lambda pid=project_id: self._finish_command(pid))

    def _finish_command(self, project_id: str):
        self.running_projects.discard(project_id)
        if project_id == self._active_project_id():
            self.entry.configure(state="normal")
            self.entry.focus_set()
            self.output.set_status("Ready", GREEN)
            self.refresh_branch()
        elif not self.running_projects:
            self.entry.configure(state="normal")
