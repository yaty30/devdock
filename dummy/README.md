# Dummy IVS Services

This directory contains local dummy services for testing the IVS Dashboard without a real project checkout or WildFly installation.

## Services

- Frontend: `http://localhost:5174`
- WildFly app: `http://localhost:8080/iap`
- WildFly health: `http://localhost:8080/health`
- WildFly management: `http://localhost:9990/management`

## Run

From this directory:

```powershell
npm start
```

Run services separately:

```powershell
npm run start:frontend
npm run start:wildfly
```

No dependency install is required. The servers use Node.js built-in modules only.

## Dashboard Settings

Use these values in the dashboard service settings:

- Frontend Directory: this repo's `dummy\frontend`
- Frontend Command: `npm run dev`
- WildFly Bin Directory: this repo's `dummy\wildfly\bin`
- WildFly Start Command: `start-rvdiap.bat`
- Admin Console URL: `http://localhost:9990/management`
- KMU URL: `http://localhost:8080/iap`

The frontend defaults to port `5174` so it can run beside this dashboard's Vite renderer on `5173`. Set `PORT` before starting it if you need a different port.
