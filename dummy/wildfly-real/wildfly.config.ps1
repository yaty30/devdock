# =============================================================================
# WildFly Shared Configuration
# Edit this file to change the WildFly version, ports, or install location.
# All scripts in scripts/ dot-source this file automatically.
# =============================================================================

$WF_VERSION    = "35.0.1.Final"
$WF_HTTP_PORT  = 8080
$WF_MGMT_PORT  = 9990
$WF_BIND       = "0.0.0.0"       # bind address for the app port (use 127.0.0.1 to restrict to localhost)
$WF_CONFIG     = "standalone.xml"

# Install directory — MUST be a short absolute path.
# WildFly's module tree is very deep; paths inside the project easily exceed
# Windows' 260-character MAX_PATH limit and Expand-Archive will fail.
# Default: C:\wildfly-server  (change freely, keep it short)
$WF_SERVER_DIR = "C:\wildfly-server"
$WF_HOME       = Join-Path $WF_SERVER_DIR "wildfly-$WF_VERSION"
$WF_BIN        = Join-Path $WF_HOME "bin"
$WF_CLI        = Join-Path $WF_BIN "jboss-cli.bat"
$WF_START      = Join-Path $WF_BIN "standalone.bat"
$WF_ADD_USER   = Join-Path $WF_BIN "add-user.bat"
