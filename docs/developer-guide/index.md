# Developer guide

This section is for contributors who work on Leyline's Vue app, modular backend, Electron shell, pi runtimes, and bundled extensions.

Start with [local development](./local-development). Then read [architecture](./architecture), [frontend state](./frontend-state), and [backend API](./backend-api).

The current implementation includes concurrent runtimes, named backend
connections, runtime and Git review WebSocket updates, transcript projection, scoped memory,
rollout feedback, embedded Elune tracing, subagents, deep research, vision delegation, goals, HTML export, and a PTY WebSocket. Packaged Electron
windows share one native backend utility process and select their active backend
independently.

Use these references for implementation details:

- [Integrations](../integrations/) describes the pi SDK, goals, memory, subagents, deep research, vision delegation, and terminal.
- [Elune integration](../integrations/elune) describes capture, storage, lazy views, usage accounting, and shutdown.
- [Realtime events](./realtime-events) describes runtime and Git review WebSockets, reconnect behavior, and trace notices.
- [API reference](../reference/api) gives each HTTP and WebSocket contract.
- [Project layout](./project-layout) maps the repository modules.
