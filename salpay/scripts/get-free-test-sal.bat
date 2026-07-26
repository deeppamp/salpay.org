@echo off
echo ========================================
echo     Getting Free Test SAL for salpaytest
echo ========================================

call "%~dp0salvium-env.bat"

echo Starting Salvium local testnet daemon in background...
start "salviumd-testnet" "%SALVIUMD_EXE%" --testnet --offline --fixed-difficulty 500

echo.
echo Waiting 10 seconds for daemon to start...
timeout /t 10

echo.
echo Opening wallet: salpaytest
"%WALLET_CLI_EXE%" --testnet --wallet-file salpaytest --password test123 --daemon-address 127.0.0.1:29081

echo.
echo If wallet doesn't exist, it will create it.
echo Once inside the wallet CLI, type these commands:
echo   - get_address
echo   - Then copy your address
pause
