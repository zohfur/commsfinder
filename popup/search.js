// Search and tag utilities for the popup.
// Provides fuzzy search, token parsing, e621 tag expansion, and autocomplete helpers.
// These are pure utility functions — no DOM access, no class state.

/**
 * Normalize a tag term for consistent comparison.
 * @param {string} value
 * @returns {string}
 */
export function normalizeTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape special regex characters in a string.
 * @param {string} value
 * @returns {string}
 */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escape HTML entities to prevent XSS.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Parse a search query string into tokens.
 * Supports: +include, -exclude, ~fuzzy, tag, wildcards (goo*), filters (score:>30), order:score.
 * @param {string} query
 * @returns {{ tokens: Array<{type: string, value: string, raw: string}>, order: string|null }}
 */
export function parseSearchQuery(query) {
  const tokens = [];
  let order = null;
  const regex = /([+-~])?"([^"]+)"|([+-~])?([^\s"]+)/g;
  let match;

  while ((match = regex.exec(query)) !== null) {
    const raw = match[0];
    const quotedModifier = match[1];
    const quotedValue = match[2];
    const unquotedModifier = match[3];
    const unquotedValue = match[4];

    let modifier = quotedModifier || unquotedModifier || '';
    let value = quotedValue ?? unquotedValue ?? '';

    // Handle filter: and order: metatags
    if (!modifier) {
      const colonIdx = value.indexOf(':');
      if (colonIdx > 0) {
        const metaKey = value.substring(0, colonIdx);
        const metaVal = value.substring(colonIdx + 1);
        if (metaKey === 'order') {
          order = metaVal;
          continue;
        }
        if (metaKey === 'score') {
          tokens.push({ type: 'score', value: metaVal, raw });
          continue;
        }
      }
    }

    if (!value) continue;

    let type = 'include';
    if (modifier === '+') type = 'include';
    else if (modifier === '-') type = 'exclude';
    else if (modifier === '~') type = 'fuzzy';

    tokens.push({ type, value, raw });
  }

  return { tokens, order };
}

/**
 * Generate searchable text for an artist result (username, displayName, tags, bio, etc.).
 * @param {object} result
 * @returns {string}
 */
export function getSearchTextForResult(result) {
  const parts = [
    result.username || '',
    result.displayName || '',
    result.bio || '',
    result.tagSearchText || '',
    ...(result.tagAliases || []),
    ...(result.profileTags || []).map(t => `${t.tag} ${t.label}`),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

/**
 * Parse e621 tag aliases from JSON data.
 * Returns a Map of alias → canonical tag.
 */
export function parseE621Aliases(aliasesJson) {
  const map = new Map();
  if (!aliasesJson) return map;
  for (const [alias, canonical] of Object.entries(aliasesJson)) {
    if (alias && canonical) {
      map.set(normalizeTerm(alias), normalizeTerm(canonical));
    }
  }
  return map;
}

/**
 * LOCAL_E621_TAG_SUGGESTIONS — a small curated set for autocomplete suggestions.
 * Full e621 tag dictionary is loaded lazily from chrome.storage or the bundled JSON.
 */
export const LOCAL_TAG_SUGGESTIONS = [
  'anthro',
  'digital_art',
  'goo',
  'hypnosis',
  'painting',
  'traditional_art',
  'transformation',
  'werewolf',
];
