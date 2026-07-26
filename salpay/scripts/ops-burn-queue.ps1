# List pending operator burns (and optionally print CLI commands).
# On the PRIVATE machine that holds treasury spend keys:
#   $env:OPS_API_KEY = '...'
#   $env:SALPAY_API_BASE = 'https://salpay.org'
#   powershell -File ops-burn-queue.ps1

$ErrorActionPreference = 'Stop'
$base = ($env:SALPAY_API_BASE -as [string])
if ([string]::IsNullOrWhiteSpace($base)) { $base = 'http://127.0.0.1:3001' }
$base = $base.TrimEnd('/')
$key = $env:OPS_API_KEY
if ([string]::IsNullOrWhiteSpace($key)) {
  throw 'Set OPS_API_KEY environment variable'
}

$headers = @{ 'X-Ops-Key' = $key }
$queue = Invoke-RestMethod -Uri "$base/api/ops/burn-queue?status=pending" -Headers $headers -TimeoutSec 30

Write-Host "Pending burns: $($queue.count)  (burn_percent=$($queue.burn_percent))"
Write-Host "Treasury: $($queue.treasury_address)"
Write-Host ""

if (-not $queue.items -or $queue.items.Count -eq 0) {
  Write-Host 'Queue empty.'
  exit 0
}

foreach ($item in $queue.items) {
  Write-Host "---- $($item.name)  ticker=$($item.ticker) ----"
  Write-Host "  amount_sal : $($item.operator_burn.amount_sal)"
  Write-Host "  payment_tx : $($item.payment_tx_hash)"
  Write-Host "  CLI        : $($item.suggested_cli)"
  Write-Host "  After burn : POST $base/api/ops/burn-complete"
  Write-Host "               body: { `"name`": `"$($item.name)`", `"burn_tx_hash`": `"<txid>`" }"
  Write-Host ""
}

Write-Host 'To record a burn after CLI succeeds:'
Write-Host '  $env:OPS_API_KEY=... ; $name=... ; $txid=...'
Write-Host "  Invoke-RestMethod $base/api/ops/burn-complete -Method Post -Headers @{ 'X-Ops-Key'=`$env:OPS_API_KEY; 'Content-Type'='application/json' } -Body (@{ name=`$name; burn_tx_hash=`$txid } | ConvertTo-Json)"
