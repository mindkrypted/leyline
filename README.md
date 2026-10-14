# <img src="assets/icon.png" width="96" height="96" alt="Leyline icon" align="center"> Leyline

Leyline is a web UI for pi coding-agent sessions. It uses Vue 3 and Vite for
the frontend. Its native backend uses the pi SDK for sessions, prompts, model
controls, runtime events, and the embedded terminal. You can also save named
connections to other Leyline backends.

## Screenshots

<table>
  <tr>
    <td width="50%"><a href="assets/readme/home.png"><img alt="Leyline start screen with project, research, and runtime controls" src="assets/readme/home.png" /></a><br /><strong>Start screen</strong></td>
    <td width="50%"><a href="assets/readme/workbench.png"><img alt="Leyline workbench with a sanitized agent session" src="assets/readme/workbench.png" /></a><br /><strong>Workbench</strong></td>
  </tr>
  <tr>
    <td><a href="assets/readme/deep-research.png"><img alt="Leyline deep research report with phase progress and cited sources" src="assets/readme/deep-research.png" /></a><br /><strong>Deep research</strong></td>
    <td><a href="assets/readme/tracing.png"><img alt="Leyline tracing workspace with a run timeline and selected observation details" src="assets/readme/tracing.png" /></a><br /><strong>Tracing workspace</strong></td>
  </tr>
</table>

See [Tracing](docs/user-guide/tracing.md) for recorded runs and capture controls.

## Documentation

- [Getting started](docs/getting-started/index.md)
- [Linux installation](docs/getting-started/linux-installation.md)
- [Sessions](docs/user-guide/sessions.md)
- [Composer](docs/user-guide/composer.md)
- [Deep research](docs/user-guide/deep-research.md)
- [Git review](docs/user-guide/git-review.md)
- [Images and vision](docs/user-guide/images-and-previews.md)
- [Memory](docs/user-guide/memory.md)
- [Subagents](docs/user-guide/subagents.md)
- [Settings, providers, and MCP](docs/user-guide/settings.md)
- [Tracing](docs/user-guide/tracing.md)
- [Elune integration](docs/integrations/elune.md)
- [Goals and events](docs/user-guide/goals-and-events.md)
- [Terminal](docs/user-guide/terminal.md)
- [Electron](docs/electron/index.md)
- [Commands](docs/reference/commands.md)
- [Troubleshooting](docs/reference/troubleshooting.md)

## Features

You can browse and run pi sessions in one workspace. You can pin sessions to keep them at the top of a project list. You can search across
projects with **Go to** and monitor work through **Activity**. You can read
live transcripts, use steering or **Up next** tasks, and examine tools, System
changes, and local files. Pi's native MCP integration supplies configured
tools, and extension confirmation cards let you accept or cancel requests.

Model controls include the optional `ultrafast` chip for supported OpenAI
Responses models. It is off by default. OpenAI charges more for `ultrafast`. See
[Runtime controls](docs/user-guide/runtime-controls.md#use-ultrafast).
Memory, subagents, HTML export, and an embedded terminal help you complete
session work.
Each window can use the native backend or a saved backend connection.

Embedded Elune tracing records new runs by default. **Session traces** opens the
selected session's inspector. **Open workspace** shows its timeline, and the
**Trace explorer** button in the sidebar shows all projects on the selected
backend. Capture controls are in the trace footer.

Traces can contain private prompts and tool results. Leyline keeps existing
traces if you stop capture, delete a session, or reset the history. See
[Tracing](docs/user-guide/tracing.md).

Settings includes provider sign-in, custom endpoints, model definitions and
overrides, and MCP server configuration. Select a configuration from the
backend catalog. Examine the fields to use. Adjust the model limits, thinking
maps, and developer-role compatibility.

Provider costs are different from connection settings. Changes use pi's files
on the selected backend. See
[Model settings](docs/user-guide/settings.md#find-a-configuration-in-the-catalog).
Project and session details hold their own agent overrides.

Deep research sessions divide a question into parallel, source-backed threads.
You can examine the plan and the worker sessions. Leyline validates numbered
report citations. Each citation opens a source preview. The research ledger
keeps records for sources that Leyline cited, used, or excluded.

On desktop, Git Review updates its header summary when the pane is closed.
Git Review prepares the selected diff before you open the pane. Git Review
separates staged and working-tree changes. Git Review can expand across the
workspace.

When the parent model cannot receive images, Leyline can send each attachment
to a configured vision model in a hidden child session. The parent model
receives the descriptions while the transcript keeps the original images.

Read [Motivations](docs/motivations.md) for more information about the project.

## Requirements

- macOS or Linux (see the tested setup below)
- Node.js 22.19.0, as specified in `.nvmrc`
- npm and Git, with GitHub access during dependency installation
- A configured pi coding-agent environment

Leyline operates on macOS and Linux. The Linux reference setup is x86-64
Omarchy (Arch-based). The setup runs Hyprland on Wayland. Leyline did not
validate other Linux distributions or architectures. Do not use Leyline on
Windows.

For a Linux desktop app and CLI that installs for one user, follow the
[Linux installation guide](docs/getting-started/linux-installation.md).

## Setup

```sh
npm install
```

This installs `@elune/embedded` from GitHub through the `spmurrayzzz/elune`
dependency. A sibling Elune checkout, an npm publication, and a standalone Go
server are not necessary.

## Development

```sh
npm run dev
```

Open the Vite URL that the terminal shows. The usual URL is:

```txt
http://localhost:5173/
```

The Vite server also serves the documentation at
`http://localhost:5173/docs/`. To run only the documentation server, use
`npm run docs:dev`.

## Backend connections

The sidebar footer shows the backend for the current window. Open **Settings →
Connections**. You can add, test, edit, remove, or select a named connection
there. The **Native backend** is the server that supplied the current Leyline
app.

Saved connections and the configured default are app-wide. Each browser or
Electron window keeps its active connection independently. A new window uses
the default. A new Electron window inherits the source window's active
connection.

Leyline sends runtime HTTP commands, runtime events, terminal WebSocket traffic,
trace requests, and exports to the active backend. Leyline does not combine
traces or capture settings across connections. Traces and capture settings stay
on the active backend. Connection management stays on the native backend. See
[Settings](docs/user-guide/settings.md) for
connection setup and [Environment variables](docs/reference/environment.md) for
packaged server and origin settings.

## Optional Electron app

The browser and Vite workflow is the primary development path. Leyline can also
run as a local Electron desktop app.

For Electron development, start Vite in one terminal:

```sh
npm run dev
```

Then launch Electron in another terminal:

```sh
npm run electron:dev
```

Run this command to build a packaged desktop app:

```sh
npm run electron:build
```

The build writes the packaged app to `release/`. The build creates the Vite
`dist/` output and then packages Electron. The build unpacks the native
terminal files that `node-pty` needs and the embedded Elune library and SQLite
worker. The packaged backend runs in an Electron utility process. Rebuild and
restart the packaged app after dependency or backend updates.

On Linux, follow the [Linux installation guide](docs/getting-started/linux-installation.md)
to install `release/Leyline-linux-x64/`, a launcher, and an application-menu entry.
The repository's `bin/leyline` and `local-publish` script are still macOS-only.

On Apple silicon macOS, run this command to install the packaged app and
expose `leyline`:

```sh
npm run local-publish
```

This command puts `Leyline.app` in `/Applications/`. The command also links the
CLI to `~/.local/bin/leyline`. Make sure that `~/.local/bin` is on your `PATH`.

```sh
cd /path/to/project
leyline
```

The CLI opens or focuses Leyline and creates a session for the current shell
directory. Use `leyline -n` to open a new window at the home workspace. The
command does not create a session.

## Electron shortcuts (macOS)

- `Command+N`: create a session in the current session CWD
- `Command+Shift+N`: open Home in a new window. This does not create a session
- `Command+W`: close the current window
- `Command+E`: show or hide the sidebar
- `Command+,`: open global Settings
- `Command+Shift+E`: show or hide Session details
- `Command+Shift+M`: show or hide Memory
- `Command+Shift+T`: show or hide the terminal
- `Escape`: close open surfaces first. If no surface is open, stop the active run

When focus is in the terminal, Escape stays in the shell unless another surface
is open.

## Useful commands

```sh
npm run build
npm run preview
npm run docs:dev
npm run docs:build
npm run docs:screenshots
npm run electron:dev
npm run electron:build
npm run local-publish # Apple silicon macOS only
npm run screenshot
npm run video
```

The capture commands require the Vite development server. `npm run screenshot` writes a
live local capture to `screenshots/current.png`. `npm run docs:screenshots`
refreshes sanitized tracked images with intercepted fixture data.
