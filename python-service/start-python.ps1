# Start Piko Python enhancement service (port 8001)
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Py = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path $Py)) {
    Write-Host "Virtual env not found. Run setup first:" -ForegroundColor Yellow
    Write-Host "  cd python-service"
    Write-Host "  python -m venv .venv"
    Write-Host "  .\.venv\Scripts\pip install -r requirements.txt"
    exit 1
}

Set-Location $Root
# Bind 0.0.0.0 so phone-hotspot / ESP32 / iPad on the same LAN can reach :8001.
# Override with $env:HOST='127.0.0.1' if you only want loopback.
$HostBind = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$PortBind = if ($env:PORT) { $env:PORT } else { "8001" }
Write-Host "Starting Python service on http://${HostBind}:${PortBind}" -ForegroundColor Green
Write-Host "Health (this PC): http://127.0.0.1:${PortBind}/health"
Write-Host "LAN clients: http://<this-PC-LAN-IP>:${PortBind}/health"
& $Py -m uvicorn app:app --host $HostBind --port $PortBind
