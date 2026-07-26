@echo off
setlocal

echo ========================================
echo     Stopping .sal Full Local Stack
echo ========================================

echo Stopping Wallet RPC...
taskkill /F /IM salvium-wallet-rpc.exe >nul 2>&1
if errorlevel 1 (
  echo Wallet RPC not running or already stopped.
) else (
  echo Wallet RPC stopped.
)

echo Stopping Next.js and backend Node processes...
taskkill /F /IM node.exe >nul 2>&1
if errorlevel 1 (
  echo Node processes not running or already stopped.
) else (
  echo Node processes stopped.
)

echo.
echo ========================================
echo Local stack stop complete.
echo ========================================

exit /b 0
