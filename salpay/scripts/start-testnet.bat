@echo off
echo Starting Salvium Local Testnet...

call "%~dp0salvium-env.bat"

if exist "%SALVIUMD_EXE%" (
	"%SALVIUMD_EXE%" --testnet --offline --fixed-difficulty 500
) else (
	salviumd --testnet --offline --fixed-difficulty 500
)
