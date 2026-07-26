@echo off
call "%~dp0salpay-env.bat"

echo Starting Wallet RPC with latest build...

taskkill /F /IM salvium-wallet-rpc.exe >nul 2>&1

if exist "%SALVIUM_PATH%\salvium-wallet-rpc.exe" (
	"%SALVIUM_PATH%\salvium-wallet-rpc.exe" ^
	  --testnet ^
	  --wallet-file "%WALLET_FILE%" ^
	  --password "%PASSWORD%" ^
	  --rpc-bind-port "%RPC_PORT%" ^
	  --daemon-address testnet.salvium.io:29081 ^
	  --trusted-daemon ^
	  --disable-rpc-login ^
	  --log-level 0
) else (
	echo Could not find salvium-wallet-rpc.exe in %SALVIUM_PATH%
	exit /b 1
)