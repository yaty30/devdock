<#
.SYNOPSIS
    Builds a WAR file from a Maven project.
.DESCRIPTION
    Runs "mvn clean package" in the specified project directory and prints
    the path to the resulting WAR file in target/.
.PARAMETER ProjectDir
    Path to the Maven project root (directory containing pom.xml). Required.
.PARAMETER SkipTests
    Pass -DskipTests to Maven to speed up the build.
.PARAMETER Goals
    Maven goals to run (default: "clean package").
.EXAMPLE
    .\scripts\build-war.ps1 -ProjectDir C:\repos\iap
    .\scripts\build-war.ps1 -ProjectDir ..\iap -SkipTests
    .\scripts\build-war.ps1 -ProjectDir ..\iap -Goals "clean install" -SkipTests
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectDir,

    [switch]$SkipTests,

    [string]$Goals = "clean package"
)

$ErrorActionPreference = 'Stop'

$projectPath = Resolve-Path -LiteralPath $ProjectDir -ErrorAction Stop

if (-not (Test-Path (Join-Path $projectPath "pom.xml"))) {
    Write-Host "[FAIL] No pom.xml found in: $projectPath" -ForegroundColor Red
    exit 1
}

Write-Host "=== Maven WAR Build ===" -ForegroundColor Cyan
Write-Host "  Project : $projectPath"
Write-Host "  Goals   : $Goals"
if ($SkipTests) { Write-Host "  Tests   : skipped" }
Write-Host ""

$mvnArgs = ($Goals -split '\s+')
if ($SkipTests) { $mvnArgs += "-DskipTests" }

Push-Location $projectPath
try {
    & mvn @mvnArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "[FAIL] Maven build failed with exit code $LASTEXITCODE." -ForegroundColor Red
        exit $LASTEXITCODE
    }
}
finally {
    Pop-Location
}

$warFile = Get-ChildItem -Path (Join-Path $projectPath "target") -Filter "*.war" -ErrorAction SilentlyContinue |
           Sort-Object LastWriteTime -Descending |
           Select-Object -First 1

Write-Host ""
if ($warFile) {
    Write-Host "[OK] Build succeeded." -ForegroundColor Green
    Write-Host "     WAR : $($warFile.FullName)"
    Write-Host ""
    Write-Host "Deploy it with:" -ForegroundColor Cyan
    Write-Host "  .\scripts\deploy.ps1 -WarPath `"$($warFile.FullName)`""
}
else {
    Write-Host "[WARN] Build succeeded but no .war found in target/." -ForegroundColor Yellow
    Write-Host "       Verify your pom.xml packaging is set to 'war'."
    exit 1
}
