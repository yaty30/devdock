import os
import sys
import zipfile
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox


APP_NAME = "dashboard"
ZIP_FILE_NAME = "dashboard.zip"
VERSION_FILE_NAME = "version.txt"


def get_resource_path(relative_path: str) -> Path:
    """
    Gets the correct path for bundled files.

    Works both when running as a normal Python script and when bundled
    into an executable using tools like PyInstaller.
    """
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / relative_path

    return Path(__file__).resolve().parent / relative_path


def read_version(version_file: Path) -> str:
    """
    Reads the version value from version.txt.
    """
    if not version_file.exists():
        raise FileNotFoundError(f"Missing required file: {version_file}")

    version = version_file.read_text(encoding="utf-8").strip()

    if not version:
        raise ValueError("version.txt is empty")

    return version


def unzip_dashboard(zip_file: Path, install_path: Path) -> None:
    """
    Unzips dashboard.zip into the selected installation path.
    """
    if not zip_file.exists():
        raise FileNotFoundError(f"Missing required file: {zip_file}")

    install_path.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_file, "r") as zip_ref:
        zip_ref.extractall(install_path)


def write_appdata_version(version: str) -> Path:
    """
    Creates %APPDATA%/dashboard/.data and writes CURRENT_VERSION into it.
    """
    appdata = os.getenv("APPDATA")

    if not appdata:
        raise EnvironmentError("APPDATA environment variable was not found")

    dashboard_appdata_dir = Path(appdata) / APP_NAME
    dashboard_appdata_dir.mkdir(parents=True, exist_ok=True)

    data_file = dashboard_appdata_dir / ".data"

    data_file.write_text(
        f"CURRENT_VERSION={version}\n",
        encoding="utf-8"
    )

    return data_file


def choose_install_location() -> Path | None:
    """
    Opens a folder selection dialog for the user to choose install location.
    """
    root = tk.Tk()
    root.withdraw()

    selected_path = filedialog.askdirectory(
        title="Select installation folder for Dashboard"
    )

    root.destroy()

    if not selected_path:
        return None

    return Path(selected_path)


def main() -> None:
    try:
        zip_file = get_resource_path(ZIP_FILE_NAME)
        version_file = get_resource_path(VERSION_FILE_NAME)

        install_path = choose_install_location()

        if install_path is None:
            messagebox.showinfo("Installation Cancelled", "No installation folder was selected.")
            return

        version = read_version(version_file)

        unzip_dashboard(zip_file, install_path)

        data_file = write_appdata_version(version)

        messagebox.showinfo(
            "Installation Complete",
            f"Dashboard was installed successfully.\n\n"
            f"Install location:\n{install_path}\n\n"
            f"Version saved to:\n{data_file}"
        )

    except Exception as e:
        messagebox.showerror(
            "Installation Failed",
            f"An error occurred during installation:\n\n{e}"
        )
        sys.exit(1)


if __name__ == "__main__":
    main()