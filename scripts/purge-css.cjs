// Runner for PurgeCSS (the CLI mishandles absolute config paths on Windows).
// Usage:
//   node scripts/purge-css.cjs            → writes trimmed CSS to popup/popup.css
//   node scripts/purge-css.cjs --out DIR  → writes to DIR/popup.css (for diffing)

const fs = require('fs');
const path = require('path');
const { PurgeCSS } = require('purgecss');
const config = require('../purgecss.config.cjs');

(async () => {
  const outIdx = process.argv.indexOf('--out');
  const outFile = outIdx !== -1
    ? path.join(process.argv[outIdx + 1], 'popup.css')
    : path.resolve(__dirname, '..', 'popup', 'popup.css');

  const result = await new PurgeCSS().purge(config);
  const purged = result.find((r) => r.file && r.file.endsWith('popup.css')) || result[0];

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, purged.css);
  console.log(`Wrote ${outFile} (${purged.css.split('\n').length} lines)`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
