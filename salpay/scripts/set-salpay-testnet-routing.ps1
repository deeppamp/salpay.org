param(
    [string]$ServerHost = "deploy@YOUR_SERVER_IP",
    [string]$RemoteRoot = "/home/YOUR_DEPLOY_USER/sal.cash",
    [int]$BurnPercent = 50
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$addressFile = Join-Path $repoRoot "..\salpaytest.address.txt"

if (-not (Test-Path $addressFile)) {
    throw "Address file not found: $addressFile"
}

$scAddress = Get-Content $addressFile | Where-Object { $_ -match '^SC' } | Select-Object -First 1
if (-not $scAddress) {
    throw "Could not find an SC testnet address in $addressFile"
}

$scAddress = $scAddress.Trim()
if ($scAddress.Length -lt 10) {
    throw "SC address looks invalid: $scAddress"
}

$remoteCommand = @(
    "cd $RemoteRoot",
    "sed -i '/^SALPAY_NETWORK=/d;/^MINT_TREASURY_ADDRESS_TESTNET=/d;/^MINT_BURN_ADDRESS=/d;/^MINT_BURN_PERCENT=/d' salpay/.env.server",
    "printf '%s\n' 'SALPAY_NETWORK=testnet' 'MINT_TREASURY_ADDRESS_TESTNET=$scAddress' 'MINT_BURN_ADDRESS=$scAddress' 'MINT_BURN_PERCENT=$BurnPercent' >> salpay/.env.server",
    "docker compose --env-file salpay/.env.server -f salpay/deploy/docker-compose.server.yml up -d --build --force-recreate backend",
    "docker compose --env-file salpay/.env.server -f salpay/deploy/docker-compose.server.yml logs --tail=120 backend"
) -join '; '

Write-Host "Using SC testnet address: $scAddress"
Write-Host "Updating server routing on $ServerHost"
& ssh $ServerHost $remoteCommand
if ($LASTEXITCODE -ne 0) {
    throw "Remote routing update failed with exit code $LASTEXITCODE"
}