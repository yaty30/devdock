<div align="center">

<img src="src/renderer/src/assets/icon.png" width="96" alt="DevDock logo" />

# DevDock

**A desktop developer workspace for managing projects, databases, APIs, Git workflows, and everyday development tools in one place.**

Built with Electron, React, TypeScript, and Vite.

</div>

---

## Overview

DevDock is a cross-platform desktop application designed to bring common development workflows into a single workspace.

Instead of switching between terminals, database clients, API tools, notes, project dashboards, and various utilities, DevDock provides a unified interface for managing local development environments and developer tools.

Current version: **v1.1.10**

## Features

### Project Management

Create and manage development projects with support for:

* Optional frontend applications
* WildFly / Java backends
* Python backends

  * FastAPI
  * Flask API
  * Django REST
  * Custom servers
* Configurable start, build, install, and health-check commands
* Runtime service monitoring
* Project-level environment variables
* `.env` editing
* Build status and notifications
* Project notes

### Git & Terminal

Integrated project Git workflows including:

* Repository status
* Built-in terminal
* Single-repository projects
* Separate frontend/backend repositories
* Automatic Git repository detection
* Frontend/backend repository switching

### Database Workspace

Connect directly to:

* PostgreSQL
* MySQL
* Oracle

Database tools include:

* SQL editor powered by CodeMirror
* Object explorer
* Query execution
* Query history
* Result tables
* Result exporting
* Database monitoring
* Multiple saved connections
* PostgreSQL schema selection and search-path handling

### API Tester

Test HTTP APIs without leaving DevDock.

Includes support for:

* Request configuration
* Headers
* Request bodies
* Cookies
* Request history
* Saved requests
* Response inspection

### Developer Tools

DevDock also includes several standalone utilities:

* **Comparing** - Compare text and inspect differences
* **API Tester** - Build and execute HTTP requests
* **Cryptographic** - Encoding, hashing, and cryptographic utilities
* **Notebook** - Store development notes and snippets

### SSH

SSH and SFTP functionality exists within the project but is currently marked as **experimental and disabled** in the public application build.

## Tech Stack

| Area             | Technology              |
| ---------------- | ----------------------- |
| Desktop          | Electron                |
| Frontend         | React 18                |
| Language         | TypeScript              |
| State Management | Redux Toolkit           |
| Build Tool       | Vite / electron-vite    |
| Packaging        | Electron Forge          |
| SQL Editor       | CodeMirror 6            |
| Local Storage    | SQLite / better-sqlite3 |
| PostgreSQL       | `pg`                    |
| MySQL            | `mysql2`                |
| Oracle           | `oracledb`              |
| Terminal         | xterm.js / node-pty     |
| SSH              | ssh2                    |
| Testing          | Playwright              |
| Rich Text        | Tiptap                  |

## Getting Started

### Prerequisites

Install:

* Node.js
* npm
* Git

Some DevDock features use native Node modules, so your system may also require the appropriate native build tools.

### Clone the Repository

```bash
git clone https://github.com/yaty30/devdock.git
cd devdock
```

### Install Dependencies

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

## Available Scripts

```bash
# Start development mode
npm run dev

# TypeScript validation
npm run typecheck

# Build the application
npm run build

# Start a built version
npm run start

# Preview a build
npm run preview

# Run UI tests
npm run test:ui

# Package the Electron application
npm run package

# Create platform installers/packages
npm run make

# Rebuild native dependencies
npm run rebuild
```

## Building Distributables

DevDock uses Electron Forge for packaging.

```bash
npm run make
```

Configured build targets include:

| Platform | Output             |
| -------- | ------------------ |
| macOS    | ZIP                |
| Windows  | Squirrel installer |
| Linux    | `.deb`             |
| Linux    | `.rpm`             |

Because DevDock uses native dependencies such as `better-sqlite3`, `oracledb`, and `node-pty`, rebuilding native modules may occasionally be necessary:

```bash
npm run rebuild
```

## Project Structure

```text
devdock/
├── scripts/                    # Development/start helper scripts
├── src/
│   ├── main/                   # Electron main process
│   │   ├── dashboardBackend.ts
│   │   ├── chatService.ts
│   │   ├── sshService.ts
│   │   └── xtermService.ts
│   │
│   ├── preload/                # Electron preload / IPC bridge
│   │
│   ├── renderer/               # React renderer application
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       ├── features/
│   │       │   ├── chat/
│   │       │   ├── dashboard/
│   │       │   ├── databases/
│   │       │   ├── env/
│   │       │   ├── git/
│   │       │   ├── monitor/
│   │       │   ├── notes/
│   │       │   ├── projects/
│   │       │   ├── settings/
│   │       │   └── tools/
│   │       └── assets/
│   │
│   ├── shared/                 # Shared types and application logic
│   └── java/                   # Java/WebSocket integration resources
│
├── tests/
│   └── ui/                     # Playwright UI tests
│
├── updateNotes/                # Version release notes
├── electron.vite.config.ts
├── forge.config.js
└── package.json
```

## Architecture

DevDock follows Electron's multi-process architecture:

```text
┌───────────────────────────────┐
│          React UI             │
│       Renderer Process        │
└───────────────┬───────────────┘
                │
                │ IPC
                ▼
┌───────────────────────────────┐
│         Preload Layer         │
│      Controlled API Bridge    │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│      Electron Main Process    │
│                               │
│  Projects │ DB │ Git │ Shell  │
│  Builds   │ SSH│ Files │ APIs │
└───────────────────────────────┘
```

Application state in the renderer is progressively organized around Redux Toolkit, feature controllers, and shared typed models.

## Recent Changes

### v1.1.10

* Improved PostgreSQL database/schema handling
* Added separate database and default-schema configuration
* Added PostgreSQL search-path configuration
* Preserved compatibility with older PostgreSQL connections

### v1.1.8

* Added `.env` variable creation, editing, and deletion
* Added environment variable validation
* Preserved comments and quoting while modifying `.env` files
* Improved terminal and application lifecycle cleanup

### v1.1.7

* Added separate frontend/backend Git repository support
* Added automatic Git repository mode detection
* Added repository switching in the Git terminal
* Improved cross-platform Python virtual environment commands

Full release notes are available under [`updateNotes/`](updateNotes/).

## Testing

UI tests are written with Playwright.

```bash
npm run test:ui
```

The test suite currently covers areas including:

* API Tester
* SSH tooling
* Terminal commands
* SSH directory panels

## Development Status

DevDock is under active development.

Some features and internal APIs may change between releases. Experimental functionality, such as the built-in SSH workspace, may exist in the codebase while remaining disabled in production builds.

---

<div align="center">

Built by [yaty30](https://github.com/yaty30)

</div>
