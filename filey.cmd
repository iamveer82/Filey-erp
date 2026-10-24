@echo off
rem Filey Agent in a terminal. Same agent the desktop app runs, with the full
rem terminal tool set. Pass any `filey` subcommand through, e.g.:
rem   filey            interactive TUI
rem   filey gateway    channel gateway
rem   filey doctor     check the install
setlocal
set "ROOT=%~dp0"
if exist "%ROOT%agent\.venv\Scripts\filey.exe" (
  "%ROOT%agent\.venv\Scripts\filey.exe" %*
) else (
  python "%ROOT%agent\cli.py" %*
)
