// Background Service Worker
import { getExecutionContext, debugLog } from './utils/shared.js';
import { isModelCached, downloadAndCacheModel, setCurrentQuantization, getCurrentQuantization } from './utils/model-manager.js';
import { AIAnalyzer } from './utils/ai-analyzer.js';
import { classifyProfileTags } from './utils/tag-classifier.js';
import { classifyProfileTagsFromE621 } from './utils/e621-tagger.js';

// --- URL helpers ---------------------------------------------------------
// Match a hostname against a registrable domain, allowing subdomains but not
// look-alikes (e.g. "furaffinity.net.evil.com" or "evilfuraffinity.net").
function hostMatches(hostname, domain) {
    return hostname === domain || hostname.endsWith('.' + domain);
}

// Resolve the scan platform for a tab URL by parsing its hostname.
// Returns null for unparseable, non-http(s), or unrelated URLs.
function getPlatformFromUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (hostMatches(host, 'furaffinity.net')) return 'furaffinity';
    if (hostMatches(host, 'bsky.app')) return 'bluesky';
    if (hostMatches(host, 'twitter.com') || hostMatches(host, 'x.com')) return 'twitter';
    return null;
}

// True if the URL is one of the scan-source pages we drive during a scan.
function isScanSourceUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    if (hostMatches(host, 'furaffinity.net')) return path.startsWith('/controls/');
    if (hostMatches(host, 'bsky.app')) return path.startsWith('/profile');
    if (hostMatches(host, 'twitter.com') || hostMatches(host, 'x.com')) return path.startsWith('/following');
    return false;
}

// AI Analyzer instance
let aiAnalyzer = null;
let analyzerInitialized = false;
let initializationPromise = null;

// Initialize AI Analyzer
async function initializeAnalyzer() {
    if (analyzerInitialized && aiAnalyzer) {
        return aiAnalyzer;
    }
    
    if (initializationPromise) {
        return initializationPromise;
    }
    
    initializationPromise = (async () => {
        try {
            debugLog('[Background] Initializing AI Analyzer...');
            const debugMode = await initDebugMode();
            const quantization = getCurrentQuantization();
            const { modelTemperature = 1.0 } = await chrome.storage.local.get(['modelTemperature']);
            
            aiAnalyzer = new AIAnalyzer({
                debugMode,
                model: 'zohfur/distilbert-commissions-ONNX',
                quantization,
                temperature: modelTemperature
            });
            
            await aiAnalyzer.initialize();
            
            analyzerInitialized = true;
            debugLog('[Background] AI Analyzer initialized successfully');
            return aiAnalyzer;
        } catch (error) {
            console.error('[Background] Failed to initialize AI Analyzer:', error);
            initializationPromise = null;
            throw error;
        }
    })();
    
    return initializationPromise;
}

let isDebugMode = false;

async function initDebugMode() {
  try {
    const { debugMode } = await chrome.storage.local.get('debugMode');
    isDebugMode = debugMode || false;
  } catch (error) {
    console.error('Error initializing debug mode:', error);
  }
}

async function handleDebugModeUpdate(debugMode) {
  isDebugMode = debugMode;
  await chrome.storage.local.set({ debugMode });
}

// Track active scan tabs
let activeScanTabs = new Map();

// ---------------------------------------------------------------------------
// Scan-session in-memory cache
// Eliminates per-artist full storage read/write during active scans.
// ---------------------------------------------------------------------------

/**
 * Live state during an active scan.  Null when no scan is running.
 * @type {{
 *   results: Array,
 *   exactMap: Map<string, number>,   // "${platform}:${normalizedUsername}" → results index
 *   normNameMap: Map<string, number> // normalizedUsername → results index (cross-platform)
 * } | null}
 */
let scanCache = null;

/** Number of artists added since the last storage flush. */
let pendingWriteCount = 0;

/** Flush to storage every N artists regardless of debounce. */
const WRITE_BATCH_SIZE = 10;

/** Debounce handle for deferred storage writes. */
let pendingWriteTimer = null;
const WRITE_DEBOUNCE_MS = 3000;

/** Throttle handle for RESULTS_UPDATED messages to popup. */
let pendingResultsUpdateTimer = null;
const RESULTS_UPDATE_THROTTLE_MS = 2000;

/** Per-platform timer handles for progress-write throttling. */
const progressThrottleTimers = {};
const PROGRESS_THROTTLE_MS = 2000;

/** Pending (most-recent) progress data awaiting the next throttled flush. */
const pendingProgressData = {};

const BENCHMARK_PLATFORMS = ['furaffinity', 'bluesky'];

/**
 * Build the fast-lookup Maps from a results array.
 * @param {Array} results
 * @returns {{ exactMap: Map, normNameMap: Map }}
 */
function buildLookupMaps(results) {
  const exactMap = new Map();
  const normNameMap = new Map();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const normUser = normalizeString(r.username);
    // Exact same-platform key
    const primaryPlatform = r.platform;
    exactMap.set(`${primaryPlatform}:${normUser}`, i);
    // Also index every additional platform this artist appears on
    if (r.platforms) {
      for (const p of r.platforms) {
        exactMap.set(`${p}:${normUser}`, i);
      }
    }
    // Cross-platform name key (first writer wins; good enough for lookups)
    if (!normNameMap.has(normUser)) {
      normNameMap.set(normUser, i);
    }
    // Also index display name
    const normDisplay = normalizeString(r.displayName);
    if (normDisplay && !normNameMap.has(normDisplay)) {
      normNameMap.set(normDisplay, i);
    }
  }
  return { exactMap, normNameMap };
}

/**
 * Initialise the in-memory scan cache from an existing results array.
 * Call once at scan start, after loading the stored results.
 * @param {Array} existingResults
 */
function initScanCache(existingResults) {
  const results = existingResults ? [...existingResults] : [];
  const { exactMap, normNameMap } = buildLookupMaps(results);
  scanCache = { results, exactMap, normNameMap };
  pendingWriteCount = 0;
}

/**
 * Flush the in-memory cache to chrome.storage.local.
 * Idempotent – safe to call even when scanCache is null.
 */
async function flushScanCacheToStorage() {
  if (!scanCache) return;
  clearTimeout(pendingWriteTimer);
  pendingWriteTimer = null;
  pendingWriteCount = 0;
  await chrome.storage.local.set({ scanResults: scanCache.results });
}

/**
 * Schedule a deferred storage flush.  Flushes immediately if we've hit
 * WRITE_BATCH_SIZE writes without a flush.
 */
function scheduleScanCacheFlush() {
  pendingWriteCount++;
  if (pendingWriteCount >= WRITE_BATCH_SIZE) {
    // Flush now (fire-and-forget; errors logged inside)
    flushScanCacheToStorage().catch(err =>
      console.error('[Background] Batched storage flush error:', err)
    );
    return;
  }
  // Debounced fallback flush
  clearTimeout(pendingWriteTimer);
  pendingWriteTimer = setTimeout(() => {
    flushScanCacheToStorage().catch(err =>
      console.error('[Background] Debounced storage flush error:', err)
    );
  }, WRITE_DEBOUNCE_MS);
}

/**
 * Send a throttled RESULTS_UPDATED message to the popup.
 * At most one message every RESULTS_UPDATE_THROTTLE_MS.
 */
function scheduleResultsUpdate() {
  if (pendingResultsUpdateTimer) return; // already scheduled
  pendingResultsUpdateTimer = setTimeout(() => {
    pendingResultsUpdateTimer = null;
    if (!scanCache) return;
    chrome.runtime.sendMessage({
      type: 'RESULTS_UPDATED',
      data: scanCache.results
    }).catch(() => {});
  }, RESULTS_UPDATE_THROTTLE_MS);
}

/**
 * Tear down the scan cache after a scan ends.
 * Ensures a final storage flush before clearing.
 */
async function teardownScanCache() {
  await flushScanCacheToStorage();
  scanCache = null;
  // Cancel any lingering timers
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

/**
 * O(1) same-platform duplicate lookup against the scan cache.
 * Returns the index in scanCache.results, or -1.
 */
function findExactDuplicateIndexInCache(artistData) {
  const normUser = normalizeString(artistData.username);
  const key = `${artistData.platform}:${normUser}`;
  const idx = scanCache.exactMap.get(key);
  return idx !== undefined ? idx : -1;
}

/**
 * O(1) cross-platform duplicate lookup (exact normalised username match).
 * Falls back to O(N) "contains" scan only when needed.
 * Returns the result object or undefined.
 */
function findCrossplatformDuplicateInCache(newArtist) {
  const normUser = normalizeString(newArtist.username);
  const normDisplay = normalizeString(newArtist.displayName);

  // Fast path: exact normalised-username match in the cross-platform map
  for (const key of [normUser, normDisplay]) {
    if (!key) continue;
    const idx = scanCache.normNameMap.get(key);
    if (idx !== undefined) {
      const existing = scanCache.results[idx];
      // Confirm it is genuinely cross-platform
      if (
        existing.platform !== newArtist.platform &&
        !(existing.platforms && existing.platforms.includes(newArtist.platform))
      ) {
        return existing;
      }
    }
  }

  // Slow path: substring/"contains" similarity (rare, only for fuzzy matches)
  return scanCache.results.find(existing => {
    if (
      existing.platform === newArtist.platform ||
      (existing.platforms && existing.platforms.includes(newArtist.platform))
    ) return false;
    return areNamesSimilar(existing.username, newArtist.username) ||
           areNamesSimilar(existing.displayName, newArtist.displayName);
  });
}

/**
 * Update the fast-lookup Maps after inserting/replacing an entry.
 * @param {number} idx  Index in scanCache.results that was inserted or updated.
 */
function updateLookupMaps(idx) {
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

// Initialize on startup - restore active scan state if needed
async function initializeActiveScanState() {
  try {
    const { activeScansInProgress = false, activePlatforms = [] } = await chrome.storage.local.get(['activeScansInProgress', 'activePlatforms']);
    
    if (activeScansInProgress) {
      // Check if there are actually any tabs running scans
      const tabs = await chrome.tabs.query({});
      let foundActiveScanTabs = false;
      
      for (const tab of tabs) {
        // Check if tab URL matches scan platform URLs
        if (isScanSourceUrl(tab.url)) {

          // Try to ping the content script to see if it's actively scanning
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
            foundActiveScanTabs = true;

            // Determine platform from URL and restore to activeScanTabs
            const platform = getPlatformFromUrl(tab.url);
            if (platform) {
              activeScanTabs.set(platform, tab.id);
            }
          } catch (error) {
            // Content script not responding, tab is not actively scanning
            console.log(`[Background] Tab ${tab.id} not actively scanning:`, error);
          }
        }
      }
      
      // If no active scan tabs found, clear the activeScansInProgress flag and clean up
      if (!foundActiveScanTabs) {
        console.log('[Background] No active scan tabs found, clearing scan state');
        await chrome.storage.local.set({ 
          activeScansInProgress: false,
          scanInProgress: false,
          activePlatforms: [],
          completedPlatforms: []
        });
      }
    } else if (activePlatforms.length > 0) {
      // Clean up stale activePlatforms if scans aren't in progress
      console.log('[Background] Cleaning up stale activePlatforms list');
      await chrome.storage.local.set({ 
        activePlatforms: [],
        completedPlatforms: []
      });
    }
  } catch (error) {
    console.error('[Background] Error initializing active scan state:', error);
    // Clean up on error
    try {
      await chrome.storage.local.set({ 
        activeScansInProgress: false,
        scanInProgress: false,
        activePlatforms: [],
        completedPlatforms: []
      });
    } catch (cleanupError) {
      console.error('[Background] Error cleaning up scan state:', cleanupError);
    }
  }
}

// Initialize on startup
initializeActiveScanState();

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (isDebugMode) {
      debugLog('[Background] Received message:', request.type, 'from:', sender);
    }

    if (request.type === 'STOP_SCAN') {
        handleStopScan(sendResponse);
        return true;
    }

    if (request.type === 'CANCEL_SCAN') {
        handleCancelScan(sendResponse);
        return true;
    }

    if (request.type === 'GET_MODEL_STATUS') {
        const quantizationType = request.modelName || getCurrentQuantization();
        isModelCached(quantizationType).then(isCached => {
            sendResponse({ isCached });
        });
        return true; // Keep channel open for async response
    }

    if (request.type === 'DOWNLOAD_MODEL') {
        const quantizationType = request.modelName || getCurrentQuantization();
        downloadAndCacheModel((status, progress) => {
            // Send progress updates to the popup
            chrome.runtime.sendMessage({
                type: 'MODEL_DOWNLOAD_PROGRESS',
                data: { status, progress }
            });
        }, quantizationType).then(() => {
            sendResponse({ success: true });
        }).catch(error => {
            console.error('[Background] Model download failed:', error);
            const errorMessage = error.message || error.toString();
            sendResponse({ success: false, error: errorMessage });
        });
        return true; // Keep channel open for async response
    }

    if (request.type === 'analyze_text' || request.type === 'analyze_components') {
        handleAnalyzeRequest(request, sender, sendResponse);
        return true; // Keep the message channel open for async response
    }

    if (request.type === 'get_debug_mode') {
        initDebugMode().then(debugMode => sendResponse({ debugMode }));
        return true;
    }

    if (request.type === 'set_debug_mode') {
        chrome.storage.local.set({ debugMode: request.value })
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (request.type === 'SCAN_REQUEST') {
      handleScanRequest(request.platforms, sendResponse, request.scanSettings || null);
      return true; // Keep message channel open for async response
    }

    if (request.type === 'BENCHMARK_SCAN_REQUEST') {
      handleBenchmarkScanRequest(request, sendResponse);
      return true;
    }
      
    if (request.type === 'ARTIST_FOUND') {
      handleArtistFound(request.data);
      // No response needed for fire-and-forget messages
      return false;
    }
      
    if (request.type === 'SCAN_COMPLETE') {
      handleScanComplete(request.platform, request.results);
      // No response needed for fire-and-forget messages
      return false;
    }
      
    if (request.type === 'GET_RESULTS') {
      getStoredResults(sendResponse);
      return true;
    }
      
    if (request.type === 'CLEAR_RESULTS') {
      clearResults(sendResponse);
      return true;
    }
      
    if (request.type === 'runTests') {
      handleTestRequest(sendResponse);
      return true;
    }

    if (request.type === 'MODEL_CHANGED') {
      handleQuantizationChange(request.modelName, sendResponse);
      return true;
    }

    if (request.type === 'SCAN_PROGRESS') {
      handleScanProgress(request.platform, request.data);
      // No response needed for fire-and-forget messages
      return false;
    }

    if (request.type === 'SCAN_ERROR') {
      handleScanError(request.platform, request.error);
      // No response needed for fire-and-forget messages
      return false;
    }

    if (request.type === 'LOGIN_REQUIRED') {
      handleLoginRequired(request.platform, request.error, sender);
      // No response needed for fire-and-forget messages
      return false;
    }

    if (request.type === 'OPEN_LOGIN_TAB') {
      handleOpenLoginTab(sendResponse);
      return true;
    }

    if (request.type === 'UPDATE_TEMPERATURE') {
      handleTemperatureUpdate(request.temperature, sendResponse);
      return true;
    }

    if (request.type === 'UPDATE_DEBUG_MODE') {
      handleDebugModeUpdate(request.debugMode);
      sendResponse({ success: true });
      return true;
    }

    if (request.type === 'BENCHMARK_RESULTS') {
      handleBenchmarkResults(request.platform, request.results);
      // No response needed for fire-and-forget messages
      return false;
    }

    if (request.type === 'GET_BENCHMARK_RESULTS') {
      getStoredBenchmarkResults(sendResponse);
      return true;
    }

    if (request.type === 'GET_BENCHMARK_RUN') {
      getStoredBenchmarkRun(sendResponse);
      return true;
    }

    console.warn('Unknown message type:', request.type);
});

// Handle external messages (from demo page)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (isDebugMode) {
    console.log('[Background] Received external message:', request.type, 'from:', sender.url);
  }

  if (request.type === 'analyze_text' || request.type === 'analyze_components') {
    handleAnalyzeRequest(request, sender, sendResponse);
    return true; // Keep the message channel open for async response
  } else if (request.type === 'runTests') {
    handleTestRequest(sendResponse);
    return true;
  }
});

// Pattern matching for No-AI mode
const OPEN_PATTERNS = [
  /\bcomm?(?:ission)?s?\s*(?:are\s+)?open\b/i,
  /\bc0mm?(?:ission)?s?\s*(?:are\s+)?open\b/i,
  /\bc0mm?s?\s*0pen\b/i,
  /\bc\*mm?s?\s*open\b/i,
  /\btaking\s+comm?(?:ission)?s?\b/i,
  /\bcomm?(?:ission)?s?\s+slots?\s+(?:open|available)\b/i,
  /\bopen\s+for\s+comm?(?:ission)?s?\b/i,
  /\bopen\s+comm?(?:ission)?s?\b/i,
  /\bcommissions?\s*:\s*open\b/i,
  /\bcommisisons\s+open\b/i,
  /\bСommission\s*-\s*open\b/i,
  /\baccept(?:ing)?\s+comm?(?:ission)?s?\b/i,
  /\bslots?\s+available\b/i,
  /\bdm\s+(?:me\s+)?for\s+comm?(?:ission)?s?\b/i,
  /\bqueue\s+(?:is\s+)?open\b/i
];

const CLOSED_PATTERNS = [
  /\bcomm?(?:ission)?s?\s*(?:are\s+)?closed?\b/i,
  /\bc\*mm?s?\s*closed?\b/i,
  /\bcom?s?\s*closed?\b/i,
  /\bnot\s+taking\s+comm?(?:ission)?s?\b/i,
  /\bno\s+comm?(?:ission)?s?\b/i,
  /\bclosed\s+(?:for\s+)?comm?(?:ission)?s?\b/i,
  /\bhiatus\b/i,
  /\bcomm?(?:ission)?s?\s*(?:are\s+)?(?:full|unavailable)\b/i,
  /\bcommissions?\s*:\s*closed\b/i,
  /\bqueue\s*(?:is\s+)?(?:full|closed)\b/i,
  /\bnot\s+accept(?:ing)?\s+comm?(?:ission)?s?\b/i,
  /\bfully\s+booked\b/i,
  /\bwaitlist\s+(?:is\s+)?closed\b/i
];

// Pattern analysis for single text
function patternAnalyze(text) {
  if (!text) {
    return {
      commissionStatus: 'unclear',
      confidence: 0.3,
      method: 'pattern-matching',
      triggers: []
    };
  }

  const openMatches = [];
  const closedMatches = [];
  
  // Check for open patterns
  for (const pattern of OPEN_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      openMatches.push(match[0]);
    }
  }
  
  // Check for closed patterns
  for (const pattern of CLOSED_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      closedMatches.push(match[0]);
    }
  }
  
  let commissionStatus = 'unclear';
  let confidence = 0.3;
  let triggers = [];
  
  if (closedMatches.length > 0 && openMatches.length === 0) {
    commissionStatus = 'closed';
    confidence = Math.min(0.8 + (closedMatches.length * 0.05), 0.95);
    triggers = closedMatches;
  } else if (openMatches.length > 0 && closedMatches.length === 0) {
    commissionStatus = 'open';
    confidence = Math.min(0.8 + (openMatches.length * 0.05), 0.95);
    triggers = openMatches;
  } else if (openMatches.length > 0 && closedMatches.length > 0) {
    // Conflicting signals - use the one with more matches
    if (closedMatches.length > openMatches.length) {
      commissionStatus = 'closed';
      confidence = 0.6;
      triggers = closedMatches;
    } else {
      commissionStatus = 'open';
      confidence = 0.6;
      triggers = openMatches;
    }
  }
  
  return {
    commissionStatus,
    confidence,
    method: 'pattern-matching',
    triggers: [...new Set(triggers)] // Unique triggers
  };
}

// Pattern analysis for components
async function patternAnalyzeComponents(components) {
  const results = {
    displayName: null,
    bio: null,
    journal: null,
    gallery: null,
    posts: null
  };
  
  let highestConfidence = 0;
  let overallStatus = 'unclear';
  let allTriggers = [];
  
  // Analyze display name with high weight
  if (components.displayName) {
    const displayNameResult = patternAnalyze(components.displayName);
    results.displayName = displayNameResult;
    
    if (displayNameResult.confidence > 0.7) {
      // Display name is very reliable
      highestConfidence = displayNameResult.confidence;
      overallStatus = displayNameResult.commissionStatus;
      allTriggers.push(...displayNameResult.triggers);
    }
  }
  
  // Analyze bio with high weight
  if (components.bio) {
    const bioResult = patternAnalyze(components.bio);
    results.bio = bioResult;
    
    if (bioResult.confidence > highestConfidence) {
      highestConfidence = bioResult.confidence;
      overallStatus = bioResult.commissionStatus;
    }
    allTriggers.push(...bioResult.triggers);
  }
  
  // Analyze journal if present
  if (components.journal && components.journal.text) {
    const journalResult = patternAnalyze(components.journal.text);
    results.journal = {
      ...journalResult,
      date: components.journal.date
    };
    
    // Recent journal has more weight
    const isRecent = components.journal.date && 
                    (Date.now() - new Date(components.journal.date).getTime()) < 30 * 24 * 60 * 60 * 1000;
    
    if (isRecent && journalResult.confidence > highestConfidence) {
      highestConfidence = journalResult.confidence;
      overallStatus = journalResult.commissionStatus;
    }
    allTriggers.push(...journalResult.triggers);
  }
  
  // Analyze gallery items if present
  if (components.gallery && components.gallery.items) {
    const galleryResults = [];
    for (const item of components.gallery.items) {
      const itemText = `${item.title || ''} ${item.description || ''} ${item.tags || ''}`.trim();
      if (itemText) {
        const itemResult = patternAnalyze(itemText);
        galleryResults.push({
          ...itemResult,
          url: item.url,
          date: item.date,
          title: item.title,
          description: item.description,
          thumbnailUrl: item.thumbnailUrl,
          imageUrl: item.imageUrl,
          previewUrl: item.previewUrl
        });
        allTriggers.push(...itemResult.triggers);
      }
    }
    
    if (galleryResults.length > 0) {
      // Use the most confident gallery result
      const bestGalleryResult = galleryResults.reduce((best, current) => 
        current.confidence > best.confidence ? current : best
      );
      
      results.gallery = {
        items: galleryResults,
        confidence: bestGalleryResult.confidence,
        commissionStatus: bestGalleryResult.commissionStatus
      };
      
      if (bestGalleryResult.confidence > highestConfidence * 0.8) {
        // Gallery can influence but not override strong signals
        overallStatus = bestGalleryResult.commissionStatus;
      }
    }
  }
  
  // Analyze posts if present
  if (components.posts && components.posts.items) {
    const postResults = [];
    for (const post of components.posts.items) {
      if (post.text) {
        const postResult = patternAnalyze(post.text);
        postResults.push({
          ...postResult,
          url: post.url,
          date: post.date,
          text: post.text,
          thumbnailUrl: post.thumbnailUrl,
          imageUrl: post.imageUrl,
          previewUrl: post.previewUrl,
          isPinned: post.isPinned
        });
        allTriggers.push(...postResult.triggers);
      }
    }
    
    if (postResults.length > 0) {
      // Prioritize pinned posts
      const pinnedPosts = postResults.filter(p => p.isPinned);
      const bestPostResult = pinnedPosts.length > 0 ? 
        pinnedPosts.reduce((best, current) => current.confidence > best.confidence ? current : best) :
        postResults.reduce((best, current) => current.confidence > best.confidence ? current : best);
      
      results.posts = {
        items: postResults,
        confidence: bestPostResult.confidence,
        commissionStatus: bestPostResult.commissionStatus
      };
      
      if (bestPostResult.isPinned && bestPostResult.confidence > 0.7) {
        highestConfidence = bestPostResult.confidence;
        overallStatus = bestPostResult.commissionStatus;
      }
    }
  }
  
  // Return final result
  return {
    commissionStatus: overallStatus,
    confidence: highestConfidence,
    components: results,
    method: 'pattern-matching',
    triggers: [...new Set(allTriggers)].slice(0, 5) // Top 5 unique triggers
  };
}

// Handle analysis requests directly in background
async function handleAnalyzeRequest(request, sender, sendResponse) {
  try {
    if (isDebugMode) {
      console.log('[Background] Processing analysis request:', request);
    }
    
    // Check if AI is enabled
    const { aiEnabled = true } = await chrome.storage.local.get(['aiEnabled']);
    
    let result;
    
    if (!aiEnabled) {
      // No-AI mode - use pattern matching only
      console.log('[Background] Using No-AI mode (pattern matching)');
      
      if (request.type === 'analyze_components') {
        result = await patternAnalyzeComponents(request.components);
      } else {
        result = patternAnalyze(request.text);
      }
    } else {
      // AI mode - use analyzer once with timeout protection
      const analyzer = await initializeAnalyzer();

      // Add timeout protection to prevent service worker from being stopped
      const analysisPromise = request.type === 'analyze_components'
        ? analyzer.analyzeComponents(request.components)
        : analyzer.analyze(request.text, request.context || 'bio');

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Analysis timeout - exceeded 25 seconds')), 25000);
      });

      try {
        result = await Promise.race([analysisPromise, timeoutPromise]);
      } catch (timeoutError) {
        if (timeoutError?.message?.includes('timeout')) {
          console.warn('[Background] Analysis timed out, falling back to pattern matching');
          // Fallback to pattern matching if AI times out
          if (request.type === 'analyze_components') {
            result = await patternAnalyzeComponents(request.components);
          } else {
            result = patternAnalyze(request.text);
          }
          result.method = 'pattern-fallback';
        } else {
          throw timeoutError;
        }
      }
    }
    
    if (isDebugMode) {
      console.log('[Background] Analysis complete:', result);
    }
    sendResponse({ 
      success: true, 
      result: result 
    });
    
  } catch (error) {
    console.error('[Background] Analysis failed:', error);
    sendResponse({ 
      success: false, 
      error: error.message || 'Analysis failed' 
    });
  }
}

async function handleScanRequest(platforms, sendResponse, scanSettings = null) {
  try {
    // Validate request
    if (!platforms || platforms.length === 0) {
      sendResponse({ success: false, error: 'No platforms selected' });
      return;
    }

    // Check if scan already in progress
    const { activeScansInProgress = false } = await chrome.storage.local.get(['activeScansInProgress']);
    if (activeScansInProgress) {
      sendResponse({ success: false, error: 'Scan already in progress' });
      return;
    }

    // Send success response immediately
    sendResponse({ success: true, message: 'Scan initiated' });

    // Perform setup asynchronously
    initializeScan(platforms, { scanSettings }).catch(error => {
      console.error('Scan initialization failed:', error);
      // Notify popup of error
      chrome.runtime.sendMessage({
        type: 'SCAN_ERROR',
        error: error.message || 'Failed to initialize scan'
      });
    });

  } catch (error) {
    console.error('Scan request failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleBenchmarkScanRequest(request, sendResponse) {
  try {
    const { activeScansInProgress = false } = await chrome.storage.local.get(['activeScansInProgress']);
    if (activeScansInProgress) {
      sendResponse({ success: false, error: 'Scan already in progress' });
      return;
    }

    const platforms = Array.isArray(request.platforms) && request.platforms.length > 0
      ? request.platforms.filter(platform => BENCHMARK_PLATFORMS.includes(platform))
      : BENCHMARK_PLATFORMS;

    if (platforms.length === 0) {
      sendResponse({ success: false, error: 'No benchmarkable platforms selected' });
      return;
    }

    const runId = `benchmark-${Date.now()}`;
    const activeBenchmarkRun = {
      id: runId,
      label: request.label || 'current-working-tree',
      baselineCommit: request.baselineCommit || null,
      platforms,
      startedAt: Date.now(),
      userAgent: navigator.userAgent,
      manifestVersion: chrome.runtime.getManifest().version,
    };

    benchmarkResults = {};
    await chrome.storage.local.remove([
      'benchmarkResults',
      'lastBenchmarkRun',
      'platformProgress',
      'lastPlatformScanned',
      'furaffinity_progress',
      'bluesky_progress',
      'twitter_progress',
      'furaffinity_error',
      'bluesky_error',
      'twitter_error',
    ]);
    await chrome.storage.local.set({
      activeBenchmarkRun,
      benchmarkResults,
      scanResults: [],
      completedPlatforms: [],
      activePlatforms: [],
      scanInProgress: false,
      activeScansInProgress: false,
    });

    sendResponse({ success: true, runId, platforms });

    initializeScan(platforms, { forceFresh: true, benchmarkRunId: runId }).catch(async error => {
      console.error('Benchmark scan initialization failed:', error);
      await finishBenchmarkRun('failed', [], error.message || String(error));
      chrome.runtime.sendMessage({
        type: 'BENCHMARK_SCAN_FAILED',
        error: error.message || 'Failed to initialize benchmark scan',
      }).catch(() => {});
    });
  } catch (error) {
    console.error('Benchmark scan request failed:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// New function to handle async scan initialization
async function initializeScan(platforms, options = {}) {
  try {
    // Get existing scan state
    let { 
      scanInProgress = false, 
      lastPlatformScanned = null,
      scanResults = []
    } = await chrome.storage.local.get([
      'scanInProgress',
      'lastPlatformScanned',
      'scanResults'
    ]);

    if (options.forceFresh) {
      scanResults = [];
    }

    const { aiEnabled = true, selectedQuantization = 'full' } = await chrome.storage.local.get([
      'aiEnabled',
      'selectedQuantization'
    ]);
    const activeScanSettings = options.scanSettings || {
      platforms: [...platforms],
      mode: aiEnabled ? 'discriminative' : 'pattern',
      model: aiEnabled ? selectedQuantization : null,
      startedAt: Date.now()
    };

    // Batch-read all platform progress in a single storage call
    const progressKeys = platforms.map(p => `${p}_progress`);
    const progressStorage = await chrome.storage.local.get(progressKeys);

    const existingProgress = {};
    for (const platform of platforms) {
      const platformProgressData = progressStorage[`${platform}_progress`];
      if (platformProgressData && platformProgressData.phase !== 'completed') {
        if (platform === 'bluesky' && platformProgressData.following) {
          existingProgress[platform] = {
            following: platformProgressData.following,
            completed: platformProgressData.completed || 0
          };
        } else if (platform === 'furaffinity' && platformProgressData.artists) {
          existingProgress[platform] = {
            artists: platformProgressData.artists,
            completed: platformProgressData.completed || 0
          };
        }
      }
    }

    // If resuming, start from the last platform that wasn't completed
    let platformsToScan = platforms;
    let isResuming = false;
    
    if (!options.forceFresh && scanInProgress && lastPlatformScanned) {
      const lastIndex = platforms.indexOf(lastPlatformScanned);
      if (lastIndex >= 0) {
        platformsToScan = platforms.slice(lastIndex);
        isResuming = true;
      }
    }

    // Only clear results if this is a completely fresh scan
    if (options.forceFresh || (!isResuming && !scanInProgress)) {
      await chrome.storage.local.set({ 
        scanInProgress: true,
        scanStartTime: Date.now(),
        activeScanSettings,
        lastPlatformScanned: null,
        platformProgress: {},
        ...(options.forceFresh ? { scanResults: [] } : {})
      });
    }

    // Clear a previous auth pause once the user intentionally resumes.
    await chrome.storage.local.remove(['loginRequiredPause']);

    // Mark scans as actively in progress
    await chrome.storage.local.set({ 
      activeScansInProgress: true,
      scanInProgress: true,
      activePlatforms: platformsToScan,
      completedPlatforms: []
    });

    // Bootstrap the in-memory scan cache from what's already stored.
    // This is the single storage read for the whole scan; subsequent
    // handleArtistFound calls work entirely in memory.
    initScanCache(scanResults);

    // Check if model needs to be downloaded
    if (aiEnabled) {
      try {
        const quantizationType = getCurrentQuantization();
        const modelCached = await isModelCached(quantizationType);
        
        if (!modelCached) {
          console.log('Model not cached, downloading first...');
          await downloadAndCacheModel((status, progress) => {
            chrome.runtime.sendMessage({
              type: 'MODEL_DOWNLOAD_PROGRESS',
              data: { status, progress }
            });
          }, quantizationType);
        }
      } catch (modelError) {
        console.error('Model download failed, trying fallback quantizations:', modelError);
        
        // Try fallback quantizations in order of preference
        const fallbackQuantizations = ['fp16', 'full', 'int8'];
        let fallbackSuccess = false;
        
        for (const fallbackQuantization of fallbackQuantizations) {
          try {
            console.log(`Trying fallback quantization: ${fallbackQuantization}`);
            setCurrentQuantization(fallbackQuantization);
            await downloadAndCacheModel((status, progress) => {
              chrome.runtime.sendMessage({
                type: 'MODEL_DOWNLOAD_PROGRESS',
                data: { status, progress }
              });
            }, fallbackQuantization);
            fallbackSuccess = true;
            console.log(`Successfully downloaded model with ${fallbackQuantization} quantization`);
            break;
          } catch (fallbackError) {
            console.warn(`Fallback quantization ${fallbackQuantization} failed:`, fallbackError);
          }
        }
        
        if (!fallbackSuccess) {
          console.error('All model download attempts failed, continuing without AI analysis');
          // Disable AI temporarily and continue with pattern-based analysis
          await chrome.storage.local.set({ aiEnabled: false });
          console.log('AI analysis disabled due to model download failure');
        }
      }
    }

    // Scan platforms sequentially
    for (const platform of platformsToScan) {
      console.log(`Starting sequential scan for ${platform}...`);
      await chrome.storage.local.set({ lastPlatformScanned: platform });

      const platformProgress = existingProgress[platform] || {};
      
      try {
        await scanPlatform(
          platform === 'furaffinity' ? 'https://www.furaffinity.net/controls/favorites/' :
          platform === 'twitter' ? 'https://twitter.com/following' :
          platform === 'bluesky' ? 'https://bsky.app' : '',
          platform,
          platformProgress
        );
      } catch (error) {
        console.error(`Failed to scan ${platform}:`, error);
        // Continue with next platform even if one fails
      }
    }

  } catch (error) {
    console.error('Scan initialization failed:', error);
    
    // Enhanced error handling for model download issues
    let errorMessage = error.message || error.toString();
    if (error.originalError) {
      console.error('[Background] Original error:', error.originalError);
    }
    
    // Flush any partial results and tear down cache on error
    await flushScanCacheToStorage().catch(() => {});
    await teardownScanCache();

    // Clear active scan state on error
    await chrome.storage.local.set({ 
      activeScansInProgress: false,
      scanInProgress: false
    });
    await chrome.storage.local.remove(['loginRequiredPause']);
    await finishBenchmarkRun('failed', [], errorMessage).catch(() => {});
    
    // Create enhanced error with more context
    const enhancedError = new Error(`Scan initialization failed: ${errorMessage}`);
    enhancedError.originalError = error;
    throw enhancedError; // Re-throw to be caught by caller
  }
}

async function scanPlatform(url, platform, existingProgress = {}) {
  try {
    console.log(`Starting scan for ${platform} with progress:`, existingProgress);
    
    // Create or focus tab for the platform - now as a pinned tab
    const tab = await chrome.tabs.create({ 
      url, 
      active: false,
      pinned: true  // Make the tab pinned
    });
    
    // Store tab info
    activeScanTabs.set(platform, tab.id);
    
    // Wait for tab to load
    await new Promise(resolve => {
      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
    
    // Wait a bit for page to settle
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Inject platform-specific scanner
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [`content/${platform}.js`]
    });
    
    console.log(`Scanner injected for ${platform}`);
    
    // Send start scan message with existing progress
    await chrome.tabs.sendMessage(tab.id, {
      type: 'START_SCAN',
      platform: platform,
      existingProgress: existingProgress
    });
    
  } catch (error) {
    console.error(`Failed to scan ${platform}:`, error);
    handleScanError(platform, error.message);
  }
}

function getPlatformLoginInfo(platform) {
  const loginInfo = {
    furaffinity: {
      name: 'FurAffinity',
      url: 'https://www.furaffinity.net/login/'
    },
    bluesky: {
      name: 'Bluesky',
      url: 'https://bsky.app'
    },
    twitter: {
      name: 'Twitter',
      url: 'https://twitter.com/login'
    }
  };

  return loginInfo[platform] || {
    name: platform,
    url: ''
  };
}

async function handleLoginRequired(platform, errorMessage, sender) {
  console.warn(`[Background] Login required for ${platform}:`, errorMessage);

  try {
    const tabId = activeScanTabs.get(platform) || sender?.tab?.id || null;
    const loginInfo = getPlatformLoginInfo(platform);
    const loginRequiredPause = {
      platform,
      platformName: loginInfo.name,
      loginUrl: loginInfo.url,
      tabId,
      message: errorMessage || `Log in to ${loginInfo.name} to continue scanning.`,
      updatedAt: Date.now()
    };

    const progressData = {};
    for (const [activePlatform] of activeScanTabs) {
      const { [`${activePlatform}_progress`]: platformProgress } =
        await chrome.storage.local.get([`${activePlatform}_progress`]);
      if (platformProgress) {
        progressData[activePlatform] = platformProgress;
      }
    }

    await flushScanCacheToStorage();

    for (const [activePlatform, activeTabId] of activeScanTabs) {
      if (activeTabId === tabId) {
        continue;
      }

      try {
        await chrome.tabs.sendMessage(activeTabId, { type: 'STOP_SCAN' });
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.warn(`Failed to send STOP_SCAN to ${activePlatform} tab ${activeTabId}:`, error);
      }

      try {
        await chrome.tabs.remove(activeTabId);
      } catch (error) {
        console.warn(`Failed to close paused ${activePlatform} tab ${activeTabId}:`, error);
      }
    }

    activeScanTabs.clear();

    progressData[platform] = {
      phase: 'login_required',
      error: loginRequiredPause.message,
      percentage: 5
    };

    await chrome.storage.local.set({
      loginRequiredPause,
      platformProgress: progressData,
      scanInProgress: true,
      activeScansInProgress: false,
      [`${platform}_progress`]: progressData[platform]
    });

    chrome.runtime.sendMessage({
      type: 'LOGIN_REQUIRED',
      data: loginRequiredPause
    }).catch(() => {});
  } catch (error) {
    console.error(`[Background] Error pausing scan for ${platform} login:`, error);
    handleScanError(platform, error.message || errorMessage);
  }
}

async function handleOpenLoginTab(sendResponse) {
  try {
    const { loginRequiredPause } = await chrome.storage.local.get(['loginRequiredPause']);
    if (!loginRequiredPause?.loginUrl) {
      sendResponse({ success: false, error: 'No login-required scan is paused' });
      return;
    }

    let tab = null;
    if (loginRequiredPause.tabId) {
      try {
        tab = await chrome.tabs.get(loginRequiredPause.tabId);
      } catch (error) {
        console.warn('[Background] Stored login tab is no longer available:', error);
      }
    }

    if (tab) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      sendResponse({ success: true });
      return;
    }

    const createdTab = await chrome.tabs.create({
      url: loginRequiredPause.loginUrl,
      active: true
    });
    await chrome.storage.local.set({
      loginRequiredPause: {
        ...loginRequiredPause,
        tabId: createdTab.id
      }
    });
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Failed to open login tab:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleCancelScan(sendResponse) {
  try {
    console.log('[Background] Cancelling scan...');

    for (const [platform, tabId] of activeScanTabs) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'STOP_SCAN' });
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.warn(`Failed to send STOP_SCAN to ${platform} tab ${tabId}:`, error);
      }

      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        console.warn(`Failed to close scan tab for ${platform}:`, error);
      }
    }

    activeScanTabs.clear();
    await flushScanCacheToStorage();
    await teardownScanCache();
    await chrome.storage.local.set({
      scanInProgress: false,
      activeScansInProgress: false,
      activePlatforms: [],
      completedPlatforms: [],
      platformProgress: {},
      lastPlatformScanned: null
    });
    await chrome.storage.local.remove([
      'loginRequiredPause',
      'furaffinity_progress',
      'bluesky_progress',
      'twitter_progress',
      'furaffinity_error',
      'bluesky_error',
      'twitter_error'
    ]);

    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Error cancelling scan:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle stop scan request
async function handleStopScan(sendResponse) {
  try {
    console.log('Stopping active scans...');
    
    // Get current progress before closing tabs
    const progressData = {};
    for (const [platform, tabId] of activeScanTabs) {
      try {
        // Get progress from storage
        const { [`${platform}_progress`]: platformProgress } = 
          await chrome.storage.local.get([`${platform}_progress`]);
        
        if (platformProgress) {
          progressData[platform] = platformProgress;
        }
      } catch (error) {
        console.warn(`Failed to get progress for ${platform} in tab ${tabId}:`, error);
      }
    }
    
    // Flush the in-memory scan cache before pausing
    await flushScanCacheToStorage();

    // Store all progress data and mark scans as paused (not actively running)
    await chrome.storage.local.set({
      platformProgress: progressData,
      scanInProgress: true, // Keep scan in progress state for resumption
      activeScansInProgress: false, // Clear active state since we're stopping
      // Keep activePlatforms and completedPlatforms for potential resumption
    });
    
    // Request benchmark results from content scripts before closing tabs
    for (const [platform, tabId] of activeScanTabs) {
      try {
        // Send STOP_SCAN message to get benchmark results before closing
        await chrome.tabs.sendMessage(tabId, { type: 'STOP_SCAN' });
        // Give a small delay for the message to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.warn(`Failed to send STOP_SCAN to ${platform} tab ${tabId}:`, error);
      }
    }
    
    // Close all active scan tabs
    for (const [platform, tabId] of activeScanTabs) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        console.warn(`Failed to close tab for ${platform}:`, error);
      }
    }
    
    // Clear active tabs
    activeScanTabs.clear();

    // Tear down the scan cache (keeps results in storage, clears timers)
    await teardownScanCache();
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error stopping scan:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Helper function to normalize strings for comparison
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Helper function to check if two names are similar enough to be considered the same artist
function areNamesSimilar(name1, name2) {
  if (!name1 || !name2) return false;
  
  const normalized1 = normalizeString(name1);
  const normalized2 = normalizeString(name2);
  
  // Exact match
  if (normalized1 === normalized2) return true;
  
  // One contains the other (for variations like "artist" vs "artistart")
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    // But make sure it's not just a tiny substring
    const minLength = Math.min(normalized1.length, normalized2.length);
    const maxLength = Math.max(normalized1.length, normalized2.length);
    // Require at least 60% overlap for shorter names, 70% for longer names
    const threshold = minLength < 6 ? 0.6 : 0.7;
    return (minLength / maxLength) >= threshold;
  }
  
  return false;
}

// Helper function to determine which artist result is "better"
function chooseBetterArtist(existing, newArtist) {
  // Priority 1: Commission status (open > unclear > closed)
  const statusPriority = { open: 3, unclear: 2, closed: 1 };
  const existingPriority = statusPriority[existing.commissionStatus] || 0;
  const newPriority = statusPriority[newArtist.commissionStatus] || 0;
  
  if (newPriority > existingPriority) {
    return newArtist;
  } else if (existingPriority > newPriority) {
    return existing;
  }
  
  // Priority 2: If same status, choose higher confidence
  if (newArtist.confidence > existing.confidence) {
    return newArtist;
  } else if (existing.confidence > newArtist.confidence) {
    return existing;
  }
  
  // Priority 3: If same confidence, choose more recent
  const existingTime = existing.lastUpdated || 0;
  const newTime = newArtist.lastUpdated || Date.now();
  
  return newTime > existingTime ? newArtist : existing;
}

// Helper function to merge platform information
function mergePlatformData(baseArtist, additionalArtist) {
  // Initialize platforms array if it doesn't exist
  if (!baseArtist.platforms) {
    baseArtist.platforms = [baseArtist.platform];
  }
  
  // Add the new platform if not already present
  if (!baseArtist.platforms.includes(additionalArtist.platform)) {
    baseArtist.platforms.push(additionalArtist.platform);
  }
  
  // Create platform-specific data storage
  if (!baseArtist.platformData) {
    baseArtist.platformData = {};
  }
  
  // Store the original platform data
  baseArtist.platformData[baseArtist.platform] = {
    username: baseArtist.username,
    displayName: baseArtist.displayName,
    bio: baseArtist.bio,
    stats: baseArtist.stats || null,
    followerCount: baseArtist.followerCount || null,
    viewCount: baseArtist.viewCount || null,
    submissionCount: baseArtist.submissionCount || null,
    favCount: baseArtist.favCount || null,
    profileUrl: baseArtist.profileUrl,
    avatarUrl: baseArtist.avatarUrl,
    profileBackgroundUrl: baseArtist.profileBackgroundUrl || baseArtist.bannerUrl || baseArtist.backgroundUrl || null,
    bannerUrl: baseArtist.bannerUrl || baseArtist.profileBackgroundUrl || baseArtist.backgroundUrl || null,
    confidence: baseArtist.confidence,
    commissionStatus: baseArtist.commissionStatus,
    triggers: baseArtist.triggers,
    analysis: baseArtist.analysis,
    lastUpdated: baseArtist.lastUpdated
  };
  
  // Store the additional platform data
  baseArtist.platformData[additionalArtist.platform] = {
    username: additionalArtist.username,
    displayName: additionalArtist.displayName,
    bio: additionalArtist.bio,
    stats: additionalArtist.stats || null,
    followerCount: additionalArtist.followerCount || null,
    viewCount: additionalArtist.viewCount || null,
    submissionCount: additionalArtist.submissionCount || null,
    favCount: additionalArtist.favCount || null,
    profileUrl: additionalArtist.profileUrl,
    avatarUrl: additionalArtist.avatarUrl,
    profileBackgroundUrl: additionalArtist.profileBackgroundUrl || additionalArtist.bannerUrl || additionalArtist.backgroundUrl || null,
    bannerUrl: additionalArtist.bannerUrl || additionalArtist.profileBackgroundUrl || additionalArtist.backgroundUrl || null,
    confidence: additionalArtist.confidence,
    commissionStatus: additionalArtist.commissionStatus,
    triggers: additionalArtist.triggers,
    analysis: additionalArtist.analysis,
    lastUpdated: additionalArtist.lastUpdated
  };
  
  return baseArtist;
}

function mergeProfileTagData(baseArtist, additionalArtist) {
  const tagMap = new Map();

  for (const sourceArtist of [baseArtist, additionalArtist]) {
    for (const tag of sourceArtist.profileTags || []) {
      if (!tagMap.has(tag.tag)) {
        tagMap.set(tag.tag, {
          ...tag,
          aliases: [...(tag.aliases || [])],
          matchedAliases: [...(tag.matchedAliases || [])],
          sources: [...(tag.sources || [])],
          impliedBy: [...(tag.impliedBy || [])],
        });
        continue;
      }

      const existing = tagMap.get(tag.tag);
      existing.aliases = [...new Set([...existing.aliases, ...(tag.aliases || [])])];
      existing.matchedAliases = [...new Set([...existing.matchedAliases, ...(tag.matchedAliases || [])])];
      existing.sources = [...new Set([...existing.sources, ...(tag.sources || [])])];
      existing.impliedBy = [...new Set([...existing.impliedBy, ...(tag.impliedBy || [])])];
      existing.score = Math.max(existing.score || 0, tag.score || 0);
    }
  }

  const profileTags = [...tagMap.values()]
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.label.localeCompare(b.label));
  const tagAliases = [...new Set([
    ...(baseArtist.tagAliases || []),
    ...(additionalArtist.tagAliases || []),
    ...profileTags.flatMap(tag => [tag.tag, tag.label, ...(tag.aliases || [])]),
  ])].filter(Boolean);

  return {
    ...baseArtist,
    profileTags,
    tagAliases,
    tagSearchText: tagAliases.join(' '),
    tagMatches: [
      ...(baseArtist.tagMatches || []),
      ...(additionalArtist.tagMatches || []),
    ],
    e621ArtistTag: baseArtist.e621ArtistTag || additionalArtist.e621ArtistTag,
    e621PostCount: Math.max(baseArtist.e621PostCount || 0, additionalArtist.e621PostCount || 0),
  };
}

async function handleArtistFound(artistData) {
  debugLog('Artist found:', artistData.username, 'on', artistData.platform);
  
  try {
    // If no active scan cache exists (edge-case: message arrived before scan init),
    // bootstrap the cache from storage so we never lose data.
    if (!scanCache) {
      const { scanResults: stored = [] } = await chrome.storage.local.get(['scanResults']);
      initScanCache(stored);
    }
    const localTagClassification = classifyProfileTags(artistData);
    const e621TagClassification = await classifyProfileTagsFromE621(artistData);
    const tagClassification = e621TagClassification
      ? mergeProfileTagData(localTagClassification, e621TagClassification)
      : localTagClassification;

    // Include analysis data in the artist data
    const resultToStore = {
      ...artistData,
      ...tagClassification,
      analysis: artistData.analysis || null,
      confidence: artistData.confidence,
      commissionStatus: artistData.commissionStatus,
      triggers: artistData.triggers,
      lastUpdated: Date.now()
    };

    // --- O(1) exact same-platform duplicate check ---
    const exactDuplicateIndex = findExactDuplicateIndexInCache(artistData);

    if (exactDuplicateIndex >= 0) {
      debugLog('Found exact duplicate for same platform, updating if better confidence');
      if (artistData.confidence > scanCache.results[exactDuplicateIndex].confidence) {
        const existingPlatformData = scanCache.results[exactDuplicateIndex].platformData || {};
        scanCache.results[exactDuplicateIndex] = {
          ...resultToStore,
          platforms: scanCache.results[exactDuplicateIndex].platforms,
          platformData: {
            ...existingPlatformData,
            [artistData.platform]: {
              username: resultToStore.username,
              displayName: resultToStore.displayName,
              bio: resultToStore.bio,
              stats: resultToStore.stats || null,
              followerCount: resultToStore.followerCount || null,
              viewCount: resultToStore.viewCount || null,
              submissionCount: resultToStore.submissionCount || null,
              favCount: resultToStore.favCount || null,
              profileUrl: resultToStore.profileUrl,
              avatarUrl: resultToStore.avatarUrl,
              profileBackgroundUrl: resultToStore.profileBackgroundUrl || resultToStore.bannerUrl || resultToStore.backgroundUrl || null,
              bannerUrl: resultToStore.bannerUrl || resultToStore.profileBackgroundUrl || resultToStore.backgroundUrl || null,
              confidence: resultToStore.confidence,
              commissionStatus: resultToStore.commissionStatus,
              triggers: resultToStore.triggers,
              analysis: resultToStore.analysis,
              lastUpdated: resultToStore.lastUpdated
            }
          }
        };
      }
      const currentArtist = scanCache.results[exactDuplicateIndex];
      const currentPlatformData = currentArtist.platformData || {};
      const platformKey = artistData.platform;
      const existingPlatformSnapshot = currentPlatformData[platformKey] || {};
      const freshBackgroundUrl = resultToStore.profileBackgroundUrl || resultToStore.bannerUrl || resultToStore.backgroundUrl || null;
      const freshBannerUrl = resultToStore.bannerUrl || resultToStore.profileBackgroundUrl || resultToStore.backgroundUrl || null;

      scanCache.results[exactDuplicateIndex] = {
        ...currentArtist,
        profileBackgroundUrl: currentArtist.profileBackgroundUrl || freshBackgroundUrl || null,
        bannerUrl: currentArtist.bannerUrl || freshBannerUrl || null,
        backgroundUrl: currentArtist.backgroundUrl || freshBackgroundUrl || null,
        platformData: {
          ...currentPlatformData,
          [platformKey]: {
            ...existingPlatformSnapshot,
            username: resultToStore.username || existingPlatformSnapshot.username,
            displayName: resultToStore.displayName || existingPlatformSnapshot.displayName,
            bio: resultToStore.bio || existingPlatformSnapshot.bio,
            stats: resultToStore.stats || existingPlatformSnapshot.stats || null,
            followerCount: resultToStore.followerCount || existingPlatformSnapshot.followerCount || null,
            viewCount: resultToStore.viewCount || existingPlatformSnapshot.viewCount || null,
            submissionCount: resultToStore.submissionCount || existingPlatformSnapshot.submissionCount || null,
            favCount: resultToStore.favCount || existingPlatformSnapshot.favCount || null,
            profileUrl: resultToStore.profileUrl || existingPlatformSnapshot.profileUrl,
            avatarUrl: resultToStore.avatarUrl || existingPlatformSnapshot.avatarUrl,
            profileBackgroundUrl: freshBackgroundUrl || existingPlatformSnapshot.profileBackgroundUrl || null,
            bannerUrl: freshBannerUrl || existingPlatformSnapshot.bannerUrl || null,
            confidence: resultToStore.confidence ?? existingPlatformSnapshot.confidence,
            commissionStatus: resultToStore.commissionStatus || existingPlatformSnapshot.commissionStatus,
            triggers: resultToStore.triggers || existingPlatformSnapshot.triggers,
            analysis: resultToStore.analysis || existingPlatformSnapshot.analysis,
            lastUpdated: resultToStore.lastUpdated || existingPlatformSnapshot.lastUpdated
          }
        }
      };

      const updatedArtist = scanCache.results[exactDuplicateIndex];
      const tagMergedArtist = mergeProfileTagData(updatedArtist, resultToStore);
      // Preserve platform merge fields explicitly to avoid accidental overwrite by tag merge logic.
      scanCache.results[exactDuplicateIndex] = {
        ...updatedArtist,
        ...tagMergedArtist,
        platforms: updatedArtist.platforms,
        platformData: updatedArtist.platformData,
      };
      updateLookupMaps(exactDuplicateIndex);
    } else {
      // --- O(1) fast-path cross-platform duplicate check ---
      const crossPlatformDuplicate = findCrossplatformDuplicateInCache(resultToStore);

      if (crossPlatformDuplicate) {
        debugLog('Found cross-platform duplicate:', {
          existing: { username: crossPlatformDuplicate.username, platform: crossPlatformDuplicate.platform },
          new: { username: resultToStore.username, platform: resultToStore.platform }
        });

        const betterArtist = chooseBetterArtist(crossPlatformDuplicate, resultToStore);
        const additionalArtist = betterArtist === crossPlatformDuplicate ? resultToStore : crossPlatformDuplicate;

        // The cross-platform duplicate is the object reference itself – find its index
        const duplicateIndex = scanCache.results.indexOf(crossPlatformDuplicate);
        const mergedArtist = mergeProfileTagData(
          mergePlatformData({ ...betterArtist }, additionalArtist),
          additionalArtist
        );
        scanCache.results[duplicateIndex] = mergedArtist;
        updateLookupMaps(duplicateIndex);
      } else {
        debugLog('No duplicates found, adding new artist');
        const newIndex = scanCache.results.length;
        scanCache.results.push(resultToStore);
        updateLookupMaps(newIndex);
      }
    }

    debugLog('Cache size after update:', scanCache.results.length);

    // Batched / debounced write – avoids per-artist full storage round-trips
    scheduleScanCacheFlush();

    // Throttled popup notification – avoids flooding the popup renderer
    scheduleResultsUpdate();

  } catch (error) {
    console.error('Error handling found artist:', error);
  }
}

async function handleScanComplete(platform, results) {
  console.log(`Scan complete for ${platform}:`, results.length, 'artists found');
  
  try {
    const storage = await chrome.storage.local.get(['scanResults', 'completedPlatforms', 'activePlatforms']);
    const completedPlatforms = storage.completedPlatforms || [];
    const activePlatforms = storage.activePlatforms || [];
    
    if (!completedPlatforms.includes(platform)) {
      completedPlatforms.push(platform);
      await chrome.storage.local.set({ completedPlatforms });
    }
    
    // Get the tab ID before removing from activeScanTabs
    const tabId = activeScanTabs.get(platform);
    
    // Remove completed platform from active tabs
    activeScanTabs.delete(platform);
    
    // Close the completed platform's tab
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        console.warn(`Failed to close tab for ${platform}:`, error);
      }
    }
    
    console.log(`Platform completion status: ${completedPlatforms.length}/${activePlatforms.length} completed`);
    console.log('Completed platforms:', completedPlatforms);
    console.log('Active platforms:', activePlatforms);
    
    // Check if all scans are complete using the activePlatforms list
    if (activePlatforms.length > 0 && completedPlatforms.length >= activePlatforms.length) {
      console.log('All scans complete - cleaning up and notifying');
      
      // Close any remaining scan tabs
      for (const [remainingPlatform, remainingTabId] of activeScanTabs) {
        try {
          await chrome.tabs.remove(remainingTabId);
        } catch (error) {
          console.warn(`Failed to close remaining tab for ${remainingPlatform}:`, error);
        }
      }
      activeScanTabs.clear();
      
      // Flush the in-memory cache to storage and get the final results
      await flushScanCacheToStorage();
      const finalResults = scanCache ? [...scanCache.results] : [];
      await teardownScanCache();

      const { activeScanSettings = null } = await chrome.storage.local.get(['activeScanSettings']);
      await chrome.storage.local.set({
        scanInProgress: false,
        activeScansInProgress: false,
        lastScanDate: Date.now(),
        lastScanSettings: activeScanSettings ? { ...activeScanSettings, completedAt: Date.now() } : null,
        completedPlatforms: [],
        activePlatforms: []
      });
      await chrome.storage.local.remove(['loginRequiredPause']);
      
      console.log('All scans complete');
      await finishBenchmarkRun('completed', finalResults);
      
      chrome.runtime.sendMessage({
        type: 'SCAN_FINISHED',
        data: finalResults
      }).catch(() => {});
    } else if (activePlatforms.length === 0) {
      // Fallback: if activePlatforms is empty, assume scan is complete
      console.log('No active platforms list found, assuming scan complete');
      
      for (const [remainingPlatform, remainingTabId] of activeScanTabs) {
        try {
          await chrome.tabs.remove(remainingTabId);
        } catch (error) {
          console.warn(`Failed to close remaining tab for ${remainingPlatform}:`, error);
        }
      }
      activeScanTabs.clear();

      await flushScanCacheToStorage();
      const finalResults = scanCache ? [...scanCache.results] : [];
      await teardownScanCache();

      const { activeScanSettings = null } = await chrome.storage.local.get(['activeScanSettings']);
      await chrome.storage.local.set({
        scanInProgress: false,
        activeScansInProgress: false,
        lastScanDate: Date.now(),
        lastScanSettings: activeScanSettings ? { ...activeScanSettings, completedAt: Date.now() } : null,
        completedPlatforms: []
      });
      await chrome.storage.local.remove(['loginRequiredPause']);

      await finishBenchmarkRun('completed', finalResults);
      
      chrome.runtime.sendMessage({
        type: 'SCAN_FINISHED',
        data: finalResults
      }).catch(() => {});
    }
    
  } catch (error) {
    console.error('Error handling scan completion:', error);
    
    // Fallback error handling - ensure scan state is cleared
    try {
      await chrome.storage.local.set({
        scanInProgress: false,
        activeScansInProgress: false,
        completedPlatforms: [],
        activePlatforms: []
      });
      
      // Notify popup of error
      chrome.runtime.sendMessage({
        type: 'SCAN_ERROR',
        platform: platform,
        error: 'Error completing scan: ' + error.message
      }).catch(() => {});
    } catch (fallbackError) {
      console.error('Critical error in scan completion fallback:', fallbackError);
    }
  }
}

async function getStoredResults(sendResponse) {
  try {
    const data = await chrome.storage.local.get([
      'scanResults', 
      'lastScanDate', 
      'lastScanSettings',
      'scanInProgress',
      'activeScansInProgress',
      'loginRequiredPause'
    ]);
    
    // Double-check if scans are actually running by checking active tabs
    let actuallyActiveScanning = data.activeScansInProgress || false;
    
    if (actuallyActiveScanning && activeScanTabs.size === 0) {
      // No active scan tabs but flag says we're scanning - check if any tabs exist
      console.log('[Background] activeScansInProgress was true but no activeScanTabs found, checking for actual scan tabs...');
      
      try {
        const tabs = await chrome.tabs.query({});
        let foundActiveScanTabs = false;
        
        for (const tab of tabs) {
          if (isScanSourceUrl(tab.url)) {

            // Try to ping the content script to see if it's actively scanning
            try {
              await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
              foundActiveScanTabs = true;

              // Restore to activeScanTabs map
              const platform = getPlatformFromUrl(tab.url);
              if (platform) {
                activeScanTabs.set(platform, tab.id);
              }

              console.log(`[Background] Restored active scan tab for platform from URL: ${tab.url}`);
            } catch (error) {
              // Content script not responding, tab is not actively scanning
              console.log(`[Background] Tab ${tab.id} not actively scanning`);
              console.log(error);
            }
          }
        }
        
        // Update the actual state based on what we found
        if (!foundActiveScanTabs) {
          console.log('[Background] No active scan tabs found, cleaning up scan state');
          actuallyActiveScanning = false;
          await chrome.storage.local.set({ 
            activeScansInProgress: false,
            scanInProgress: false,
            activePlatforms: [],
            completedPlatforms: []
          });
        }
      } catch (error) {
        console.error('[Background] Error checking for active scan tabs:', error);
      }
    }
    
    sendResponse({
      success: true,
      results: data.scanResults || [],
      lastScanDate: data.lastScanDate,
      lastScanSettings: data.lastScanSettings || null,
      scanInProgress: data.scanInProgress || false,
      activeScansInProgress: actuallyActiveScanning,
      loginRequiredPause: data.loginRequiredPause || null
    });
  } catch (error) {
    console.error('Error getting stored results:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function clearResults(sendResponse) {
  try {
    await chrome.storage.local.set({
      scanResults: [],
      lastScanDate: null
    });
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error clearing results:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleTestRequest(sendResponse) {
  try {
    // Initialize analyzer if needed
    const analyzer = await initializeAnalyzer();
    
    // Run test cases
    const testCases = [
      { text: "Commissions are OPEN! DM me for details", expected: true },
      { text: "Sorry, commissions are closed right now", expected: false },
      { text: "Taking art commissions, 5 slots available!", expected: true },
      { text: "Not accepting any commission work at this time", expected: false },
      { text: "Hi! I'm an artist who loves to draw", expected: false }
    ];
    
    const results = [];
    for (const testCase of testCases) {
      const result = await analyzer.analyze(testCase.text, 'test');
      results.push({
        text: testCase.text,
        expected: testCase.expected,
        actual: result.commissionStatus,
        confidence: result.confidence,
        passed: result.commissionStatus === testCase.expected.commissionStatus
      });
    }
    
    sendResponse({ 
      success: true, 
      results: results,
      summary: {
        total: results.length,
        passed: results.filter(r => r.passed).length,
        failed: results.filter(r => !r.passed).length
      }
    });
  } catch (error) {
    console.error('Error running tests:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle model change requests
async function handleQuantizationChange(quantizationType, sendResponse) {
  try {
    console.log('[Background] Quantization change requested:', quantizationType);
    
    // Update the current quantization in model manager
    setCurrentQuantization(quantizationType);
    
    // Reset analyzer to force re-initialization with new model
    analyzerInitialized = false;
    initializationPromise = null;
    aiAnalyzer = null;
    
    // Store the selected quantization in storage
    await chrome.storage.local.set({ selectedQuantization: quantizationType });
    
    console.log('[Background] Quantization changed successfully to:', quantizationType);
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Error changing quantization:', error);
    sendResponse({ success: false, error: error.message });
  }
}

function stripProgressForPopup(progressData) {
  if (!progressData || typeof progressData !== 'object') {
    return progressData;
  }

  const popupProgress = { ...progressData };
  // Large resume arrays are only needed for persistence/resume, not live UI.
  delete popupProgress.artists;
  delete popupProgress.following;
  return popupProgress;
}

// Handle scan progress updates (throttled per platform to reduce storage spam)
function handleScanProgress(platform, progressData) {
  debugLog(`[Background] Scan progress for ${platform}:`, progressData);

  // Always forward to popup immediately (cheap runtime message, no storage)
  chrome.runtime.sendMessage({
    type: 'SCAN_PROGRESS_UPDATE',
    platform: platform,
    data: stripProgressForPopup(progressData)
  }).catch(() => {});

  // Buffer the most-recent data and throttle the storage write
  pendingProgressData[platform] = progressData;

  if (progressThrottleTimers[platform]) return; // already scheduled

  progressThrottleTimers[platform] = setTimeout(() => {
    delete progressThrottleTimers[platform];
    const latest = pendingProgressData[platform];
    delete pendingProgressData[platform];
    if (latest) {
      chrome.storage.local.set({ [`${platform}_progress`]: latest }).catch(err =>
        console.error(`[Background] Progress storage error for ${platform}:`, err)
      );
    }
  }, PROGRESS_THROTTLE_MS);
}

// Handle scan errors
async function handleScanError(platform, errorMessage) {
  console.error(`[Background] Scan error for ${platform}:`, errorMessage);
  
  try {
    const storage = await chrome.storage.local.get(['completedPlatforms', 'activePlatforms']);
    const completedPlatforms = storage.completedPlatforms || [];
    const activePlatforms = storage.activePlatforms || [];
    
    // Add failed platform to completed list so scan can continue
    if (!completedPlatforms.includes(platform)) {
      completedPlatforms.push(platform);
      await chrome.storage.local.set({ completedPlatforms });
    }
    
    // Get the tab ID before removing from activeScanTabs
    const tabId = activeScanTabs.get(platform);
    
    // Remove platform from active tabs
    activeScanTabs.delete(platform);
    
    // Close the failed platform's tab
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        console.warn(`Failed to close tab for ${platform}:`, error);
      }
    }
    
    // Store error
    await chrome.storage.local.set({
      [`${platform}_error`]: errorMessage
    });
    
    console.log(`Platform error status: ${completedPlatforms.length}/${activePlatforms.length} completed (including errors)`);
    
    // Check if all scans are complete (including failed ones)
    if (activePlatforms.length > 0 && completedPlatforms.length >= activePlatforms.length) {
      console.log('All scans complete (some with errors) - cleaning up and notifying');
      
      // Close any remaining scan tabs
      for (const [errPlatform, errTabId] of activeScanTabs) {
        try {
          await chrome.tabs.remove(errTabId);
        } catch (tabErr) {
          console.warn(`Failed to close remaining tab for ${errPlatform}:`, tabErr);
        }
      }
      activeScanTabs.clear();

      // Flush cache before clearing state
      await flushScanCacheToStorage();
      const finalResults = scanCache ? [...scanCache.results] : [];
      await teardownScanCache();
      
      await chrome.storage.local.set({
        scanInProgress: false,
        activeScansInProgress: false,
        lastScanDate: Date.now(),
        completedPlatforms: [],
        activePlatforms: []
      });
      
      chrome.runtime.sendMessage({
        type: 'SCAN_FINISHED',
        data: finalResults
      }).catch(() => {});

      await finishBenchmarkRun('completed_with_errors', finalResults, errorMessage);
    }
    
    // Notify popup of the specific error
    chrome.runtime.sendMessage({
      type: 'SCAN_ERROR_UPDATE',
      platform: platform,
      error: errorMessage
    }).catch(() => {});
    
  } catch (storageError) {
    console.error(`[Background] Error handling scan error for ${platform}:`, storageError);
    
    // Fallback - clear scan state
    await chrome.storage.local.set({
      scanInProgress: false,
      activeScansInProgress: false,
      completedPlatforms: [],
      activePlatforms: []
    }).catch(() => {});
  }
}

// Handle temperature update
async function handleTemperatureUpdate(temperature, sendResponse) {
  try {
    
    if(isDebugMode) {
      console.log('[Background] Updating model temperature to:', temperature);
    }
    // Store the new temperature
    await chrome.storage.local.set({ modelTemperature: temperature });
    
    // Reset analyzer to force re-initialization with new temperature
    analyzerInitialized = false;
    initializationPromise = null;
    aiAnalyzer = null;
    
    sendResponse({ success: true });
  } catch (error) {
    console.error('[Background] Error updating temperature:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle opening extension in a separate window
async function handleOpenInWindow(sendResponse) {
  try {
    // Create a new popup window with the extension (twice the popup size)
    const window = await chrome.windows.create({
      url: chrome.runtime.getURL('popup/popup.html'),
      type: 'popup',
      width: 500,
      height: 900,
      focused: true
    });
    
    if (isDebugMode) {
      console.log('[Background] Created window with ID:', window.id);
    }
    
    if (sendResponse) {
      sendResponse({ success: true, windowId: window.id });
    }
  } catch (error) {
    console.error('[Background] Error creating window:', error);
    if (sendResponse) {
      sendResponse({ success: false, error: error.message });
    }
  }
}

// Load the selected quantization at startup
async function initializeSelectedQuantization() {
  try {
    const { selectedQuantization } = await chrome.storage.local.get(['selectedQuantization']);
    if (selectedQuantization) {
      console.log('[Background] Setting startup quantization:', selectedQuantization);
      setCurrentQuantization(selectedQuantization);
    }
  } catch (error) {
    console.error('[Background] Error initializing selected quantization:', error);
  }
}

// Initialize quantization on startup
initializeSelectedQuantization();

// Handle extension icon click - open in window instead of popup
chrome.action.onClicked.addListener(async () => {
  if (isDebugMode) {
    console.log('[Background] Extension icon clicked, opening window');
  }
  
  // Open the extension in a window
  await handleOpenInWindow();
});

// Store benchmark results
let benchmarkResults = {};

async function handleBenchmarkResults(platform, results) {
  console.log(`[Background] Received benchmark results for ${platform}:`, results);
  benchmarkResults[platform] = results;
  
  // Store in chrome.storage for persistence
  await chrome.storage.local.set({ benchmarkResults });
  
  // Forward to popup if open
  chrome.runtime.sendMessage({
    type: 'BENCHMARK_RESULTS_UPDATE',
    platform: platform,
    results: results
  }).catch(() => {}); // Ignore if popup is closed
}

async function finishBenchmarkRun(status, finalResults = [], error = null) {
  const stored = await chrome.storage.local.get(['activeBenchmarkRun', 'benchmarkResults']);
  const activeBenchmarkRun = stored.activeBenchmarkRun;
  if (!activeBenchmarkRun) return null;

  const finishedAt = Date.now();
  const perPlatformResults = stored.benchmarkResults || benchmarkResults || {};
  const lastBenchmarkRun = {
    ...activeBenchmarkRun,
    status,
    error,
    finishedAt,
    wallClockMs: finishedAt - activeBenchmarkRun.startedAt,
    wallClockSeconds: (finishedAt - activeBenchmarkRun.startedAt) / 1000,
    resultCount: Array.isArray(finalResults) ? finalResults.length : 0,
    benchmarkResults: perPlatformResults,
    platformSummaries: Object.fromEntries(
      Object.entries(perPlatformResults).map(([platform, result]) => [
        platform,
        {
          profileCount: result?.profileCount || 0,
          totalTimeMs: result?.totalTimeMs || 0,
          totalTimeSeconds: result?.totalTimeSeconds || 0,
          topSteps: Array.isArray(result?.steps) ? result.steps.slice(0, 8) : [],
        },
      ])
    ),
  };

  await chrome.storage.local.remove(['activeBenchmarkRun']);
  await chrome.storage.local.set({ lastBenchmarkRun });

  chrome.runtime.sendMessage({
    type: 'BENCHMARK_SCAN_FINISHED',
    data: lastBenchmarkRun,
  }).catch(() => {});

  return lastBenchmarkRun;
}

async function getStoredBenchmarkResults(sendResponse) {
  try {
    const stored = await chrome.storage.local.get(['benchmarkResults', 'lastBenchmarkRun']);
    sendResponse({
      success: true,
      results: stored.benchmarkResults || benchmarkResults,
      run: stored.lastBenchmarkRun || null
    });
  } catch (error) {
    console.error('Error getting benchmark results:', error);
    sendResponse({
      success: false,
      error: error.message,
      results: benchmarkResults
    });
  }
}

async function getStoredBenchmarkRun(sendResponse) {
  try {
    const stored = await chrome.storage.local.get(['lastBenchmarkRun', 'activeBenchmarkRun']);
    sendResponse({
      success: true,
      run: stored.lastBenchmarkRun || null,
      activeRun: stored.activeBenchmarkRun || null,
    });
  } catch (error) {
    console.error('Error getting benchmark run:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Initialize debug mode when extension starts
initDebugMode();

// Log that the service worker is ready
console.log('[Background] Service worker initialized in context:', getExecutionContext()); 
