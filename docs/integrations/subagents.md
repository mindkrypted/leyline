# Subagent integration

Leyline bundles `.pi/extensions/subagent/index.ts`. The extension registers the `subagent` tool and sends child work to the local Leyline server.

## Agent definitions

Leyline reads Markdown definitions from:

- `~/.pi/agent/agents/` for user definitions
- the nearest `.pi/agents/` directory above the current working directory for project definitions

Each file must have YAML frontmatter with `name` and `description`. It can also set `model`, `thinking`, and a comma-separated `tools` list. The Markdown body supplies the child instructions.

A project definition replaces a user definition with the same name. Resource discovery and session start refresh the definition list.

Deep research adds a reserved bundled `researcher` after normal discovery. This definition cannot be replaced by a user or project file.

The reserved researcher receives all tools discovered by its child runtime except `write` and `edit`. Its prompt prohibits file changes, including changes through `bash`. It returns a structured thread summary and source list for the research extension. See [Deep research integration](./deep-research).

## Execution modes

The `subagent` tool supports these modes:

- `single` runs one agent for one task.
- `parallel` runs tasks concurrently in batches of the configured size.
- `chain` runs tasks in order and replaces `{previous}` with the prior result.

Parallel and chain items can set their own model, thinking level, and working directory. An item setting takes priority over the top-level tool setting.

## Batch scheduling and configuration

The extension groups multiple top-level `single` calls from one assistant message into one implicit group. Calls run in message order, in waves. Each wave waits for all calls in the preceding wave to finish. Each call keeps its original ID, progress, and result. Grouping does not rewrite the transcript or reject calls for retry.

Singles still form a group when explicit `parallel` or `chain` calls coexist. Each explicit parallel call has a separate batch schedule. Chains stay sequential. Nested tool calls do not enter the implicit group. Batch size is not a limit on total concurrent work across a session or backend.

The default size is 4. **Settings → Agent defaults → Subagents → Batch size** sets the selected backend's global default. **Session details → Subagents** supplies a session override. **Use global default** removes it. There is no project batch-size override. Values must be positive safe integers.

Each implicit group or explicit parallel call resolves its effective size once. Changes apply to future groups and calls without reload. Running groups keep their size.

The `leyline_settings` key `subagents.batch_size` stores the global value. The `subagent_batch_overrides` table stores session values in the same backend-local database as model overrides. Session identity uses a hash of the canonical path. For a missing file, path resolution uses its nearest existing ancestor, preserving identity through symlinked session directories.

Forks copy session batch overrides. Session deletion removes its batch override. Project deletion removes batch overrides for the deleted sessions.

## Required session titles

Every child requires a short, nonblank `title`, separate from its full `task`. Single mode uses a top-level `title`. Each item in `tasks` or `chain` requires its own `title`.

The extension checks all titles before it starts any child. A missing, empty, or whitespace-only title rejects the complete call. The backend also requires a nonblank title on each child request.

Titles remain in live progress and final results, including failures, cancellations, and tasks that did not start. The inspector and HTML export prefer this title. Older sessions retain their existing label fallbacks.

## Model and thinking selection

Leyline resolves models in this order:

1. The model on the tool call or task item
2. A session override
3. A project override
4. A global override
5. The model in the agent definition
6. The runtime default model

The value `inherit` selects the parent session model. A model value can be a model ID or `provider/model-id`.

Model overrides are stored in the `subagent_overrides` table in `~/.local/share/leyline/memory.sqlite`. A session fork copies its session overrides to the new session.

Thinking selection uses the tool or item setting first, then the agent definition. The value `inherit` selects the parent thinking level. Leyline does not store thinking overrides in SQLite.

## Child runtime

The extension uses two internal integration routes:

1. `POST /api/pi/subagents/resolve` resolves batch size without `agentKey`, or model and thinking values with `agentKey`.
2. `POST /api/pi/subagent` creates and runs the child session.

The server creates a pi session with `parentSession` set to the parent session file. Before runtime startup, it saves the normalized title with `SessionManager.appendSessionInfo()`. The sidebar prefers this session name over task metadata.

The server also appends a `leyline-subagent-session` custom record. This marker identifies subagent children for sidebar nesting and distinguishes them from normal forks.

For older records without the marker, Leyline also finds child paths in parent `subagent` tool results. Identified children appear as [nested sidebar rows](../user-guide/sessions#open-a-subagent-session) under their parent. Each call stays in a compact Activity row. The subagent inspector provides an **Open child session** action for the selected task, and the child session links back to its parent.

Normal subagents load all six bundled extensions, inline Elune capture, and native MCP and tool search. The server applies the selected model, thinking level, and tool allowlist. It excludes nested `subagent` delegation and `codemode`. The agent definition body precedes the task text. Provider authentication must be available to the server process.

Children with an isolated custom system prompt retain output-budget and inline Elune capture. They have no active tools, context files, skills, MCP, tool search, or Leyline prompt. Vision children use this path. See [Runtime construction](../developer-guide/backend-api#runtime-construction).

Bundled requests include `parentSessionId` and `_toolCallId` for trace linkage. The child marker retains available parent trace and observation anchors. Proven committed child usage can reconcile parent totals after the tool result. Unknown attribution remains explicit. See [Elune integration](./elune#usage-and-child-accounting).

The child execution route waits for the child run to finish. If its caller disconnects before the response finishes, the server aborts the child run. Scheduling belongs to the extension. Direct execution requests do not use a backend batch limiter. See the [API reference](../reference/api#subagent-routes).

## Live child inspection

`useSubagentPreview.js` loads a flat, source-derived Action ledger for the selected child, whether saved or active. Rows open full entries in the same sheet. Message readers offer **Formatted**/**Source**, while tool readers offer **Output**/**Arguments**. **Copy full text** copies the selected format. The full task prompt opens another reader view. **Back to activity** restores the ledger scroll position and keeps the selected task.

The inspector reads only the selected child through `GET /api/pi/sessions/:id?compact=1&toolArguments=1&path=...`. While that child runs, it also opens a separate `WS /api/pi/events?sessionId=<child-id>` connection. These reads never activate the child or submit work. The parent session and its runtime subscription stay selected. `toolArguments=1` retains original projected tool text and arguments even with `compact=1`, without changing ordinary session payloads. Older records can lack output or arguments, and the reader does not reconstruct them.

Closing the inspector releases this observer without canceling the execution request. Previews retain the latest 80 projected assistant/tool entries before ledger block expansion. Full child history remains available through **Open child session**. HTML exports use matching ledger and reader styles for task messages and results already available in the parent result. They do not fetch or embed the full child transcript or subscribe to live updates.

See [Subagent inspector state](../developer-guide/frontend-state#subagent-inspector-state) for request ordering, reconnect recovery, reader identity, and scroll ownership.
