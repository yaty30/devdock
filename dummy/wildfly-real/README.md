# Real WildFly Setup

Local WildFly 35 environment for WAR deployment and server management.

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Java JDK | 11 (17+ recommended) | https://adoptium.net |
| Maven | 3.8+ | `winget install Apache.Maven` |

Verify with:
```powershell
.\scripts\check-env.ps1
```

---

## First-time setup

### 1. Download WildFly

```powershell
.\scripts\setup.ps1
```

This downloads **WildFly 35.0.1.Final** from GitHub Releases and extracts it to
`server/wildfly-35.0.1.Final/`. That directory is gitignored — re-run this after
a fresh clone.

### 2. (Optional) Add a management user

Required for the **web Admin Console** (`http://localhost:9990/console`).  
Not required for CLI commands on localhost (silent-auth handles that).

```powershell
.\scripts\add-user.ps1
```

Follow the interactive prompts, choose type **[b] Management User**.

---

## Daily workflow

### Start the server

```powershell
# Foreground — logs stream in current terminal, Ctrl+C to stop
.\scripts\start.ps1

# Background — opens in a new window
.\scripts\start.ps1 -Background
```

### Check if it's running

```powershell
.\scripts\status.ps1
```

### Stop the server

```powershell
.\scripts\stop.ps1
```

---

## WAR deployment

### Deploy an existing WAR

```powershell
.\scripts\deploy.ps1 -WarPath C:\path\to\myapp.war

# Overwrite a previously deployed app
.\scripts\deploy.ps1 -WarPath C:\path\to\myapp.war -Force
```

### Undeploy

```powershell
.\scripts\undeploy.ps1 -AppName myapp.war
```

### Build a WAR with Maven (then deploy manually)

```powershell
.\scripts\build-war.ps1 -ProjectDir C:\repos\iap
.\scripts\build-war.ps1 -ProjectDir C:\repos\iap -SkipTests
```

### Build + deploy in one step

```powershell
.\scripts\build-deploy.ps1 -ProjectDir C:\repos\iap
.\scripts\build-deploy.ps1 -ProjectDir C:\repos\iap -SkipTests -Force
```

---

## Configuration

All ports, the WildFly version, and paths are defined in one place:

```
wildfly-real/wildfly.config.ps1
```

Edit that file to switch versions or change default ports. Every script
dot-sources it automatically.

| Setting | Default |
|---------|---------|
| `$WF_VERSION` | `35.0.1.Final` |
| `$WF_HTTP_PORT` | `8080` |
| `$WF_MGMT_PORT` | `9990` |
| `$WF_CONFIG` | `standalone.xml` |

To switch to a different WildFly version:
1. Edit `$WF_VERSION` in `wildfly.config.ps1`
2. Run `.\scripts\setup.ps1` again

---

## URLs

| Endpoint | URL |
|----------|-----|
| Application root | http://localhost:8080 |
| Admin Console | http://localhost:9990/console |
| Management API | http://localhost:9990/management |

---

## Directory layout

```
wildfly-real/
├── wildfly.config.ps1      ← shared config (version, ports)
├── scripts/
│   ├── check-env.ps1       ← verify Java + Maven
│   ├── setup.ps1           ← download WildFly
│   ├── add-user.ps1        ← create management user
│   ├── start.ps1           ← start standalone server
│   ├── stop.ps1            ← graceful shutdown via CLI
│   ├── status.ps1          ← check running state
│   ├── deploy.ps1          ← deploy a WAR
│   ├── undeploy.ps1        ← remove a deployment
│   ├── build-war.ps1       ← Maven build
│   └── build-deploy.ps1    ← Maven build + deploy
└── server/                 ← WildFly install (gitignored)
    └── wildfly-35.0.1.Final/
```
