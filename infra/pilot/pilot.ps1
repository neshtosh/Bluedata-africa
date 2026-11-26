<#
.SYNOPSIS
  Runs the SamakiOS / BlueData pilot on this laptop (ADR-019). See infra/pilot/README.md.

.EXAMPLE
  .\infra\pilot\pilot.ps1 init        # once: creates .env.pilot with fresh secrets
  .\infra\pilot\pilot.ps1 up          # start everything (builds the first time), show the addresses
  .\infra\pilot\pilot.ps1 update      # rebuild from the current code, migrate, restart
  .\infra\pilot\pilot.ps1 urls        # the current public addresses
  .\infra\pilot\pilot.ps1 link -Phone +254712345678 -Name "Achieng Otieno"
  .\infra\pilot\pilot.ps1 backup      # database backup now
  .\infra\pilot\pilot.ps1 down        # stop (data is kept)
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'up', 'update', 'down', 'status', 'urls', 'link', 'backup', 'restore', 'logs', 'schedule-backup')]
  [string]$Command = 'status',
  [string]$Phone,
  [string]$Name,
  [string]$File,
  [string]$Service
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$compose = Join-Path $here 'docker-compose.yml'
$envFile = Join-Path $here '.env.pilot'

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & docker compose -f $compose --env-file $envFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($Arguments -join ' ') failed (exit $LASTEXITCODE)" }
}

function New-Secret([int]$Bytes = 32) {
  $buffer = New-Object byte[] $Bytes
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
  return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Read-PilotSetting([string]$Key) {
  if (-not (Test-Path $envFile)) { return $null }
  foreach ($line in Get-Content $envFile) {
    if ($line -match "^\s*$Key\s*=\s*(.*)$") { return $Matches[1].Trim() }
  }
  return $null
}

function Assert-Initialised {
  if (-not (Test-Path $envFile)) { throw "Run '.\infra\pilot\pilot.ps1 init' first." }
}

function Get-TunnelUrl([string]$TunnelService) {
  $logs = & docker compose -f $compose --env-file $envFile logs --no-color $TunnelService 2>&1
  $found = $logs | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Value }
  if ($found) { return @($found)[-1] }
  return $null
}

function Show-Urls {
  $samakios = Get-TunnelUrl 'tunnel-samakios'
  $bluedata = Get-TunnelUrl 'tunnel-bluedata'
  Write-Output ''
  Write-Output "SamakiOS:  $(if ($samakios) { $samakios } else { '(tunnel not ready yet - try again in a few seconds)' })"
  Write-Output "BlueData:  $(if ($bluedata) { $bluedata } else { '(tunnel not ready yet)' })"
  Write-Output 'On this laptop: http://localhost:8080 (SamakiOS) and http://localhost:8082 (BlueData)'
  Write-Output 'The public addresses change whenever the tunnels restart.'
}

switch ($Command) {
  'init' {
    if (Test-Path $envFile) { throw '.env.pilot already exists. Delete it only if you mean to start over with an empty database.' }
    $content = @(
      '# Pilot secrets (ADR-019). Keep this file private and backed up with the database:',
      '# without AUTH_SECRET, existing setup links stop working; without the passwords, the database.',
      "POSTGRES_SUPERUSER_PASSWORD=$(New-Secret)",
      "APP_MIGRATOR_PASSWORD=$(New-Secret)",
      "APP_RUNTIME_PASSWORD=$(New-Secret)",
      "AUTH_SECRET=$(New-Secret 48)",
      '# Where nightly backups are written (relative to infra/pilot, or an absolute path).',
      'BACKUP_DIR=./backups',
      '# Optional: a folder that leaves the laptop, e.g. your OneDrive or Google Drive folder.',
      'OFFSITE_BACKUP_DIR='
    )
    Set-Content -Path $envFile -Value $content -Encoding ascii
    New-Item -ItemType Directory -Force -Path (Join-Path $here 'backups') | Out-Null
    Write-Output "Created $envFile with new secrets. Next: .\infra\pilot\pilot.ps1 up"
  }

  { $_ -in 'up', 'update' } {
    Assert-Initialised
    if ($Command -eq 'update') {
      # A backup first, so a bad migration can be undone.
      & $MyInvocation.MyCommand.Path backup
      Invoke-Compose build
    }
    Invoke-Compose up -d
    Write-Output 'Waiting for the tunnels to get their addresses...'
    for ($i = 0; $i -lt 30 -and -not (Get-TunnelUrl 'tunnel-samakios'); $i++) { Start-Sleep -Seconds 2 }
    Show-Urls
  }

  'down' { Assert-Initialised; Invoke-Compose stop; Write-Output 'Pilot stopped. Data is kept.' }

  'status' { Assert-Initialised; Invoke-Compose ps }

  'urls' { Assert-Initialised; Show-Urls }

  'logs' {
    Assert-Initialised
    if ($Service) { Invoke-Compose logs --tail 200 $Service } else { Invoke-Compose logs --tail 100 }
  }

  'link' {
    Assert-Initialised
    if (-not $Phone) { throw 'Give -Phone in international form, e.g. -Phone +254712345678 (and -Name for a new person).' }
    $arguments = @('exec', '-T', 'api', 'node', 'dist/scripts/setup-link.js', '--phone', $Phone)
    if ($Name) { $arguments += @('--name', $Name) }
    $base = Get-TunnelUrl 'tunnel-samakios'
    if ($base) { $arguments += @('--base', $base) }
    Invoke-Compose @arguments
    Write-Output 'Send this link to that person only (e.g. on WhatsApp). It works once.'
  }

  'backup' {
    Assert-Initialised
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $name = "pilot-$stamp.dump"
    Invoke-Compose exec -T postgres pg_dump -U postgres -d blue -Fc -f "/backups/$name"
    $backupDir = Read-PilotSetting 'BACKUP_DIR'
    if (-not $backupDir) { $backupDir = './backups' }
    if (-not [System.IO.Path]::IsPathRooted($backupDir)) { $backupDir = Join-Path $here $backupDir }
    $path = Join-Path $backupDir $name
    if (-not (Test-Path $path) -or (Get-Item $path).Length -eq 0) { throw "Backup file missing or empty: $path" }
    # Keep the 14 most recent backups here.
    Get-ChildItem $backupDir -Filter 'pilot-*.dump' | Sort-Object Name -Descending |
      Select-Object -Skip 14 | Remove-Item -Force
    $offsite = Read-PilotSetting 'OFFSITE_BACKUP_DIR'
    if ($offsite) {
      New-Item -ItemType Directory -Force -Path $offsite | Out-Null
      Copy-Item $path $offsite
      Get-ChildItem $offsite -Filter 'pilot-*.dump' | Sort-Object Name -Descending |
        Select-Object -Skip 30 | Remove-Item -Force
      Write-Output "Backup written to $path and copied to $offsite"
    } else {
      Write-Output "Backup written to $path"
      Write-Output 'WARNING: OFFSITE_BACKUP_DIR is empty in .env.pilot, so this backup has not left the laptop.'
    }
  }

  'restore' {
    Assert-Initialised
    if (-not $File) { throw 'Give -File with a backup name from the backup folder, e.g. -File pilot-20261126-020000.dump' }
    $leaf = Split-Path -Leaf $File
    $answer = Read-Host "This REPLACES all pilot data with $leaf. Type RESTORE to continue"
    if ($answer -ne 'RESTORE') { Write-Output 'Cancelled.'; return }
    Invoke-Compose stop api worker
    Invoke-Compose exec -T postgres pg_restore -U postgres -d blue --clean --if-exists --no-owner --role=app_migrator "/backups/$leaf"
    Invoke-Compose up -d api worker
    Write-Output "Restored $leaf. Everyone will need to sign in again if sessions changed."
  }

  'schedule-backup' {
    Assert-Initialised
    $script = $MyInvocation.MyCommand.Path
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`" backup"
    $trigger = New-ScheduledTaskTrigger -Daily -At 2am
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries
    Register-ScheduledTask -TaskName 'Blue pilot backup' -Action $action -Trigger $trigger -Settings $settings -Description 'Nightly pilot database backup (infra/pilot/pilot.ps1 backup)' -Force | Out-Null
    Write-Output "Scheduled 'Blue pilot backup' every day at 02:00 (runs at the next chance if the laptop was off)."
  }
}
