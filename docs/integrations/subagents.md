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
- `parallel` runs tasks concurrently in batches of four.
- `chain` runs tasks in order and replaces `{previous}` with the prior result.

Parallel and chain items can set their own model, thinking level, and working directory. An item setting takes priority over the top-level tool setting.

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

1. `POST /api/pi/subagents/resolve` resolves stored model overrides.
2. `POST /api/pi/subagent` creates and runs the child session.

The server creates a pi session with `parentSession` set to the parent session file. Before runtime startup, it saves the normalized title with `SessionManager.appendSessionInfo()`. The sidebar prefers this session name over task metadata.

The server also appends a `leyline-subagent-session` custom record. This marker identifies subagent children for sidebar nesting and distinguishes them from normal forks.

For older records without the marker, Leyline also finds child paths in parent `subagent` tool results. Identified children appear as [nested sidebar rows](../user-guide/sessions#open-a-subagent-session) under their parent. Each call stays in a compact Activity row. The subagent inspector provides an **Open child session** action for the selected task, and the child session links back to its parent.

Normal subagents load all six bundled extensions, inline Elune capture, and native MCP and tool search. The server applies the selected model, thinking level, and tool allowlist. It excludes nested `subagent` delegation and `codemode`. The agent definition body precedes the task text. Provider authentication must be available to the server process.

Children with an isolated custom system prompt retain output-budget and inline Elune capture. They have no active tools, context files, skills, MCP, tool search, or Leyline prompt. Vision children use this path. See [Runtime construction](../developer-guide/backend-api#runtime-construction).

Bundled requests include `parentSessionId` and `_toolCallId` for trace linkage. The child marker retains available parent trace and observation anchors. Proven committed child usage can reconcile parent totals after the tool result. Unknown attribution remains explicit. See [Elune integration](./elune#usage-and-child-accounting).

The child execution route waits for the child run to finish. If its caller disconnects before the response finishes, the server aborts the child run. See the [API reference](../reference/api#subagent-routes).

## Live child inspection

The inspector reads the selected child through `GET /api/pi/sessions/:id?compact=1&path=...` and a separate `WS /api/pi/events?sessionId=<child-id>` connection. These reads do not activate the child or submit work. The parent session and its runtime subscription stay selected.

Closing the inspector releases this observer without canceling the execution request. Live previews retain recent messages and tool output; the full transcript remains available through **Open child session**. HTML exports show recorded task results without a live connection.

See [Subagent inspector state](../developer-guide/frontend-state#subagent-inspector-state) for request ordering, reconnect recovery, and disclosure ownership.
