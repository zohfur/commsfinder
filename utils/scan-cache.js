// In-memory scan cache with batched storage writes.
// Eliminates per-artist full storage read/write during active scans.
// All state is module-private — external code uses the exported functions.

// --- Constants ---

const WRITE_BATCH_SIZE = 10;
const WRITE_DEBOUNCE_MS = 3000;
const RESULTS_UPDATE_THROTTLE_MS = 2000;
const PROGRESS_THROTTLE_MS = 2000;
const BENCHMARK_PLATFORMS = ['furaffinity', 'bluesky'];

// --- Module state ---

/**
 * Live state during an active scan. Null when no scan is running.
 * @type {{ results: Array, exactMap: Map, normNameMap: Map } | null}
 */
let scanCache = null;

/** Number of artists added since the last storage flush. */
let pendingWriteCount = 0;

/** Debounce handle for deferred storage writes. */
let pendingWriteTimer = null;

/** Throttle handle for RESULTS_UPDATED messages to popup. */
let pendingResultsUpdateTimer = null;

/** Per-platform timer handles for progress-write throttling. */
const progressThrottleTimers = {};
const pendingProgressData = {};

// --- String utilities (consumed by scan-cache) ---

export function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function areNamesSimilar(name1, name2) {
  if (!name1 || !name2) return false;

  const normalized1 = normalizeString(name1);
  const normalized2 = normalizeString(name2);

  if (normalized1 === normalized2) return true;

  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    const minLength = Math.min(normalized1.length, normalized2.length);
    const maxLength = Math.max(normalized1.length, normalized2.length);
    const threshold = minLength < 6 ? 0.6 : 0.7;
    return (minLength / maxLength) >= threshold;
  }

  return false;
}

// --- Lookup map builders ---

export function buildLookupMaps(results) {
  const exactMap = new Map();
  const normNameMap = new Map();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const normUser = normalizeString(r.username);
    const primaryPlatform = r.platform;
    exactMap.set(`${primaryPlatform}:${normUser}`, i);
    if (r.platforms) {
      for (const p of r.platforms) {
        exactMap.set(`${p}:${normUser}`, i);
      }
    }
    if (!normNameMap.has(normUser)) {
      normNameMap.set(normUser, i);
    }
    const normDisplay = normalizeString(r.displayName);
    if (normDisplay && !normNameMap.has(normDisplay)) {
      normNameMap.set(normDisplay, i);
    }
  }
  return { exactMap, normNameMap };
}

// --- Cache lifecycle ---

export function initScanCache(existingResults) {
  const results = existingResults ? [...existingResults] : [];
  const { exactMap, normNameMap } = buildLookupMaps(results);
  scanCache = { results, exactMap, normNameMap };
  pendingWriteCount = 0;
}

export function getScanCache() {
  return scanCache;
}

export async function flushScanCacheToStorage() {
  if (!scanCache) return;
  clearTimeout(pendingWriteTimer);
  pendingWriteTimer = null;
  pendingWriteCount = 0;
  await chrome.storage.local.set({ scanResults: scanCache.results });
}

export function scheduleScanCacheFlush() {
  pendingWriteCount++;
  if (pendingWriteCount >= WRITE_BATCH_SIZE) {
    flushScanCacheToStorage().catch(err =>
      console.error('[Background] Batched storage flush error:', err)
    );
    return;
  }
  clearTimeout(pendingWriteTimer);
  pendingWriteTimer = setTimeout(() => {
    flushScanCacheToStorage().catch(err =>
      console.error('[Background] Debounced storage flush error:', err)
    );
  }, WRITE_DEBOUNCE_MS);
}

export function scheduleResultsUpdate() {
  if (pendingResultsUpdateTimer) return;
  pendingResultsUpdateTimer = setTimeout(() => {
    pendingResultsUpdateTimer = null;
    if (!scanCache) return;
    chrome.runtime.sendMessage({
      type: 'RESULTS_UPDATED',
      data: scanCache.results
    }).catch(() => {});
  }, RESULTS_UPDATE_THROTTLE_MS);
}

export async function teardownScanCache() {
  await flushScanCacheToStorage();
  scanCache = null;
  clearTimeout(pendingWriteTimer);
  pendingWriteTimer = null;
  if (pendingResultsUpdateTimer) {
    clearTimeout(pendingResultsUpdateTimer);
    pendingResultsUpdateTimer = null;
  }
  for (const platform of Object.keys(progressThrottleTimers)) {
    clearTimeout(progressThrottleTimers[platform]);
    delete progressThrottleTimers[platform];
    delete pendingProgressData[platform];
  }
}

// --- Lookup ---

export function findExactDuplicateIndexInCache(artistData) {
  const normUser = normalizeString(artistData.username);
  const key = `${artistData.platform}:${normUser}`;
  const idx = scanCache.exactMap.get(key);
  return idx !== undefined ? idx : -1;
}

export function findCrossplatformDuplicateInCache(newArtist) {
  const normUser = normalizeString(newArtist.username);
  const normDisplay = normalizeString(newArtist.displayName);

  for (const key of [normUser, normDisplay]) {
    if (!key) continue;
    const idx = scanCache.normNameMap.get(key);
    if (idx !== undefined) {
      const existing = scanCache.results[idx];
      if (
        existing.platform !== newArtist.platform &&
        !(existing.platforms && existing.platforms.includes(newArtist.platform))
      ) {
        return existing;
      }
    }
  }

  return scanCache.results.find(existing => {
    if (
      existing.platform === newArtist.platform ||
      (existing.platforms && existing.platforms.includes(newArtist.platform))
    ) return false;
    return areNamesSimilar(existing.username, newArtist.username) ||
           areNamesSimilar(existing.displayName, newArtist.displayName);
  });
}

export function updateLookupMaps(idx) {
  const r = scanCache.results[idx];
  const normUser = normalizeString(r.username);
  const normDisplay = normalizeString(r.displayName);

  const primaryPlatform = r.platform;
  scanCache.exactMap.set(`${primaryPlatform}:${normUser}`, idx);
  if (r.platforms) {
    for (const p of r.platforms) {
      scanCache.exactMap.set(`${p}:${normUser}`, idx);
    }
  }
  if (!scanCache.normNameMap.has(normUser)) {
    scanCache.normNameMap.set(normUser, idx);
  }
  if (normDisplay && !scanCache.normNameMap.has(normDisplay)) {
    scanCache.normNameMap.set(normDisplay, idx);
  }
}

// --- Progress throttling ---

export function getPendingProgressData() {
  return pendingProgressData;
}

export function getProgressThrottleTimers() {
  return progressThrottleTimers;
}

export function getProgressThrottleMs() {
  return PROGRESS_THROTTLE_MS;
}

export { BENCHMARK_PLATFORMS };
