from .common import *

@dataclass
class BuildProgress:
    build_name: str = ""
    running: bool = False
    success: bool | None = None
    started_at: float | None = None
    finished_at: float | None = None
    current_status: str = "Idle"
    branch_name: str = ""
    branch_error: str = ""
    war_path: str = ""
    frontend_seen: bool = False
    requires_install: bool = True
    requires_deploy: bool = True
    milestones: dict = field(default_factory=dict)

    def __post_init__(self):
        self.reset("")

    def reset(self, build_name: str):
        self.build_name = build_name
        self.running = False
        self.success = None
        self.started_at = None
        self.finished_at = None
        self.current_status = "Idle"
        self.branch_name = ""
        self.branch_error = ""
        self.war_path = ""
        self.frontend_seen = False
        is_sit = build_name.lower() == "sit" if build_name else False
        self.requires_install = not is_sit
        self.requires_deploy = not is_sit
        self.milestones = {
            "start": {"label": "Build started", "state": "pending"},
            "clean": {"label": "Cleaning project", "state": "pending"},
            "backend_compile": {"label": "Backend compile", "state": "pending"},
            "frontend": {"label": "Building frontend", "state": "pending"},
            "package": {"label": "Packaging WAR", "state": "pending"},
            "install": {"label": "Installing artifact", "state": "pending"},
            "deploy": {"label": "Deploying", "state": "pending"},
            "complete": {"label": "Build completed", "state": "pending"},
        }

    def start(self, build_name: str, branch_name: str = "", branch_error: str = ""):
        self.reset(build_name)
        self.branch_name = branch_name or "unavailable"
        self.branch_error = branch_error or ""
        self.running = True
        if not self.requires_install:
            self.milestones["install"]["state"] = "skipped"
        if not self.requires_deploy:
            self.milestones["deploy"]["state"] = "skipped"
        self.started_at = time.time()
        self.current_status = f"Starting {build_name} build..."
        self.set_done("start")
        self.set_running_status(f"Starting {build_name} build...")

    def finish(self, success: bool):
        self.running = False
        self.success = success
        self.finished_at = time.time()
        if not self.frontend_seen and self.milestones["frontend"]["state"] == "pending":
            self.milestones["frontend"]["state"] = "skipped"
        if not self.requires_install and self.milestones["install"]["state"] == "pending":
            self.milestones["install"]["state"] = "skipped"
        if not self.requires_deploy and self.milestones["deploy"]["state"] == "pending":
            self.milestones["deploy"]["state"] = "skipped"
        self.milestones["complete"]["state"] = "done" if success else "failed"
        if success:
            self.current_status = f"{self.build_name.capitalize()} build completed"
        else:
            self.current_status = f"{self.build_name.capitalize()} build failed"

    def mark_frontend_skipped_if_needed(self):
        if not self.frontend_seen and self.milestones["frontend"]["state"] == "pending":
            self.milestones["frontend"]["state"] = "skipped"

    def set_running(self, key: str, status: str | None = None):
        for k, item in self.milestones.items():
            if item["state"] == "running" and k != key:
                item["state"] = "done"
        if self.milestones[key]["state"] in ("pending", "skipped"):
            self.milestones[key]["state"] = "running"
        if status:
            self.current_status = status

    def set_done(self, key: str):
        self.milestones[key]["state"] = "done"

    def set_failed(self, key: str):
        self.milestones[key]["state"] = "failed"

    def set_running_status(self, text: str):
        self.current_status = text

    def parse_line(self, line: str):
        low = line.lower()

        found_war = extract_war_path_from_line(line)
        if found_war:
            self.war_path = resolve_under_base(found_war)
            self.set_running("package", "Packaging WAR...")
            self.set_done("package")

        if "build failure" in low:
            self.finish(False)
            return
        if "build success" in low:
            self.mark_frontend_skipped_if_needed()
            self.finish(True)
            return

        if "clean:" in low or "--- clean" in low:
            self.set_running("clean", "Cleaning project...")
            self.set_done("clean")

        if ("compiler:" in low and ":compile" in low) or "compiling " in low:
            self.set_running("backend_compile", "Compiling backend...")
            if "compiling " in low:
                self.set_done("backend_compile")

        if "npm run build" in low or "vite v" in low or "vite build" in low:
            self.frontend_seen = True
            self.set_running("frontend", "Building frontend...")
        if "built in " in low and self.frontend_seen:
            self.set_done("frontend")
            self.current_status = "Frontend build done ✔"

        if ("packaging webapp" in low or "building war" in low or ":war" in low
                or "assembling webapp" in low or "portal-iap-local.war" in low):
            self.set_running("package", "Packaging WAR...")
            if "portal-iap-local.war" in low or "building war" in low:
                self.set_done("package")

        if self.requires_install and (":install" in low or "installing " in low):
            self.set_running("install", "Installing artifact...")
            if "installing " in low:
                self.set_done("install")

        if self.requires_deploy and (("wildfly:" in low and "deploy" in low) or "deploy (default-deploy)" in low):
            self.set_running("deploy", "Deploying...")
        if self.requires_deploy and ("jboss threads version" in low or "wildfly elytron version" in low):
            self.set_done("deploy")

    def elapsed_text(self):
        if not self.started_at:
            return "--:--"
        end = time.time() if self.running else (self.finished_at or time.time())
        sec = int(max(0, end - self.started_at))
        mins, sec = divmod(sec, 60)
        hrs, mins = divmod(mins, 60)
        if hrs:
            return f"{hrs:02d}:{mins:02d}:{sec:02d}"
        return f"{mins:02d}:{sec:02d}"


