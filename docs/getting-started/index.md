# Getting started

Leyline is a local interface for a configured pi coding-agent environment. It
reads pi sessions and uses pi runtime operations to run work from a browser or
Electron window.

For a desktop app, follow [macOS installation](./installation#macos-desktop-release)
or [Linux installation](./linux-installation). The installed app includes its
backend and does not need a Vite server. Downloaded macOS builds need
[security approval](./installation#macos-security-warning) before first launch.

## Start the browser app

1. Install Node.js 22.19.0 and npm.
2. Run `npm install` in the Leyline repository.
3. Run `npm run dev`.
4. Open the Vite URL, usually `http://localhost:5173/`.
5. Select a project directory.
6. Enter a prompt and submit it.

Leyline creates the pi session and sends the first prompt in one operation.

Elune trace capture starts on for new runs. Traces stay on the selected backend and can contain private prompts and tool results. Open the sidebar **Trace explorer** button to inspect records or change **Capture new runs** in the footer. See [Tracing](../user-guide/tracing).

Continue with these pages:

- [Requirements](./requirements)
- [Installation](./installation)
- [Linux installation](./linux-installation)
- [First run](./first-run)
- [Browser vs Electron](./browser-vs-electron)
- [Composer](../user-guide/composer)
- [Sessions](../user-guide/sessions)
- [Tracing](../user-guide/tracing)
- [Terminal](../user-guide/terminal)
- [Troubleshooting](../reference/troubleshooting)
