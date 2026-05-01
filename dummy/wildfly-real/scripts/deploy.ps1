<#
.SYNOPSIS
    Deploys a WAR file to the running WildFly instance via the CLI.
.DESCRIPTION
    Uses jboss-cli to deploy the specified WAR. If the application is already
    deployed, use -Force to overwrite it.
.PARAMETER WarPath
    Path to the .war file to deploy. Required.
.PARAMETER Force
    Overwrite an existing deployment with the same name.
.PARAMETER User
    Management username (only needed if local auth is disabled).
.PARAMETER Password
    Management password (only needed if local auth is disabled).
.EXAMPLE
    .\scripts\deploy.ps1 -WarPath ..\myapp\target\myapp.war
    .\scripts\deploy.ps1 -WarPath C:\builds\iap.war -Force
    .\scripts\deploy.ps1 -WarPath iap.war -User admin -Password s3cr3t
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$WarPath,

    [switch]$Force,

    [string]$User     = "",
    [string]$Password = ""
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\..\wildfly.config.ps1"

$resolvedWar = Resolve-Path -LiteralPath $WarPath -ErrorAction Stop

if (-not (Test-Path $WF_CLI)) {
    Write-Host "[FAIL] WildFly CLI not found at: $WF_CLI" -ForegroundColor Red
    Write-Host "       Run .\scripts\setup.ps1 first." -ForegroundColor Yellow
    exit 1
}

$warName = Split-Path $resolvedWar -Leaf
Write-Host "=== Deploying $warName ===" -ForegroundColor Cyan
Write-Host "  WAR     : $resolvedWar"
Write-Host "  Server  : http://localhost:$WF_HTTP_PORT"
Write-Host ""

$deployCmd = "deploy `"$resolvedWar`""
if ($Force) { $deployCmd += " --force" }

$cliArgs = @(
    "--connect",
    "--controller=127.0.0.1:$WF_MGMT_PORT",
    "--command=$deployCmd"
)

if ($User -and $Password) {
    $cliArgs += "--user=$User"
    $cliArgs += "--password=$Password"
}

& $WF_CLI @cliArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "[OK] $warName deployed successfully." -ForegroundColor Green
    Write-Host "     Access it at: http://localhost:$WF_HTTP_PORT/$($warName -replace '\.war$', '')"
}
else {
    Write-Host ""
    Write-Host "[FAIL] Deployment failed (exit code $LASTEXITCODE)." -ForegroundColor Red
    Write-Host "       Tip: If the app is already deployed, add the -Force flag." -ForegroundColor Yellow
    exit $LASTEXITCODE
}
