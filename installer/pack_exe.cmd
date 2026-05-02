python -m PyInstaller --onefile --windowed ^
  --add-data "dashboard.zip;." ^
  --add-data "version.txt;." ^
  installer.py