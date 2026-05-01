<#
.SYNOPSIS
    Checks whether WildFly is currently running.
.DESCRIPTION
    Queries the management HTTP API for server state.
    Exits with code 0 if running, 1 if unreachable or stopped.
.EXAMPLE
    .\scripts\status.ps1
#>

. "$PSScriptRoot\..\wildfly.config.ps1"

$mgmtUrl = "http://127.0.0.1:$WF_MGMT_PORT/management?operation=attribute&name=server-state"

Write-Host "Checking WildFly at http://127.0.0.1:$WF_MGMT_PORT ..." -ForegroundColor Cyan

try {
    $ProgressPreference = 'SilentlyContinue'
    $resp = Invoke-WebRequest -Uri $mgmtUrl -UseBasicParsing -TimeoutSec 5
    $body = $resp.Content | ConvertFrom-Json -ErrorAction SilentlyContinue

    # Management API returns the value directly as a JSON string "running"
    $state = if ($body) { $body } else { $resp.Content.Trim('"') }

    if ($state -eq "running") {
        Write-Host "[OK] WildFly is RUNNING  (state: $state)" -ForegroundColor Green
        exit 0
    }
    else {
        Write-Host "[WARN] WildFly responded but state is: $state" -ForegroundColor Yellow
        exit 1
    }
}
catch {
    Write-Host "[DOWN] WildFly is NOT running or unreachable." -ForegroundColor Red
    Write-Host "       $_" -ForegroundColor DarkGray
    exit 1
}
