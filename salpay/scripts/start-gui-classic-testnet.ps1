param(
    [string]$ClassicGuiDir = '<YOUR_DOWNLOADS>\salvium-gui-v1.1.1-windows-x64'
)

$ErrorActionPreference = 'Stop'

$classicExe = Join-Path $ClassicGuiDir 'salvium-wallet-gui.exe'
if (-not (Test-Path $classicExe)) {
    throw "Classic GUI executable not found: $classicExe"
}

Get-Process salvium-wallet-gui -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# This GUI build does not accept a --testnet CLI flag.
Start-Process -FilePath $classicExe -WorkingDirectory $ClassicGuiDir
Write-Host "Started classic GUI: $classicExe"
