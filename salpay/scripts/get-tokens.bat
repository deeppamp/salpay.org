@echo off
call "%~dp0salpay-env.bat"

set "ASSET_TYPE=%~1"

echo ========================================
echo Querying Salvium Tokens
echo RPC: http://127.0.0.1:%RPC_PORT%/json_rpc
if not "%ASSET_TYPE%"=="" echo Asset filter: %ASSET_TYPE%
echo ========================================

if "%ASSET_TYPE%"=="" (
	curl.exe "http://127.0.0.1:%RPC_PORT%/json_rpc" ^
	  -X POST ^
	  -H "Content-Type: application/json" ^
	  -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"get_tokens\"}"
) else (
	curl.exe "http://127.0.0.1:%RPC_PORT%/json_rpc" ^
	  -X POST ^
	  -H "Content-Type: application/json" ^
	  -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"get_tokens\",\"params\":{\"asset_type\":\"%ASSET_TYPE%\"}}"
)

echo.