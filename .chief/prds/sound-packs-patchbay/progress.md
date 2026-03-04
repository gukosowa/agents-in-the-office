## Codebase Patterns
- soundStore uses Pinia with `defineStore('sound', () => {...})` composition API pattern
- Tauri FS: use `exists()`, `readTextFile()`, `writeTextFile()`, `readDir()`, `readFile()` from `@tauri-apps/plugin-fs`
- Return object from store must explicitly list all functions to export them (no auto-export)
- `bun run build` runs `vue-tsc -b && vite build` — use this to verify types
- SoundsDialog is in `src/components/SoundsDialog.vue`, soundStore in `src/stores/soundStore.ts`
- AgentEventType is a union type in `src/drivers/types.ts` — 16 values

---

## 2026-03-04 - US-001
- What was implemented: Added `PackManifest` interface (sounds[], assignments[]), `PackManifestSound`, `PackManifestAssignment` interfaces. Updated `PackInfo` to include `manifest: PackManifest` and `hasManifest: boolean`. Added `loadPackManifest(packName)` and `savePackManifest(packName, manifest)` functions. Updated `scanPacks()` to read manifest.json per pack.
- Files changed: `src/stores/soundStore.ts`
- **Learnings for future iterations:**
  - The existing scanPacks() scans subdirectories as "categories" (old format). New manifest format is flat — files in pack root + manifest.json. Both coexist.
  - `hasManifest` boolean on PackInfo distinguishes old-style packs from new manifest packs (needed for US-012 migration indicator)
  - TypeScript strict mode: functions declared inside store closure but not returned cause "declared but value never read" errors — always add to return object
---
