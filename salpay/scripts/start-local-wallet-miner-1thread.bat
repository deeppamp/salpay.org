@echo off
setlocal

call "%~dp0salvium-env.bat"

echo ========================================
echo   Start Local Wallet + 1 Thread Miner
echo ========================================

set "MINER_ADDRESS=SC1Tou2VtQX3Pb3nYrEVLwFAniy8QeEjGfBRJTzxL4A8CoxPVeUDLxTLMKZvQmtcnYHcuWqH85CgM9gt8Ti4qoyh7tDPcN9YpUv"
if exist "%REPO_ROOT%\salpaytest.address.txt" (
  for /f "usebackq tokens=* delims=" %%A in ("%REPO_ROOT%\salpaytest.address.txt") do (
    if /I "%%A" neq "" (
      if /I "%%A:~0,2"=="SC" (
        set "MINER_ADDRESS=%%A"
        goto :address_loaded
      )
    )
  )
)

:address_loaded
echo Miner address: %MINER_ADDRESS%

echo Stopping old local processes (if any)...
taskkill /F /IM salvium-wallet-rpc.exe >nul 2>&1
taskkill /F /IM salviumd.exe >nul 2>&1

echo Starting local testnet daemon...
if exist "%SALVIUMD_EXE%" (
  start /min "salviumd-local-testnet" "%SALVIUMD_EXE%" --testnet --offline --fixed-difficulty 500
) else (
  echo Could not find salviumd.exe in %SALVIUM_PATH%
  exit /b 1
)

echo Waiting for daemon boot...
timeout /t 6 /nobreak >nul

echo Starting wallet RPC...
if exist "%WALLET_RPC_EXE%" (
  start /min "salvium-wallet-rpc" "%WALLET_RPC_EXE%" ^
    --testnet ^
    --wallet-file "%WALLET_FILE%" ^
    --password "%PASSWORD%" ^
    --rpc-bind-port "%RPC_PORT%" ^
    --daemon-address "%DAEMON%" ^
    --trusted-daemon ^
    --disable-rpc-login ^
    --log-level 0
) else (
  echo Could not find salvium-wallet-rpc.exe in %SALVIUM_PATH%
  exit /b 1
)

echo Waiting for wallet RPC boot...
set "RPC_READY=0"
for /L %%I in (1,1,20) do (
  powershell -NoProfile -Command "if ((Test-NetConnection -ComputerName 127.0.0.1 -Port %RPC_PORT% -WarningAction SilentlyContinue).TcpTestSucceeded) { exit 0 } else { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set "RPC_READY=1"
    goto :rpc_ready
  )
  timeout /t 1 /nobreak >nul
)

:rpc_ready
if "%RPC_READY%"=="0" (
  echo Wallet RPC did not become reachable on 127.0.0.1:%RPC_PORT%
  exit /b 1
)

echo Starting mining with 1 thread...
curl http://127.0.0.1:29081/start_mining ^
  -X POST ^
  -H "Content-Type: application/json" ^
  -d "{\"do_background_mining\":false,\"ignore_battery\":true,\"miner_address\":\"%MINER_ADDRESS%\",\"threads_count\":1}"

echo.
echo Done. Local daemon + wallet RPC + 1-thread mining should now be running.
echo Wallet RPC health check:
curl http://127.0.0.1:%RPC_PORT%/json_rpc -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"get_address\",\"params\":{\"account_index\":0}}"
echo.

endlocal