# AquaSDR on Hostinger VPS

## Visitor experience

A fresh tab opens a compact graphite welcome dialog. After the operator successfully enters hardware or demo mode, session storage remembers entry and the current workspace for that tab. Reload returns directly to that workspace and uses fresh bridge state, without replaying mode, connection or output-start commands. If browser storage is disabled, the welcome dialog appears again on reload. The actual payload model rotates, with a pause control, reduced-motion support and a reference-image fallback.

- **Connect AquaSDR payload:** on the local console, list USB serial ports, let the operator select one, and connect through the existing bridge. A port-open response is distinct from fresh firmware telemetry; the Hardware workspace reports both. Legacy hardware commands stay read-only; a separately targeted computed companion enables reference controls alongside live sensors. See [connected operation](CONNECTED_DEMO.md).
- **Continue with demo mode:** explicitly choose the existing C-backed simulation. Do not start transmitter output automatically. If the backend is unavailable, keep the dialog open and explain the failure.
- On a hosted origin, the connection path currently explains the limitation and links to the local console at `http://127.0.0.1:4318/`. The operator must already have started the local AquaSDR installation. This is a handoff to another page, not a cross-origin API connection.

Implemented here: welcome UI, local USB flow, demo selection, connection/error feedback. **Public multi-user hosting and direct browser USB are planned below, not implemented by the welcome dialog.**

## Hosting choice

The selected platform is **Hostinger VPS**. It allows control over system dependencies, which this application's native C helper requires. Hostinger also offers managed Node hosting on eligible plans, but merely uploading `dist/` does not supply this project's API, WebSocket or C simulation process.

Reference: [Hostinger Node.js hosting options](https://www.hostinger.com/support/node-js-hosting-options-at-hostinger/).

## Target architecture

```text
Visitor browser ── HTTPS ── Nginx ── static dashboard + GLB model
                └─ WSS/API ────── Node session service
                                   └─ C engine + acoustic worker per demo session

Hardware option A (next milestone):
Visitor browser ── Web Serial ── visitor's USB payload
                └─ applied configuration ── session-scoped C reference service

Hardware option B (available local workflow):
Visitor opens local console ── local Node bridge ── visitor's USB payload
```

The VPS cannot enumerate USB ports plugged into a visitor's laptop. Web Serial can provide that browser-to-device transport, with an explicit device chooser and supported browser. It is not yet part of this application. Feature detection, disconnect recovery and secure-context behavior must be implemented and tested before describing hosted USB as available.

Reference: [Chrome Web Serial documentation](https://developer.chrome.com/docs/capabilities/serial).

## Work required before public launch

1. **Isolate visitor sessions.** The existing bridge has one global mode, serial connection, recording collection and native helper. Refactor these into bounded, expiring sessions. Route HTTP requests, WebSocket broadcasts, commands, ownership and recordings to the correct session. Two visitors must never change each other's environment or read each other's recordings.
2. **Keep local hardware private.** Do not publish `/api/ports`, `/api/connect` or a network tunnel to a bench device. Separate hosted demo APIs from the local bridge. Keep firmware capability negotiation, explicit start, keepalive lease, ACK tracking and faults when adding Web Serial.
3. **Add hosting configuration.** Retain Node binding to loopback; put Nginx in front for HTTPS and WebSocket upgrade. Replace the current hard-coded localhost Host/Origin allowlist with explicit deployment origins for the hosted service. Do not simply remove the guard. Use session cookies, request-origin checks and per-session access checks for mutation/recording routes.
4. **Provision runtime.** Install a supported Node runtime, package dependencies and a C compiler/build tools on the VPS. Run `npm ci`, `npm test`, `npm run build`, then verify the native helper on the target Linux host. Compilation currently uses `CC` or `cc`; a failed helper must remain visibly unavailable.
5. **Operate the service.** Use an unprivileged service account and a systemd service with a writable `AQUASDR_DATA_DIR`; bind to loopback port 4318 behind Nginx. Add session limits, idle expiry, storage quotas, health checks, log rotation and process restart handling. Size concurrency after measuring native/worker CPU and memory per active session.
6. **Deploy a staging domain first.** Point DNS to the VPS, provision TLS, serve model/font/assets with correct paths and proxy `/api` and `/ws/telemetry`. Test before switching the public domain. Keep a prior release for rollback.

No VPS credentials, DNS changes, package purchases or deployment were requested or performed by this change.

## Launch acceptance

- Fresh tabs show the welcome dialog; keyboard focus stays within it. Reload after successful entry restores the workspace without sending commands. A failed connection does not mark entry complete.
- Model rotates, pause works, reduced-motion is respected and WebGL failure has a usable fallback.
- Demo choice enters an isolated simulation; absent native C engine produces an explicit unavailable state.
- Two browser sessions can apply different environments and record independently.
- Local hardware flow handles no ports, port busy, unplug, legacy packets and fresh command-capable firmware without false success.
- Hosted hardware flow either uses verified Web Serial or clearly hands off to the installed local console.
- HTTPS, WebSocket reconnect, session expiry, recordings and bounded resource use pass on the VPS.
- No automatic output start, environment replay or modeled-as-measured values occur.

Physical DAC/ADC and scope acceptance remain separate from web hosting.
