<#
.SYNOPSIS
    Downloads and extracts WildFly into $WF_SERVER_DIR (default: C:\wildfly-server).
.DESCRIPTION
    Fetches the WildFly zip from GitHub Releases and extracts it to
    $WF_SERVER_DIR\wildfly-<version>\.  The install location is a short
    absolute path outside the project to avoid Windows 260-char MAX_PATH errors
    caused by WildFly's deep module tree.
    Configure the path in wildfly-real\wildfly.config.ps1.
.PARAMETER Version
    WildFly version to install. Defaults to the version in wildfly.config.ps1.
.EXAMPLE
    .\scripts\setup.ps1
    .\scripts\setup.ps1 -Version 36.0.0.Final
#>
param(
    [string]$Version
)

$ErrorActionPreference = 'Stop'

. "$PSScriptRoot\..\wildfly.config.ps1"

if (-not $Version) { $Version = $WF_VERSION }

$zipName     = "wildfly-$Version.zip"
$downloadUrl = "https://github.com/wildfly/wildfly/releases/download/$Version/$zipName"
# Use $WF_SERVER_DIR from wildfly.config.ps1 — must be a short path to avoid MAX_PATH issues
$extractTo   = (New-Item -ItemType Directory -Force -Path $WF_SERVER_DIR).FullName
$targetHome  = Join-Path $extractTo "wildfly-$Version"
$tempZip     = Join-Path $env:TEMP $zipName

Write-Host "=== WildFly $Version Setup ===" -ForegroundColor Cyan
Write-Host "Install directory : $extractTo"
Write-Host ""

# ── Already installed? ────────────────────────────────────────────────────────
if (Test-Path $targetHome) {
    Write-Host "[SKIP] WildFly $Version already installed at:" -ForegroundColor Yellow
    Write-Host "         $targetHome"
    Write-Host "       Delete that directory to force a reinstall."
    exit 0
}

# ── Download ──────────────────────────────────────────────────────────────────
Write-Host "Downloading $zipName ..." -ForegroundColor Cyan
Write-Host "  URL: $downloadUrl"
Write-Host ""

try {
    $ProgressPreference = 'SilentlyContinue'   # speeds up Invoke-WebRequest significantly
    Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip -UseBasicParsing
}
catch {
    Write-Host "[FAIL] Download failed: $_" -ForegroundColor Red
    Write-Host "       Check the version number or your internet connection." -ForegroundColor Yellow
    exit 1
}

# ── Extract ───────────────────────────────────────────────────────────────────
Write-Host "Extracting (this may take a moment) ..."
Expand-Archive -Path $tempZip -DestinationPath $extractTo -Force
Remove-Item $tempZip -ErrorAction SilentlyContinue

if (-not (Test-Path $targetHome)) {
    Write-Host "[FAIL] Extraction succeeded but expected directory not found:" -ForegroundColor Red
    Write-Host "         $targetHome"
    Write-Host "       The archive may use a different folder name."
    exit 1
}

Write-Host ""
Write-Host "[OK] WildFly $Version ready at:" -ForegroundColor Green
Write-Host "       $targetHome"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. (Optional) Add a management user: .\scripts\add-user.ps1"
Write-Host "  2. Start the server               : .\scripts\start.ps1"
Write-Host "  3. Deploy a WAR                   : .\scripts\deploy.ps1 -WarPath <path\to\app.war>"
