<#
.SYNOPSIS
    Checks that all required tools are present for running WildFly.
.DESCRIPTION
    Validates Java (JDK 11+), JAVA_HOME, Maven, and whether WildFly has
    already been downloaded by setup.ps1.
#>

. "$PSScriptRoot\..\wildfly.config.ps1"

$ok = $true

Write-Host "=== Environment Check ===" -ForegroundColor Cyan
Write-Host ""

# ── Java ──────────────────────────────────────────────────────────────────────
try {
    $javaOut = & java -version 2>&1
    $javaLine = ($javaOut | Select-String "version") -replace "`"", ""
    Write-Host "[OK]   Java  : $javaLine" -ForegroundColor Green
}
catch {
    Write-Host "[FAIL] Java not found." -ForegroundColor Red
    Write-Host "       Install JDK 11+ from https://adoptium.net" -ForegroundColor Yellow
    $ok = $false
}

# ── JAVA_HOME ─────────────────────────────────────────────────────────────────
if ($env:JAVA_HOME -and (Test-Path $env:JAVA_HOME)) {
    Write-Host "[OK]   JAVA_HOME: $($env:JAVA_HOME)" -ForegroundColor Green
}
elseif ($env:JAVA_HOME) {
    Write-Host "[WARN] JAVA_HOME is set but path does not exist: $($env:JAVA_HOME)" -ForegroundColor Yellow
}
else {
    Write-Host "[WARN] JAVA_HOME is not set — WildFly may fail to start." -ForegroundColor Yellow
    Write-Host "       Fix: [System.Environment]::SetEnvironmentVariable('JAVA_HOME','C:\path\to\jdk','User')" -ForegroundColor DarkGray
}

# ── Maven ─────────────────────────────────────────────────────────────────────
try {
    $mvnOut = & mvn -version 2>&1 | Select-Object -First 1
    Write-Host "[OK]   Maven : $mvnOut" -ForegroundColor Green
}
catch {
    Write-Host "[WARN] Maven not found." -ForegroundColor Yellow
    Write-Host "       Install: winget install Apache.Maven  OR  https://maven.apache.org/download" -ForegroundColor DarkGray
}

# ── WildFly installation ──────────────────────────────────────────────────────
if (Test-Path $WF_HOME) {
    Write-Host "[OK]   WildFly $WF_VERSION installed at:" -ForegroundColor Green
    Write-Host "         $WF_HOME" -ForegroundColor DarkGray
}
else {
    Write-Host "[INFO] WildFly $WF_VERSION not yet installed." -ForegroundColor Cyan
    Write-Host "       Run: .\scripts\setup.ps1" -ForegroundColor DarkGray
}

Write-Host ""
if ($ok) {
    Write-Host "All required tools found." -ForegroundColor Green
}
else {
    Write-Host "One or more required tools are missing. See above." -ForegroundColor Red
    exit 1
}
