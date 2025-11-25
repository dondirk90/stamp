# Restart dev environment: Hardhat node, Deploy, API server, Apps server
# Usage: From repo root: powershell -File ./scripts/restart-all.ps1
# This script opens four new PowerShell windows (keeps them open) and runs the commands there.

$ErrorActionPreference = 'Stop'

# Resolve repo root (scripts folder is inside repo)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $scriptDir "..")).Path

function start-window {
    param(
        [string]$label,
        [string]$command
    )
    Write-Host "Starting $label..."
    # Use Start-Process to open a new PowerShell window and run the command, keep it open with -NoExit
    Start-Process -FilePath powershell -ArgumentList @('-NoExit','-Command',"Set-Location -LiteralPath '$root'; $command") -WindowStyle Normal
}

# Start services – each in its own window
start-window 'Hardhat Node' 'npx hardhat node'
start-window 'Deploy (once)' 'pnpm run deploy'
start-window 'API Server' 'node api/server.cjs'
start-window 'Apps Server' 'node apps/server.cjs'

Write-Host "Launched Hardhat, Deploy, API and Apps server in new PowerShell windows."