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

## 2026-03-04 - US-006
- Implemented event row sound chips in the right column of the patchbay
- Each event row shows chips for assigned sound files with truncated filenames (max 20 chars + ellipsis)
- Chip body click plays a preview (reuses existing `playPreview` function)
- Chip × button removes the `(file, event)` assignment from manifest and autosaves
- Live highlight: listens to `agent-event` Tauri events; matching event row flashes with `bg-indigo-600/30` for 200ms
- Event row layout changed from single flex row to stacked: header row + chips row below
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - `listen` from `@tauri-apps/api/event` can be used in any component, not just RunView — import + onUnmounted cleanup
  - The Tauri event payload for `agent-event` is a JSON string that needs `JSON.parse` → `AgentEvent`
  - `flashingEvent` ref + `setTimeout(200ms)` pattern works well for brief UI flash effects
  - Cleaned up `"inProgress": true` from prd.json when setting `passes: true`
---

## 2026-03-04 - US-007
- Implemented drag-and-drop from sound rows (left column) to event rows (right column)
- Sound rows are `draggable="true"` with `cursor-grab` and dim to `opacity-50` while being dragged
- Event rows accept drops via `@dragover`, `@dragleave`, `@drop` handlers
- During drag: all event rows become full opacity (visible as drop targets), hovered row gets `bg-indigo-500/20` highlight
- `addAssignment(file, eventType)` checks for duplicates before pushing to manifest and autosaving
- HTML5 Drag API: `effectAllowed: 'copy'`, `dropEffect: 'copy'`, `setData('text/plain', filename)` for native ghost
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - HTML5 drag ghost (default browser behavior) shows a translucent copy of the dragged element — no custom ghost needed for basic cases
  - `draggingSoundFile` ref tracks drag state; cleared in both `dragend` and `drop` handlers for safety
  - All event rows get `opacity-100` during drag via conditional class to override the dimmed state for unassigned events
  - `e.preventDefault()` in `dragover` is required to make an element a valid drop target
---

## 2026-03-04 - US-008
- Implemented chip-to-sound-row drag-and-drop for re-assigning events to different sounds
- Assignment chips are `draggable="true"` with `@dragstart.stop` (stop prevents parent event row from also starting a drag)
- `draggingChip` ref tracks `{ file, event }` during drag; `dragOverSoundFile` tracks hovered sound row
- Sound rows accept drops via `@dragover`, `@dragleave`, `@drop` handlers (only active when `draggingChip` is set)
- `onSoundRowDrop`: removes old `(originalFile, event)` assignment, adds `(newFile, event)` if not already present; autosaves
- Same-sound drop is silently ignored (`chip.file === newFile` early return)
- Visual feedback: sound rows get `bg-indigo-500/20` highlight during chip drag hover, all rows full opacity
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - Use `@dragstart.stop` on chips to prevent the parent event row div from also receiving the dragstart event
  - Two separate drag modes coexist: `draggingSoundFile` (sound→event) and `draggingChip` (chip→sound) — guard handlers with the appropriate ref check
  - `effectAllowed: 'move'` for chip drag vs `'copy'` for sound drag distinguishes intent visually in the browser
---

## 2026-03-04 - US-009
- Implemented OS file drag-and-drop onto the sounds column to add audio files to a pack
- Implemented "Add file" button in sounds column header that opens Tauri file picker (multiple selection, audio filter)
- Audio files (wav/mp3/ogg/flac/m4a/webm) are copied to pack directory root via `writeFile`
- New files added to `manifest.sounds` with defaults `{ volume: 1.0, enabled: true }`; duplicates skipped
- Non-audio files silently ignored (filtered by extension check)
- Drop overlay shows "Drop audio files here" on the sounds column during OS drag
- `e.stopPropagation()` on sounds column drop handlers prevents the outer dialog ZIP import handler from catching audio file drops
- `checkSoundFileExistence` called after adding files to refresh the existence map
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - OS file drops in WebView use `File.arrayBuffer()` to get bytes (same as ZIP import), then `writeFile` to copy to pack dir
  - `open({ multiple: true })` from `@tauri-apps/plugin-dialog` returns `string[] | null` for multi-select
  - Use `e.stopPropagation()` on inner drop zones to prevent outer drop handlers from also firing
  - Three drag modes now coexist: `draggingSoundFile` (sound→event), `draggingChip` (chip→sound), `audioDragOver` (OS→sounds column)
---

## 2026-03-04 - US-010
- Replaced old "type name first, then create" flow with immediate create + inline rename
- `startCreatePack()` generates unique name ("New Pack", "New Pack 2", etc.), creates dir, writes empty manifest.json, scans, selects, enters inline edit mode
- Inline edit: pack entry in sidebar shows `<input>` when `editingPackName` matches the pack name
- Enter/blur → `confirmEditPackName()`: renames directory on disk, updates activePacks + soundOverrides, rescans
- Escape → `cancelEditPackName()`: if `isNewPack`, deletes the directory and rescans
- Removed old `creatingPack`, `newPackName`, `newPackInput` refs and the input-above-buttons UI
- Added `rename` and `remove` imports from `@tauri-apps/plugin-fs`
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - `ref` on a `v-if` element inside a `v-for` loop resolves to the single visible instance when only one matches — works fine for inline edit
  - `@keydown.escape.prevent` is important to prevent Escape from bubbling to the dialog close handler
  - Rename logic mirrors PackContextMenu.confirmRename — keep them in sync if changing soundOverrides migration
  - Old `confirmCreatePack` was creating event subdirectories — new flow writes only manifest.json (correct for patchbay model)
---

## 2026-03-04 - US-011
- Updated `importZipBytes` to require manifest.json in ZIP; shows error toast if missing
- ZIP can have manifest at root or inside a single top-level folder (common ZIP structure) — `stripPrefix` handles both
- Audio files extracted flat to pack root (no subdirectories preserved)
- manifest.json written to pack directory before audio files
- Added `importError` ref + `showImportError()` with 5s auto-dismiss toast at top of dialog
- Non-manifest files in subdirectories are skipped (`effectivePath.includes('/')` guard)
- Cleaned up `importErrorTimeout` in `onUnmounted`
- **Files changed:** `src/components/SoundsDialog.vue`
- **Learnings for future iterations:**
  - JSZip `zip.file('path')` returns null if the file doesn't exist — use it to check for manifest presence
  - Common ZIP tools wrap files in a single top-level folder matching the ZIP filename — handle `stripPrefix` for that case
  - `showImportError` pattern with auto-dismiss timeout is reusable for other transient error messages in dialogs
---
