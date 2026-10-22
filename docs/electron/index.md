# Electron

Electron is the optional desktop path for Leyline. It uses the same Vue app and
pi API as the browser workflow.

Electron adds these functions:

- Foreground native windows for modified internal targets
- Desktop shortcuts
- A packaged native backend available to all app windows
- Login-shell environment loading on macOS and Linux
- Saved window size, position, maximized state, and full-screen state
- Independent backend selection in each window
- The `leyline` command after local publication

[Elune tracing](../user-guide/tracing) uses the same inspector, workspace, and
explorer as the browser app. The package includes the library and SQLite worker.
No separate Elune server is needed. Traces stay on the selected backend.

Electron supports local speech models. Speech runs on this device. See the
[dictation guide](../user-guide/dictation) to set up a model.

See [Development](./development), [Packaging](./packaging),
[Environment](./environment), and [Windows and state](./window-state).
