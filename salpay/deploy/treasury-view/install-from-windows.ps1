# Upload treasury-view keys + install scripts to VPS and run install.
# Requires working SSH. Do NOT hardcode hostnames, users, or local paths here.
#
# Example:
#   $env:SALPAY_SSH = "deploy@YOUR_SERVER_IP"
#   $env:SALPAY_SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519"   # optional
#   $env:SALPAY_LOCAL_TREASURY_DIR = "D:\path\to\private\treasury-view"
#   .\install-from-windows.ps1

param(
  [string]$SshTarget = $(if ($env:SALPAY_SSH) { $env:SALPAY_SSH } else { "" }),
  [string]$SshKey = $(if ($env:SALPAY_SSH_KEY) { $env:SALPAY_SSH_KEY } else { "" }),
  [string]$RemoteTreasuryDir = "/var/lib/salpay/treasury-view",
  [string]$LocalTreasuryDir = $(if ($env:SALPAY_LOCAL_TREASURY_DIR) { $env:SALPAY_LOCAL_TREASURY_DIR } else { "" })
)

$ErrorActionPreference = "Stop"
if (-not $SshTarget) {
  throw "Set SALPAY_SSH (e.g. deploy@YOUR_SERVER_IP) or pass -SshTarget. Do not commit real hosts."
}
if (-not $LocalTreasuryDir) {
  throw "Set SALPAY_LOCAL_TREASURY_DIR to your private treasury-view folder (outside git) or pass -LocalTreasuryDir."
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$installSh = Join-Path $here "install-treasury-view-vps.sh"
$keys = Join-Path $LocalTreasuryDir "treasury-view-mainnet.keys"
if (-not (Test-Path $keys)) { throw "Missing $keys — create view wallet first on a private machine." }
if (-not (Test-Path $installSh)) { throw "Missing $installSh" }

$sshArgs = @("-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15")
if ($SshKey -and (Test-Path $SshKey)) {
  $sshArgs = @("-i", $SshKey) + $sshArgs
}

function Invoke-Ssh([string]$cmd) {
  & ssh @sshArgs $SshTarget $cmd
  if ($LASTEXITCODE -ne 0) { throw "ssh failed: $cmd" }
}
function Invoke-Scp([string]$src, [string]$dst) {
  & scp @sshArgs $src $dst
  if ($LASTEXITCODE -ne 0) { throw "scp failed: $src -> $dst" }
}

Write-Host "Target: $SshTarget"
Write-Host "Creating remote dirs..."
Invoke-Ssh "sudo mkdir -p $RemoteTreasuryDir /opt/salvium /var/log/salpay; sudo chown `$USER `$USER $RemoteTreasuryDir 2>/dev/null || true"

Write-Host "Uploading view wallet keys..."
Invoke-Scp $keys "${SshTarget}:/tmp/treasury-view-mainnet.keys"
# optional cache
$cache = Join-Path $LocalTreasuryDir "treasury-view-mainnet"
if (Test-Path $cache) {
  Write-Host "Uploading wallet cache (may be large)..."
  Invoke-Scp $cache "${SshTarget}:/tmp/treasury-view-mainnet"
}

Write-Host "Uploading install script..."
Invoke-Scp $installSh "${SshTarget}:/tmp/install-treasury-view-vps.sh"

Write-Host "Running install as root..."
Invoke-Ssh @"
sudo mv /tmp/treasury-view-mainnet.keys $RemoteTreasuryDir/treasury-view-mainnet.keys
if [ -f /tmp/treasury-view-mainnet ]; then sudo mv /tmp/treasury-view-mainnet $RemoteTreasuryDir/treasury-view-mainnet; fi
sudo chmod 600 $RemoteTreasuryDir/treasury-view-mainnet.keys
# Prefer a salvium-wallet-rpc if already on the box
if [ -x "`$HOME/salpay.org/bin/salvium-wallet-rpc" ]; then sudo cp "`$HOME/salpay.org/bin/salvium-wallet-rpc" /opt/salvium/; fi
if [ -x /usr/local/bin/salvium-wallet-rpc ]; then sudo cp /usr/local/bin/salvium-wallet-rpc /opt/salvium/; fi
if [ -x /opt/salvium/salvium-wallet-rpc ]; then true; fi
sudo bash /tmp/install-treasury-view-vps.sh
"@

Write-Host "Public health:"
try {
  Invoke-RestMethod "https://sal.cash/api/treasury-view-status" -TimeoutSec 20 | ConvertTo-Json -Depth 5
} catch {
  Write-Host $_.Exception.Message
}

Write-Host "Done. If binary missing on server, copy Linux salvium-wallet-rpc to /opt/salvium/ then: sudo systemctl restart salpay-treasury-view"
