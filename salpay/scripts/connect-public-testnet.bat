@echo off
echo ========================================
echo   Connecting to Public Salvium Testnet
echo ========================================

call "%~dp0salvium-env.bat"

if exist "%SALVIUMD_EXE%" (
	"%SALVIUMD_EXE%" --testnet --bootstrap-daemon-address testnet.salvium.io:29081
) else (
	salviumd --testnet --bootstrap-daemon-address testnet.salvium.io:29081
)
