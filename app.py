import ctypes
import os
import sys
import time
import tkinter as tk
from tkinter import messagebox

from dashboard.dashboard_app import DashboardApp


_MUTEX_HANDLE = None
ERROR_ALREADY_EXISTS = 183


def resource_path(relative_path: str) -> str:
    """Return a resource path that works in script and PyInstaller one-file modes."""
    base_dir = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_dir, relative_path)


def acquire_single_instance_lock() -> bool:
    """Prevent launching more than one Dashboard instance on Windows."""
    global _MUTEX_HANDLE
    if os.name != "nt":
        return True
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    mutex_name = "Global\\Dashboard_RVDIAP_SingleInstance"
    _MUTEX_HANDLE = kernel32.CreateMutexW(None, False, mutex_name)
    if not _MUTEX_HANDLE:
        return True
    if ctypes.get_last_error() == ERROR_ALREADY_EXISTS:
        try:
            kernel32.CloseHandle(_MUTEX_HANDLE)
        except Exception:
            pass
        _MUTEX_HANDLE = None
        return False
    return True


def release_single_instance_lock() -> None:
    global _MUTEX_HANDLE
    if os.name == "nt" and _MUTEX_HANDLE:
        try:
            ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(_MUTEX_HANDLE)
        except Exception:
            pass
        _MUTEX_HANDLE = None


def center_window(window: tk.Tk | tk.Toplevel, width: int, height: int) -> None:
    window.update_idletasks()
    screen_w = window.winfo_screenwidth()
    screen_h = window.winfo_screenheight()
    x = max(0, (screen_w - width) // 2)
    y = max(0, (screen_h - height) // 2)
    window.geometry(f"{width}x{height}+{x}+{y}")


def show_startup_splash(min_visible_seconds: float = 1.2) -> None:
    """Show a true pre-main-window startup splash, SourceTree-style."""
    splash = tk.Tk()
    splash.withdraw()
    splash.overrideredirect(True)
    splash.configure(bg="#11161d")
    try:
        splash.attributes("-topmost", True)
        splash.lift()
    except Exception:
        pass

    icon_path = resource_path("app.ico")
    try:
        if os.path.exists(icon_path):
            splash.iconbitmap(icon_path)
    except Exception:
        pass

    splash_path = resource_path("splash.png")
    splash._image_ref = None
    width, height = 560, 200
    if os.path.exists(splash_path):
        try:
            image = tk.PhotoImage(file=splash_path)
            splash._image_ref = image
            width, height = image.width(), image.height()
            tk.Label(splash, image=image, bd=0, highlightthickness=0).pack(fill="both", expand=True)
        except Exception:
            tk.Label(splash, text="Dashboard", bg="#11161d", fg="#ffffff", font=("Calibri", 44, "bold"), padx=80, pady=45).pack(fill="both", expand=True)
    else:
        tk.Label(splash, text="Dashboard", bg="#11161d", fg="#ffffff", font=("Calibri", 44, "bold"), padx=80, pady=45).pack(fill="both", expand=True)

    center_window(splash, width, height)
    splash.deiconify()
    splash.update_idletasks()
    splash.update()

    start = time.time()
    while time.time() - start < min_visible_seconds:
        try:
            splash.update()
        except tk.TclError:
            break
        time.sleep(0.02)

    try:
        splash.destroy()
    except Exception:
        pass


def show_already_running_message() -> None:
    tmp = tk.Tk()
    tmp.withdraw()
    try:
        messagebox.showinfo("Dashboard", "Dashboard is already running.")
    finally:
        tmp.destroy()


def main() -> None:
    if not acquire_single_instance_lock():
        show_already_running_message()
        return
    try:
        # Show this before creating the main Dashboard window.
        show_startup_splash()
        root = tk.Tk()
        try:
            icon_path = resource_path("app.ico")
            if os.path.exists(icon_path):
                root.iconbitmap(icon_path)
        except Exception:
            pass
        DashboardApp(root)
        root.deiconify()
        root.lift()
        root.focus_force()
        root.mainloop()
    finally:
        release_single_instance_lock()


if __name__ == "__main__":
    main()
