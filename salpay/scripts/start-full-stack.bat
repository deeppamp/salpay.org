@echo off
setlocal

echo ========================================
echo     Starting .sal Full Local Stack
echo ========================================

pushd "%~dp0"

call salpay-env.bat
if errorlevel 1 (
  echo Failed to load salpay-env.bat
  popd
  exit /b 1
)

echo Starting Wallet RPC...
taskkill /F /IM salvium-wallet-rpc.exe >nul 2>&1

set "SKIP_WALLET_RPC="
tasklist /FI "IMAGENAME eq salvium-wallet-gui.exe" 2>nul | find /I "salvium-wallet-gui.exe" >nul
if not errorlevel 1 (
  echo Wallet GUI is running; skipping wallet-rpc to avoid wallet file lock conflict.
  set "SKIP_WALLET_RPC=1"
)

echo Clearing existing frontend/backend listeners...
for %%P in (3000 3001) do (
  for /f "usebackq delims=" %%I in (`powershell -NoProfile -Command "$pids=Get-NetTCPConnection -State Listen -LocalPort %%P -ErrorAction SilentlyContinue ^| Select-Object -ExpandProperty OwningProcess -Unique; if($pids){$pids}"`) do (
    taskkill /F /PID %%I >nul 2>&1
  )
)

if not defined SKIP_WALLET_RPC (
  start /min "salvium-wallet-rpc" "%SALVIUM_PATH%\salvium-wallet-rpc.exe" ^
    --testnet ^
    --wallet-file "%WALLET_FILE%" ^
    --password "%PASSWORD%" ^
    --rpc-bind-port %RPC_PORT% ^
    --daemon-address %DAEMON% ^
    --trusted-daemon ^
    --disable-rpc-login

  echo Waiting 8 seconds for RPC to start...
  timeout /t 8 /nobreak >nul
) else (
  echo Wallet RPC startup skipped.
)

echo Starting Backend Resolver...
REM Testnet: full fee to treasury (no protocol BURN). Offline testnet HF often cannot burn.
REM Mainnet deploy uses MINT_BURN_PERCENT=50 via env.mainnet.example.
start "salpay-backend" cmd /k "set SALPAY_NETWORK=testnet && set MINT_BURN_PERCENT=0 && set MINT_BURN_KIND=protocol && set MINT_PAYMENT_VERIFICATION_MODE=client_attested && set MAINNET_STRICT_GUARDS=false && set AUTHORITATIVE_NAME_CHECK_URL=self && set AUTHORITATIVE_TICKER_CHECK_URL=self && set MINT_TREASURY_ADDRESS_TESTNET=SC1Tou2VtQX3Pb3nYrEVLwFAniy8QeEjGfBRJTzxL4A8CoxPVeUDLxTLMKZvQmtcnYHcuWqH85CgM9gt8Ti4qoyh7tDPcN9YpUv && cd /d "%~dp0..\backend" && npm run dev"

echo Starting Frontend...
start "salpay-frontend" cmd /k "cd /d "%~dp0..\frontend" && npm run dev"

echo.
echo ========================================
echo All services started!
echo Frontend: http://localhost:3000
echo Resolver: http://localhost:3001
if defined SKIP_WALLET_RPC (
  echo Wallet RPC: skipped because GUI owns wallet file
) else (
  echo Wallet RPC: 127.0.0.1:29088
)
echo ========================================

popd
exit /b 0
