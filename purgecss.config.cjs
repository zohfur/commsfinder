// PurgeCSS config for the popup stylesheet.
//
// IMPORTANT: popup.css is consumed only by popup/popup.html and the popup JS.
// Many class names are built at runtime (template literals, classList, setAttribute),
// so PurgeCSS's static content scan cannot see them. Every such family MUST be
// safelisted below or its rules get stripped — that is what broke the header dither
// backdrop and the scan-source progress fill (flicker) previously.
//
// Run:  npm run purge:css   (regenerates popup/popup.css in place)

module.exports = {
  // All files that reference popup.css classes. Missing any of these causes
  // over-removal of perfectly-used static classes.
  content: [
    'popup/popup.html',
    'popup/popup.js',
    'popup/dither.js',
    'popup/results.js',
    'popup/search.js',
    'popup/state.js',
  ],

  css: ['popup/popup.css'],

  // Keep class tokens that contain digits/hyphens intact (default splits on them oddly).
  defaultExtractor: (content) => content.match(/[\w-]+(?<!:)/g) || [],

  safelist: {
    standard: [
      // --- Runtime-injected (dither.js) ---
      'dither-canvas',

      // --- Interpolated platform suffix: `platform-${platform}`, `scan-fill-${platform}` ---
      // e.g. platform-furaffinity, platform-bluesky, scan-fill-furaffinity ...
      /^platform-[a-z0-9]+$/,
      /^scan-fill/,

      // --- Interpolated status/state suffixes appended in template literals ---
      // gallery-item-status ${s}, profile-status-orb ${s}, profile-work-status ${s},
      // confidence-status ${s}, result-platform-badge ${s}, status-dot ${s}, notification ${type}
      /-status(-|$)/,
      /^status-dot/,
      /^notification/,
      /^confidence/,
      /^profile-status/,
      /^profile-work-status/,
      /^gallery-item-status/,
      /^result-platform-badge/,

      // --- Commission-status / type words used as standalone interpolated tokens ---
      'open', 'closed', 'unclear',
      'scanning', 'error', 'complete', 'idle',
      'success', 'info', 'warning',
    ],

    // data-status attribute selectors ([data-status="error"] etc.) — values are set
    // dynamically via setAttribute('data-status', status).
    greedy: [
      /data-status/,
      /^scan-fill-/,
    ],
  },
};
