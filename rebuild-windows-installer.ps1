<#
  rebuild-windows-installer.ps1 — 重新打包 Orca 的 Windows 安装包 (NSIS)

  为什么需要它:electron-builder 打包前要清空 dist\win-unpacked,但上一个打好的
  Orca.exe 在运行时会把 d3dcompiler_47.dll 等 DLL 锁住,导致 "Access is denied"。
  本脚本先关停锁目录的旧 Orca,再清理目录后重新打包。

  ⚠️ 请在【不是跑在 Orca 内】的终端执行(否则关停 Orca 会一并关掉本终端)。
     推荐用 Windows Terminal / 独立 PowerShell。

  用法:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\rebuild-windows-installer.ps1
    参数:
      -RepackageOnly  跳过编译,复用现有 out/(刚成功编译过时最快,几分钟出包)
      -Force          跳过关停 Orca 前的确认提示
      -OutDir <dir>   输出目录(相对仓库根),默认 dist。指定 dist-new 等全新目录可
                      绕开正在运行的 Orca 对 dist\win-unpacked 的文件锁,无需关停它。
#>
[CmdletBinding()]
param(
  [switch]$RepackageOnly,
  [switch]$Force,
  [string]$OutDir = 'dist'
)

$ErrorActionPreference = 'Stop'

# 始终在脚本所在目录(仓库根)下执行,这样 pnpm 能找到 package.json。
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot
Write-Host "仓库根: $RepoRoot" -ForegroundColor Cyan

# pnpm 可用性检查
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw "找不到 pnpm,请先确保已通过 corepack 启用 pnpm 10.24+。"
}

# Electron 运行时与 NSIS 工具链默认从 GitHub releases 下载,国内网络会连接超时导致打包中断。
# 走 npmmirror 镜像;这是两个独立的下载源,必须都配。若用户已自定义则尊重不覆盖。
if (-not $env:ELECTRON_MIRROR) {
  $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
}
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
}
Write-Host "Electron 镜像: $env:ELECTRON_MIRROR" -ForegroundColor DarkCyan
Write-Host "Builder 二进制镜像: $env:ELECTRON_BUILDER_BINARIES_MIRROR" -ForegroundColor DarkCyan

# 输出目录可由 -OutDir 覆盖;electron-builder 把它当作 directories.output(相对仓库根)。
$OutDirFull = Join-Path $RepoRoot $OutDir
$distUnpacked = Join-Path $OutDirFull 'win-unpacked'
Write-Host "输出目录: $OutDirFull" -ForegroundColor Cyan

# 1) 关停从 <OutDir>\win-unpacked 运行、锁住输出目录的旧 Orca 进程
$orca = @(Get-Process -Name 'Orca' -ErrorAction SilentlyContinue) | Where-Object {
  try { $_.Path -and $_.Path.StartsWith($distUnpacked, [System.StringComparison]::OrdinalIgnoreCase) }
  catch { $false }
}
if ($orca.Count -gt 0) {
  Write-Host "发现 $($orca.Count) 个运行中的 Orca 进程,正锁住 ${distUnpacked}:" -ForegroundColor Yellow
  $orca | Select-Object Id, Path | Format-Table -AutoSize | Out-Host
  if (-not $Force) {
    Write-Host "即将结束这些进程。如果本终端就跑在该 Orca 内,请立即按 Ctrl+C。" -ForegroundColor Red
    [void](Read-Host "按 Enter 关停并继续")
  }
  $orca | Stop-Process -Force
  Start-Sleep -Seconds 2
  Write-Host "已关停旧 Orca。" -ForegroundColor Green
} else {
  Write-Host "未发现从 $distUnpacked 运行的 Orca,跳过关停。" -ForegroundColor Green
}

# 2) 删除被锁的旧 win-unpacked,让 electron-builder 能干净地重新打包(带重试,等句柄释放)
if (Test-Path $distUnpacked) {
  $removed = $false
  foreach ($attempt in 1..5) {
    try {
      Remove-Item -Recurse -Force $distUnpacked -ErrorAction Stop
      $removed = $true
      break
    } catch {
      Write-Host "删除 win-unpacked 失败(第 $attempt 次),2 秒后重试: $($_.Exception.Message)" -ForegroundColor DarkYellow
      Start-Sleep -Seconds 2
    }
  }
  if (-not $removed) {
    throw "无法删除 $distUnpacked —— 仍有进程占用。请确认所有 Orca 实例已关闭后重试。"
  }
  Write-Host "已删除旧 dist\win-unpacked。" -ForegroundColor Green
}

# 3) 构建
# 把输出目录覆盖透传给 electron-builder(directories.output)。完整模式下经由 pnpm 的
# `--` 分隔符,参数会附加到 build:win 链尾的 electron-builder 命令。
$outputOverride = "--config.directories.output=$OutDir"
if ($RepackageOnly) {
  Write-Host "仅重新打包(复用现有 out/ 与 web 构建)..." -ForegroundColor Cyan
  & pnpm run ensure:electron-runtime
  if ($LASTEXITCODE -ne 0) { throw "ensure:electron-runtime 失败 (exit $LASTEXITCODE)" }
  & pnpm exec electron-builder --config config/electron-builder.config.cjs --win $outputOverride
  if ($LASTEXITCODE -ne 0) { throw "electron-builder 失败 (exit $LASTEXITCODE)" }
} else {
  Write-Host "完整重建(pnpm build:win:typecheck → relay → cli → electron-vite → web → 打包)..." -ForegroundColor Cyan
  & pnpm run build:win '--' $outputOverride
  if ($LASTEXITCODE -ne 0) { throw "build:win 失败 (exit $LASTEXITCODE)" }
}

# 4) 输出安装包产物
Write-Host "`n=== 构建成功。$OutDir\ 下的安装包产物 ===" -ForegroundColor Green
$artifacts = Get-ChildItem -Path $OutDirFull -Filter '*.exe' -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending
if ($artifacts) {
  $artifacts | Select-Object Name,
    @{N='SizeMB'; E={ [math]::Round($_.Length / 1MB, 1) }},
    LastWriteTime, @{N='FullPath'; E={ $_.FullName }} |
    Format-Table -AutoSize -Wrap | Out-Host
} else {
  Write-Host "未在 $OutDir\ 找到 .exe 安装包,请检查上面的构建日志。" -ForegroundColor Yellow
}
