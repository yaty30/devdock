<#
.SYNOPSIS
    Runs WildFly's interactive add-user script to create a management user.
.DESCRIPTION
    A management user is required to access the Admin Console at
    http://localhost:9990/console and to use jboss-cli with credentials.
    WildFly's local silent-auth allows CLI access without a password when
    running on the same machine, but the web console always requires a user.
.EXAMPLE
    .\scripts\add-user.ps1
#>

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\..\wildfly.config.ps1"

if (-not (Test-Path $WF_ADD_USER)) {
    Write-Host "[FAIL] WildFly not found at: $WF_HOME" -ForegroundColor Red
    Write-Host "       Run .\scripts\setup.ps1 first." -ForegroundColor Yellow
    exit 1
}

Write-Host "=== Add WildFly Management User ===" -ForegroundColor Cyan
Write-Host "This launches WildFly's interactive user wizard."
Write-Host "Select type [b] (Management User) and follow the prompts."
Write-Host ""

& $WF_ADD_USER
