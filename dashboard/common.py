import os
import re
import subprocess
import sys
import threading
import time
import queue
import tempfile
import json
import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk, filedialog, messagebox
import configparser
from dataclasses import dataclass, field

@dataclass(frozen=True)
class DashboardProject:
    id: str
    name: str
    config_path: str = ""
    asset_path: str = ""
    build_profile: str = ""
    root_path: str = ""
    created_at: str = ""
    updated_at: str = ""

def get_app_dir() -> str:
    """Return the folder users should place/edit app.config in.

    - Script mode: project root folder containing app.py
    - PyInstaller .exe mode: folder containing the .exe
    """
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    # common.py lives in <project>/dashboard/common.py, so app.config should live in <project>.
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_bundled_config_path() -> str | None:
    """Return bundled app.config path when packaged with PyInstaller --add-data, if present."""
    bundle_dir = getattr(sys, "_MEIPASS", None)
    if not bundle_dir:
        return None
    bundled = os.path.join(bundle_dir, "app.config")
    return bundled if os.path.exists(bundled) else None


APP_DIR = get_app_dir()
APP_DATA_DIR = os.path.join(APP_DIR, ".dashboard_data")
APP_DATA_PROJECTS_DIR = os.path.join(APP_DATA_DIR, "projects")

# Legacy paths from the original single-project dashboard. These are read for
# compatibility and migration, but new dashboard-owned state is stored under
# .dashboard_data/.
LEGACY_CONFIG_FILE = os.path.join(APP_DIR, "app.config")
LEGACY_ACTIVE_PROJECT_FILE = os.path.join(APP_DIR, ".dashboard_active_project")
LEGACY_PROJECT_REGISTRY_FILE = os.path.join(APP_DIR, ".dashboard_projects.json")

CONFIG_FILE = os.path.join(APP_DATA_PROJECTS_DIR, "iap", "app.config")
ACTIVE_PROJECT_FILE = os.path.join(APP_DATA_DIR, "active_project")
PROJECT_REGISTRY_FILE = os.path.join(APP_DATA_DIR, "projects.json")
MAX_PROJECTS = 3

BUILTIN_PROJECT_REGISTRY: tuple[DashboardProject, ...] = (
    DashboardProject(id="iap", name="Project IAP", config_path=os.path.join(APP_DATA_PROJECTS_DIR, "iap", "app.config"), root_path=os.path.join(APP_DATA_PROJECTS_DIR, "iap")),
    DashboardProject(id="wp", name="Project WP", config_path=os.path.join(APP_DATA_PROJECTS_DIR, "wp", "app.config"), root_path=os.path.join(APP_DATA_PROJECTS_DIR, "wp")),
)
DEFAULT_PROJECT_ID = "iap"
APP_VERSION = "v0.5.0"

def ensure_app_data_dir() -> None:
    os.makedirs(APP_DATA_DIR, exist_ok=True)
    os.makedirs(APP_DATA_PROJECTS_DIR, exist_ok=True)

def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")

def _migrate_legacy_dashboard_state() -> None:
    """Move dashboard-owned metadata into .dashboard_data/ without deleting legacy files."""
    ensure_app_data_dir()

    if not os.path.exists(PROJECT_REGISTRY_FILE):
        if os.path.exists(LEGACY_PROJECT_REGISTRY_FILE):
            try:
                with open(LEGACY_PROJECT_REGISTRY_FILE, "r", encoding="utf-8", errors="replace") as src:
                    legacy = json.load(src)
                items = legacy.get("projects", []) if isinstance(legacy, dict) else legacy
                projects: list[DashboardProject] = []
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict):
                            project = _project_from_dict(item)
                            if project:
                                projects.append(project)
                if projects:
                    save_project_registry(projects)
            except Exception:
                pass

        elif os.path.exists(LEGACY_CONFIG_FILE):
            # Legacy single-project fallback: keep using the root app.config, but
            # register it in the new registry so future projects use .dashboard_data/.
            legacy_project = DashboardProject(
                id=DEFAULT_PROJECT_ID,
                name="Project IAP",
                root_path=APP_DIR,
                config_path=LEGACY_CONFIG_FILE,
                created_at=_now_iso(),
                updated_at=_now_iso(),
            )
            save_project_registry([legacy_project])

    if not os.path.exists(ACTIVE_PROJECT_FILE) and os.path.exists(LEGACY_ACTIVE_PROJECT_FILE):
        try:
            with open(LEGACY_ACTIVE_PROJECT_FILE, "r", encoding="utf-8", errors="replace") as src:
                value = src.read().strip()
            if value:
                with open(ACTIVE_PROJECT_FILE, "w", encoding="utf-8") as dst:
                    dst.write(value)
        except Exception:
            pass

def _slugify_project_id(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower()).strip("-")
    return slug or "project"

def _project_from_dict(raw: dict) -> DashboardProject | None:
    try:
        project_id = _slugify_project_id(raw.get("id") or raw.get("name") or "project")
        name = (raw.get("name") or project_id).strip()
        raw_config = raw.get("configPath") or raw.get("config_path") or ""
        raw_root = raw.get("rootPath") or raw.get("root_path") or ""
        raw_asset = raw.get("assetPath") or raw.get("asset_path") or ""
        config_path = os.path.abspath(os.path.expanduser(os.path.expandvars(raw_config))) if raw_config else ""
        root_path = os.path.abspath(os.path.expanduser(os.path.expandvars(raw_root))) if raw_root else ""
        if not root_path:
            root_path = os.path.dirname(config_path) if config_path else get_default_project_root(project_id)
        if not config_path:
            config_path = get_default_project_config_path(root_path)
        asset_path = os.path.abspath(os.path.expanduser(os.path.expandvars(raw_asset))) if raw_asset else ""
        created_at = (raw.get("createdAt") or raw.get("created_at") or "").strip()
        updated_at = (raw.get("updatedAt") or raw.get("updated_at") or "").strip()
        return DashboardProject(
            id=project_id,
            name=name,
            config_path=config_path,
            asset_path=asset_path,
            build_profile=(raw.get("buildProfile") or raw.get("build_profile") or "").strip(),
            root_path=root_path,
            created_at=created_at,
            updated_at=updated_at,
        )
    except Exception:
        return None

def _project_to_dict(project: DashboardProject) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "rootPath": project.root_path,
        "configPath": project.config_path,
        "assetPath": project.asset_path,
        "buildProfile": project.build_profile,
        "createdAt": project.created_at,
        "updatedAt": project.updated_at,
    }

def _dedupe_projects(projects: list[DashboardProject]) -> list[DashboardProject]:
    seen = set()
    result: list[DashboardProject] = []
    for project in projects:
        if not project or not project.id or project.id in seen:
            continue
        seen.add(project.id)
        result.append(project)
    return result

def get_project_registry() -> tuple[DashboardProject, ...]:
    _migrate_legacy_dashboard_state()
    projects: list[DashboardProject] = []
    if os.path.exists(PROJECT_REGISTRY_FILE):
        try:
            with open(PROJECT_REGISTRY_FILE, "r", encoding="utf-8", errors="replace") as f:
                data = json.load(f)
            if isinstance(data, dict):
                data = data.get("projects", [])
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        project = _project_from_dict(item)
                        if project:
                            projects.append(project)
        except Exception:
            projects = []
    if not projects:
        projects = list(BUILTIN_PROJECT_REGISTRY)
        save_project_registry(projects)
    return tuple(_dedupe_projects(projects))

def save_project_registry(projects: list[DashboardProject] | tuple[DashboardProject, ...]) -> None:
    ensure_app_data_dir()
    clean = _dedupe_projects(list(projects))
    with open(PROJECT_REGISTRY_FILE, "w", encoding="utf-8") as f:
        json.dump({"projects": [_project_to_dict(p) for p in clean]}, f, indent=2)

def make_unique_project_id(name: str) -> str:
    base = _slugify_project_id(name)
    existing = {p.id for p in get_project_registry()}
    if base not in existing:
        return base
    idx = 2
    while f"{base}-{idx}" in existing:
        idx += 1
    return f"{base}-{idx}"

def get_default_project_root(project_id: str) -> str:
    """Return the dashboard-managed folder for a user-created project."""
    safe_id = _slugify_project_id(project_id)
    return os.path.join(APP_DATA_PROJECTS_DIR, safe_id)


def get_default_project_config_path(project_root: str) -> str:
    """Return the conventional app.config path for a project folder."""
    return os.path.join(project_root, "app.config")


def add_project(name: str, root_path: str | None = None, config_path: str | None = None) -> DashboardProject:
    """Create/register a project.

    The normal UI flow is intentionally name-only: the dashboard generates a
    stable project id, creates .dashboard_data/projects/<project_id>/, and
    stores .dashboard_data/projects/<project_id>/app.config internally. Optional
    root/config arguments are kept for backward-compatible callers and tests.
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("Project name is required.")

    projects = list(get_project_registry())
    if len(projects) >= MAX_PROJECTS:
        raise ValueError(
            f"Project limit reached. This dashboard supports up to {MAX_PROJECTS} projects "
            "because each project may run its own WildFly and frontend services."
        )

    project_id = make_unique_project_id(name)

    if root_path:
        resolved_root = os.path.abspath(os.path.expanduser(os.path.expandvars(root_path.strip().strip('"'))))
    else:
        resolved_root = get_default_project_root(project_id)

    if config_path:
        resolved_config = os.path.abspath(os.path.expanduser(os.path.expandvars(config_path.strip().strip('"'))))
    else:
        resolved_config = get_default_project_config_path(resolved_root)

    now = _now_iso()
    project = DashboardProject(
        id=project_id,
        name=name,
        root_path=resolved_root,
        config_path=resolved_config,
        created_at=now,
        updated_at=now,
    )
    projects.append(project)
    save_project_registry(projects)
    ensure_config_file(resolved_config)
    return project


def update_project_folder(project_id: str, root_path: str) -> DashboardProject:
    """Update a project's folder and derive its app.config path from that folder."""
    root_path = os.path.abspath(os.path.expanduser(os.path.expandvars((root_path or "").strip().strip('"'))))
    if not root_path:
        raise ValueError("Project folder is required.")

    projects = list(get_project_registry())
    updated: DashboardProject | None = None
    for idx, project in enumerate(projects):
        if project.id == project_id:
            updated = DashboardProject(
                id=project.id,
                name=project.name,
                root_path=root_path,
                config_path=get_default_project_config_path(root_path),
                asset_path=project.asset_path,
                build_profile=project.build_profile,
                created_at=project.created_at,
                updated_at=_now_iso(),
            )
            projects[idx] = updated
            break
    if updated is None:
        raise ValueError(f"Unknown project: {project_id}")
    save_project_registry(projects)
    ensure_config_file(updated.config_path)
    return updated


def remove_project(project_id: str) -> tuple[DashboardProject | None, tuple[DashboardProject, ...]]:
    """Remove a project from the dashboard registry only. Does not delete files."""
    project_id = (project_id or "").strip().lower()
    projects = list(get_project_registry())
    removed: DashboardProject | None = None
    remaining: list[DashboardProject] = []
    for project in projects:
        if project.id == project_id:
            removed = project
        else:
            remaining.append(project)
    if removed is None:
        raise ValueError(f"Unknown project: {project_id}")
    save_project_registry(remaining)
    if remaining:
        set_active_project_id(remaining[0].id)
    else:
        try:
            ensure_app_data_dir()
            with open(ACTIVE_PROJECT_FILE, "w", encoding="utf-8") as f:
                f.write("")
        except Exception:
            pass
    return removed, tuple(remaining)


def get_project_by_id(project_id: str | None) -> DashboardProject:
    registry = get_project_registry()
    pid = (project_id or "").strip().lower()
    for project in registry:
        if project.id == pid:
            return project
    return registry[0]

def get_active_project_id() -> str:
    try:
        with open(ACTIVE_PROJECT_FILE, "r", encoding="utf-8", errors="replace") as f:
            value = f.read().strip().lower()
        return get_project_by_id(value).id
    except Exception:
        return get_project_by_id(DEFAULT_PROJECT_ID).id

def set_active_project_id(project_id: str) -> str:
    project = get_project_by_id(project_id)
    ensure_app_data_dir()
    with open(ACTIVE_PROJECT_FILE, "w", encoding="utf-8") as f:
        f.write(project.id)
    return project.id

def get_config_file_for_project(project_id: str | None = None) -> str:
    project = get_project_by_id(project_id or get_active_project_id())
    path = project.config_path or CONFIG_FILE
    return os.path.abspath(path)

DEFAULT_BUILDERS = [
    {"profile": "local", "name": "Local", "goal": "clean install", "confirm_before_run": "false"},
    {"profile": "sit", "name": "SIT", "goal": "clean package", "confirm_before_run": "false"},
    {"profile": "prod", "name": "Production", "goal": "clean package", "confirm_before_run": "true"},
]

DEFAULT_CONFIG = {
    "paths": {
        "log_file_path": "",
        "git_project_dir": r"C:\Users\yipsy1\iap",
    },
    "services": {
        "frontend_name": "Frontend",
        "frontend_dir": r"C:\Users\yipsy1\iap\frontend",
        "frontend_command": "npm run dev",
        "wildfly_dir": r"C:\wildfly\bin",
        "wildfly_command": "start-rvdiap.bat",
    },
    "links": {
        "admin_console_url": "",
        "kmu_url": "",
    },
    "builder": {
        "mvn_cmd": "mvn",
        "settings_xml": "",
        "pom_xml": r"C:\Users\yipsy1\iap\pom.xml",
        "skip_tests": "true",
    },
    "layout": {
        "window_geometry": "",
        "dashboard_sash_1_ratio": "",
        "dashboard_sash_2_ratio": "",
        "middle_sash_ratio": "",
        "build_sash_ratio": "",
        "build_log_collapsed": "true",
    },
    "build:local": DEFAULT_BUILDERS[0],
    "build:sit": DEFAULT_BUILDERS[1],
    "build:prod": DEFAULT_BUILDERS[2],
}


def _bool_text(value: str | bool, default: bool = False) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value or "").strip().lower()
    if text in ("1", "yes", "y", "true", "on"):
        return "true"
    if text in ("0", "no", "n", "false", "off"):
        return "false"
    return "true" if default else "false"


def _bool_value(value: str | bool, default: bool = False) -> bool:
    return _bool_text(value, default) == "true"


def quote_cmd_arg(value: str) -> str:
    value = (value or "").strip().strip('"')
    if not value:
        return '""'
    if any(ch.isspace() for ch in value) or any(ch in value for ch in "&()[]{}^=;!'+,`~"):
        return '"' + value.replace('"', '\\"') + '"'
    return value


def is_absolute_path(value: str) -> bool:
    value = (value or "").strip().strip('"')
    return bool(os.path.isabs(value) or re.match(r"^[A-Za-z]:[\\/]", value) or value.startswith('\\\\'))


def _default_builder_sections() -> list[dict]:
    return [builder.copy() for builder in DEFAULT_BUILDERS]


def ensure_config_file(config_file: str | None = None) -> None:
    """Create a project app.config if it does not exist yet."""
    target_config = config_file or get_config_file_for_project()
    if os.path.exists(target_config):
        return

    os.makedirs(os.path.dirname(target_config), exist_ok=True)

    bundled_config = get_bundled_config_path()
    if bundled_config:
        with open(bundled_config, "r", encoding="utf-8", errors="replace") as src, open(target_config, "w", encoding="utf-8") as dst:
            dst.write(src.read())
        return

    config = configparser.ConfigParser()
    for section, values in DEFAULT_CONFIG.items():
        config[section] = values
    with open(target_config, "w", encoding="utf-8") as f:
        f.write("# Dashboard configuration\n")
        f.write("# Users should edit this from the Settings window.\n")
        f.write("# Builder commands are generated from Maven config + build profiles.\n")
        f.write("# log_file_path should be the exact path to the application log file.\n\n")
        config.write(f)


def _config_get(config: configparser.ConfigParser, section: str, key: str) -> str:
    if section in DEFAULT_CONFIG and key in DEFAULT_CONFIG[section]:
        fallback = DEFAULT_CONFIG[section][key]
    else:
        fallback = ""
    return config.get(section, key, fallback=fallback).strip()


def _migrate_old_batch_config(config: configparser.ConfigParser, values: dict) -> dict:
    """Best-effort compatibility for app.config files created by older dashboard versions."""
    if config.has_section("batches"):
        mapping = {
            "wildfly_bat": ("services", "wildfly_command"),
            "vite_bat": ("services", "frontend_command"),
        }
        for old_key, (section, new_key) in mapping.items():
            old_val = config.get("batches", old_key, fallback="").strip()
            if old_val and values.get(new_key) == DEFAULT_CONFIG[section][new_key]:
                values[new_key] = old_val
    return values


def _builder_from_old_command(profile: str, command: str) -> dict:
    profile = (profile or "").strip().lower()
    goal = "clean install" if profile == "local" else "clean package"
    command = command or ""
    match = re.search(r"-P\s*([^\s]+)\s+(.+?)(?:\s+--settings|\s+-D\s*skipTests|\s+-DskipTests|\s+-f\s+|$)", command, re.IGNORECASE)
    if match:
        profile = match.group(1).strip() or profile
        goal = match.group(2).strip() or goal
    return {"profile": profile, "name": profile.upper(), "goal": goal, "confirm_before_run": _bool_text(profile.lower() == "prod")}


def _load_builders(config: configparser.ConfigParser) -> list[dict]:
    builders: list[dict] = []
    for section in config.sections():
        if not section.lower().startswith("build:"):
            continue
        profile_key = section.split(":", 1)[1].strip()
        profile = config.get(section, "profile", fallback=profile_key).strip() or profile_key
        name = config.get(section, "name", fallback="").strip()
        goal = config.get(section, "goal", fallback="clean package").strip() or "clean package"
        confirm = _bool_text(config.get(section, "confirm_before_run", fallback=_bool_text(profile.lower() == "prod")))
        builders.append({"profile": profile, "name": name or profile.upper(), "goal": goal, "confirm_before_run": confirm})

    if builders:
        return builders

    if config.has_section("builds"):
        old_map = [
            ("local", config.get("builds", "local_build_command", fallback="")),
            ("sit", config.get("builds", "sit_build_command", fallback="")),
            ("prod", config.get("builds", "prod_build_command", fallback="")),
        ]
        migrated = [_builder_from_old_command(profile, command) for profile, command in old_map if command.strip()]
        if migrated:
            return migrated

    return _default_builder_sections()


def _load_layout_config(config: configparser.ConfigParser) -> dict:
    values = DEFAULT_CONFIG.get("layout", {}).copy()
    if config.has_section("layout"):
        for key in values:
            values[key] = config.get("layout", key, fallback=values[key]).strip()
    return values


def _get_existing_layout_config(config_file: str | None = None) -> dict:
    target_config = config_file or get_config_file_for_project()
    ensure_config_file(target_config)
    config = configparser.ConfigParser()
    config.read(target_config, encoding="utf-8")
    return _load_layout_config(config)


def save_layout_config(layout_values: dict, config_file: str | None = None) -> None:
    """Persist layout/window sizing without changing user service or builder settings."""
    target_config = config_file or get_config_file_for_project()
    ensure_config_file(target_config)
    config = configparser.ConfigParser()
    config.read(target_config, encoding="utf-8")
    if not config.has_section("layout"):
        config.add_section("layout")
    for key, default_value in DEFAULT_CONFIG.get("layout", {}).items():
        value = layout_values.get(key, config.get("layout", key, fallback=default_value))
        config.set("layout", key, str(value))
    with open(target_config, "w", encoding="utf-8") as f:
        f.write("# Dashboard configuration\n")
        f.write("# These values can be edited from the app Settings window.\n")
        f.write("# Builder commands are generated from Maven config + build profiles.\n")
        f.write("# log_file_path should be the exact path to the application log file.\n")
        f.write("# Layout values are saved automatically when the app exits.\n\n")
        config.write(f)


def load_config_values_for_edit(config_file: str | None = None) -> dict:
    """Return editable/raw config values, without expanding paths."""
    active_project = get_project_by_id(get_active_project_id())
    target_config = config_file or get_config_file_for_project(active_project.id)
    ensure_config_file(target_config)
    config = configparser.ConfigParser()
    config.read(target_config, encoding="utf-8")

    values = {
        "project_root_path": active_project.root_path,
        "log_file_path": config.get("paths", "log_file_path", fallback=config.get("paths", "log_path_file", fallback=DEFAULT_CONFIG["paths"]["log_file_path"])).strip(),
        "git_project_dir": _config_get(config, "paths", "git_project_dir"),
        "frontend_name": _config_get(config, "services", "frontend_name"),
        "frontend_dir": _config_get(config, "services", "frontend_dir"),
        "frontend_command": _config_get(config, "services", "frontend_command"),
        "wildfly_dir": _config_get(config, "services", "wildfly_dir"),
        "wildfly_command": _config_get(config, "services", "wildfly_command"),
        "admin_console_url": config.get("links", "admin_console_url", fallback=DEFAULT_CONFIG.get("links", {}).get("admin_console_url", "")).strip(),
        "kmu_url": config.get("links", "kmu_url", fallback=DEFAULT_CONFIG.get("links", {}).get("kmu_url", "")).strip(),
        "mvn_cmd": _config_get(config, "builder", "mvn_cmd"),
        "settings_xml": _config_get(config, "builder", "settings_xml"),
        "pom_xml": _config_get(config, "builder", "pom_xml"),
        "skip_tests": _bool_text(_config_get(config, "builder", "skip_tests"), True),
        "builders": _load_builders(config),
        "layout": _load_layout_config(config),
    }

    # Pull common Maven paths out of legacy full command fields when possible.
    if config.has_section("builds"):
        sample_commands = "\n".join(config.get("builds", key, fallback="") for key in ("local_build_command", "sit_build_command", "prod_build_command"))
        mvn_match = re.search(r'"([^"]*mvn\.cmd)"|([^\s"]*mvn(?:\.cmd)?)', sample_commands, re.IGNORECASE)
        settings_match = re.search(r'--settings\s+"([^"]+)"|--settings\s+([^\s]+)', sample_commands, re.IGNORECASE)
        pom_match = re.search(r'-f\s+"([^"]+)"|-f\s+([^\s]+)', sample_commands, re.IGNORECASE)
        if mvn_match and values["mvn_cmd"] == DEFAULT_CONFIG["builder"]["mvn_cmd"]:
            values["mvn_cmd"] = (mvn_match.group(1) or mvn_match.group(2) or "").strip()
        if settings_match and not values["settings_xml"]:
            values["settings_xml"] = (settings_match.group(1) or settings_match.group(2) or "").strip()
        if pom_match and values["pom_xml"] == DEFAULT_CONFIG["builder"]["pom_xml"]:
            values["pom_xml"] = (pom_match.group(1) or pom_match.group(2) or "").strip()

    return _migrate_old_batch_config(config, values)


def save_app_config(values: dict, config_file: str | None = None) -> None:
    """Persist dashboard settings to app.config."""
    # Preserve automatically saved layout settings when user saves Settings.
    target_config = config_file or get_config_file_for_project()
    existing_layout = _get_existing_layout_config(target_config)
    config = configparser.ConfigParser()
    config["paths"] = {
        "log_file_path": values.get("log_file_path", values.get("log_path_file", "")).strip(),
        "git_project_dir": values.get("git_project_dir", "").strip(),
    }
    config["services"] = {
        "frontend_name": values.get("frontend_name", "").strip() or "Frontend",
        "frontend_dir": values.get("frontend_dir", "").strip(),
        "frontend_command": values.get("frontend_command", "").strip(),
        "wildfly_dir": values.get("wildfly_dir", "").strip(),
        "wildfly_command": values.get("wildfly_command", "").strip(),
    }
    config["links"] = {
        "admin_console_url": values.get("admin_console_url", "").strip(),
        "kmu_url": values.get("kmu_url", "").strip(),
    }
    config["builder"] = {
        "mvn_cmd": values.get("mvn_cmd", "").strip(),
        "settings_xml": values.get("settings_xml", "").strip(),
        "pom_xml": values.get("pom_xml", "").strip(),
        "skip_tests": _bool_text(values.get("skip_tests", "true"), True),
    }

    seen_sections = set()
    for builder in values.get("builders", []) or []:
        profile = (builder.get("profile") or "").strip()
        name = (builder.get("name") or "").strip()
        goal = (builder.get("goal") or "").strip()
        if not profile or not goal:
            continue
        safe_section = re.sub(r"[^A-Za-z0-9_.-]+", "_", profile.lower()).strip("_") or f"builder_{len(seen_sections) + 1}"
        section = f"build:{safe_section}"
        suffix = 2
        while section in seen_sections:
            section = f"build:{safe_section}_{suffix}"
            suffix += 1
        seen_sections.add(section)
        config[section] = {
            "profile": profile,
            "name": name or profile.upper(),
            "goal": goal,
            "confirm_before_run": _bool_text(builder.get("confirm_before_run", profile.lower() == "prod")),
        }

    config["layout"] = existing_layout

    with open(target_config, "w", encoding="utf-8") as f:
        f.write("# Dashboard configuration\n")
        f.write("# These values can be edited from the app Settings window.\n")
        f.write("# Builder commands are generated from Maven config + build profiles.\n")
        f.write("# log_file_path should be the exact path to the application log file.\n\n")
        config.write(f)


def build_maven_command(builder: dict, builder_config: dict) -> str:
    profile = (builder.get("profile") or "").strip()
    goal = (builder.get("goal") or "").strip()
    mvn_cmd = builder_config.get("mvn_cmd", "mvn")
    settings_xml = builder_config.get("settings_xml", "")
    pom_xml = builder_config.get("pom_xml", "")
    parts = [quote_cmd_arg(mvn_cmd)]
    if profile:
        parts.extend(["-P", profile])
    if goal:
        parts.append(goal)
    if settings_xml:
        parts.extend(["--settings", quote_cmd_arg(settings_xml)])
    if _bool_value(builder_config.get("skip_tests", "true"), True):
        parts.append("-D skipTests")
    if pom_xml:
        parts.extend(["-f", quote_cmd_arg(pom_xml)])
    return " ".join(parts)


def load_app_config(project_id: str | None = None) -> dict:
    target_config = get_config_file_for_project(project_id)
    raw = load_config_values_for_edit(target_config)

    def resolve_path(value: str) -> str:
        value = os.path.expandvars(os.path.expanduser((value or "").strip()))
        if value and not is_absolute_path(value):
            value = os.path.abspath(os.path.join(APP_DIR, value))
        return value

    log_path_file = resolve_path(raw.get("log_file_path", raw.get("log_path_file", "")))
    git_project_dir = resolve_path(raw["git_project_dir"])
    frontend_dir = resolve_path(raw["frontend_dir"])
    wildfly_dir = resolve_path(raw["wildfly_dir"])
    mvn_cmd = resolve_path(raw["mvn_cmd"]) if raw.get("mvn_cmd") and raw.get("mvn_cmd", "").lower() != "mvn" else raw.get("mvn_cmd", "mvn")
    settings_xml = resolve_path(raw.get("settings_xml", ""))
    pom_xml = resolve_path(raw.get("pom_xml", ""))
    build_work_dir = os.path.dirname(pom_xml) if pom_xml else APP_DIR

    builder_config = {
        "mvn_cmd": mvn_cmd,
        "settings_xml": settings_xml,
        "pom_xml": pom_xml,
        "skip_tests": _bool_text(raw.get("skip_tests", "true"), True),
    }
    builders = []
    for builder in raw.get("builders", []) or []:
        profile = (builder.get("profile") or "").strip()
        name = (builder.get("name") or "").strip()
        goal = (builder.get("goal") or "").strip()
        if not profile or not goal:
            continue
        builder_name = (builder.get("name") or "").strip() or profile.upper()
        normalized = {
            "profile": profile,
            "name": builder_name,
            "goal": goal,
            "confirm_before_run": _bool_text(builder.get("confirm_before_run", profile.lower() == "prod")),
        }
        normalized["command"] = build_maven_command(normalized, builder_config)
        normalized["label"] = f"Run {builder_name} Build"
        builders.append(normalized)

    return {
        "log_file_path": log_path_file,
        "log_path_file": log_path_file,
        "git_project_dir": git_project_dir,
        "frontend_name": raw["frontend_name"] or "Frontend",
        "frontend_dir": frontend_dir,
        "frontend_command": raw["frontend_command"],
        "wildfly_dir": wildfly_dir,
        "wildfly_command": raw["wildfly_command"],
        "admin_console_url": raw.get("admin_console_url", ""),
        "kmu_url": raw.get("kmu_url", ""),
        "build_work_dir": build_work_dir,
        "builder_config": builder_config,
        "builders": builders,
        "layout": raw.get("layout", DEFAULT_CONFIG.get("layout", {}).copy()),
    }

ACTIVE_PROJECT_ID = get_active_project_id()
CONFIG_FILE = get_config_file_for_project(ACTIVE_PROJECT_ID)
APP_CONFIG = load_app_config(ACTIVE_PROJECT_ID)
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
LAYOUT_CONFIG = APP_CONFIG.get("layout", DEFAULT_CONFIG.get("layout", {}).copy())
POLL_MS = 120
MAX_APPEND_CHARS = 50000
LOG_TAIL_SLEEP = 0.4

BG = "#15181d"
PANEL_BG = "#1d2128"
TEXT_BG = "#101317"
TEXT_FG = "#d7dde7"
MUTED = "#8b95a7"
BORDER = "#2a313b"
BTN_BG = "#252b34"
BTN_FG = "#e5e9f0"
BTN_ACTIVE = "#303846"
GREEN = "#48c774"
YELLOW = "#f6c343"
RED = "#ff6b6b"
BLUE = "#5aa9ff"
PROD_BTN_BG = "#8f4a4a"
PROD_BTN_ACTIVE = "#a85858"


def decode_bytes(data: bytes) -> str:
    for enc in ("utf-8", "cp950", "cp1252", "cp437"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            pass
    return data.decode("utf-8", errors="replace")


def kill_process_tree(pid: int) -> None:
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        pass


def resolve_under_base(path_value: str, base_dir: str | None = None) -> str:
    """Resolve a config path when it is relative. Defaults to the app folder."""
    if not path_value:
        return ""
    base = base_dir or APP_DIR
    expanded = os.path.expandvars(os.path.expanduser(path_value.strip().strip('"')))
    if is_absolute_path(expanded):
        return expanded
    return os.path.abspath(os.path.join(base, expanded))

def open_folder_in_explorer(folder_path: str) -> None:
    """Open a folder using the native file browser."""
    if not folder_path or not os.path.isdir(folder_path):
        raise FileNotFoundError(folder_path or "Folder path is empty")
    if os.name == "nt":
        os.startfile(folder_path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", folder_path])



def open_file_native(file_path: str) -> None:
    """Open a file using the OS default app."""
    if not file_path or not os.path.isfile(file_path):
        raise FileNotFoundError(file_path or "File path is empty")
    if os.name == "nt":
        os.startfile(file_path)  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", file_path])

def extract_war_path_from_line(line: str) -> str | None:
    """Find a WAR artifact path in a build log line."""
    explicit = re.search(r"building\s+war:\s*(.+?\.war)\b", line, re.IGNORECASE)
    if explicit:
        return explicit.group(1).strip().strip('"')
    matches = re.findall(r"""(?:[A-Za-z]:\\|/|\./|\.\./)?[^\s'"<>|]+?\.war\b""", line, re.IGNORECASE)
    if matches:
        return matches[-1].strip().strip('"')
    return None


def get_current_git_branch(project_dir: str) -> tuple[str, str | None]:
    """Return (branch, error). Branch is empty when unavailable."""
    project_dir = os.path.expandvars(os.path.expanduser((project_dir or "").strip()))
    if not project_dir:
        return "", "Git Project Directory is empty."
    if not os.path.isdir(project_dir):
        return "", f"Git Project Directory does not exist: {project_dir}"
    try:
        result = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "git branch failed").strip()
            return "", err
        branch = (result.stdout or "").strip()
        if branch:
            return branch, None
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=project_dir,
            capture_output=True,
            text=True,
            timeout=8,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        commit = (result.stdout or "").strip()
        if result.returncode == 0 and commit:
            return f"detached HEAD ({commit})", None
        return "", "Could not detect current branch."
    except FileNotFoundError:
        return "", "Git executable was not found on PATH."
    except Exception as e:
        return "", str(e)



# Allow star imports from split modules to include helper functions used across files.
__all__ = [name for name in globals() if not name.startswith('__')]
