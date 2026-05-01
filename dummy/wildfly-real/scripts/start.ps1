<#
.SYNOPSIS
    Starts the WildFly standalone server.
.DESCRIPTION
    Launches bin\standalone.bat with the configured ports and bind addresses.
    Runs in the foreground by default (press Ctrl+C to stop).
    Use -Background to spawn it as a detached background process.
.PARAMETER Background
    Start WildFly in a new window instead of blocking the current terminal.
.PARAMETER Config
    Server configuration file (default: standalone.xml).
.EXAMPLE
    .\scripts\start.ps1
    .\scripts\start.ps1 -Background
    .\scripts\start.ps1 -Config standalone-full.xml
#>
param(
    [switch]$Background,
    [string]$Config
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\..\wildfly.config.ps1"

if (-not $Config) { $Config = $WF_CONFIG }

if (-not (Test-Path $WF_HOME)) {
    Write-Host "[FAIL] WildFly not found at: $WF_HOME" -ForegroundColor Red
    Write-Host "       Run .\scripts\setup.ps1 first." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== Starting WildFly $WF_VERSION ===" -ForegroundColor Cyan
Write-Host "  App port        : http://localhost:$WF_HTTP_PORT"
Write-Host "  Management port : http://localhost:$WF_MGMT_PORT/console"
Write-Host "  Config          : $Config"
Write-Host ""

# WildFly reads JAVA_HOME from the environment; pass it explicitly if set.
$env:JBOSS_HOME = $WF_HOME

$startArgs = @(
    "-c", $Config,
    "-b", $WF_BIND,
    "-bmanagement", "127.0.0.1",
    "-Djboss.http.port=$WF_HTTP_PORT",
    "-Djboss.management.http.port=$WF_MGMT_PORT"
)

if ($Background) {
    Write-Host "Starting in background window..." -ForegroundColor Cyan
    Start-Process -FilePath $WF_START `
                  -ArgumentList $startArgs `
                  -WorkingDirectory $WF_HOME `
                  -WindowStyle Normal
    Write-Host "[OK] WildFly launched. Check the new window for startup logs." -ForegroundColor Green
    Write-Host "     Stop it with: .\scripts\stop.ps1"
}
else {
    Write-Host "Running in foreground. Press Ctrl+C to stop." -ForegroundColor DarkGray
    Write-Host ""
    & $WF_START @startArgs
}
