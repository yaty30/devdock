<#
.SYNOPSIS
    Gracefully shuts down the running WildFly instance via the CLI.
.DESCRIPTION
    Connects to the management port and issues the :shutdown command.
    WildFly allows local unauthenticated CLI connections from the same machine
    (silent-auth token file). If you disabled that, supply -User / -Password.
.PARAMETER User
    Management username (only needed if local auth is disabled).
.PARAMETER Password
    Management password (only needed if local auth is disabled).
.EXAMPLE
    .\scripts\stop.ps1
    .\scripts\stop.ps1 -User admin -Password s3cr3t
#>
param(
    [string]$User     = "",
    [string]$Password = ""
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\..\wildfly.config.ps1"

if (-not (Test-Path $WF_CLI)) {
    Write-Host "[FAIL] WildFly CLI not found at: $WF_CLI" -ForegroundColor Red
    Write-Host "       Run .\scripts\setup.ps1 first." -ForegroundColor Yellow
    exit 1
}

Write-Host "Stopping WildFly on management port $WF_MGMT_PORT ..." -ForegroundColor Cyan

$cliArgs = @(
    "--connect",
    "--controller=127.0.0.1:$WF_MGMT_PORT",
    "--command=:shutdown"
)

if ($User -and $Password) {
    $cliArgs += "--user=$User"
    $cliArgs += "--password=$Password"
}

& $WF_CLI @cliArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Shutdown command sent successfully." -ForegroundColor Green
}
else {
    Write-Host "[WARN] jboss-cli exited with code $LASTEXITCODE." -ForegroundColor Yellow
    Write-Host "       WildFly may already be stopped, or the management port is unreachable."
}
