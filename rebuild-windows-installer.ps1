<#
  Rebuild the Orca Windows installer (NSIS).

  Why: electron-builder clears <OutDir>\win-unpacked before packaging. If an
  Orca instance launched from that directory still holds DLLs, Windows returns
  "Access is denied". This script closes only those matching instances, clears
  the target unpacked directory, then rebuilds.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\rebuild-windows-installer.ps1

  Parameters:
    -RepackageOnly  Skip compilation and reuse existing out/ and web build output.
    -Force          Skip the confirmation before stopping matching Orca processes.
    -OutDir <dir>   Output directory relative to the repo root. Defaults to dist.
                    Use dist-new to avoid locks from a running dist\win-unpacked app.
#>
[CmdletBinding()]
param(
  [switch]$RepackageOnly,
  [switch]$Force,
  [string]$OutDir = 'dist'
)

$ErrorActionPreference = 'Stop'

# Run from the repo root so pnpm resolves package.json and local config paths.
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot
Write-Host "Repo root: $RepoRoot" -ForegroundColor Cyan

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "pnpm was not found. Enable corepack and install pnpm 10.24+ first."
}

# Electron and NSIS downloads default to GitHub releases, which can time out on
# some networks. Respect caller-provided mirrors and fill in stable defaults.
if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}
Write-Host "Electron mirror: $env:ELECTRON_MIRROR" -ForegroundColor DarkCyan
Write-Host "Builder binaries mirror: $env:ELECTRON_BUILDER_BINARIES_MIRROR" -ForegroundColor DarkCyan

# Why: 7zip-bin's bundled Windows 7za.exe can access-violate on this large
# package at electron-builder's default -mx=9. Keep the rebuild script reliable
# while still allowing callers to override the compression level.
if (-not $env:ELECTRON_BUILDER_COMPRESSION_LEVEL) {
  $env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '1'
}
Write-Host "Builder compression level: $env:ELECTRON_BUILDER_COMPRESSION_LEVEL" -ForegroundColor DarkCyan

$OutDirFull = Join-Path $RepoRoot $OutDir
$distUnpacked = Join-Path $OutDirFull 'win-unpacked'
Write-Host "Output directory: $OutDirFull" -ForegroundColor Cyan

$orca = @(Get-Process -Name 'Orca' -ErrorAction SilentlyContinue) | Where-Object {
  try {
    $_.Path -and $_.Path.StartsWith($distUnpacked, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    $false
  }
}

if ($orca.Count -gt 0) {
  Write-Host "Found $($orca.Count) running Orca process(es) locking ${distUnpacked}:" -ForegroundColor Yellow
  $orca | Select-Object Id, Path | Format-Table -AutoSize | Out-Host
  if (-not $Force) {
    Write-Host "These processes will be stopped. Press Ctrl+C now to abort." -ForegroundColor Red
    [void](Read-Host 'Press Enter to stop them and continue')
  }
  $orca | Stop-Process -Force
  Start-Sleep -Seconds 2
  Write-Host "Stopped old Orca process(es)." -ForegroundColor Green
} else {
  Write-Host "No Orca process is running from $distUnpacked; skipping process stop." -ForegroundColor Green
}

if (Test-Path $distUnpacked) {
  $removed = $false
  foreach ($attempt in 1..5) {
    try {
      Remove-Item -Recurse -Force $distUnpacked -ErrorAction Stop
      $removed = $true
      break
    } catch {
      Write-Host "Failed to remove win-unpacked on attempt $attempt; retrying in 2 seconds: $($_.Exception.Message)" -ForegroundColor DarkYellow
      Start-Sleep -Seconds 2
    }
  }
  if (-not $removed) {
    throw "Could not remove $distUnpacked. Close every Orca instance using that directory and retry."
  }
  Write-Host "Removed old win-unpacked directory." -ForegroundColor Green
}

$outputOverride = "--config.directories.output=$OutDir"
if ($RepackageOnly) {
  Write-Host "Repackaging only; reusing existing build output..." -ForegroundColor Cyan
  & pnpm run ensure:electron-runtime
  if ($LASTEXITCODE -ne 0) { throw "ensure:electron-runtime failed (exit $LASTEXITCODE)" }
  & pnpm exec electron-builder --config config/electron-builder.config.cjs --win $outputOverride
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed (exit $LASTEXITCODE)" }
} else {
  Write-Host "Full rebuild and Windows packaging..." -ForegroundColor Cyan
  & pnpm run build:desktop
  if ($LASTEXITCODE -ne 0) { throw "build:desktop failed (exit $LASTEXITCODE)" }
  & pnpm run ensure:electron-runtime
  if ($LASTEXITCODE -ne 0) { throw "ensure:electron-runtime failed (exit $LASTEXITCODE)" }
  & pnpm exec electron-builder --config config/electron-builder.config.cjs --win $outputOverride
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed (exit $LASTEXITCODE)" }
}

Write-Host "`n=== Build succeeded. Installer artifact(s) under $OutDir ===" -ForegroundColor Green
$artifacts = Get-ChildItem -Path $OutDirFull -Filter '*.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending

if ($artifacts) {
  $artifacts | Select-Object Name,
    @{N = 'SizeMB'; E = { [math]::Round($_.Length / 1MB, 1) }},
    LastWriteTime,
    @{N = 'FullPath'; E = { $_.FullName }} |
    Format-Table -AutoSize -Wrap | Out-Host
} else {
  Write-Host "No .exe installer was found under $OutDir. Check the build log above." -ForegroundColor Yellow
}
