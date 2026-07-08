# Stop dev environment processes (Hardhat/API/Apps) by common ports
# Usage: From repo root: powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/stop-all.ps1

$ErrorActionPreference = 'SilentlyContinue'

$ports = @(8545,3000,8080,8081,19000,19001,19002)

Write-Host "Stopping listeners on ports: $($ports -join ', ')" -ForegroundColor Cyan

$pids = @()
foreach ($p in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conns) {
        $pids += ($conns | Select-Object -ExpandProperty OwningProcess)
    }
}

$pids = $pids | Sort-Object -Unique

if (-not $pids -or $pids.Count -eq 0) {
    Write-Host "No matching listeners found." -ForegroundColor Yellow
} else {
    foreach ($pid in $pids) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        $name = if ($proc) { $proc.ProcessName } else { "?" }
        Write-Host "- Stop PID $pid ($name)" -ForegroundColor Yellow
        Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    }
}

Start-Sleep -Milliseconds 300

foreach ($p in $ports) {
    $still = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($still) {
        $pid = ($still | Select-Object -First 1 -ExpandProperty OwningProcess)
        Write-Host "Port $p still LISTEN (PID $pid)" -ForegroundColor Red
    } else {
        Write-Host "Port $p free" -ForegroundColor Green
    }
}
