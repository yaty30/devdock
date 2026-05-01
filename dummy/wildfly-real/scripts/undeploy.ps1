<#
.SYNOPSIS
    Removes a deployed application from the running WildFly instance.
.DESCRIPTION
    Uses jboss-cli to undeploy the named application.
    Use -KeepContent to undeploy without removing the deployment content
    from the repository (useful for re-deploying later without re-uploading).
.PARAMETER AppName
    The deployment name, e.g. "iap.war". Required.
.PARAMETER KeepContent
    Undeploy without deleting the content from the server content repository.
.PARAMETER User
    Management username (only needed if local auth is disabled).
.PARAMETER Password
    Management password (only needed if local auth is disabled).
.EXAMPLE
    .\scripts\undeploy.ps1 -AppName iap.war
    .\scripts\undeploy.ps1 -AppName iap.war -KeepContent
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$AppName,

    [switch]$KeepContent,

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

Write-Host "Undeploying $AppName ..." -ForegroundColor Cyan

$undeployCmd = "undeploy $AppName"
if ($KeepContent) { $undeployCmd += " --keep-content" }

$cliArgs = @(
    "--connect",
    "--controller=127.0.0.1:$WF_MGMT_PORT",
    "--command=$undeployCmd"
)

if ($User -and $Password) {
    $cliArgs += "--user=$User"
    $cliArgs += "--password=$Password"
}

& $WF_CLI @cliArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] $AppName undeployed." -ForegroundColor Green
}
else {
    Write-Host "[FAIL] Undeploy failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    exit $LASTEXITCODE
}
