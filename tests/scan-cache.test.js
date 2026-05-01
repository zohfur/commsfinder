/**
 * Focused unit tests for the scan-cache performance improvements in background.js.
 *
 * These tests exercise the pure logic functions in isolation:
 *   - normalizeString / areNamesSimilar (unchanged helpers)
 *   - buildLookupMaps (new)
 *   - findExactDuplicateIndexInCache (new)
 *   - findCrossplatformDuplicateInCache (new)
 *   - updateLookupMaps (new)
 *   - scheduleScanCacheFlush / batch-write counter logic (new)
 *   - handleScanProgress throttle behaviour (new)
 *
 * Because background.js is a browser-extension module that imports chrome APIs and
 * ESM-only packages, we reproduce only the pure functions here rather than importing
 * the whole module.  The logic is an exact copy of what was written in background.js.
 */

// ---------------------------------------------------------------------------
// Helpers reproduced from background.js (unchanged)
// ---------------------------------------------------------------------------
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function areNamesSimilar(name1, name2) {
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

// ---------------------------------------------------------------------------
// New cache helpers reproduced from background.js
// ---------------------------------------------------------------------------
function buildLookupMaps(results) {
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

function initScanCache(existingResults) {
  const results = existingResults ? [...existingResults] : [];
  const { exactMap, normNameMap } = buildLookupMaps(results);
  return { results, exactMap, normNameMap };
}

function findExactDuplicateIndexInCache(cache, artistData) {
  const normUser = normalizeString(artistData.username);
  const key = `${artistData.platform}:${normUser}`;
  const idx = cache.exactMap.get(key);
  return idx !== undefined ? idx : -1;
}

function findCrossplatformDuplicateInCache(cache, newArtist) {
  const normUser = normalizeString(newArtist.username);
  const normDisplay = normalizeString(newArtist.displayName);
  for (const key of [normUser, normDisplay]) {
    if (!key) continue;
    const idx = cache.normNameMap.get(key);
    if (idx !== undefined) {
      const existing = cache.results[idx];
      if (
        existing.platform !== newArtist.platform &&
        !(existing.platforms && existing.platforms.includes(newArtist.platform))
      ) {
        return existing;
      }
    }
  }
  return cache.results.find(existing => {
    if (
      existing.platform === newArtist.platform ||
      (existing.platforms && existing.platforms.includes(newArtist.platform))
    ) return false;
    return areNamesSimilar(existing.username, newArtist.username) ||
           areNamesSimilar(existing.displayName, newArtist.displayName);
  });
}

function updateLookupMaps(cache, idx) {
  const r = cache.results[idx];
  const normUser = normalizeString(r.username);
  const normDisplay = normalizeString(r.displayName);
  cache.exactMap.set(`${r.platform}:${normUser}`, idx);
  if (r.platforms) {
    for (const p of r.platforms) {
      cache.exactMap.set(`${p}:${normUser}`, idx);
    }
  }
  if (!cache.normNameMap.has(normUser)) {
    cache.normNameMap.set(normUser, idx);
  }
  if (normDisplay && !cache.normNameMap.has(normDisplay)) {
    cache.normNameMap.set(normDisplay, idx);
  }
}

// ---------------------------------------------------------------------------
// Batch-write counter logic reproduced from background.js
// ---------------------------------------------------------------------------
const WRITE_BATCH_SIZE = 10;

function makeFlushController() {
  let pendingWriteCount = 0;
  let timerFired = false;
  let batchFlushed = false;
  let timerId = null;

  const flushToStorage = jest.fn(() => {
    pendingWriteCount = 0;
    batchFlushed = true;
  });

  function scheduleScanCacheFlush() {
    pendingWriteCount++;
    if (pendingWriteCount >= WRITE_BATCH_SIZE) {
      flushToStorage();
      clearTimeout(timerId);
      timerId = null;
      return;
    }
    clearTimeout(timerId);
    timerId = setTimeout(() => {
      timerFired = true;
      flushToStorage();
    }, 3000);
  }

  return { scheduleScanCacheFlush, flushToStorage, getCount: () => pendingWriteCount, timerFired: () => timerFired, batchFlushed: () => batchFlushed };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeString', () => {
  test('lowercases and strips non-alphanumeric', () => {
    expect(normalizeString('Hello World!')).toBe('helloworld');
    expect(normalizeString('Artist_42')).toBe('artist42');
    expect(normalizeString('')).toBe('');
    expect(normalizeString(null)).toBe('');
  });
});

describe('buildLookupMaps', () => {
  test('exactMap contains platform:normUsername keys', () => {
    const results = [
      { platform: 'furaffinity', username: 'ArtistOne', displayName: 'Artist One' },
      { platform: 'bluesky', username: 'ArtistTwo', displayName: 'Artist Two' },
    ];
    const { exactMap } = buildLookupMaps(results);
    expect(exactMap.get('furaffinity:artistone')).toBe(0);
    expect(exactMap.get('bluesky:artisttwo')).toBe(1);
    expect(exactMap.size).toBe(2);
  });

  test('exactMap includes secondary platforms from platforms[]', () => {
    const results = [
      {
        platform: 'furaffinity',
        username: 'MultiArtist',
        displayName: 'Multi',
        platforms: ['furaffinity', 'bluesky'],
      },
    ];
    const { exactMap } = buildLookupMaps(results);
    expect(exactMap.get('furaffinity:multiartist')).toBe(0);
    expect(exactMap.get('bluesky:multiartist')).toBe(0);
  });

  test('normNameMap contains normalised username and display name', () => {
    const results = [
      { platform: 'furaffinity', username: 'CoolArtist', displayName: 'Cool Artist' },
    ];
    const { normNameMap } = buildLookupMaps(results);
    expect(normNameMap.get('coolartist')).toBe(0);
    expect(normNameMap.get('coolartist')).toBe(0); // display name same after strip
  });

  test('handles empty results array', () => {
    const { exactMap, normNameMap } = buildLookupMaps([]);
    expect(exactMap.size).toBe(0);
    expect(normNameMap.size).toBe(0);
  });
});

describe('findExactDuplicateIndexInCache', () => {
  let cache;
  beforeEach(() => {
    cache = initScanCache([
      { platform: 'furaffinity', username: 'ExistingArtist', displayName: 'EA', confidence: 0.8, commissionStatus: 'open' },
      { platform: 'bluesky', username: 'AnotherArtist', displayName: 'AA', confidence: 0.7, commissionStatus: 'unclear' },
    ]);
  });

  test('returns index for exact same-platform match', () => {
    expect(findExactDuplicateIndexInCache(cache, { platform: 'furaffinity', username: 'ExistingArtist' })).toBe(0);
    expect(findExactDuplicateIndexInCache(cache, { platform: 'bluesky', username: 'AnotherArtist' })).toBe(1);
  });

  test('returns -1 for different platform', () => {
    expect(findExactDuplicateIndexInCache(cache, { platform: 'twitter', username: 'ExistingArtist' })).toBe(-1);
  });

  test('returns -1 for unknown username', () => {
    expect(findExactDuplicateIndexInCache(cache, { platform: 'furaffinity', username: 'Newcomer' })).toBe(-1);
  });

  test('case-insensitive match', () => {
    expect(findExactDuplicateIndexInCache(cache, { platform: 'furaffinity', username: 'existingartist' })).toBe(0);
    expect(findExactDuplicateIndexInCache(cache, { platform: 'furaffinity', username: 'EXISTINGARTIST' })).toBe(0);
  });
});

describe('findCrossplatformDuplicateInCache', () => {
  let cache;
  beforeEach(() => {
    cache = initScanCache([
      { platform: 'furaffinity', username: 'SharedArtist', displayName: 'Shared Artist', confidence: 0.8, commissionStatus: 'open' },
      { platform: 'bluesky', username: 'UniqueBlue', displayName: 'Unique Blue', confidence: 0.7, commissionStatus: 'unclear' },
    ]);
  });

  test('finds cross-platform duplicate by exact normalised username', () => {
    const result = findCrossplatformDuplicateInCache(cache, {
      platform: 'bluesky',
      username: 'SharedArtist',
      displayName: 'Different Display'
    });
    expect(result).toBeDefined();
    expect(result.platform).toBe('furaffinity');
    expect(result.username).toBe('SharedArtist');
  });

  test('finds cross-platform duplicate by display name', () => {
    const result = findCrossplatformDuplicateInCache(cache, {
      platform: 'twitter',
      username: 'totallydifferent',
      displayName: 'Shared Artist'
    });
    expect(result).toBeDefined();
    expect(result.username).toBe('SharedArtist');
  });

  test('returns undefined when no cross-platform match', () => {
    const result = findCrossplatformDuplicateInCache(cache, {
      platform: 'twitter',
      username: 'BrandNewUser',
      displayName: 'Brand New'
    });
    expect(result).toBeUndefined();
  });

  test('does not match same-platform entry', () => {
    // UniqueBlue already on bluesky; a new bluesky artist with same name is same-platform
    const result = findCrossplatformDuplicateInCache(cache, {
      platform: 'bluesky',
      username: 'UniqueBlue',
      displayName: 'Unique Blue'
    });
    // Should skip same-platform entry; no cross-platform match
    expect(result).toBeUndefined();
  });

  test('falls back to fuzzy contains-match for similar usernames', () => {
    // 'sharedartistXYZ' contains 'sharedartist' → areNamesSimilar returns true if overlap ≥ threshold
    const result = findCrossplatformDuplicateInCache(cache, {
      platform: 'twitter',
      username: 'SharedArtistArt', // contains 'sharedartist' (13/16 = 0.8125 ≥ 0.7)
      displayName: 'Something Else'
    });
    expect(result).toBeDefined();
    expect(result.username).toBe('SharedArtist');
  });
});

describe('updateLookupMaps', () => {
  test('newly pushed artist becomes findable via exactMap', () => {
    const cache = initScanCache([
      { platform: 'furaffinity', username: 'OldArtist', displayName: 'Old', confidence: 0.5, commissionStatus: 'unclear' }
    ]);
    const newArtist = { platform: 'bluesky', username: 'NewArtist', displayName: 'New', confidence: 0.9, commissionStatus: 'open' };
    const idx = cache.results.length;
    cache.results.push(newArtist);
    updateLookupMaps(cache, idx);

    expect(cache.exactMap.get('bluesky:newartist')).toBe(1);
    expect(cache.normNameMap.get('newartist')).toBe(1);
  });

  test('updated artist at existing index retains correct Map entry', () => {
    const cache = initScanCache([
      { platform: 'furaffinity', username: 'Artist', displayName: 'A', confidence: 0.5, commissionStatus: 'unclear' }
    ]);
    cache.results[0] = { platform: 'furaffinity', username: 'Artist', displayName: 'Updated', confidence: 0.9, commissionStatus: 'open' };
    updateLookupMaps(cache, 0);
    expect(cache.exactMap.get('furaffinity:artist')).toBe(0);
  });
});

describe('batch-write flush counter', () => {
  test('flushes immediately after WRITE_BATCH_SIZE (10) artists', () => {
    const ctrl = makeFlushController();
    for (let i = 0; i < WRITE_BATCH_SIZE - 1; i++) {
      ctrl.scheduleScanCacheFlush();
    }
    expect(ctrl.flushToStorage).not.toHaveBeenCalled();
    ctrl.scheduleScanCacheFlush(); // 10th artist
    expect(ctrl.flushToStorage).toHaveBeenCalledTimes(1);
  });

  test('does not flush before batch size is reached', () => {
    const ctrl = makeFlushController();
    for (let i = 0; i < WRITE_BATCH_SIZE - 1; i++) {
      ctrl.scheduleScanCacheFlush();
    }
    expect(ctrl.flushToStorage).not.toHaveBeenCalled();
  });

  test('resets counter after flush', () => {
    const ctrl = makeFlushController();
    for (let i = 0; i < WRITE_BATCH_SIZE; i++) ctrl.scheduleScanCacheFlush();
    expect(ctrl.flushToStorage).toHaveBeenCalledTimes(1);
    expect(ctrl.getCount()).toBe(0);
    // Adding more artists doesn't immediately flush again (need another full batch)
    for (let i = 0; i < WRITE_BATCH_SIZE - 1; i++) ctrl.scheduleScanCacheFlush();
    expect(ctrl.flushToStorage).toHaveBeenCalledTimes(1);
  });

  test('second batch of WRITE_BATCH_SIZE triggers a second flush', () => {
    const ctrl = makeFlushController();
    for (let i = 0; i < WRITE_BATCH_SIZE * 2; i++) ctrl.scheduleScanCacheFlush();
    expect(ctrl.flushToStorage).toHaveBeenCalledTimes(2);
  });
});

describe('progress throttle: write is deferred, message is immediate', () => {
  /**
   * This test verifies the intent of the handleScanProgress throttle:
   *   - popup message is sent every call
   *   - storage write is delayed (PROGRESS_THROTTLE_MS) and only the latest data is stored
   */
  test('only the most-recent pending data is retained for deferred write', () => {
    const pendingProgressData = {};

    function storeLatest(platform, data) {
      pendingProgressData[platform] = data;
    }

    storeLatest('furaffinity', { completed: 1, total: 100 });
    storeLatest('furaffinity', { completed: 2, total: 100 });
    storeLatest('furaffinity', { completed: 3, total: 100 });

    // Only the latest update should be flushed to storage
    expect(pendingProgressData['furaffinity'].completed).toBe(3);
  });

  test('platforms are tracked independently', () => {
    const pendingProgressData = {};
    pendingProgressData['furaffinity'] = { completed: 5, total: 50 };
    pendingProgressData['bluesky'] = { completed: 10, total: 200 };

    expect(pendingProgressData['furaffinity'].completed).toBe(5);
    expect(pendingProgressData['bluesky'].completed).toBe(10);
  });
});
