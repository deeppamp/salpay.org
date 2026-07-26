@echo off

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..") do set "REPO_ROOT=%%~fI"

set "SALVIUM_PATH_V113C=<YOUR_DOWNLOADS>\salvium-v1.1.3c-win64"
set "SALVIUM_PATH_V111B=<YOUR_DOWNLOADS>\salvium-v1.1.1b-win64"
if exist "%SALVIUM_PATH_V113C%\salvium-wallet-rpc.exe" (
	set "SALVIUM_PATH=%SALVIUM_PATH_V113C%"
) else (
	set "SALVIUM_PATH=%SALVIUM_PATH_V111B%"
)
set "WALLET_NAME=salpaytest"
set "WALLET_FILE=%REPO_ROOT%\%WALLET_NAME%"
set "PASSWORD=salpaytest"
set "RPC_PORT=29088"
set "DAEMON=127.0.0.1:29081"

set "SALVIUM_DIR=%SALVIUM_PATH%"
set "WALLET_PASSWORD=%PASSWORD%"
set "DAEMON_ADDRESS=%DAEMON%"

set "SALVIUMD_EXE=%SALVIUM_PATH%\salviumd.exe"
set "WALLET_CLI_EXE=%SALVIUM_PATH%\salvium-wallet-cli.exe"
set "WALLET_RPC_EXE=%SALVIUM_PATH%\salvium-wallet-rpc.exe"

echo ========================================
echo Salvium Environment Loaded (prefers v1.1.3c)
echo Path: %SALVIUM_PATH%
echo Wallet: %WALLET_NAME%
echo ========================================
