# Recover deeppamp.sal after user paid treasury but chain_proof missed the tx.
# Requires OPS_API_KEY (same as burn-queue) and a reachable salpay.org API.
#
# Usage (PowerShell):
#   $env:OPS_API_KEY = 'your-ops-key'
#   .\ops-force-mint-deeppamp.ps1
#
# Or override:
#   .\ops-force-mint-deeppamp.ps1 -PaymentTxHash <64hex> -PrimaryAddress SC11...

param(
  [string]$ApiBase = "https://salpay.org",
  [string]$Name = "deeppamp.sal",
  [string]$Ticker = "DEEP",
  [string]$PrimaryAddress = "SC11gssCpXu7koERwgU6PfGrbE6uDvT5VAiwX4YJiJvCLcDs4YnjyfTP5j2vNV8Mw9DwNutaWW5iue5VQVNm3qZa3gLMeyauMi",
  [string]$PaymentTxHash = "a4ca37d2b811c4a3cfb13a8d4b7375ac948daa7c2516bda71d3f192c1c121aba",
  [double]$Fee = 412
)

$ErrorActionPreference = "Stop"
if (-not $env:OPS_API_KEY) {
  throw "Set `$env:OPS_API_KEY first (operator key from server .env)."
}

$body = @{
  name = $Name
  ticker = $Ticker
  primary_address = $PrimaryAddress
  payment_tx_hash = $PaymentTxHash
  fee = $Fee
  note = "Recovery: user paid 412 SAL1 (change ~87.99). Tx confirmed height ~539357. Treasury view had tx_not_found."
} | ConvertTo-Json

Write-Host "POST $ApiBase/api/ops/force-mint-complete"
$resp = Invoke-RestMethod -Uri "$ApiBase/api/ops/force-mint-complete" -Method POST `
  -Headers @{ "x-ops-key" = $env:OPS_API_KEY; "Content-Type" = "application/json" } `
  -Body $body -TimeoutSec 60

$resp | ConvertTo-Json -Depth 8
Write-Host ""
Write-Host "Resolve check:"
try {
  Invoke-RestMethod -Uri "$ApiBase/api/resolve/$Name" -TimeoutSec 20 | ConvertTo-Json -Depth 6
} catch {
  $_.ErrorDetails.Message
}
