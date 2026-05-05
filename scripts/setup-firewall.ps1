param(
  [int]$AppsPort = 8080,
  [int]$ApiPort = 3000,
  [int[]]$ExpoPorts = @(19000,19001,19002),
  [ValidateSet('Private','Domain','Public','Any')][string]$Profile = 'Private'
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Bitte PowerShell als Administrator starten.'
  }
}

function Ensure-Rule {
  param(
    [string]$Name,
    [int]$Port,
    [string]$Profile
  )

  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if ($existing) {
    # Make it deterministic: remove then recreate.
    $existing | Remove-NetFirewallRule | Out-Null
  }

  $profileArg = if ($Profile -eq 'Any') { 'Any' } else { $Profile }

  New-NetFirewallRule `
    -DisplayName $Name `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile $profileArg `
    -Enabled True |
    Out-Null
}

function Show-Listening {
  param([int]$Port)
  Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' } |
    Select-Object LocalAddress,LocalPort,State,OwningProcess |
    Format-Table -AutoSize |
    Out-String
}

Assert-Admin

Write-Host 'Setting up Windows Firewall rules (inbound) ...'
Ensure-Rule -Name "Stamp Apps ($AppsPort)" -Port $AppsPort -Profile $Profile
Ensure-Rule -Name "Stamp API ($ApiPort)" -Port $ApiPort -Profile $Profile

if ($ExpoPorts -and $ExpoPorts.Count -gt 0) {
  foreach ($p in $ExpoPorts) {
    if ($p -gt 0) {
      Ensure-Rule -Name "Stamp Expo ($p)" -Port $p -Profile $Profile
    }
  }
}

Write-Host ''
Write-Host 'Rules created/updated:'
Get-NetFirewallRule -DisplayName "Stamp Apps ($AppsPort)","Stamp API ($ApiPort)","Stamp Expo*" |
  Get-NetFirewallPortFilter |
  Select-Object Name,Protocol,LocalPort |
  Format-Table -AutoSize

Write-Host ''
Write-Host 'Listening state (for sanity):'
Write-Host (Show-Listening -Port $AppsPort)
Write-Host (Show-Listening -Port $ApiPort)

if ($ExpoPorts -and $ExpoPorts.Count -gt 0) {
  foreach ($p in $ExpoPorts) {
    if ($p -gt 0) {
      Write-Host (Show-Listening -Port $p)
    }
  }
}

Write-Host ''
Write-Host 'Done. If a phone still cannot reach the PC:'
Write-Host ' - Ensure the phone is on the same Wi-Fi (not guest network / client isolation)'
Write-Host ' - Ensure Windows network is Private (not Public)'
