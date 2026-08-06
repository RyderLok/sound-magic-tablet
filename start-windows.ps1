#Requires -Version 5.1
<#
  Piko — Windows 一键启动
  用法：在项目根目录
    .\start-windows.ps1
  或双击 / Cursor Agent 自动调用
#>
param(
  [string]$SerialPort = $(if ($env:SERIAL_PORT) { $env:SERIAL_PORT } else { "auto" }),
  [int]$SerialBaud = 500000,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogDir = Join-Path $Root "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Test-TcpPort([int]$Port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect("127.0.0.1", $Port)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Start-ServiceWindow([string]$Title, [string]$WorkDir, [string]$Command) {
  $arg = "-NoExit -Command `"Set-Location '$WorkDir'; $Command`""
  Start-Process -FilePath "powershell.exe" -ArgumentList $arg -WindowStyle Normal
  Write-Host "[start] $Title -> $WorkDir"
}

Write-Host ""
Write-Host "Piko — Windows bootstrap" -ForegroundColor Cyan
Write-Host "Project: $Root"
Write-Host ""

# --- Python :8001 ---
if (Test-TcpPort 8001) {
  Write-Host "[ok] Python already on :8001" -ForegroundColor Green
} else {
  $pyScript = Join-Path $Root "python-service\start-python.ps1"
  if (-not (Test-Path $pyScript)) {
    Write-Host "[!!] Missing $pyScript — run python-service\setup-python.ps1 first" -ForegroundColor Yellow
  } else {
    Start-ServiceWindow "Python :8001" (Join-Path $Root "python-service") ".\start-python.ps1"
  }
}

Start-Sleep -Seconds 2

# --- Bridge :8765 ---
if (Test-TcpPort 8765) {
  Write-Host "[ok] Bridge already on :8765" -ForegroundColor Green
} else {
  $bridgeDir = Join-Path $Root "bridge"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[!!] node not in PATH — install Node.js LTS" -ForegroundColor Yellow
  } else {
    if (-not (Test-Path (Join-Path $bridgeDir "node_modules"))) {
      Write-Host "[..] npm install in bridge (first time)..."
      Push-Location $bridgeDir
      npm install 2>&1 | Out-File (Join-Path $LogDir "bridge-npm-install.log")
      Pop-Location
    }
    $bridgeCmd = "node serial-bridge.js --port $SerialPort --baud $SerialBaud --ws 8765"
    Start-ServiceWindow "Bridge :8765 ($SerialPort)" $bridgeDir $bridgeCmd
  }
}

Start-Sleep -Seconds 1

# --- Frontend :8000 ---
if (Test-TcpPort 8000) {
  Write-Host "[ok] Frontend already on :8000" -ForegroundColor Green
} else {
  $webDir = Join-Path $Root "web-demo"
  if (Get-Command npx -ErrorAction SilentlyContinue) {
    Start-ServiceWindow "Frontend :8000" $webDir "npx --yes http-server -p 8000 -c-1"
  } elseif (Get-Command python -ErrorAction SilentlyContinue) {
    Start-ServiceWindow "Frontend :8000" $webDir "python -m http.server 8000"
  } else {
    Write-Host "[!!] Need npx or python for static server" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "Waiting for services..." -ForegroundColor DarkGray
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  if ((Test-TcpPort 8000) -and (Test-TcpPort 8001)) { break }
  Start-Sleep -Seconds 1
}

if (Test-TcpPort 8001) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8001/health" -TimeoutSec 5
    if ($health.status -eq "ok") {
      Write-Host "[ok] Python health check passed" -ForegroundColor Green
    }
  } catch {
    Write-Host "[..] Python port open, health still starting..." -ForegroundColor DarkYellow
  }
}

Write-Host ""
Write-Host "Open: http://localhost:8000" -ForegroundColor Cyan
Write-Host "Bridge serial: $SerialPort @ $SerialBaud (auto = USB plug-and-play; set `$env:SERIAL_PORT to pin a port)"
Write-Host ""

if (-not $NoBrowser) {
  Start-Process "http://localhost:8000"
}
