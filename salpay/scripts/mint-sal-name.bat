@echo off
call "%~dp0salpay-env.bat"

set "TICKER=%~1"
set "NAME=%~2"
set "PRIMARY_ADDRESS=%~3"

if "%TICKER%"=="" set "TICKER=BOBB"
if "%NAME%"=="" set "NAME=bob.sal"
if "%PRIMARY_ADDRESS%"=="" set "PRIMARY_ADDRESS=SC1Tou2VtQX3Pb3nYrEVLwFAniy8QeEjGfBRJTzxL4A8CoxPVeUDLxTLMKZvQmtcnYHcuWqH85CgM9gt8Ti4qoyh7tDPcN9YpUv"

echo ========================================
echo Minting .sal Name with Rich Metadata
echo ========================================

set "SAL_NAME=%NAME%"
set "SAL_TICKER=%TICKER%"
set "SAL_PRIMARY_ADDRESS=%PRIMARY_ADDRESS%"

for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "$name=$env:SAL_NAME; $ticker=$env:SAL_TICKER; $primary=$env:SAL_PRIMARY_ADDRESS; if([string]::IsNullOrWhiteSpace($name)){ exit 1 }; if([string]::IsNullOrWhiteSpace($ticker)){ exit 1 }; if([string]::IsNullOrWhiteSpace($primary)){ exit 1 }; $meta=[ordered]@{standard='sal-name-v1';name=$name;ticker=$ticker;primary_address=$primary;sub_names=[ordered]@{shop=[ordered]@{index=42;label='Shop payments'};pay=[ordered]@{index=5;label='General payments'}};records=[ordered]@{description='My first .sal name on salpay.org';website='https://salpay.org'};carrot_enabled=$true;sparc_returns=$true;created_at='2026-05-30'}; $json=$meta | ConvertTo-Json -Compress -Depth 6; $bytes=[System.Text.Encoding]::UTF8.GetBytes($json); -join ($bytes | ForEach-Object { $_.ToString('x2') })"`) do set "TOKEN_METADATA_HEX=%%H"

if not defined TOKEN_METADATA_HEX (
  echo Failed to encode metadata into token_metadata_hex.
  exit /b 1
)

echo Metadata prepared.

curl.exe "http://127.0.0.1:29088/json_rpc" ^
  -X POST ^
  -H "Content-Type: application/json" ^
  -d "{\"jsonrpc\":\"2.0\",\"id\":\"0\",\"method\":\"create_token\",\"params\":{\"ticker\":\"%TICKER%\",\"supply\":1,\"name\":\"%NAME%\",\"token_metadata_hex\":\"%TOKEN_METADATA_HEX%\"}}"

echo.
pause
