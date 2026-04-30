Dashboard split-project version

Entry point:
  app.py

Config file:
  app.config should sit beside app.py during development, or beside Dashboard.exe after packaging.

Packaging:
  pyinstaller ^
    --onefile ^
    --windowed ^
    --name Dashboard ^
    --icon=app.ico ^
    app.py

Main modules:
  dashboard/common.py
    Shared imports, app.config loading/saving, theme constants, utility functions.

  dashboard/build_model.py
    BuildProgress model and build command generation.

  dashboard/widgets/text_pane.py
    Log/output panel with search, line numbers, and collapse/expand behavior.

  dashboard/widgets/build_status_panel.py
    Build Status panel UI.

  dashboard/widgets/settings_dialog.py
    Settings dialog and builder configuration UI.

  dashboard/widgets/git_terminal.py
    Git Terminal tab.

  dashboard/dashboard_app.py
    Main Tkinter application layout, process control, queue flushing, and event routing.

Splash screen and single-instance behavior:
- splash.png is shown during startup before the main Dashboard window appears.
- app.py uses a Windows named mutex so only one Dashboard instance can run at a time.
- build_dashboard.bat includes splash.png and app.ico as PyInstaller data files.
