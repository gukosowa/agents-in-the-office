## Codebase Patterns
- `soundStore.ts` is in `src/stores/` and uses Pinia defineStore with composition API style
- `PackInfo` has both legacy `categories: Record<string, string[]>` (folder-based) and `manifest: PackManifest` (new)
- Two-layer volume/enabled resolution: `effectiveVolume(packName, filename, manifestSound?)` and `isEnabled(packName, filename, manifestSound?)` — both are already in soundStore
- Files in new manifest-based packs live at pack root (`soundPacksDir/packName/filename`), not in category subdirectories
- `exists` from `@tauri-apps/plugin-fs` is already imported in soundStore for file existence checks
- Type check via `bun run build` (runs `vue-tsc -b && vite build`)

---

## 2026-03-04 - US-003
- Updated `playForEvent` to use manifest-based lookup instead of folder-based categories
- Now reads `packInfo.manifest.assignments.filter(a => a.event === event.type)` to get assigned files
- Builds `manifestSoundMap` from `packInfo.manifest.sounds` for volume/enabled defaults
- Filters enabled files using `isEnabled(packName, filename, manifestSoundMap.get(filename))`
- Resolves volume using `effectiveVolume(packName, chosenFile, manifestSound)`
- File path changed from `soundPacksDir/packName/category/file` to `soundPacksDir/packName/file`
- Added `exists()` check before loading — skips with `console.warn` if file not on disk
- **Files changed:** `src/stores/soundStore.ts`
- **Learnings for future iterations:**
  - The old `categories` field on PackInfo is still populated by scanPacks but is no longer used in playback — it remains for legacy/UI purposes
  - Session pack assignment on `session_start` is still inline in `playForEvent` (separate from `assignSessionPack` which handles preferred packs from Character)
  - `getTrackConfig` / `setTrackConfig` still exist for backward compat but playForEvent no longer uses them
---

## 2026-03-04 - US-004
- Replaced old category accordion panel with two-column patchbay layout (Sounds + Events)
- Left column shows "Sounds" header with empty body (US-005 will populate)
- Right column shows all 16 AgentEventType rows; dimmed (`opacity-40`) when no assignments, full opacity when assigned
- Removed dead code: `sortedCategories`, `categoryAllEnabled`, `toggleCategoryEnabled`, `toggleCategory`, `expandedCategories`, `addFilesToCategory`, `deleteTrack`, `getFilePath`, `AudioPlayer` import
- Kept `remove` and `copyFile` imports removed (will be re-added in US-005/US-009)
- `hasAssignments(eventType)` reads from `selectedPackInfo.manifest.assignments`
- Info popovers migrated from category-based to event-type-based (same pattern)
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - The prd.json lives in the main repo dir (`/agents-in-the-office/.chief/prds/`), NOT in the worktree — edit it there
  - `rightPanel` ref now wraps the entire two-column area (the `flex flex-1 min-h-0 overflow-hidden` div) — scroll reset via `rightPanel.scrollTop = 0` is preserved
  - The `confirmCreatePack` still creates old-style event subdirectories — US-010 will fix this to use manifest
---

## 2026-03-04 - US-005
- Implemented left column sound file list with inline preview
- Each sound row: play button (▶), filename, broken-link indicator (⚠ in red), volume slider (on hover), enabled toggle (checkbox), stop button (■ active when playing)
- `playPreview(filename)` uses soundStore.loadBuffer + getOrCreateAudioContext, stops any current source first (restarts from start)
- `stopPreview()` stops the AudioBufferSourceNode safely (try/catch for already-stopped)
- `checkSoundFileExistence(packName)` async parallel check using `exists()` from plugin-fs, results in `soundFileExists` Map
- `updateSoundVolume/updateSoundEnabled` mutate the manifest.sounds entry in place (reactive through Pinia ref), then call `savePackManifest`
- Hover state tracked with `hoveredSoundFile` ref; volume slider uses `v-show` for visibility
- `watch(selectedPack)` extended: stops preview, clears existence map, triggers new existence check, resets scroll
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - `AudioBufferSourceNode.stop()` can throw if already stopped — always wrap in try/catch
  - `soundFileExists.value` must be a `ref<Map<...>>` not a reactive Map for `v-if="soundFileExists.get(x) === false"` to be reactive
  - Mutating nested objects inside `packs.value[i].manifest.sounds[j]` IS reactive (Pinia wraps deeply)
  - `exists` must be imported from `@tauri-apps/plugin-fs` (already available in soundStore)
  - prd.json may have extra fields like `"inProgress": true` — clean them up when setting passes: true
---
