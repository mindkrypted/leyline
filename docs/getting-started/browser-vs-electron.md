# Browser vs Electron

The browser and Vite workflow is the primary development workflow. Electron is
an optional desktop shell around the same Vue app and API.

| Area | Browser and Vite | Electron |
| --- | --- | --- |
| App files | Vite dev server | Vite dev server or packaged `dist/` files |
| Native backend | `server/pi-api/index.js` as Vite middleware | Vite middleware or `server/leyline-server.js` in a packaged app |
| Environment | Inherits the environment that starts Vite | Loads the login-shell environment |
| Runtime and Git review events | Separate WebSocket connections to the selected backend | Same WebSocket connections |
| Terminal | Separate WebSocket connection to the selected backend | Separate WebSocket connection to the selected backend |
| Tracing | Embedded Elune storage and views on the selected backend | Same trace views, with the library and worker included in the package |
| Windows | Browser-managed tabs and windows | Foreground native windows with saved state |
| Dictation | Browser speech recognition by default; optional local models run on the Leyline server | Optional local models run on this device |

Use the browser for normal development and visual changes. Use Electron to test
packaging, desktop shortcuts, shell environment loading, multiple windows, and
saved window state.

Browser speech recognition is the default in a normal web browser. Its
availability and processing depend on the browser. Electron uses local models
on this device and does not offer browser speech recognition. Local models are
also available in a browser. Browser audio for local models goes to the Leyline
server that serves the app, independent of the selected agent backend. See
[Dictation](../user-guide/dictation) for setup and processing details.

## Open another window

Command-click an internal session, project, **New session**, or backend target.
Use Ctrl-click on other platforms or middle-click with a mouse.

Electron opens a foreground Leyline window. The browser build uses the browser's
normal tab or window behavior. The source window does not change. External
links continue to use the browser.

## Backend selection

The native backend is the server that supplied the current app. In browser
development, Vite owns it. A packaged Electron app starts one native backend.
By default, it uses an ephemeral loopback port. Server environment variables
can change the host and port.

Both paths support **Settings → Connections → Allow network access**. **Proxy port** accepts a fixed port or a blank value for automatic selection. Select **Apply** to save a port change. These controls take effect immediately without changing the origin or active agents. Changing the port or disabling sharing disconnects remote clients. See [Network access](../user-guide/settings#share-the-native-backend) for sharing URLs and the full-access warning.

Leyline stores named connections and the configured default for the full app.
Each window selects its active backend independently. A fresh window uses the
default. A new Electron window inherits the source window's active backend
unless the selected target specifies a backend.

Runtime HTTP commands, runtime and Git review WebSockets, terminal traffic, trace
requests, and exports use the active backend. Traces and capture settings remain on that
backend, without aggregation across connections. See [Tracing](../user-guide/tracing).
Connection management stays on the native backend. The native backend remains
available when a window selects another connection.

Both frontend and backend must use API v2. Runtime and Git review events require
WebSockets, with no SSE fallback. See [Realtime events](../developer-guide/realtime-events).
