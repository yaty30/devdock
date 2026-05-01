<#
.SYNOPSIS
    Builds a WAR with Maven and immediately deploys it to WildFly.
.DESCRIPTION
    Combines build-war.ps1 and deploy.ps1 into one step.
    WildFly must already be running before you call this script.
.PARAMETER ProjectDir
    Path to the Maven project root (directory containing pom.xml). Required.
.PARAMETER SkipTests
    Pass -DskipTests to Maven.
.PARAMETER Force
    Overwrite an existing deployment with the same name on WildFly.
.PARAMETER Goals
    Maven goals (default: "clean package").
.PARAMETER User
    WildFly management username (only needed if local auth is disabled).
.PARAMETER Password
    WildFly management password (only needed if local auth is disabled).
.EXAMPLE
    .\scripts\build-deploy.ps1 -ProjectDir C:\repos\iap
    .\scripts\build-deploy.ps1 -ProjectDir ..\iap -SkipTests -Force
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectDir,

    [switch]$SkipTests,
    [switch]$Force,

    [string]$Goals    = "clean package",
    [string]$User     = "",
    [string]$Password = ""
)

$ErrorActionPreference = 'Stop'

# ── Build ─────────────────────────────────────────────────────────────────────
$buildArgs = @{ ProjectDir = $ProjectDir; Goals = $Goals }
if ($SkipTests) { $buildArgs['SkipTests'] = $true }

& "$PSScriptRoot\build-war.ps1" @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# ── Find the WAR ──────────────────────────────────────────────────────────────
$projectPath = Resolve-Path -LiteralPath $ProjectDir
$warFile = Get-ChildItem -Path (Join-Path $projectPath "target") -Filter "*.war" |
           Sort-Object LastWriteTime -Descending |
           Select-Object -First 1

if (-not $warFile) {
    Write-Host "[FAIL] No WAR file found after build. Cannot deploy." -ForegroundColor Red
    exit 1
}

# ── Deploy ────────────────────────────────────────────────────────────────────
Write-Host ""
$deployArgs = @{ WarPath = $warFile.FullName }
if ($Force)    { $deployArgs['Force']    = $true }
if ($User)     { $deployArgs['User']     = $User }
if ($Password) { $deployArgs['Password'] = $Password }

& "$PSScriptRoot\deploy.ps1" @deployArgs
exit $LASTEXITCODE
