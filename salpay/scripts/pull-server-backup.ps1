# Pull latest server backup tarball to this machine.
# Private ops only — never commit real hosts or local paths.
#
#   $env:SALPAY_SSH = "deploy@YOUR_SERVER_IP"
#   $env:SALPAY_BACKUP_DIR = "D:\backups\salpay-server-mirrors"   # outside git
#   .\pull-server-backup.ps1

param(
  [string]$SshTarget = $(if ($env:SALPAY_SSH) { $env:SALPAY_SSH } else { "" }),
  [string]$SshKey = $(if ($env:SALPAY_SSH_KEY) { $env:SALPAY_SSH_KEY } else { "" }),
  [string]$LocalDir = $(if ($env:SALPAY_BACKUP_DIR) { $env:SALPAY_BACKUP_DIR } else { "" })
)

$ErrorActionPreference = "Stop"
if (-not $SshTarget) { throw "Set SALPAY_SSH to deploy@YOUR_SERVER_IP" }
if (-not $LocalDir) { throw "Set SALPAY_BACKUP_DIR to a private local folder (outside git)" }

New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
$sshArgs = @("-o", "ConnectTimeout=20", "-o", "StrictHostKeyChecking=accept-new")
if ($SshKey -and (Test-Path $SshKey)) { $sshArgs = @("-i", $SshKey) + $sshArgs }

Write-Host "Creating remote bundle..."
& ssh @sshArgs $SshTarget "sudo bash -lc 'cd `$HOME/sal.cash 2>/dev/null || cd /opt/sal.cash 2>/dev/null || cd /root/sal.cash; sudo bash salpay/scripts/server/backup-server-bundle.sh || sudo bash scripts/server/backup-server-bundle.sh'"
if ($LASTEXITCODE -ne 0) { throw "remote backup failed" }

$remoteLatest = & ssh @sshArgs $SshTarget "ls -1t /var/backups/salpay/salpay-server-*.tgz 2>/dev/null | head -1"
if (-not $remoteLatest) { throw "no remote tarball found" }
$remoteLatest = $remoteLatest.Trim()
$leaf = Split-Path $remoteLatest -Leaf
$dest = Join-Path $LocalDir $leaf
Write-Host "Downloading $remoteLatest -> $dest"
& scp @sshArgs "${SshTarget}:$remoteLatest" $dest
Write-Host "Saved $dest"
