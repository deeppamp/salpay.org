param(
    [switch]$NoBuild,
    [switch]$NoStart,
    [string]$GuiRoot = '<YOUR_SALPAY_WORKSPACE>\salvium-gui-clean-v113c'
)

$ErrorActionPreference = 'Stop'

$buildDir = Join-Path $GuiRoot 'build\release'
$binDir = Join-Path $buildDir 'bin'
$mingwBin = 'C:\msys64\mingw64\bin'
$msysBin = 'C:\msys64\usr\bin'

if (-not (Test-Path $buildDir)) {
    throw "Build directory not found: $buildDir"
}

# Ensure MinGW runtime/tools are first in PATH so gcc frontend DLLs resolve.
$pathParts = @($mingwBin, $msysBin)
foreach ($part in $pathParts) {
    if (-not (Test-Path $part)) {
        throw "Required tool path not found: $part"
    }
}

$currentPathParts = $env:PATH -split ';' | Where-Object { $_ -ne '' }
$filtered = $currentPathParts | Where-Object { $_ -notin $pathParts }
$env:PATH = (($pathParts + $filtered) -join ';')

if (-not $NoBuild) {
    Get-Process salvium-wallet-gui -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    Push-Location $buildDir
    try {
        cmake --build . --target salvium-wallet-gui --config Release -- -j4
        if ($LASTEXITCODE -ne 0) {
            throw "Build failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

if (-not $NoStart) {
    $guiExe = Join-Path $binDir 'salvium-wallet-gui.exe'
    if (-not (Test-Path $guiExe)) {
        throw "GUI executable not found: $guiExe"
    }

    # This GUI build does not accept a --testnet CLI flag.
    Start-Process -FilePath $guiExe -WorkingDirectory $binDir
    Write-Host "Started salvium-wallet-gui from $binDir"
}
