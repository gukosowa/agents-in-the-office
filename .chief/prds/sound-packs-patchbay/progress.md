## Codebase Patterns
- soundStore uses Pinia with `defineStore('sound', () => {...})` composition API pattern
- Tauri FS: use `exists()`, `readTextFile()`, `writeTextFile()`, `readDir()`, `readFile()` from `@tauri-apps/plugin-fs`
- Return object from store must explicitly list all functions to export them (no auto-export)
- `bun run build` runs `vue-tsc -b && vite build` — use this to verify types
- SoundsDialog is in `src/components/SoundsDialog.vue`, soundStore in `src/stores/soundStore.ts`
- AgentEventType is a union type in `src/drivers/types.ts` — 16 values
- `soundOverrides` uses flat key `"packName/filename"` — NOT nested by pack like the old `tracks` field
- When renaming a pack, iterate `soundOverrides` keys to move `oldName/file` → `newName/file`; when deleting, filter by `startsWith("packName/")`
- Vue components directly mutate `soundStore.config.*` reactively — grep all components when changing a config field
- TypeScript `@deprecated` JSDoc generates `ts(6385)` warnings — use plain comments to avoid zero-warnings policy violations

---

## 2026-03-04 - US-002
- What was implemented:
  - Added `soundOverrides: Record<string, { volume: number; enabled: boolean }>` to `SoundConfig` (key: `packName/filename`)
  - Made `tracks` optional in `SoundConfig` for backward-compat read; dropped from saves
  - Added `migrateTracksToSoundOverrides()`: converts `tracks[packName]["category/filename"]` → `soundOverrides["packName/filename"]`
  - Updated `init()` to migrate on load, then exclude `tracks` from in-memory config
  - Rewrote `getTrackConfig`/`setTrackConfig` to read/write `soundOverrides` (still accept legacy `category/filename` arg)
  - Added `effectiveVolume(packName, filename, manifestSound?)` and `isEnabled(packName, filename, manifestSound?)` two-layer helpers
  - Updated `PackContextMenu.vue`: rename migrates `soundOverrides` keys; delete removes all matching keys
  - Updated `SoundsDialog.vue`: delete track removes `soundOverrides[packName/filename]`
- Files changed:
  - `src/stores/soundStore.ts`
  - `src/components/PackContextMenu.vue`
  - `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - The old `tracks` field was nested `tracks[packName][categoryAndFile]`; new `soundOverrides` is flat `soundOverrides["packName/filename"]`
  - Multiple Vue components accessed `soundStore.config.tracks` directly — always grep for usages across all `.vue` files when changing a config field
---

## 2026-03-04 - US-001
- What was implemented: Added `PackManifest` interface (sounds[], assignments[]), `PackManifestSound`, `PackManifestAssignment` interfaces. Updated `PackInfo` to include `manifest: PackManifest` and `hasManifest: boolean`. Added `loadPackManifest(packName)` and `savePackManifest(packName, manifest)` functions. Updated `scanPacks()` to read manifest.json per pack.
- Files changed: `src/stores/soundStore.ts`
- **Learnings for future iterations:**
  - The existing scanPacks() scans subdirectories as "categories" (old format). New manifest format is flat — files in pack root + manifest.json. Both coexist.
  - `hasManifest` boolean on PackInfo distinguishes old-style packs from new manifest packs (needed for US-012 migration indicator)
  - TypeScript strict mode: functions declared inside store closure but not returned cause "declared but value never read" errors — always add to return object
---
