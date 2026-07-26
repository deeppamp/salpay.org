param(
    [string]$ServerHost = "deploy@YOUR_SERVER",
    [string]$RemoteRoot = "/home/YOUR_DEPLOY_USER/salpay.org",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$localBackendFile = Join-Path $repoRoot "backend\index.js"

if (-not (Test-Path $localBackendFile)) {
    throw "Local backend file not found: $localBackendFile"
}

$remoteBackendFile = "$ServerHost`:$RemoteRoot/salpay/backend/index.js"
$composeCommand = "cd $RemoteRoot && docker compose --env-file salpay/.env.server -f salpay/deploy/docker-compose.server.yml"

Write-Host "Copying backend file to $remoteBackendFile"
& scp $localBackendFile $remoteBackendFile
if ($LASTEXITCODE -ne 0) {
    throw "scp failed with exit code $LASTEXITCODE"
}

if (-not $SkipBuild) {
    Write-Host "Rebuilding backend container"
    & ssh $ServerHost "$composeCommand build --no-cache backend"
    if ($LASTEXITCODE -ne 0) {
        throw "Remote build failed with exit code $LASTEXITCODE"
    }
}

Write-Host "Restarting backend container"
& ssh $ServerHost "$composeCommand up -d --force-recreate backend"
if ($LASTEXITCODE -ne 0) {
    throw "Remote restart failed with exit code $LASTEXITCODE"
}

Write-Host "Fetching backend logs"
& ssh $ServerHost "$composeCommand logs --tail=120 backend"
if ($LASTEXITCODE -ne 0) {
    throw "Remote log fetch failed with exit code $LASTEXITCODE"
}