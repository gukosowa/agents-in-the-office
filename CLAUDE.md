# agents-in-the-office

Pixel-art office simulation where real AI agent sessions control NPC characters.

## Stack

- **Frontend:** Vue 3 + TypeScript + Vite 7 + Pinia + TailwindCSS 4
- **Backend:** Tauri 2 (Rust) — file watcher via `notify` crate, `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-window-state`
- **Package manager:** bun (use `bun install`, `bun run <script>` — not npm/npx)
- **Rust edition:** 2024

## Dev commands

```sh
bun run tauri dev    # start Tauri dev app (Vite + Rust)
bun run build        # frontend-only build (vue-tsc + vite)
bun run tauri build  # release build with installer
vue-tsc -b           # type-check frontend
cargo clippy --all-targets --all-features -- -D warnings  # lint Rust
```

## Architecture

**Event pipeline:** Claude Code hooks write JSON to `~/.agents-in-the-office/events/` → Tauri Rust watcher picks up files, emits `agent-event` Tauri events, deletes files → `RunView.vue` listens → `AgentStore` routes to driver → driver issues `NpcHandle` commands → `Character` executes.

**Subagent pipeline:** Parent receives `subagent_start` event → `AgentStore.spawnSubagent()` derives session ID + transcript path → Rust `start_transcript_poll` reads JSONL transcript → extracts tool_use/tool_result → emits synthetic events → subagent NPC spawns with badge.

**Event persistence:** Every event is persisted to IndexedDB (`events` store). On session reconnect, `replayActivityLog()` rebuilds the activity panel from stored events. Old events (>24h) are pruned on app mount.

Key source locations:

- `src/drivers/` — agent driver system:
  - `types.ts` — `NpcCommand`, `AgentEvent`, `AgentEventType`, `AgentType`, `NpcHandle`, `ActivityMessage`, `SubagentInfo`
  - `AgentDriver.ts` — `AgentDriver` interface + `BaseDriver` abstract class (tool→object mapping)
  - `ClaudeCodeDriver.ts` — Claude Code–specific driver (MCP-aware routing, permission wait, subagent handling)
  - `agentStore.ts` — Pinia store for session lifecycle (spawn/despawn/reconnect, stale cleanup, activity log, subagent management). `handleEvent()` returns `Promise<HandleEventResult[]>` — one event can yield multiple results (e.g., parent update + subagent spawn)
  - `npcHandle.ts` — `createNpcHandle()` factory wrapping `Character` into `NpcHandle` interface
  - `activityMessages.ts` — formats `AgentEvent` into `ActivityMessage` for the activity panel (supports prefix for subagent messages)
  - `agentBubbleTexts.ts` — localized NPC speech/thought bubble texts per tool (en/de, 20+ variants each)
- `src/classes/Character.ts` — NPC entity: states (idle/walking/interacting/conversing/exited), sprite animation, A* pathfinding, command queue, autonomous + external control modes, conversation system, optional `badge` overlay
- `src/utils/` — `pathfinding.ts` (A*), `db.ts` (IndexedDB — map persistence + event persistence with `persistEvent`, `getSessionEvents`, `pruneSessionEvents`, `pruneOldEvents`), `fileIO.ts` (.aito file format), `spriteLoader.ts`, `fill.ts`, `rmxpAutoTile.ts`, `vxAutoTile.ts`
- `src/views/RunView.vue` — game loop, agent event listener, camera, NPC spawning/despawning, session restore, badge rendering
- `src/views/EditorView.vue` — tile map editor
- `src/components/AgentActivityPanel.vue` — floating panel showing agent session activity log
- `src/components/AgentSetupDialog.vue` — hook installation dialog (writes hook script + merges into `~/.claude/settings.json`; extracts `agentId` and `agentTranscriptPath` from subagent events)
- `src/i18n/bubbleTexts.ts` — autonomous NPC bubble texts (en/de)
- `src/stores/mapStore.ts` — map state (tile layers, objects, spawn points, collision grid, tileset pool)
- `src-tauri/src/watcher.rs` — file watcher (`notify` crate, `~/.agents-in-the-office/events/`)
- `src-tauri/src/transcript.rs` — JSONL transcript poller for subagents (background thread per subagent, extracts tool_use/tool_result from assistant/user messages, skips Task tool to avoid recursion)
- `src-tauri/src/lib.rs` — Tauri setup, registers `set_executable`, `focus_terminal_window`, `start_transcript_poll`, `stop_transcript_poll` commands; manages `TranscriptPollers` state; stops all pollers on window destroy
- `src-tauri/src/macos_focus.rs` — macOS Accessibility API for raising terminal windows

## Implementation status

Two PRDs fully implemented:
- **agent-drivers** (US-001–US-010): core event pipeline, driver system, NPC control, activity panel, hook setup
- **make-subagent-into** (US-001–US-011): event persistence (IndexedDB), JSONL transcript polling (Rust), subagent NPC spawning with visual distinction, activity log replay on reconnect, cleanup on exit/stale

## Known pitfalls

- **WebKit blob URLs are unreliable in Tauri's WKWebView.** `URL.createObjectURL()` fails intermittently with "WebKitBlobResource error 1". Use `FileReader.readAsDataURL()` instead for loading images from blobs (tileset pool, autotile pool). Data URLs bypass WebKit's blob resource loader entirely.

## Conventions

- Rust: follow global clippy lints from `~/.claude/CLAUDE.md`; use `eprintln!` for errors (no `println!`)
- TypeScript: strict mode, ESM only, no relative `..` imports
- Vue: `<script setup>` SFCs, Composition API only
- i18n: English and German, locale strings live in `src/i18n/` and `src/drivers/agentBubbleTexts.ts`
- Do not add autonomous NPC behavior changes when implementing driver features — keep the two paths fully separate via `controlMode`
