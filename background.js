// Background Service Worker
import { getExecutionContext, debugLog } from './utils/shared.js';
import { isModelCached, downloadAndCacheModel, setCurrentQuantization, getCurrentQuantization } from './utils/model-manager.js';
import { AIAnalyzer } from './utils/ai-analyzer.js';

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
        if (tab.url?.includes('furaffinity.net/controls/') ||
            tab.url?.includes('bsky.app/profile') ||
            tab.url?.includes('twitter.com/following')) {
          
          // Try to ping the content script to see if it's actively scanning
          try {
            await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
            foundActiveScanTabs = true;
            
            // Determine platform from URL and restore to activeScanTabs
            if (tab.url.includes('furaffinity.net')) {
              activeScanTabs.set('furaffinity', tab.id);
            } else if (tab.url.includes('bsky.app')) {
              activeScanTabs.set('bluesky', tab.id);
            } else if (tab.url.includes('twitter.com')) {
              activeScanTabs.set('twitter', tab.id);
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
      handleScanRequest(request.platforms, sendResponse);
      return true; // Keep message channel open for async response
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

    if (request.type === 'UPDATE_TEMPERATURE') {
      handleTemperatureUpdate(request.temperature, sendResponse);
      return true;
    }

    if (request.type === 'UPDATE_DEBUG_MODE') {
      handleDebugModeUpdate(request.debugMode);
      sendResponse({ success: true });
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
          date: item.date
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

      // AI mode - use the full AI analyzer
      const analyzer = await initializeAnalyzer();
      
      if (request.type === 'analyze_components') {
        result = await analyzer.analyzeComponents(request.components);
      } else {
        result = await analyzer.analyze(request.text, request.context || 'bio');
      // AI mode - use the full AI analyzer with timeout protection
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
        if (timeoutError.message.includes('timeout')) {
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
    
  } 
} catch (error) {
    console.error('[Background] Analysis failed:', error);
    sendResponse({ 
      success: false, 
      error: error.message || 'Analysis failed' 
    });
  }
}

async function handleScanRequest(platforms, sendResponse) {
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
    initializeScan(platforms).catch(error => {
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

// New function to handle async scan initialization
async function initializeScan(platforms) {
  try {
    // Get existing scan state
    const { 
      scanInProgress = false, 
      lastPlatformScanned = null,
      scanResults = []
    } = await chrome.storage.local.get([
      'scanInProgress',
      'lastPlatformScanned',
      'scanResults'
    ]);

    // Get existing progress data
    const existingProgress = {};
    for (const platform of platforms) {
      const { [`${platform}_progress`]: platformProgressData } = 
        await chrome.storage.local.get([`${platform}_progress`]);
      
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
    
    if (scanInProgress && lastPlatformScanned) {
      const lastIndex = platforms.indexOf(lastPlatformScanned);
      if (lastIndex >= 0) {
        platformsToScan = platforms.slice(lastIndex);
        isResuming = true;
      }
    }

    // Only clear results if this is a completely fresh scan
    if (!isResuming && !scanInProgress) {
      await chrome.storage.local.set({ 
        scanInProgress: true,
        scanStartTime: Date.now(),
        lastPlatformScanned: null,
        platformProgress: {}
      });
    }

    // Mark scans as actively in progress
    await chrome.storage.local.set({ 
      activeScansInProgress: true,
      scanInProgress: true,
      activePlatforms: platformsToScan,
      completedPlatforms: []
    });

    // Check if model needs to be downloaded
    const { aiEnabled = true } = await chrome.storage.local.get(['aiEnabled']);
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
          platform === 'bluesky' ? 'https://bsky.app/profile' : '',
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
    
    // Clear active scan state on error
    await chrome.storage.local.set({ 
      activeScansInProgress: false,
      scanInProgress: false
    });
    
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
        console.warn(`Failed to get progress for ${platform}:`, error);
      }
    }
    
    // Store all progress data and mark scans as paused (not actively running)
    await chrome.storage.local.set({
      platformProgress: progressData,
      scanInProgress: true, // Keep scan in progress state for resumption
      activeScansInProgress: false, // Clear active state since we're stopping
      // Keep activePlatforms and completedPlatforms for potential resumption
    });
    
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

// Helper function to find cross-platform duplicates
function findCrossplatformDuplicate(newArtist, existingResults) {
  return existingResults.find(existing => {
    // Skip if same platform (handled by existing logic)
    if (existing.platform === newArtist.platform || 
        (existing.platforms && existing.platforms.includes(newArtist.platform))) {
      return false;
    }
    
    // Check username similarity
    if (areNamesSimilar(existing.username, newArtist.username)) {
      return true;
    }
    
    // Check display name similarity
    if (areNamesSimilar(existing.displayName, newArtist.displayName)) {
      return true;
    }
    
    return false;
  });
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
    profileUrl: baseArtist.profileUrl,
    avatarUrl: baseArtist.avatarUrl,
    confidence: baseArtist.confidence,
    commissionStatus: baseArtist.commissionStatus,
    triggers: baseArtist.triggers,
    analysis: baseArtist.analysis,
    lastUpdated: baseArtist.lastUpdated
  };
  
  // Store the additional platform data
  baseArtist.platformData[additionalArtist.platform] = {
    username: additionalArtist.username,
    profileUrl: additionalArtist.profileUrl,
    avatarUrl: additionalArtist.avatarUrl,
    confidence: additionalArtist.confidence,
    commissionStatus: additionalArtist.commissionStatus,
    triggers: additionalArtist.triggers,
    analysis: additionalArtist.analysis,
    lastUpdated: additionalArtist.lastUpdated
  };
  
  return baseArtist;
}

async function handleArtistFound(artistData) {
  debugLog('Artist found:', artistData.username, 'on', artistData.platform);
  
  try {
    const { scanResults = [] } = await chrome.storage.local.get(['scanResults']);
    
    // Include analysis data in the artist data
    const resultToStore = {
      ...artistData,
      analysis: artistData.analysis || null,
      confidence: artistData.confidence,
      commissionStatus: artistData.commissionStatus,
      triggers: artistData.triggers,
      lastUpdated: Date.now()
    };
    
    // Check for exact duplicates within the same platform first
    const exactDuplicateIndex = scanResults.findIndex(
      artist => artist.username === artistData.username && 
                (artist.platform === artistData.platform || 
                 (artist.platforms && artist.platforms.includes(artistData.platform)))
    );
    
    if (exactDuplicateIndex >= 0) {
      console.log('Found exact duplicate for same platform, updating if better confidence');
      // Update existing entry if this one has higher confidence
      if (artistData.confidence > scanResults[exactDuplicateIndex].confidence) {
        // Preserve platform data but update main fields
        const existingPlatformData = scanResults[exactDuplicateIndex].platformData || {};
        scanResults[exactDuplicateIndex] = {
          ...resultToStore,
          platforms: scanResults[exactDuplicateIndex].platforms,
          platformData: {
            ...existingPlatformData,
            [artistData.platform]: {
              username: resultToStore.username,
              profileUrl: resultToStore.profileUrl,
              avatarUrl: resultToStore.avatarUrl,
              confidence: resultToStore.confidence,
              commissionStatus: resultToStore.commissionStatus,
              triggers: resultToStore.triggers,
              analysis: resultToStore.analysis,
              lastUpdated: resultToStore.lastUpdated
            }
          }
        };
      }
    } else {
      // Check for cross-platform duplicates
      const crossPlatformDuplicate = findCrossplatformDuplicate(resultToStore, scanResults);
      
      if (crossPlatformDuplicate) {
        console.log('Found cross-platform duplicate:', {
          existing: { username: crossPlatformDuplicate.username, platform: crossPlatformDuplicate.platform },
          new: { username: resultToStore.username, platform: resultToStore.platform }
        });
        
        // Determine which artist data to use as the base
        const betterArtist = chooseBetterArtist(crossPlatformDuplicate, resultToStore);
        const additionalArtist = betterArtist === crossPlatformDuplicate ? resultToStore : crossPlatformDuplicate;
        
        console.log('Chose better artist:', {
          base: { username: betterArtist.username, platform: betterArtist.platform, status: betterArtist.commissionStatus, confidence: betterArtist.confidence },
          additional: { username: additionalArtist.username, platform: additionalArtist.platform, status: additionalArtist.commissionStatus, confidence: additionalArtist.confidence }
        });
        
        // Find the index of the duplicate to replace
        const duplicateIndex = scanResults.findIndex(artist => artist === crossPlatformDuplicate);
        
        // Merge the platform data
        const mergedArtist = mergePlatformData({ ...betterArtist }, additionalArtist);
        
        console.log('Merged artist data:', {
          username: mergedArtist.username,
          displayName: mergedArtist.displayName,
          platforms: mergedArtist.platforms,
          commissionStatus: mergedArtist.commissionStatus,
          confidence: mergedArtist.confidence
        });
        
        // Replace the existing entry with the merged data
        scanResults[duplicateIndex] = mergedArtist;
      } else {
        // No duplicates found, add as new artist
        debugLog('No duplicates found, adding new artist');
        scanResults.push(resultToStore);
      }
    }
    
    await chrome.storage.local.set({ scanResults });
    
    debugLog('Updated scan results, total artists:', scanResults.length);
    
    // Notify popup if it's open
    chrome.runtime.sendMessage({
      type: 'RESULTS_UPDATED',
      data: scanResults
    }).catch(() => {}); // Ignore if popup is closed
    
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
      for (const [platform, tabId] of activeScanTabs) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (error) {
          console.warn(`Failed to close remaining tab for ${platform}:`, error);
        }
      }
      
      // Clear active tabs map
      activeScanTabs.clear();
      
      // Get current scan results before clearing state
      const { scanResults: currentResults = [] } = await chrome.storage.local.get(['scanResults']);
      
      await chrome.storage.local.set({
        scanInProgress: false,
        activeScansInProgress: false, // Clear active state
        lastScanDate: Date.now(),
        completedPlatforms: [],
        activePlatforms: [], // Clear active platforms list
        scanResults: currentResults // Preserve the scan results
      });
      
      console.log('All scans complete');
      
      // Use the preserved results
      const scanResults = currentResults;
      
      // Notify popup
      chrome.runtime.sendMessage({
        type: 'SCAN_FINISHED',
        data: scanResults
      }).catch(() => {});
    } else if (activePlatforms.length === 0) {
      // Fallback: if activePlatforms is empty, assume scan is complete
      console.log('No active platforms list found, assuming scan complete');
      
      // Close any remaining scan tabs
      for (const [platform, tabId] of activeScanTabs) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (error) {
          console.warn(`Failed to close remaining tab for ${platform}:`, error);
        }
      }
      
      // Clear active tabs map
      activeScanTabs.clear();
      
      // Get current scan results before clearing state
      const { scanResults: currentResults = [] } = await chrome.storage.local.get(['scanResults']);
      
      await chrome.storage.local.set({
        scanInProgress: false,
        activeScansInProgress: false,
        lastScanDate: Date.now(),
        completedPlatforms: [],
        scanResults: currentResults // Preserve the scan results
      });
      
      // Use the preserved results
      const scanResults = currentResults;
      
      // Notify popup
      chrome.runtime.sendMessage({
        type: 'SCAN_FINISHED',
        data: scanResults
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
      'scanInProgress',
      'activeScansInProgress'
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
          if (tab.url?.includes('furaffinity.net/controls/') ||
              tab.url?.includes('bsky.app/profile') ||
              tab.url?.includes('twitter.com/following')) {
            
            // Try to ping the content script to see if it's actively scanning
            try {
              await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
              foundActiveScanTabs = true;
              
              // Restore to activeScanTabs map
              if (tab.url.includes('furaffinity.net')) {
                activeScanTabs.set('furaffinity', tab.id);
              } else if (tab.url.includes('bsky.app')) {
                activeScanTabs.set('bluesky', tab.id);
              } else if (tab.url.includes('twitter.com')) {
                activeScanTabs.set('twitter', tab.id);
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
      scanInProgress: data.scanInProgress || false,
      activeScansInProgress: actuallyActiveScanning
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

// Handle scan progress updates
async function handleScanProgress(platform, progressData) {
  debugLog(`[Background] Scan progress for ${platform}:`, progressData);
  
  // Store progress data
  await chrome.storage.local.set({
    [`${platform}_progress`]: progressData
  });
  
  // Forward to popup if open
  chrome.runtime.sendMessage({
    type: 'SCAN_PROGRESS_UPDATE',
    platform: platform,
    data: progressData
  }).catch(() => {}); // Ignore if popup is closed
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
      for (const [platform, tabId] of activeScanTabs) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (error) {
          console.warn(`Failed to close remaining tab for ${platform}:`, error);
        }
      }
      
      // Clear active tabs map
      activeScanTabs.clear();
      
      await chrome.storage.local.set({
        scanInProgress: false,
        activeScansInProgress: false,
        lastScanDate: Date.now(),
        completedPlatforms: [],
        activePlatforms: []
      });
      
      // Get final results from storage
      const { scanResults = [] } = await chrome.storage.local.get(['scanResults']);
      
      // Notify popup that scan finished (even with some errors)
      chrome.runtime.sendMessage({
        type: 'SCAN_FINISHED',
        data: scanResults
      }).catch(() => {});
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

// Initialize debug mode when extension starts
initDebugMode();

// Log that the service worker is ready
console.log('[Background] Service worker initialized in context:', getExecutionContext()); 