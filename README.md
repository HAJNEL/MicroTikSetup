# HikCentral Site Setup (Electron)

Electron desktop rewrite of the original `MicroTikSetup` .NET console app. Replicates every
feature: new-site MikroTik provisioning wizard, the tracked sites list/editor, WiFi rename,
VPN-recovery watchdog, one-shot tunnel recovery, remote-support hardening, and this computer's
IP assignment helper — all driven over SSH against the router, following the steps in the
"HikCentral Remote Site Setup Guide".

## Architecture

- **Main process** (`electron/`): all SSH/network/filesystem work.
  - `services/MikroTikClient.ts` — SSH wrapper (`ssh2`), replaces `MikroTikClient.cs`.
  - `services/SiteRepository.ts` — CSV-backed site storage, replaces `SiteCsvRepository.cs`. Stored at your OS's per-user app-data folder (`app.getPath('userData')/sites.csv`) instead of next to the executable.
  - `services/ConnectionWatchdog.ts` — RouterOS scheduler script builder, replaces `ConnectionWatchdog.cs`.
  - `services/NetworkHelper.ts` — default-gateway detection + adapter listing + elevated `netsh` calls (UAC), replaces `NetworkHelper.cs` / the netsh calls in `IpAssignmentWorkflow.cs`.
  - `ipc/*.ts` — one file per IPC domain (sites, network, setup, recover, watchdog, remoteSupport, wifi), each a 1:1 port of the matching `*Workflow.cs`.
- **Preload** (`electron/preload.ts`): the only bridge — exposes `window.api.*` via `contextBridge`. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Renderer** (`src/`): React + TypeScript. `pages/SitesPage.tsx` + `SiteDetail.tsx` replace the console's site list/manage menu; `pages/NewSiteWizard.tsx` replaces `SetupWorkflow.cs`'s interactive flow (step checklist, plan summary, mid-flow "change your laptop IP now" confirmation); `pages/WifiPage.tsx` replaces `WifiWorkflow.cs`; `components/LogConsole.tsx` streams live command output from main via a `workflow:log` IPC event, replacing `Console.WriteLine`.

Long-running SSH workflows run entirely in the main process and stream each line of progress to
the renderer as they happen, so the UI behaves like the console app's live scrolling output.

## Prerequisites

- Node.js 18+ and npm
- Windows (the app targets `netsh`/UAC for IP assignment, same as the original; SSH workflows themselves are cross-platform)

## Running in development

```bash
npm install
npm run dev
```

This starts Vite's dev server and launches Electron with hot-reload for both renderer and main process changes.

## Building a Windows installer

```bash
npm install
npm run dist:win
```

Output goes to `release/` (an NSIS installer `.exe`). `npm run build` alone just compiles/bundles
without packaging, if you want to sanity-check the build first.

## Moving this into your existing project folder / GitHub repo

This was built in an isolated environment, so it doesn't have access to your machine or your
GitHub repo directly. To get it into
`C:\Users\hajne\OneDrive\Documents\Projects\MicroTikSetup_New\MicroTikSetup`:

1. Extract this archive's contents into that folder (or `git clone` your repo there first, then copy these files in, if you want it tracked from the start).
2. From that folder:
   ```bash
   npm install
   git add .
   git commit -m "Rewrite MicroTikSetup as an Electron app"
   git push
   ```
3. `npm run dev` to try it, `npm run dist:win` to produce an installer.

## Preloaded sites

`electron/seed-sites.csv` ships with the app and contains the 4 sites already configured on the
EC2 server (Riverland, Century City, Somerset West Hyper, Eikestad). On first launch, if no
`sites.csv` exists yet in the per-user app-data folder, it's copied from this seed file
automatically — so the site list isn't empty on a fresh install. After that first copy, the app
only ever reads/writes the app-data `sites.csv`; editing `electron/seed-sites.csv` later has no
effect on an install that's already run once. To reset to the seed list, close the app and delete
`sites.csv` from the app-data folder (Windows: `%APPDATA%\microtik-setup\sites.csv`, the folder
name matches the `name` field in `package.json`).

## Notes / deliberate differences from the console app

- **Where `sites.csv` lives**: per-user app data folder instead of next to the `.exe`, since Electron apps shouldn't write inside their own install directory. Same CSV format/columns, so you can copy an existing `sites.csv` over if you have one.
- **Mid-flow confirmation**: the original console app paused live mid-SSH-session to ask "have you changed your laptop's IP yet?" before changing the bridge IP. Since a single Electron IPC call can't pause for a UI prompt mid-stream, the wizard asks this confirmation *before* starting the SSH run instead of partway through it — functionally the same checkpoint, just relocated.
- **WiFi package detection**: ported from probing `/interface wifi print terse` for "no such command", same as the original.
