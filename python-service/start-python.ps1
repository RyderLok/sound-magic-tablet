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
Write-Host "Starting Python service on http://127.0.0.1:8001" -ForegroundColor Green
Write-Host "Health: http://127.0.0.1:8001/health"
& $Py -m uvicorn app:app --host 127.0.0.1 --port 8001
