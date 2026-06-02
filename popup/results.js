// Results rendering helpers for the popup.
// Pure functions that build DOM elements from artist result data.
// In the future, CommissionsfinderPopup would delegate card creation to these.

/**
 * Format a confidence score for display.
 * @param {object} result
 * @returns {{ percent: number, className: string, display: string }}
 */
export function formatConfidence(result) {
  const confidenceScore = typeof result.confidence === 'number' ? result.confidence : 0;
  const percent = Math.round(confidenceScore * 100);
  let className = 'low';
  if (percent >= 70) className = 'high';
  else if (percent >= 50) className = 'medium';
  return { percent, className, display: `${percent}%` };
}

/**
 * Get the display confidence for a result, applying any transform.
 * @param {object} result
 * @returns {number} 0-100
 */
export function getDisplayConfidence(result) {
  return Math.round((result.confidence || 0) * 100);
}

/**
 * Determine the confidence level label for an artist.
 * @param {object} result
 * @returns {'high' | 'medium' | 'low'}
 */
export function getConfidenceLevel(result) {
  const score = result.confidence || 0;
  if (score >= 0.7) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}

/**
 * Build a plain text label describing which data sources contributed to a result.
 * @param {object} result
 * @returns {string}
 */
export function getContributionSummary(result) {
  if (!result.analysis) return '';
  const parts = [];
  const comp = result.analysis;
  if (comp.bio !== null) parts.push('bio');
  if (comp.displayName !== null) parts.push('display name');
  if (comp.journal !== null) parts.push('journal');
  if (comp.gallery !== null) parts.push('gallery');
  if (comp.posts !== null) parts.push('posts');
  return parts.length > 0 ? `Contributing: ${parts.join(', ')}` : '';
}

/**
 * Build a color-coded platform badge name.
 * @param {string} platform
 * @returns {string}
 */
export function formatPlatformName(platform) {
  const names = {
    furaffinity: 'FurAffinity',
    bluesky: 'Bluesky',
    twitter: 'Twitter/X',
  };
  return names[platform] || platform;
}

/**
 * Derive a simple profile theme colour from username (hash-based).
 * @param {string} username
 * @returns {string} OKLCH colour
 */
export function deriveProfileTheme(username) {
  if (!username) return 'oklch(30% 0.02 270)';
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  const h = Math.abs(hash % 360);
  return `oklch(28% 0.04 ${h})`;
}
