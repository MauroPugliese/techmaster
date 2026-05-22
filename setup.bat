@echo off
setlocal enabledelayedexpansion

REM SMaRT Platform setup helper (Windows)

set ROOT_DIR=%~dp0
set BACKEND_DIR=%ROOT_DIR%backend
set FRONTEND_DIR=%ROOT_DIR%frontend

if "%1"=="" goto usage

if /I "%1"=="init" goto init
if /I "%1"=="install" goto install
if /I "%1"=="up" goto up
if /I "%1"=="down" goto down
if /I "%1"=="backup-db" goto backup_db
if /I "%1"=="restore-db" goto restore_db

goto usage

:init
if not exist "%ROOT_DIR%.env" (
  copy "%ROOT_DIR%.env.example" "%ROOT_DIR%.env" >nul
  echo Created .env from .env.example
) else (
  echo .env already exists
)
goto install

:install
echo Installing backend dependencies...
pushd "%BACKEND_DIR%"
call npm install
if errorlevel 1 goto fail
popd

echo Installing frontend dependencies...
pushd "%FRONTEND_DIR%"
call npm install
if errorlevel 1 goto fail
popd
echo Dependencies installed.
goto done

:up
docker compose up --build
goto done

:down
docker compose down
goto done

:backup_db
if "%2"=="" (
  echo Missing backup file path.
  echo Example: setup.bat backup-db backups\smart_backup.sql
  goto fail
)
for %%I in ("%2") do set OUT_DIR=%%~dpI
if not "%OUT_DIR%"=="" if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
docker compose exec -T db sh -lc "mysqldump -u\"$MYSQL_USER\" -p\"$MYSQL_PASSWORD\" \"$MYSQL_DATABASE\"" > "%2"
if errorlevel 1 goto fail
echo Database backup saved to %2
goto done

:restore_db
if "%2"=="" (
  echo Missing SQL file path.
  echo Example: setup.bat restore-db backups\smart_backup.sql
  goto fail
)
if not exist "%2" (
  echo File not found: %2
  goto fail
)
type "%2" | docker compose exec -T db sh -lc "mysql -u\"$MYSQL_USER\" -p\"$MYSQL_PASSWORD\" \"$MYSQL_DATABASE\""
if errorlevel 1 goto fail
echo Database restored from %2
goto done

:usage
echo Usage:
echo   setup.bat init
echo   setup.bat install
echo   setup.bat up
echo   setup.bat down
echo   setup.bat backup-db ^<output.sql^>
echo   setup.bat restore-db ^<input.sql^>
goto done

:fail
echo Command failed.
exit /b 1

:done
exit /b 0
