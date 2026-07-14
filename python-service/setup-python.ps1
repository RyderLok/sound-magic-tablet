# One-time Python environment setup for Sound Magic Tablet
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$Candidates = @(
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
)
$Py = $Candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $Py) {
    $Py = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $Py -or $Py -like "*WindowsApps*") {
    Write-Host "Python not found. Install from https://www.python.org/downloads/ or run:" -ForegroundColor Red
    Write-Host "  winget install -e --id Python.Python.3.12"
    exit 1
}

Write-Host "Using: $Py" -ForegroundColor Cyan
& $Py -m venv .venv
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\pip.exe install -r requirements.txt
& .\.venv\Scripts\python.exe -m pytest tests/ -q
Write-Host "Setup complete. Start service with: .\start-python.ps1" -ForegroundColor Green
