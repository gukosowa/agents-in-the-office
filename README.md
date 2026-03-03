# Agents in the Office

A pixel-art office simulation where real AI agent sessions control NPC characters on an animated tile map. When you start an agent session, an NPC spawns and its behavior mirrors what the agent is actually doing — writing code sends it to a computer, reading files sends it to the bookshelf, idle turns trigger wandering. Subagents spawn as separate NPCs with badge overlays.

**Supported agents:** Claude Code, Gemini CLI. Codex CLI support is planned once [tool hook infrastructure](https://github.com/openai/codex/discussions/2150) lands upstream.

> Inspired by [pixel-agents](https://github.com/pablodelucca/pixel-agents) by pablodelucca — the initial idea and early draft that sparked this project.

---

## How it works

```
Claude Code hooks
    └─► ~/.agents-in-the-office/events/*.json
            └─► Tauri Rust file watcher (notify crate)
                    └─► Tauri event: "agent-event"
                            └─► AgentStore (Pinia)
                                    ├─► ClaudeCodeDriver → NpcHandle → Character
                                    └─► Subagent lifecycle
                                            └─► Rust JSONL transcript poller
                                                    └─► Synthetic tool events → Subagent NPC
```

Claude Code lifecycle hooks write JSON event files to disk. A Rust file watcher picks them up, emits typed Tauri events, and deletes the files. The Vue frontend routes each event to the matching agent driver, which issues movement and animation commands to the NPC character.

Agent events are persisted to IndexedDB so activity logs survive app restarts and reconnects. Map files (tilesets, autotiles, layout) are saved as `.aito` files on disk.

---

## Features

- **Live agent visualization** — NPC behavior reflects what the AI agent is doing in real time
- **Subagent support** — Task sub-agents spawn as distinct NPCs with badge overlays; transcript is polled for tool activity
- **Tile map editor** — draw and save your own office layouts using tilesets and autotiles
- **RPG Maker asset compatible** — load standard RPG Maker XP / VX / MV tilesets, autotile sheets, and character sprites directly (no conversion needed)
- **Activity log** — floating panel shows a scrollable history of agent actions; events persisted in IndexedDB, survive restarts
- **i18n** — NPC speech bubbles in English and German
- **macOS terminal focus** — clicking an NPC raises its terminal window via the Accessibility API

---

## Prerequisites

- [Bun](https://bun.sh/) (`curl -fsSL https://bun.sh/install | bash`)
- [Rust (stable)](https://rustup.rs/)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform
  - macOS: Xcode Command Line Tools (`xcode-select --install`)

---

## Getting started

```sh
# Install JS dependencies
bun install

# Start the dev app (compiles Rust, starts Vite, opens the window)
bun run tauri dev
```

### Connect your agents

1. Open the app and switch to **Editor** mode
2. Click **Setup Agents** in the toolbar → **Add Hooks**
3. Switch to **Run** mode
4. Start a Claude Code or Gemini CLI session — an NPC will spawn through the agent door

The hook script maps agent lifecycle events to JSON files in `~/.agents-in-the-office/events/`. Each file is consumed by the watcher within milliseconds.

---

## Using your own assets

The tile map editor supports loading tilesets, autotile sheets, and character sprites from local image files. RPG Maker assets work out of the box:

- **Tilesets** — RPG Maker XP (A1–E), VX Ace, MZ tile sheets
- **Autotiles** — XP-style (3×4 per tile) and VX/MV-style (2×3 per tile) autotile engines are built in
- **Characters** — standard RPG Maker character sheets (3×4 poses per character, 4 characters per row)

No external tools or conversion steps required — load the PNG, pick the tile dimensions, and paint.

---

## Building a release

```sh
# Full release build with bundled installer
bun run tauri build
```

Output goes to `src-tauri/target/release/bundle/`. On macOS this produces a `.dmg` and `.app`.

To build only the frontend (no Tauri):

```sh
bun run build
```

---

## Event reference

| Event | Trigger | NPC behavior |
|-------|---------|--------------|
| `session_start` | Claude Code session begins | NPC spawns, enters through agent door |
| `session_end` | Session ends | NPC walks to door and exits |
| `tool_start` | Tool invoked (Bash, Read, Edit, …) | NPC walks to matching object |
| `tool_end` | Tool finishes | Bubble clears |
| `prompt_submit` | User sends a prompt | NPC shows thought bubble |
| `turn_end` | Agent turn completes | NPC wanders |
| `permission_wait` | Waiting for user approval | NPC shows waiting indicator |
| `subagent_start` | Sub-agent spawned | Subagent NPC spawns with badge; transcript poller starts |
| `subagent_end` | Sub-agent finished | Subagent NPC exits; poller stops |

Each event file has the shape:

```json
{
  "sessionId": "abc123",
  "timestamp": 1700000000000,
  "type": "tool_start",
  "agentType": "claude_code",
  "payload": { "toolName": "Bash" }
}
```

---

## Project structure

```
src/
  drivers/               # Agent driver system
    types.ts             # NpcCommand, AgentEvent, NpcHandle, SubagentInfo
    AgentDriver.ts       # BaseDriver abstract class (tool → object mapping)
    ClaudeCodeDriver.ts  # Claude Code–specific driver
    agentStore.ts        # Session lifecycle, subagent management, event persistence
    npcHandle.ts         # NpcHandle factory wrapping Character
    activityMessages.ts  # Formats events into activity panel messages
    agentBubbleTexts.ts  # Localized NPC speech/thought bubble texts (en/de)
  classes/
    Character.ts         # NPC entity — states, pathfinding, command queue, sprites
  components/
    AgentActivityPanel.vue   # Floating activity log panel
    AgentSetupDialog.vue     # Hook installation dialog
    GridCanvas.vue           # Tile painting canvas
    TileSelector.vue         # Tileset picker
  views/
    EditorView.vue       # Tile map editor
    RunView.vue          # Game loop, agent event listener, session restore
  i18n/
    bubbleTexts.ts       # Autonomous NPC bubble texts (en/de)
  stores/
    mapStore.ts          # Map state — layers, objects, spawn points, collision
  utils/
    pathfinding.ts       # A* pathfinding
    db.ts                # IndexedDB — map + event persistence
    fileIO.ts            # .aito save/load format
    rmxpAutoTile.ts      # RMXP-style autotile engine
    vxAutoTile.ts        # VX Ace/MV-style autotile engine
src-tauri/src/
    lib.rs               # Tauri setup, command registration
    watcher.rs           # File watcher: ~/.agents-in-the-office/events/
    transcript.rs        # JSONL transcript poller for subagent tool extraction
    macos_focus.rs       # macOS Accessibility API — raise terminal windows
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vue 3 + TypeScript + Vite 7 + Pinia + TailwindCSS 4 |
| Desktop shell | Tauri 2 (Rust, edition 2024) |
| File watching | `notify` crate |
| Persistence | IndexedDB (`idb`) for events + autotile library; `.aito` files for maps |
| Package manager | Bun |

---

## Contributing

Bug reports and pull requests are welcome. Before opening a PR:

```sh
vue-tsc -b                                                        # type-check frontend
cargo clippy --all-targets --all-features -- -D warnings          # lint Rust
```

Keep changes focused — one logical change per PR.

---

## Credits

- **Character sprites** — [MetroCity Free Top-Down Character Pack](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) by jik-a-4 on itch.io
- **Original concept & early draft** — [pixel-agents](https://github.com/pablodelucca/pixel-agents) by pablodelucca
- **RPG Maker** — Autotile and tileset format compatibility built around RPG Maker XP / VX Ace / MV/MZ asset conventions. RPG Maker assets are not bundled; you can use your own licensed copies.

---

## License

MIT
