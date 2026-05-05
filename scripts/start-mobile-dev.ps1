# Start mobile dev environment for Expo Go (Customer + Café) + local web/API servers
# Usage (repo root): powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-mobile-dev.ps1
# Optional: -LanIp 192.168.0.176

param(
  [int]$AppsPort = 8081,
  [int]$ApiPort = 3000,
  [int]$CustomerExpoPort = 19000,
  [int]$CafeExpoPort = 19001,
  [string]$LanIp = ""
)

$ErrorActionPreference = 'Stop'

# Resolve repo root (scripts folder is inside repo)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..")).Path

function Get-LanIpv4 {
  try {
    # Prefer the interface that has the default route.
    $defaultRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
      Sort-Object -Property RouteMetric,InterfaceMetric |
      Select-Object -First 1

    if ($defaultRoute -and $defaultRoute.InterfaceIndex) {
      $ip = Get-NetIPAddress -InterfaceIndex $defaultRoute.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
        Select-Object -First 1 -ExpandProperty IPAddress
      if ($ip) { return $ip }
    }

    # Fallback: first non-loopback IPv4.
    $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1' } |
      Select-Object -First 1 -ExpandProperty IPAddress

    return $fallback
  } catch {
    return $null
  }
}

function Start-Window {
  param(
    [string]$label,
    [string]$command
  )

  Write-Host "Starting $label..." -ForegroundColor Cyan
  Start-Process -FilePath powershell -ArgumentList @(
    '-NoExit',
    '-Command',
    "Set-Location -LiteralPath '$root'; $command"
  ) -WindowStyle Normal | Out-Null
}

function Wait-Port {
  param(
    [string]$ComputerName,
    [int]$port,
    [int]$timeoutSeconds = 25
  )

  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $ok = $false
    try {
      $ok = (Test-NetConnection -ComputerName $ComputerName -Port $port -WarningAction SilentlyContinue).TcpTestSucceeded
    } catch {}

    if ($ok) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

if (-not $LanIp -or $LanIp.Trim().Length -eq 0) {
  $LanIp = Get-LanIpv4
}

if (-not $LanIp) {
  throw "Could not auto-detect LAN IP. Re-run with -LanIp <your ip>, e.g. -LanIp 192.168.0.176"
}

$webBaseUrl = "http://$LanIp`:$AppsPort"

Write-Host "Repo: $root" -ForegroundColor Gray
Write-Host "LAN IP: $LanIp" -ForegroundColor Yellow
Write-Host "Web base URL: $webBaseUrl" -ForegroundColor Yellow
Write-Host "";

# 1) Start API first
Start-Window 'API Server' "node api\\server.cjs"

Write-Host "Waiting for API on 127.0.0.1:$ApiPort ..." -ForegroundColor Gray
if (-not (Wait-Port -ComputerName '127.0.0.1' -port $ApiPort -timeoutSeconds 25)) {
  Write-Host "WARN: API did not open port $ApiPort yet. Apps Server may show 502 until API is ready." -ForegroundColor Yellow
}

# 2) Start Apps server after API (prevents early proxy/SSE weirdness)
Start-Window 'Apps Server' "node apps\\server.cjs"

Write-Host "Waiting for Apps Server on ${LanIp}:${AppsPort} ..." -ForegroundColor Gray
if (-not (Wait-Port -ComputerName $LanIp -port $AppsPort -timeoutSeconds 25)) {
  Write-Host "WARN: Apps Server not reachable on ${LanIp}:${AppsPort} yet." -ForegroundColor Yellow
}

# 3) Start Expo servers (Customer + Café)
# Important env vars:
# - EXPO_PUBLIC_WEB_BASE_URL: used by the WebView wrapper to load the web app
# - REACT_NATIVE_PACKAGER_HOSTNAME: ensures Expo Go QR points at the LAN IP (not localhost)
# - EXPO_NO_DEPENDENCY_VALIDATION: skips Expo CLI dependency validation (avoids flaky remote version fetch)

$customerCmd = "`$env:EXPO_PUBLIC_WEB_BASE_URL='$webBaseUrl'; `$env:REACT_NATIVE_PACKAGER_HOSTNAME='$LanIp'; `$env:EXPO_NO_DEPENDENCY_VALIDATION='1'; pnpm -C apps\\customer-ios-new start -- --lan --port $CustomerExpoPort"
$cafeCmd = "`$env:EXPO_PUBLIC_WEB_BASE_URL='$webBaseUrl'; `$env:REACT_NATIVE_PACKAGER_HOSTNAME='$LanIp'; `$env:EXPO_NO_DEPENDENCY_VALIDATION='1'; pnpm -C apps\\cafe-ios-new start -- --lan --port $CafeExpoPort"

Start-Window 'Expo (Customer)' $customerCmd
Start-Window 'Expo (Café)' $cafeCmd

Write-Host "";
Write-Host "Open on phone (same Wi-Fi):" -ForegroundColor Green
Write-Host "- Web diag: $webBaseUrl/__diag" -ForegroundColor Green
Write-Host "- Customer Expo: exp://$LanIp`:$CustomerExpoPort" -ForegroundColor Green
Write-Host "- Café Expo:     exp://$LanIp`:$CafeExpoPort" -ForegroundColor Green
Write-Host "";
Write-Host "If phone can't connect: run firewall rules as Admin:" -ForegroundColor Yellow
Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\setup-firewall.ps1 -Profile Any" -ForegroundColor Yellow
