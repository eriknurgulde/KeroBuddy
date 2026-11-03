@echo off
rem Double-click to start KeroBuddy (no console window stays open).
cd /d "%~dp0"
where pythonw >nul 2>nul && (start "" pythonw kero.py) || (start "" /min python kero.py)
