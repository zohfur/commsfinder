---
name: commsfinder-project-context
description: Brings in Commsfinder project layout and pipeline context for browser extension work. Use when changing scans, profile classification, deterministic tags, storage, popup search/results, manifests, webpack builds, tests, or extension data flow.
---

# Commsfinder Project Context

## Use This Skill

Use this skill before making or reviewing changes that touch:

- Profile scanning or `ARTIST_FOUND` handling.
- Deterministic profile tags, aliases, implications, or classification.
- Stored scan result shape, duplicate merging, or `platformData`.
- Popup result rendering, filters, Fuse search, favorites, or blacklist behavior.
- Browser extension manifests, webpack builds, or extension packaging.

## Start Here

1. Read the relevant file sections before editing; this project has long files with coupled UI and storage behavior.
2. Preserve the extension message flow: popup sends scan requests, content scripts emit profile data, `background.js` stores results, and `popup/popup.js` renders/searches stored results.
3. Keep scan-time work deterministic and local unless the task explicitly involves AI/model behavior.
4. When adding stored result fields, update duplicate merge paths and popup search/rendering together.
5. Run the smallest focused test/lint command that covers the touched pipeline.

## Key Files

- `manifest.json`: Chrome MV3 service worker manifest.
- `manifest.firefox.json`: Firefox MV3 background script manifest.
- `background.js`: scan orchestration, AI analysis requests, result storage, duplicate merging, profile tag classification.
- `content/furaffinity.js`, `content/bluesky.js`, `content/twitter.js`, `content/e621.js`: platform-specific scan/content logic.
- `popup/popup.js`: popup state, scan controls, filters, Fuse search, results rendering, settings.
- `popup/popup.css` and `popup/popup.html`: popup presentation.
- `utils/tag-classifier.js`: deterministic profile tag classifier.
- `utils/ai-analyzer.js`, `utils/model-manager.js`, `utils/ai-worker.js`: model-backed commission analysis.
- `tests/`: focused Jest tests.

## Pipeline Notes

- `SCAN_REQUEST` starts platform scans from the popup through `background.js`.
- Content scripts send `ARTIST_FOUND` messages with profile data.
- `handleArtistFound()` in `background.js` classifies/stores each profile and merges duplicates.
- Stored results live under `chrome.storage.local` key `scanResults`.
- Popup results are loaded, filtered, searched, sorted, and rendered in `popup/popup.js`.
- Tag search depends on stored fields like `profileTags`, `tagAliases`, and `tagSearchText`.

## Validation

- Use `npm test` or a focused Jest command for changed tests.
- Use focused ESLint on edited JavaScript files when possible.
- Use `npm run build:chrome` or `npm run build:firefox` for packaging-sensitive changes.
- If build failures mention missing benchmark modules, check whether those are pre-existing before treating them as caused by the current change.

## More Context

For concise architecture details and common edit checklist, see [REFERENCE.md](REFERENCE.md).
