# Commsfinder Reference

## Repository Shape

Commsfinder is a browser extension for finding artists with open commissions across multiple platforms. The root files are extension entry points and build config; platform scanners live in `content/`; shared browser/model/tag helpers live in `utils/`; popup UI lives in `popup/`.

The Chrome manifest uses a module service worker:

- `manifest.json`
- `background.service_worker`: `background.js`
- `background.type`: `module`

The Firefox manifest uses background scripts:

- `manifest.firefox.json`
- `background.scripts`: `["background.js"]`

Keep both manifests in mind when adding web accessible resources, permissions, or new files loaded by extension pages.

## Scan And Storage Flow

The normal scan pipeline is:

1. `popup/popup.js` sends `SCAN_REQUEST` with selected platforms.
2. `background.js` starts or coordinates platform scans.
3. Content scripts collect profile data and emit `ARTIST_FOUND`.
4. `handleArtistFound()` in `background.js` prepares the stored profile result.
5. Results are stored in `chrome.storage.local` as `scanResults`.
6. The popup receives updates or reloads results with `GET_RESULTS`.

When changing stored profile fields, inspect these paths:

- Result creation in `handleArtistFound()`.
- Same-platform duplicate update logic.
- Cross-platform duplicate merge logic.
- `mergePlatformData()` and `mergeProfileTagData()`.
- Popup search data preparation in `initializeSearch()`.
- Result rendering in `createResultElement()`.

## Deterministic Tagging

The deterministic tagging path is intentionally no-AI:

- Main module: `utils/tag-classifier.js`.
- Entry point: `classifyProfileTags(profile)`.
- Integration point: `handleArtistFound()` in `background.js`.
- Popup search fields include canonical tags and aliases.

Classifier changes should keep these properties:

- No network calls in the hot scan path.
- Precompile regexes or indexes at module load time.
- Normalize aliases and source text consistently.
- Exclude common single words that cause false positives.
- Filter irrelevant e621 categories such as artist/copyright unless explicitly required.
- Expand implications only through allowed canonical tags.
- Include enough alias text for user search to find canonical tags.

Useful focused validation:

```bash
npx jest tests/tag-classifier.test.js --runInBand
npx eslint utils/tag-classifier.js background.js popup/popup.js tests/tag-classifier.test.js --quiet
```

## Popup Search And Rendering

`popup/popup.js` owns most UI behavior. Search is built with Fuse in `initializeSearch()`. When adding searchable data:

- Add a normalized/search-friendly field to the `searchData` object.
- Add that field to Fuse `keys` with a conservative weight.
- Preserve original result objects when mapping search results back for rendering.
- Invalidate `this.searchInstance` when result data changes.

Rendering happens in `createResultElement()`. Keep generated HTML escaped or sourced from trusted stored values where appropriate, and update CSS in `popup/popup.css` for any new chips/badges/states.

## AI Commission Analysis

AI/model code is separate from deterministic profile tagging:

- `utils/ai-analyzer.js`
- `utils/model-manager.js`
- `utils/ai-worker.js`
- `background.js` analyzer initialization and `analyze_text` / `analyze_components` handlers

Do not mix kink/media profile tagging into AI commission status detection unless the task explicitly asks for model behavior changes.

## Build And Test Commands

Package scripts from `package.json`:

```bash
npm test
npm run build
npm run build:chrome
npm run build:firefox
npm run build:both
npm run watch
```

Prefer focused commands while iterating, then run a broader build when touching manifests, webpack config, imports, or extension-loaded assets.

## Common Risks

- Updating a stored result shape without updating duplicate merge paths.
- Making search use transformed Fuse objects instead of original result objects.
- Adding scan-time network or model work that slows every profile.
- Changing Chrome-only manifest behavior without checking Firefox packaging.
- Treating pre-existing benchmark build failures as caused by unrelated edits.
