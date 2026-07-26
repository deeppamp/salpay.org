$ErrorActionPreference = 'Stop'

$oldGuiBinCandidates = @(
    '<YOUR_SALPAY_WORKSPACE>\salvium-gui\build\release\bin',
    '<YOUR_SALPAY_WORKSPACE>\salvium-gui-clean-v113c\build\release\bin'
)

$preferredGuiBin = [string]$env:SALPAY_GUI_BIN

$daemonBinCandidates = @(
    '<YOUR_SALPAY_WORKSPACE>\salvium-gui-clean-v113c\build\release\bin',
    '<YOUR_DOWNLOADS>\salvium-v1.1.3c-win64',
    '<YOUR_DOWNLOADS>\salvium-gui-v1.1.3c-windows-x64',
    '<YOUR_SALPAY_WORKSPACE>\salvium-gui\build\release\bin'
)

$oldGuiBin = $null
if (-not [string]::IsNullOrWhiteSpace($preferredGuiBin) -and (Test-Path (Join-Path $preferredGuiBin 'salvium-wallet-gui.exe'))) {
    $oldGuiBin = $preferredGuiBin
} else {
    $oldGuiBin = $oldGuiBinCandidates | Where-Object { Test-Path (Join-Path $_ 'salvium-wallet-gui.exe') } | Select-Object -First 1
}
$daemonBin = $daemonBinCandidates | Where-Object { Test-Path (Join-Path $_ 'salviumd.exe') } | Select-Object -First 1
$bootstrapDaemon = [string]$env:SALPAY_BOOTSTRAP_DAEMON

if (-not $oldGuiBin) {
    throw "Missing GUI binary in known paths: $($oldGuiBinCandidates -join ', ')"
}

if (-not $daemonBin) {
    throw "Missing daemon binary in known paths: $($daemonBinCandidates -join ', ')"
}

$daemonExe = Join-Path $daemonBin 'salviumd.exe'
$guiExe = Join-Path $oldGuiBin 'salvium-wallet-gui.exe'

# Avoid wallet-file lock conflicts and duplicate GUI instances.
Get-Process salvium-wallet-gui,salvium-wallet-rpc -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Start compatible daemon if not already running.
$daemon = Get-Process salviumd -ErrorAction SilentlyContinue
if (-not $daemon) {
    $daemonArgs = @('--testnet','--rpc-bind-ip','127.0.0.1','--rpc-bind-port','29081','--p2p-bind-ip','0.0.0.0','--log-level','0')

    if (-not [string]::IsNullOrWhiteSpace($bootstrapDaemon)) {
        $daemonArgs += @('--bootstrap-daemon-address', $bootstrapDaemon)
    }

    # Keep an explicit opt-in path for private/offline troubleshooting mode.
    if ($env:SALPAY_DAEMON_OFFLINE -eq 'true') {
        $daemonArgs = @('--testnet','--offline','--fixed-difficulty','500','--rpc-bind-ip','127.0.0.1','--rpc-bind-port','29081','--p2p-bind-ip','127.0.0.1','--log-level','0')
    }

    Start-Process -FilePath $daemonExe -WorkingDirectory $daemonBin -ArgumentList $daemonArgs
    Start-Sleep -Milliseconds 800
}

Start-Process -FilePath $guiExe -WorkingDirectory $oldGuiBin
Start-Sleep -Milliseconds 600

Get-Process salvium-wallet-gui,salviumd -ErrorAction SilentlyContinue |
    Select-Object ProcessName, Id, Path |
    Format-Table -AutoSize |
    Out-String |
    Write-Host
