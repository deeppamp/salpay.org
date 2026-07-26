[CmdletBinding()]
param(
    [int]$MinutesBack = 45
)

$ErrorActionPreference = 'Stop'

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $scriptDir "debug-captures"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$guiLog = Join-Path $env:APPDATA 'salvium-wallet-gui\salvium-wallet-gui.log'
$guiOutPath = Join-Path $outDir ("mint-gui-log-" + $timestamp + ".txt")
$auditOutPath = Join-Path $outDir ("mint-audit-" + $timestamp + ".json")
$summaryOutPath = Join-Path $outDir ("mint-summary-" + $timestamp + ".txt")
$stateOutPath = Join-Path $outDir ("mint-state-" + $timestamp + ".txt")

$patterns = @(
    'mint',
    'salpay',
    'reserve',
    'verify-payment',
    'execute',
    'tx_hash',
    'double spend',
    'invalid format',
    'payment',
    'error'
)

$guiMatches = @()
$cutoff = (Get-Date).AddMinutes(-1 * [Math]::Abs($MinutesBack))
if (Test-Path $guiLog) {
    $regex = [string]::Join('|', $patterns)
    $raw = Select-String -Path $guiLog -Pattern $regex -CaseSensitive:$false
    $guiMatches = $raw | Where-Object {
        try {
            $lineTs = [datetime]::ParseExact($_.Line.Substring(0, 23), 'yyyy-MM-dd HH:mm:ss.fff', $null)
            $lineTs -ge $cutoff
        } catch {
            $false
        }
    } | Select-Object -Last 400
    $guiMatches | ForEach-Object { $_.Line } | Set-Content -Path $guiOutPath -Encoding UTF8
} else {
    "GUI log not found: $guiLog" | Set-Content -Path $guiOutPath -Encoding UTF8
}

$auditPayload = $null
try {
    $auditPayload = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/mint/audit?limit=300' -Method Get
    $auditPayload | ConvertTo-Json -Depth 8 | Set-Content -Path $auditOutPath -Encoding UTF8
} catch {
    @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 5 | Set-Content -Path $auditOutPath -Encoding UTF8
}

$lines = @()
$lines += "Mint debug capture: $timestamp"
$lines += "GUI log source: $guiLog"
$lines += "GUI filtered lines saved: $guiOutPath"
$lines += "Backend audit saved: $auditOutPath"
$lines += ""

if ($auditPayload -and $auditPayload.items) {
    $lines += "Latest mint audit events (up to 20):"
    $recent = $auditPayload.items | Select-Object -First 20
    foreach ($item in $recent) {
        $event = [string]$item.event
        $decision = [string]$item.decision
        $at = [string]$item.at
        $reason = [string]$item.details.reason
        $txHash = [string]$item.details.tx_hash
        $resId = [string]$item.details.reservation_id
        $lines += "- [$at] $event | $decision | reason=$reason | tx_hash=$txHash | reservation_id=$resId"
    }
} else {
    $lines += "No mint audit events returned from backend."
}

$stateLines = @()
$stateLines += "Mint state snapshot: $timestamp"
$stateLines += "Cutoff window (minutes): $MinutesBack"
$stateLines += ""
$stateLines += "Processes:"
try {
    $proc = Get-Process salvium-wallet-gui,salviumd,salvium-wallet-rpc,node -ErrorAction SilentlyContinue |
        Select-Object ProcessName,Id,Path,StartTime
    if ($proc) {
        $stateLines += ($proc | Format-Table -AutoSize | Out-String)
    } else {
        $stateLines += "(none found)"
    }
} catch {
    $stateLines += "Process snapshot error: $($_.Exception.Message)"
}

$stateLines += ""
$stateLines += "Daemon /get_info:"
try {
    $daemonInfo = Invoke-RestMethod -Uri 'http://127.0.0.1:29081/get_info' -Method Get
    $stateLines += ($daemonInfo | ConvertTo-Json -Depth 6)
} catch {
    $stateLines += "daemon get_info error: $($_.Exception.Message)"
}

$stateLines += ""
$stateLines += "Backend turnstile-config:"
try {
    $cfg = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/turnstile-config' -Method Get
    $stateLines += ($cfg | ConvertTo-Json -Depth 6)
} catch {
    $stateLines += "backend turnstile-config error: $($_.Exception.Message)"
}

$stateLines += ""
$stateLines += "DNS checks:"
foreach ($dnsHost in @('testnet.salvium.io','node.salvium.io')) {
    try {
        $answers = Resolve-DnsName $dnsHost -ErrorAction Stop | Select-Object -ExpandProperty IPAddress
        $stateLines += "$dnsHost => $($answers -join ', ')"
    } catch {
        $stateLines += "$dnsHost => DNS_FAIL ($($_.Exception.Message))"
    }
}

$stateLines | Set-Content -Path $stateOutPath -Encoding UTF8

$lines | Set-Content -Path $summaryOutPath -Encoding UTF8

Write-Host "Saved GUI lines: $guiOutPath"
Write-Host "Saved audit JSON: $auditOutPath"
Write-Host "Saved summary: $summaryOutPath"
Write-Host "Saved state snapshot: $stateOutPath"
