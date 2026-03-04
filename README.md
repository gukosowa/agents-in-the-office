# Agents in the Office

A pixel-art office simulation where real AI agent sessions control NPC characters on an animated tile map. When you start an agent session, an NPC spawns and its behavior mirrors what the agent is actually doing — writing code sends it to a computer, reading files sends it to the bookshelf, idle turns trigger wandering. Subagents spawn as separate NPCs with badge overlays.

**Supported agents:** Claude Code, Gemini CLI. Codex CLI support is planned once [tool hook infrastructure](https://github.com/openai/codex/discussions/2150) lands upstream.

> Inspired by [pixel-agents](https://github.com/pablodelucca/pixel-agents) by pablodelucca — the initial idea and early draft that sparked this project.
> I struggled a bit with the editor, which became the foundation of this project. I also wanted it to be independent from VS Code.

<img width="49%" alt="screen" src="https://github.com/user-attachments/assets/1c87b0e9-a50d-4811-99fc-c39746ef6258" />
<img width="49%" alt="editor" src="https://github.com/user-attachments/assets/9b878148-4028-4c2d-be7f-f0466291da28" />

PS: The project is completely vibe coded

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

🤖 **Multi-agent support** — Claude Code and Gemini CLI. Codex CLI support is planned once [tool hook infrastructure](https://github.com/openai/codex/discussions/2150) lands upstream.

🎮 **Live agent visualization** — NPC behavior mirrors what the agent is doing in real time: writing code sends it to a computer, reading files to the bookshelf, idle triggers wandering and conversations with nearby NPCs.

🚨 **Approval alerts** — when an agent waits for user approval, the camera snaps to the NPC, a warning sign appears, and a red pulsing vignette draws your attention.

👥 **Subagent support** — subagents spawn as distinct NPCs with badge overlays; a line connects each subagent to its parent NPC. Transcripts are polled for live tool activity.

💬 **Prompt display** — each NPC shows the last user prompt above its head, making it easy to tell sessions apart when running multiple agents simultaneously.

⚡ **One-click agent setup** — a built-in setup dialog installs the hook script and merges it into each agent's settings file automatically. No manual config required.

🗺️ **Tile map editor** — RPG Maker–style controls: pencil, rectangle, bucket fill, multi-tile selection. Depth layers (below / y-sorted / above), collision placement, autotiles (including wall autotiles), layers, undo/redo.

🎨 **RPG Maker asset compatible** — load standard RPG Maker XP / VX Ace / MV tilesets, autotile sheets, and character sprites directly — no conversion needed.

🧑‍🎨 **Character editor** — configure sprite sheets per NPC: set animation regions, action regions, and a separate sprite for subagent NPCs.

🏢 **NPC world interaction** — tiles can be marked as objects (computer, plant, chair, …). NPCs pathfind to the appropriate object for each tool. On idle, NPCs wander and start conversations with each other.

🚪 **Agent doors** — NPCs enter through a configured door on spawn and exit through it when the session ends.

📦 **Shareable maps** — maps are saved as `.aito` files: all tile data, tilesets, and autotiles encoded as base64. Send one file to share a complete map.

📋 **Activity log** — floating panel showing a scrollable history of agent actions, persisted in IndexedDB across restarts.

🪟 **Compact window** — can be pinned and sized small, ideal for placing in a corner of a secondary monitor.

🌍 **i18n** — NPC speech bubbles in English and German.

🖥️ **macOS terminal focus** — clicking an NPC raises its terminal window via the Accessibility API.

---

## Installing a release

Download the latest `.dmg` from the Releases page, open it, and drag **Agents in the Office.app** to your `/Applications` folder.

Because the app is not code-signed, macOS Gatekeeper will block it on first launch. Run this once after installing to remove the quarantine flag:

```sh
xattr -dr com.apple.quarantine "/Applications/Agents in the Office.app"
```

Then double-click to open normally.

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

Bug reports and pull requests are welcome. I work on this from time to time, so responses may take a while — but I do read everything and will get back to you.

Before opening a PR:

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
