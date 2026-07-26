@echo off
call "%~dp0salpay-env.bat"

set "TICKER=%~1"
set "SUPPLY=%~2"
set "TOKEN_NAME=%~3"

if "%TICKER%"=="" set "TICKER=ALIC"
if "%SUPPLY%"=="" set "SUPPLY=1"
if "%TOKEN_NAME%"=="" set "TOKEN_NAME=alice.sal"

echo ========================================
echo Creating Token Through Wallet CLI
echo Wallet: %WALLET_FILE%
echo Ticker: %TICKER%
echo Supply: %SUPPLY%
echo Name  : %TOKEN_NAME%
echo Daemon: 127.0.0.1:29081
echo ========================================

taskkill /IM salvium-wallet-rpc.exe /F >nul 2>&1
taskkill /IM salvium-wallet-cli.exe /F >nul 2>&1
taskkill /IM salvium-wallet-gui.exe /F >nul 2>&1

if exist "%WALLET_CLI_EXE%" (
	(
		echo create_token %TICKER% %SUPPLY% name=%TOKEN_NAME%
		echo exit
	) | "%WALLET_CLI_EXE%" --testnet --wallet-file "%WALLET_FILE%" --password "%PASSWORD%" --daemon-address 127.0.0.1:29081
) else (
	echo Could not find salvium-wallet-cli.exe in %SALVIUM_PATH%
	exit /b 1
)