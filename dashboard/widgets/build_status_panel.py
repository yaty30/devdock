from ..common import *
from ..build_model import BuildProgress

class BuildStatusPanel:
    def __init__(self, master, progress: BuildProgress, app=None, font_family="Calibri"):
        self.progress = progress
        self.app = app
        self.frame = tk.Frame(master, bg=PANEL_BG, highlightthickness=1, highlightbackground=BORDER)

        top = tk.Frame(self.frame, bg=PANEL_BG)
        top.pack(fill="x", padx=10, pady=(10, 6))
        self.title_var = tk.StringVar(value="Build Status")
        tk.Label(top, textvariable=self.title_var, bg=PANEL_BG, fg="#f8fafc",
                 font=(font_family, 12, "bold")).pack(side="left")

        self.elapsed_var = tk.StringVar(value="Elapsed: --:--")
        tk.Label(top, textvariable=self.elapsed_var, bg=PANEL_BG, fg=BLUE,
                 font=(font_family, 11, "bold")).pack(side="right")

        self.status_var = tk.StringVar(value="Idle")
        tk.Label(self.frame, textvariable=self.status_var, bg=PANEL_BG, fg=MUTED,
                 font=(font_family, 11), anchor="w").pack(fill="x", padx=10)

        self.branch_var = tk.StringVar(value="Branch: unavailable")
        tk.Label(self.frame, textvariable=self.branch_var, bg=PANEL_BG, fg=BLUE,
                 font=(font_family, 10, "bold"), anchor="w").pack(fill="x", padx=10, pady=(4, 0))

        self.row_labels = {}
        list_frame = tk.Frame(self.frame, bg=PANEL_BG)
        list_frame.pack(fill="x", padx=10, pady=(8, 10))
        order = ["start", "clean", "backend_compile", "frontend", "package", "install", "deploy", "complete"]
        for key in order:
            row = tk.Frame(list_frame, bg=PANEL_BG)
            row.pack(fill="x", pady=1)
            icon_var = tk.StringVar(value="○")
            label_var = tk.StringVar(value=progress.milestones[key]["label"])
            icon = tk.Label(row, textvariable=icon_var, width=2, bg=PANEL_BG, fg=MUTED,
                            font=(font_family, 11, "bold"), anchor="w")
            icon.pack(side="left")
            label = tk.Label(row, textvariable=label_var, bg=PANEL_BG, fg=TEXT_FG,
                             font=(font_family, 10), anchor="w")
            label.pack(side="left")
            self.row_labels[key] = (icon_var, icon, label_var, label)

        war_frame = tk.Frame(self.frame, bg=PANEL_BG)
        war_frame.pack(fill="x", padx=10, pady=(0, 10))
        self.war_var = tk.StringVar(value="WAR: not detected")
        tk.Label(war_frame, textvariable=self.war_var, bg=PANEL_BG, fg=MUTED,
                 font=(font_family, 10), anchor="w").pack(fill="x", pady=(0, 6))
        self.open_war_btn = tk.Button(
            war_frame, text="Open WAR Folder", command=self._open_war_folder,
            state="disabled", bg=BTN_BG, fg=BTN_FG, disabledforeground=MUTED,
            activebackground=BTN_ACTIVE, activeforeground=BTN_FG, relief="flat",
            padx=10, pady=4, font=(font_family, 9, "bold"),
        )
        self.open_war_btn.pack(anchor="w")

    def _open_war_folder(self):
        if self.app is not None:
            self.app.open_war_folder()

    def refresh(self):
        name = self.progress.build_name.capitalize() if self.progress.build_name else ""
        self.title_var.set("Build Status" if not name else f"{name} Build Status")
        self.status_var.set(self.progress.current_status)
        self.elapsed_var.set(f"Elapsed: {self.progress.elapsed_text()}")
        branch = self.progress.branch_name or "unavailable"
        self.branch_var.set(f"Branch: {branch}")
        for key, item in self.progress.milestones.items():
            icon_var, icon_label, _, text_label = self.row_labels[key]
            state = item["state"]
            if state == "done":
                icon_var.set("✔")
                icon_label.configure(fg=GREEN)
                text_label.configure(fg=TEXT_FG)
            elif state == "running":
                icon_var.set("⏳")
                icon_label.configure(fg=YELLOW)
                text_label.configure(fg="#ffffff")
            elif state == "failed":
                icon_var.set("✖")
                icon_label.configure(fg=RED)
                text_label.configure(fg=RED)
            elif state == "skipped":
                icon_var.set("–")
                icon_label.configure(fg=MUTED)
                text_label.configure(fg=MUTED)
            else:
                icon_var.set("○")
                icon_label.configure(fg=MUTED)
                text_label.configure(fg=TEXT_FG)

        war_path = self.progress.war_path
        if war_path:
            folder = os.path.dirname(war_path)
            display = os.path.basename(war_path) or war_path
            self.war_var.set(f"WAR: {display}")
            self.open_war_btn.configure(state="normal" if folder and os.path.isdir(folder) else "disabled")
        else:
            self.war_var.set("WAR: not detected")
            self.open_war_btn.configure(state="disabled")


