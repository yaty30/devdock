from ..common import *
from .text_pane import TextPane

class GitTerminalTab:
    def __init__(self, master, app, font_family="Calibri"):
        self.app = app
        self.frame = tk.Frame(master, bg=BG)
        self.history: list[str] = []
        self.history_index = 0
        self.running = False

        top = tk.Frame(self.frame, bg=BG)
        top.pack(fill="x", padx=10, pady=(10, 8))

        self.dir_var = tk.StringVar(value=f"Git Project Directory: {GIT_PROJECT_DIR}")
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
                               enable_search=True, show_line_numbers=True)
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

        self.output.append(f"[{time.strftime('%H:%M:%S')}] Git commands run in: {GIT_PROJECT_DIR}\n")
        self.output.append("Only commands beginning with 'git' are allowed in this terminal.\n")
        self.refresh_branch()

    def refresh_config_labels(self):
        self.dir_var.set(f"Git Project Directory: {GIT_PROJECT_DIR}")
        self.refresh_branch()

    def refresh_branch(self):
        branch, err = get_current_git_branch(GIT_PROJECT_DIR)
        if branch:
            self.branch_var.set(f"Branch: {branch}")
            self.output.set_status("Ready", GREEN)
        else:
            self.branch_var.set("Branch: unavailable")
            self.output.set_status("Git unavailable", YELLOW)
            if err:
                self.output.append(f"[{time.strftime('%H:%M:%S')}] Branch detection warning: {err}\n")

    def clear(self):
        self.output.clear()

    def history_up(self, _event=None):
        if not self.history:
            return "break"
        self.history_index = max(0, self.history_index - 1)
        self.command_var.set(self.history[self.history_index])
        self.entry.icursor("end")
        return "break"

    def history_down(self, _event=None):
        if not self.history:
            return "break"
        self.history_index += 1
        if self.history_index >= len(self.history):
            self.history_index = len(self.history)
            self.command_var.set("")
        else:
            self.command_var.set(self.history[self.history_index])
        self.entry.icursor("end")
        return "break"

    def run_command(self, _event=None):
        if self.running:
            return "break"
        command = self.command_var.get().strip()
        if not command:
            return "break"
        if not command.lower().startswith("git"):
            self.output.append(f"\n[{time.strftime('%H:%M:%S')}] Blocked: only git commands are allowed.\n")
            return "break"
        if not os.path.isdir(GIT_PROJECT_DIR):
            self.output.append(f"\n[{time.strftime('%H:%M:%S')}] ERROR: Git Project Directory does not exist: {GIT_PROJECT_DIR}\n")
            return "break"

        self.history.append(command)
        self.history_index = len(self.history)
        self.command_var.set("")
        self.entry.configure(state="disabled")
        self.running = True
        self.output.set_status("Running", YELLOW)
        self.output.append(f"\n> {command}\n")

        threading.Thread(target=self._run_command_thread, args=(command,), daemon=True).start()
        return "break"

    def _run_command_thread(self, command: str):
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            result = subprocess.run(
                command,
                cwd=GIT_PROJECT_DIR,
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
                self.app.root.after(0, lambda: self.output.append(text if text.endswith("\n") else text + "\n"))
            self.app.root.after(0, lambda: self.output.append(f"[{time.strftime('%H:%M:%S')}] Exit code: {result.returncode}\n"))
        except subprocess.TimeoutExpired:
            self.app.root.after(0, lambda: self.output.append(f"[{time.strftime('%H:%M:%S')}] ERROR: Git command timed out.\n"))
        except Exception as e:
            self.app.root.after(0, lambda: self.output.append(f"[{time.strftime('%H:%M:%S')}] ERROR: {e}\n"))
        finally:
            self.app.root.after(0, self._finish_command)

    def _finish_command(self):
        self.running = False
        self.entry.configure(state="normal")
        self.entry.focus_set()
        self.output.set_status("Ready", GREEN)
        self.refresh_branch()


