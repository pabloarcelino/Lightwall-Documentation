# Load .env variables
Get-Content .env | ForEach-Object {
    if ($_ -match '^([^#][^=]*)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), "Process")
    }
}

# Start Python CV service in background (optional — auto-fallback if not running)
$cvPath = Join-Path $PSScriptRoot "cv-service"
if (Test-Path (Join-Path $cvPath "run.py")) {
    $venvPython = Join-Path $cvPath ".venv/Scripts/python.exe"
    if (Test-Path $venvPython) {
        Write-Host "[DEV] Starting CV service (Python) on port 8100..." -ForegroundColor Cyan
        $cvJob = Start-Job -ScriptBlock {
            param($dir, $py)
            Set-Location $dir
            & $py run.py
        } -ArgumentList $cvPath, $venvPython
        Write-Host "[DEV] CV service job started (ID: $($cvJob.Id))" -ForegroundColor Green
    } else {
        Write-Host "[DEV] CV service .venv not found — skipping (run: cd cv-service && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt)" -ForegroundColor Yellow
    }
} else {
    Write-Host "[DEV] cv-service/run.py not found — skipping CV service" -ForegroundColor Yellow
}

# Start Node.js server
Write-Host "[DEV] Starting Node.js server on port $env:PORT..." -ForegroundColor Cyan
npx tsx server/index.ts
