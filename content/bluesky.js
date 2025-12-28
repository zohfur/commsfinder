// Bluesky content script for commission scanning

console.log('CommsFinder: Bluesky content script loaded');

// Import performance benchmark
import { getBenchmark, enableBenchmark } from '../utils/performance-benchmark.js';

// Create progress overlay
function createProgressOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'commsfinder-progress-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 20px;
        border-radius: 8px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        z-index: 99999;
        min-width: 300px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        display: none;
    `;
    
    overlay.innerHTML = `
        <div style="font-weight: bold; font-size: 16px; margin-bottom: 10px;">
            🔍 CommsFinder Scanning Bluesky...
        </div>
        <div id="commsfinder-status" style="margin-bottom: 10px;">Initializing...</div>
        <div style="background: #333; height: 8px; border-radius: 4px; overflow: hidden;">
            <div id="commsfinder-progress-bar" style="
                background: linear-gradient(90deg, #1da1f2, #0084b4);
                height: 100%;
                width: 0%;
                transition: width 0.3s ease;
            "></div>
        </div>
        <div id="commsfinder-details" style="margin-top: 10px; font-size: 12px; color: #ccc;"></div>
    `;
    
    document.body.appendChild(overlay);
    return overlay;
}

// Update progress overlay
function updateProgressOverlay(phase, details = {}) {
    const overlay = document.getElementById('commsfinder-progress-overlay');
    if (!overlay) return;
    
    const statusEl = document.getElementById('commsfinder-status');
    const progressBar = document.getElementById('commsfinder-progress-bar');
    const detailsEl = document.getElementById('commsfinder-details');
    
    // Safety check - if elements don't exist, don't proceed
    if (!statusEl || !progressBar || !detailsEl) {
        console.warn('[Bluesky] Progress overlay elements not found');
        return;
    }
    
    let statusText = '';
    let progress = 0;
    let detailsText = '';
    
    switch (phase) {
        case 'show':
            overlay.style.display = 'block';
            return;
        case 'hide':
            overlay.style.display = 'none';
            return;
        case 'checking_auth':
            statusText = 'Checking authentication...';
            progress = 5;
            break;
        case 'gathering_following':
            statusText = 'Gathering following list...';
            progress = 10;
            detailsText = details.source || '';
            break;
        case 'scanning_artists':
            if (details.currentArtist) {
                statusText = `Scanning: ${details.currentArtist}`;
                if (details.subTask && details.subProgress) {
                    statusText += ` - ${details.subTask} (${details.subProgress}%)`;
                }
            } else {
                statusText = 'Scanning artists...';
            }
            progress = details.percentage || 0;
            detailsText = details.total ? 
                `Progress: ${details.completed || 0} / ${details.total} artists` : '';
            break;
        case 'completed':
            statusText = 'Scan completed!';
            progress = 100;
            detailsText = `Found ${details.total || 0} artists`;
            setTimeout(() => updateProgressOverlay('hide'), 3000);
            break;
        case 'error':
            statusText = 'Scan error';
            detailsText = details.error || 'An error occurred';
            progressBar.style.background = 'linear-gradient(90deg, #f44336, #d32f2f)';
            setTimeout(() => updateProgressOverlay('hide'), 5000);
            break;
    }
    
    if (statusText) statusEl.textContent = statusText;
    if (progress) progressBar.style.width = `${progress}%`;
    if (detailsText) detailsEl.textContent = detailsText;
}

// Configuration
const CONFIG = {
    RATE_LIMIT_DELAY: 1000, // 1 second between requests
    ERROR_RETRY_DELAY: 30000, // 30 seconds on error
    MAX_RETRIES: 3,
    MAX_POSTS_PER_USER: 5, // Limit posts to analyze per artist
    MAX_JOURNAL_LENGTH: 5000, // Limit bio and post text length
    API_BASE: 'https://public.api.bsky.app/xrpc',
    CACHE_TTL: 30 * 60 * 1000, // 30 minutes cache TTL
};

// Request deduplication: track in-flight requests to avoid duplicates
const activeRequests = new Map(); // URL → Promise

// Profile data cache with TTL (in-memory for fast access)
const profileCache = new Map(); // userDid → { data, timestamp }

// Storage key for persistent cache
const CACHE_STORAGE_KEY = 'bluesky_profile_cache';
let cacheInitialized = false;

// Initialize cache from persistent storage
async function initializeCache() {
    if (cacheInitialized) return;
    
    try {
        if (!isExtensionContextValid()) {
            console.warn('[Bluesky] Extension context invalid, skipping cache initialization');
            cacheInitialized = true;
            return;
        }
        
        const result = await chrome.storage.local.get([CACHE_STORAGE_KEY]);
        const storedCache = result[CACHE_STORAGE_KEY];
        
        if (storedCache && typeof storedCache === 'object') {
            const now = Date.now();
            let loadedCount = 0;
            
            // Load valid entries (not expired)
            for (const [userDid, entry] of Object.entries(storedCache)) {
                if (entry && entry.timestamp && (now - entry.timestamp) < CONFIG.CACHE_TTL) {
                    profileCache.set(userDid, entry);
                    loadedCount++;
                }
            }
            
            console.log(`[Bluesky] Loaded ${loadedCount} cached profiles from storage`);
            
            // Clean up expired entries from storage (if any were expired)
            if (Object.keys(storedCache).length > loadedCount) {
                // Save cleaned cache immediately (not debounced) since we're initializing
                try {
                    const cleanedCache = {};
                    const now = Date.now();
                    for (const [userDid, entry] of Object.entries(storedCache)) {
                        if (entry && entry.timestamp && (now - entry.timestamp) < CONFIG.CACHE_TTL) {
                            cleanedCache[userDid] = entry;
                        }
                    }
                    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cleanedCache });
                } catch (error) {
                    console.warn('[Bluesky] Failed to clean expired cache entries:', error);
                }
            }
        }
    } catch (error) {
        console.warn('[Bluesky] Failed to initialize cache from storage:', error);
        // Continue with empty cache - in-memory only
    }
    
    cacheInitialized = true;
}

// Save cache to persistent storage (debounced to avoid excessive writes)
let saveCacheTimeout = null;
async function saveCacheToStorage() {
    if (!isExtensionContextValid()) {
        return; // Can't save if extension context is invalid
    }
    
    // Debounce saves to avoid excessive storage writes
    if (saveCacheTimeout) {
        clearTimeout(saveCacheTimeout);
    }
    
    saveCacheTimeout = setTimeout(async () => {
        try {
            const now = Date.now();
            const cacheToSave = {};
            
            // Only save valid (non-expired) entries
            for (const [userDid, entry] of profileCache.entries()) {
                if (entry && entry.timestamp && (now - entry.timestamp) < CONFIG.CACHE_TTL) {
                    cacheToSave[userDid] = entry;
                }
            }
            
            // Limit cache size to prevent storage quota issues (keep most recent 500 entries)
            const entries = Object.entries(cacheToSave);
            if (entries.length > 500) {
                // Sort by timestamp and keep most recent 500
                entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
                const limitedCache = {};
                for (let i = 0; i < 500; i++) {
                    limitedCache[entries[i][0]] = entries[i][1];
                }
                await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: limitedCache });
            } else {
                await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cacheToSave });
            }
            
            console.log(`[Bluesky] Saved ${Object.keys(cacheToSave).length} profiles to persistent cache`);
        } catch (error) {
            console.warn('[Bluesky] Failed to save cache to storage:', error);
            // Continue - cache will work in-memory only
        }
    }, 2000); // Debounce: save 2 seconds after last cache update
}

// Clean up expired entries from both memory and storage
async function cleanupExpiredCache() {
    const now = Date.now();
    let cleanedMemory = 0;
    let cleanedStorage = 0;
    
    // Clean memory cache
    for (const [userDid, entry] of profileCache.entries()) {
        if (!entry.timestamp || (now - entry.timestamp) >= CONFIG.CACHE_TTL) {
            profileCache.delete(userDid);
            cleanedMemory++;
        }
    }
    
    // Clean storage cache
    if (isExtensionContextValid()) {
        try {
            const result = await chrome.storage.local.get([CACHE_STORAGE_KEY]);
            const storedCache = result[CACHE_STORAGE_KEY];
            
            if (storedCache && typeof storedCache === 'object') {
                const cleanedCache = {};
                for (const [userDid, entry] of Object.entries(storedCache)) {
                    if (entry && entry.timestamp && (now - entry.timestamp) < CONFIG.CACHE_TTL) {
                        cleanedCache[userDid] = entry;
                    } else {
                        cleanedStorage++;
                    }
                }
                
                if (cleanedStorage > 0) {
                    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cleanedCache });
                }
            }
        } catch (error) {
            console.warn('[Bluesky] Failed to clean storage cache:', error);
        }
    }
    
    if (cleanedMemory > 0 || cleanedStorage > 0) {
        console.log(`[Bluesky] Cleaned ${cleanedMemory} memory entries and ${cleanedStorage} storage entries`);
    }
}

// Deduplicated fetch function - returns existing promise if request is in flight
async function dedupeFetch(url, options = {}) {
    // Return existing promise if request is in flight
    if (activeRequests.has(url)) {
        console.log(`[Bluesky] Request deduplication: reusing in-flight request for ${url}`);
        return activeRequests.get(url);
    }

    // Create new request promise
    const promise = fetch(url, options)
        .finally(() => {
            // Clean up when done
            activeRequests.delete(url);
        });

    activeRequests.set(url, promise);
    return promise;
}

// Get cached profile data if still valid (checks both memory and storage)
async function getCachedProfile(userDid) {
    // Ensure cache is initialized
    if (!cacheInitialized) {
        await initializeCache();
    }
    
    // Check in-memory cache first (fastest)
    const cached = profileCache.get(userDid);
    if (cached && (Date.now() - cached.timestamp) < CONFIG.CACHE_TTL) {
        console.log(`[Bluesky] Cache hit (memory) for profile: ${userDid}`);
        return cached.data;
    }
    
    // Remove expired cache entry from memory
    if (cached) {
        profileCache.delete(userDid);
    }
    
    // If not in memory, try loading from storage (only if extension context is valid)
    if (isExtensionContextValid()) {
        try {
            const result = await chrome.storage.local.get([CACHE_STORAGE_KEY]);
            const storedCache = result[CACHE_STORAGE_KEY];
            
            if (storedCache && storedCache[userDid]) {
                const storedEntry = storedCache[userDid];
                const now = Date.now();
                
                if (storedEntry.timestamp && (now - storedEntry.timestamp) < CONFIG.CACHE_TTL) {
                    // Load into memory cache for faster future access
                    profileCache.set(userDid, storedEntry);
                    console.log(`[Bluesky] Cache hit (storage) for profile: ${userDid}`);
                    return storedEntry.data;
                } else {
                    // Expired - remove from storage
                    delete storedCache[userDid];
                    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: storedCache });
                }
            }
        } catch (error) {
            console.warn('[Bluesky] Failed to check storage cache:', error);
            // Continue - will fetch fresh data
        }
    }
    
    return null;
}

// Cache profile data (both memory and storage)
async function cacheProfile(userDid, data) {
    const entry = {
        data: data,
        timestamp: Date.now()
    };
    
    // Update in-memory cache
    profileCache.set(userDid, entry);
    console.log(`[Bluesky] Cached profile data for: ${userDid}`);
    
    // Clean up old cache entries periodically (keep cache size reasonable)
    if (profileCache.size > 1000) {
        await cleanupExpiredCache();
    }
    
    // Save to persistent storage (debounced - schedules save for 2 seconds later)
    saveCacheToStorage();
}

// Progress tracking (same structure as FurAffinity)
class ProgressTracker {
    constructor() {
        this.total = 0;
        this.completed = 0;
        this.phase = 'initializing';
        this.currentArtist = null;
        this.errors = 0;
        this.rateLimited = false;
        this.subTask = null;
        this.subProgress = 0;
        this.lastUpdate = 0;
        this.pendingUpdate = null;
        this.updateThrottleMs = 10;
        this.following = null; // Store the full following list
    }

    update(data) {
        Object.assign(this, data);
        this.queueUpdate();
    }

    queueUpdate() {
        if (this.pendingUpdate) {
            cancelAnimationFrame(this.pendingUpdate);
        }

        const now = performance.now();
        const timeSinceLastUpdate = now - this.lastUpdate;

        if (timeSinceLastUpdate >= this.updateThrottleMs) {
            this.sendUpdate();
            this.lastUpdate = now;
        } else {
            this.pendingUpdate = requestAnimationFrame(() => {
                this.sendUpdate();
                this.lastUpdate = performance.now();
                this.pendingUpdate = null;
            });
        }
    }

    sendUpdate() {
        try {
            let overallPercentage = 0;
            if (this.total > 0) {
                const baseProgress = (this.completed / this.total) * 100;
                if (this.subProgress > 0) {
                    const subTaskWeight = 1 / this.total;
                    const subTaskProgress = this.subProgress / 100;
                    const weightedSubProgress = subTaskWeight * subTaskProgress;
                    overallPercentage = baseProgress + (weightedSubProgress * 100);
                } else {
                    overallPercentage = baseProgress;
                }
                
                overallPercentage = Math.min(Math.max(overallPercentage, baseProgress), 100);
            }

            const data = {
                phase: this.phase,
                total: this.total,
                completed: this.completed,
                currentArtist: this.currentArtist,
                errors: this.errors,
                rateLimited: this.rateLimited,
                percentage: Math.round(overallPercentage * 10) / 10,
                subTask: this.subTask,
                subProgress: this.subProgress
            };
            
            // Include following array for resumption if it exists
            if (this.following) {
                data.following = this.following;
            }
            
            updateProgressOverlay(this.phase, data);
            
            // Only attempt to send message if extension context is valid
            if (isExtensionContextValid()) {
                chrome.runtime.sendMessage({
                    type: 'SCAN_PROGRESS',
                    platform: 'bluesky',
                    data: data
                }).catch(error => {
                    console.warn('[Bluesky] Failed to send progress update:', error);
                });
            }
        } catch (error) {
            console.error('[Bluesky] Error in sendUpdate:', error);
        }
    }
}

const progress = new ProgressTracker();

// Helper functions
function isExtensionContextValid() {
    try {
        return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (error) {
        console.error('[Bluesky] Error checking extension context:', error);
        return false;
    }
}

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function rateLimitedDelay() {
    await delay(CONFIG.RATE_LIMIT_DELAY);
}

async function errorDelay() {
    progress.update({ rateLimited: true });
    await delay(CONFIG.ERROR_RETRY_DELAY);
    progress.update({ rateLimited: false });
}

// Check if user is authenticated by trying to get their profile
async function checkAuthStatus() {
    try {
        // Try to get the current user's handle from the page
        const userHandle = getCurrentUserHandle();
        if (!userHandle) {
            return { isAuthenticated: false, handle: null };
        }

        // Verify we can access their profile
        const response = await fetch(`${CONFIG.API_BASE}/app.bsky.actor.getProfile?actor=${userHandle}`);
        if (response.ok) {
            const profile = await response.json();
            return { 
                isAuthenticated: true, 
                handle: userHandle,
                did: profile.did,
                displayName: profile.displayName
            };
        }
        
        return { isAuthenticated: false, handle: null };
    } catch (error) {
        console.error('Error checking auth status:', error);
        return { isAuthenticated: false, handle: null };
    }
}

// Extract current user's handle from the page
function getCurrentUserHandle() {
    // First try to get from local storage
    try {
        console.log('Checking local storage for Bluesky session data...');
        const bskyStorage = localStorage.getItem('BSKY_STORAGE');
        if (bskyStorage) {
            const storageData = JSON.parse(bskyStorage);
            if (storageData?.session?.currentAccount?.handle) {
                console.log('Found handle in local storage:', storageData.session.currentAccount.handle);
                return storageData.session.currentAccount.handle;
            }
        }
    } catch (error) {
        console.warn('[Bluesky] Error accessing local storage:', error);
    }
    
    // Fall back to checking profile link
    console.log('Checking profile link...');
    const profileLink = document.querySelector('a[aria-label="Profile"]');
    if (profileLink) {
        const href = profileLink.getAttribute('href');
        const handleMatch = href?.match(/\/profile\/([^/]+)/);
        if (handleMatch) {
            console.log('Found handle in profile link:', handleMatch[1]);
            return handleMatch[1];
        }
    }
    
    // Legacy fallbacks if above methods fail
    const handleSelectors = [
        '[data-testid="profileHeaderDisplayName"]',
        '[data-testid="profileHeaderHandle"]',
        'meta[property="og:title"]',
        'title'
    ];
    
    for (const selector of handleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            const text = element.content || element.textContent || '';
            const handleMatch = text.match(/@?([a-zA-Z0-9.-]+\.bsky\.social)/);
            if (handleMatch) {
                return handleMatch[1];
            }
        }
    }
    
    // Try to extract from URL as last resort
    const urlMatch = window.location.href.match(/profile\/([^/]+)/);
    if (urlMatch) {
        return urlMatch[1];
    }
    
    return null;
}

// Get user's following list
async function getFollowingList(userDid) {
    const following = [];
    let cursor = null;
    let pageCount = 0;
    const maxPages = 10; // Safety limit
    
    try {
        do {
            console.log(`[Bluesky] Fetching following page ${pageCount + 1}...`);
            
            let url = `${CONFIG.API_BASE}/app.bsky.graph.getFollows?actor=${userDid}&limit=100`;
            if (cursor) {
                url += `&cursor=${cursor}`;
            }
            
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status === 429) {
                    console.warn('[Bluesky] Rate limited, waiting...');
                    await errorDelay();
                    continue;
                }
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log(`[Bluesky] Got ${data.follows.length} follows from page ${pageCount + 1}`);
            
            following.push(...data.follows);
            cursor = data.cursor;
            pageCount++;
            
            await rateLimitedDelay();
            
        } while (cursor && pageCount < maxPages);
        
        console.log(`[Bluesky] Total following: ${following.length} users`);
        return following;
        
    } catch (error) {
        console.error('[Bluesky] Error fetching following list:', error);
        throw error;
    }
}

// Get detailed profile and posts for a user
async function getUserProfileAndPosts(userDid, userHandle) {
    const benchmark = getBenchmark('bluesky');
    
    // Check cache first (async - may check storage)
    const cachedData = await getCachedProfile(userDid);
    if (cachedData) {
        console.log(`[Bluesky] Using cached data for: ${userHandle}`);
        return cachedData;
    }
    
    for (let retry = 0; retry < CONFIG.MAX_RETRIES; retry++) {
        try {
            console.log(`[Bluesky] Fetching profile and posts for: ${userHandle}`);
            
            progress.update({
                currentArtist: userHandle,
                subTask: 'Fetching profile',
                subProgress: 10
            });

            benchmark.startStep('Parallel fetch profile and posts');
            
            // Parallelize independent requests: fetch profile and posts simultaneously
            const profileUrl = `${CONFIG.API_BASE}/app.bsky.actor.getProfile?actor=${userDid}`;
            const postsUrl = `${CONFIG.API_BASE}/app.bsky.feed.getAuthorFeed?actor=${userDid}&limit=${CONFIG.MAX_POSTS_PER_USER}`;
            
            // Use deduplicated fetch to avoid duplicate requests
            const [profileResponse, postsResponse] = await Promise.all([
                dedupeFetch(profileUrl),
                dedupeFetch(postsUrl)
            ]);
            
            if (!profileResponse.ok || !postsResponse.ok) {
                benchmark.endStep();
                if (profileResponse.status === 429 || postsResponse.status === 429) {
                    await errorDelay();
                    continue;
                }
                const errorStatus = profileResponse.status || postsResponse.status;
                throw new Error(`HTTP ${errorStatus}`);
            }
            
            // Parse JSON responses in parallel
            const [profile, postsData] = await Promise.all([
                profileResponse.json(),
                postsResponse.json()
            ]);
            
            benchmark.endStep();
            
            progress.update({
                currentArtist: userHandle,
                subTask: 'Processing posts',
                subProgress: 50
            });

            benchmark.startStep('Processing posts');
            // Process posts to extract relevant data
            let processedPosts = processPosts(postsData.feed || []);
            let pinnedPost = null;
            benchmark.endStep();

            // Fetch pinned post if it exists
            if (profile.pinnedPost) {
                console.log(`[Bluesky] Found pinned post reference: ${profile.pinnedPost.uri}`);
                progress.update({
                    currentArtist: userHandle,
                    subTask: 'Fetching pinned post',
                    subProgress: 70
                });

                benchmark.startStep('Fetching pinned post');
                pinnedPost = await fetchPinnedPost(profile.pinnedPost.uri);
                benchmark.endStep();
                
                if (pinnedPost) {
                    pinnedPost.isPinned = true;
                    
                    // Remove the pinned post from processedPosts if it's already there
                    processedPosts = processedPosts.filter(post => post.uri !== pinnedPost.uri);
                    
                    // Add pinned post to the beginning of the posts list
                    processedPosts.unshift(pinnedPost);
                }
            }
            
            progress.update({
                currentArtist: userHandle,
                subTask: 'Analyzing content',
                subProgress: 80
            });
            
            benchmark.startStep('Formatting data for analysis');
            // Get most recent non-pinned post
            const recentPost = processedPosts.find(post => !post.isPinned) || null;
            benchmark.endStep();

            benchmark.startStep('Finalizing artist data');
            const artistData = {
                username: userHandle,
                displayName: profile.displayName || userHandle,
                platform: 'bluesky',
                profileUrl: `https://bsky.app/profile/${userHandle}`,
                avatarUrl: profile.avatar || null,
                bio: profile.description || '',
                followerCount: profile.followersCount || 0,
                followingCount: profile.followsCount || 0,
                postsCount: profile.postsCount || 0,
                pinnedPost: pinnedPost,
                recentPost: recentPost,
                posts: processedPosts,
                lastUpdated: Date.now()
            };
            benchmark.endStep();
            
            // Cache the result
            cacheProfile(userDid, artistData);
            
            console.log(`[Bluesky] Processed user data for: ${userHandle}`, artistData);
            return artistData;
            
        } catch (error) {
            if (benchmark && benchmark.currentStep) {
                benchmark.endStep();
            }
            console.error(`[Bluesky] Error getting user data for ${userHandle} (attempt ${retry + 1}):`, error);
            progress.update({ errors: progress.errors + 1 });
            
            if (retry < CONFIG.MAX_RETRIES - 1) {
                await errorDelay();
            }
        }
    }
    
    return null;
}

// Process posts to extract relevant information
function processPosts(feed) {
    return feed.slice(0, CONFIG.MAX_POSTS_PER_USER).map(feedItem => {
        const post = feedItem.post;
        const record = post.record;
        
        return {
            uri: post.uri,
            cid: post.cid,
            url: `https://bsky.app/profile/${post.author.handle}/post/${post.uri.split('/').pop()}`,
            text: record.text || '',
            createdAt: record.createdAt,
            timestamp: new Date(record.createdAt).getTime(),
            author: {
                did: post.author.did,
                handle: post.author.handle,
                displayName: post.author.displayName
            },
            replyCount: post.replyCount || 0,
            repostCount: post.repostCount || 0,
            likeCount: post.likeCount || 0,
            embed: post.embed || null,
            isPinned: false // Default to false, will be set to true for pinned posts
        };
    });
}

// Fetch a specific post by its URI (for pinned posts)
async function fetchPinnedPost(postUri) {
    try {
        console.log(`[Bluesky] Fetching pinned post: ${postUri}`);
        
        // Extract rkey from the URI
        // URI format: at://did:plc:xxxxx/app.bsky.feed.post/xxxxx
        const uriParts = postUri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
        if (!uriParts) {
            console.error('[Bluesky] Invalid post URI format:', postUri);
            return null;
        }
        
        const [, , rkey] = uriParts;
        
        // Use deduplicated fetch for pinned post
        const url = `${CONFIG.API_BASE}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}`;
        const response = await dedupeFetch(url);
        
        if (!response.ok) {
            console.error(`[Bluesky] Failed to fetch pinned post: HTTP ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        const post = data.thread?.post;
        
        if (!post) {
            console.error('[Bluesky] No post data in thread response');
            return null;
        }
        
        const record = post.record;
        
        return {
            uri: post.uri,
            cid: post.cid,
            url: `https://bsky.app/profile/${post.author.handle}/post/${rkey}`,
            text: record.text || '',
            createdAt: record.createdAt,
            timestamp: new Date(record.createdAt).getTime(),
            author: {
                did: post.author.did,
                handle: post.author.handle,
                displayName: post.author.displayName
            },
            replyCount: post.replyCount || 0,
            repostCount: post.repostCount || 0,
            likeCount: post.likeCount || 0,
            embed: post.embed || null,
            isPinned: true // This is a pinned post
        };
        
    } catch (error) {
        console.error('[Bluesky] Error fetching pinned post:', error);
        return null;
    }
}



// Format artist data for AI analysis
function formatDataForAnalysis(artistData) {
    console.log('[Bluesky] Formatting artist data for analysis:', artistData);
    
    // Truncate bio if too long (performance optimization)
    const MAX_BIO_LENGTH = 500;
    const bio = artistData.bio || '';
    const truncatedBio = bio.length > MAX_BIO_LENGTH 
        ? bio.substring(0, MAX_BIO_LENGTH) + '...'
        : bio;
    
    // Limit posts to most relevant ones (already limited in getUserProfileAndPosts, but ensure here too)
    const MAX_POSTS = 3;
    const posts = artistData.posts ? artistData.posts
        .sort((a, b) => {
            // Prioritize pinned posts, then by engagement, then by date
            if (a === artistData.pinnedPost) return -1;
            if (b === artistData.pinnedPost) return 1;
            const aEngagement = (a.likeCount || 0) + (a.repostCount || 0) + (a.replyCount || 0);
            const bEngagement = (b.likeCount || 0) + (b.repostCount || 0) + (b.replyCount || 0);
            if (aEngagement !== bEngagement) return bEngagement - aEngagement;
            return (b.timestamp || 0) - (a.timestamp || 0);
        })
        .slice(0, MAX_POSTS)
        .map(post => ({
            text: (post.text || '').substring(0, 300), // Truncate post text too
            date: post.timestamp,
            url: post.url || '',
            isPinned: post === artistData.pinnedPost,
            engagement: {
                likes: post.likeCount,
                reposts: post.repostCount,
                replies: post.replyCount
            }
        })) : [];
    
    const formatted = {
        displayName: artistData.displayName || '',
        bio: truncatedBio,
        commissionStatus: '', // Bluesky doesn't have explicit commission status
        posts: posts
    };
    
    console.log('[Bluesky] Formatted data:', formatted);
    return formatted;
}

// Main scanning function
async function scanBluesky(existingProgress = null) {
    console.log('[Bluesky] Starting Bluesky scan...', existingProgress ? 'Resuming from saved progress' : 'Fresh scan');
    
    // Initialize cache from storage
    await initializeCache();
    
    // Enable benchmarking
    const benchmark = enableBenchmark('bluesky');
    benchmark.reset();
    
    createProgressOverlay();
    updateProgressOverlay('show');
    
    // Check authentication
    progress.update({ phase: 'checking_auth' });
    const authStatus = await checkAuthStatus();
    
    if (!authStatus.isAuthenticated) {
        console.warn('[Bluesky] User not authenticated to Bluesky');
        updateProgressOverlay('error', { error: 'Not logged in to Bluesky or unable to access profile' });
        if (isExtensionContextValid()) {
            chrome.runtime.sendMessage({
                type: 'SCAN_ERROR',
                platform: 'bluesky',
                error: 'Not logged in to Bluesky or unable to access profile'
            }).catch(error => {
                console.warn('[Bluesky] Failed to send scan error message:', error);
            });
        }
        return;
    }
    
    console.log(`[Bluesky] Authenticated as: ${authStatus.handle}`);
    
    try {
        let following = [];
        let startIndex = 0;

        // If we have existing progress, try to resume
        if (existingProgress?.following?.length > 0) {
            console.log('[Bluesky] Resuming from saved following list:', existingProgress);
            following = existingProgress.following;
            startIndex = existingProgress.completed || 0;
            
            // Don't re-sort when resuming
            // Update progress tracker with existing data
            progress.update({
                phase: 'scanning_artists',
                total: following.length,
                completed: startIndex,
                currentArtist: startIndex < following.length ? following[startIndex].handle : null
            });
        } else {
            // Get following list
            progress.update({ phase: 'gathering_following' });
            updateProgressOverlay('gathering_following', { source: 'Fetching following list...' });
            
            following = await getFollowingList(authStatus.did);
            console.log(`[Bluesky] Found ${following.length} users to scan`);
            
            // Sort following list using black magic fuckery
            following = [...following].sort((a, b) => {
                const aHasDesc = a.description ? 1 : 0;
                const bHasDesc = b.description ? 1 : 0;
                if (aHasDesc !== bHasDesc) return bHasDesc - aHasDesc;
                const aPosts = a.postsCount || 0;
                const bPosts = b.postsCount || 0;
                if (aPosts !== bPosts) return bPosts - aPosts;
                const aFollowers = a.followersCount || 0;
                const bFollowers = b.followersCount || 0;
                return bFollowers - aFollowers;
            });
            
            progress.update({
                phase: 'scanning_artists',
                total: following.length,
                completed: 0
            });
        }
        
        // Scan each user, starting from the saved index
        for (let i = startIndex; i < following.length; i++) {
            const user = following[i];
            
            progress.update({
                currentArtist: user.handle,
                completed: i,
                following: following // Store following list in progress
            });
            
            const artistData = await getUserProfileAndPosts(user.did, user.handle);
            
            if (artistData) {
                // Send to AI analyzer
                const analysisRequest = {
                    type: 'analyze_components',
                    components: formatDataForAnalysis(artistData),
                    context: 'bluesky_profile',
                    metadata: artistData
                };
                
                console.log('[Bluesky] Sending analysis request:', analysisRequest);

                try {
                    if (benchmark) {
                        benchmark.startStep('Analyzing content');
                    }
                    const result = await sendAnalysisRequestWithRetry(analysisRequest, artistData);
                    if (benchmark) {
                        benchmark.endStep();
                    }
                    
                    if (result) {
                        console.log('[Bluesky] Final artist result:', result);
                        
                        // Report found artist
                        if (isExtensionContextValid()) {
                            chrome.runtime.sendMessage({
                                type: 'ARTIST_FOUND',
                                data: result
                            }).catch(error => {
                                console.warn('[Bluesky] Failed to send artist found message:', error);
                            });
                        }
                    }
                } catch (error) {
                    if (benchmark && benchmark.currentStep) {
                        benchmark.endStep();
                    }
                    console.error('[Bluesky] Analysis failed after retries:', error);
                    // Continue with next artist instead of failing completely
                }
            }
            
            await rateLimitedDelay();
        }
        
        // Report completion
        progress.update({
            phase: 'completed',
            completed: following.length,
            total: following.length
        });
        
        // Send benchmark results
        if (benchmark) {
            const benchmarkResults = benchmark.getResults();
            if (benchmarkResults) {
                try {
                    chrome.runtime.sendMessage({
                        type: 'BENCHMARK_RESULTS',
                        platform: 'bluesky',
                        results: benchmarkResults
                    }).catch(() => {});
                } catch (e) {
                    console.warn('[Bluesky] Failed to send benchmark results:', e);
                }
            }
        }
        
        if (isExtensionContextValid()) {
            chrome.runtime.sendMessage({
                type: 'SCAN_COMPLETE',
                platform: 'bluesky',
                results: [] // Send empty results array to match expected signature
            }).catch(error => {
                console.warn('[Bluesky] Failed to send scan complete message:', error);
            });
        }
        
    } catch (error) {
        console.error('[Bluesky] Scan error:', error);
        updateProgressOverlay('error', { error: error.message });
        
        // Send benchmark results even on error
        if (benchmark) {
            const benchmarkResults = benchmark.getResults();
            if (benchmarkResults) {
                try {
                    chrome.runtime.sendMessage({
                        type: 'BENCHMARK_RESULTS',
                        platform: 'bluesky',
                        results: benchmarkResults
                    }).catch(() => {});
                } catch (e) {
                    console.warn('[Bluesky] Failed to send benchmark results on error:', e);
                }
            }
        }
        
        if (isExtensionContextValid()) {
            chrome.runtime.sendMessage({
                type: 'SCAN_ERROR',
                platform: 'bluesky',
                error: error.message
            }).catch(error => {
                console.warn('[Bluesky] Failed to send scan error message:', error);
            });
        }
    }
}

// Helper function to send benchmark results
function sendBenchmarkResults() {
    const benchmark = getBenchmark('bluesky');
    if (benchmark) {
        const benchmarkResults = benchmark.getResults();
        if (benchmarkResults) {
            try {
                chrome.runtime.sendMessage({
                    type: 'BENCHMARK_RESULTS',
                    platform: 'bluesky',
                    results: benchmarkResults
                }).catch(() => {});
            } catch (e) {
                console.warn('[Bluesky] Failed to send benchmark results:', e);
            }
        }
    }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        if (request.type === 'START_SCAN' && request.platform === 'bluesky') {
            scanBluesky(request.existingProgress);
            sendResponse({ started: true });
        } else if (request.type === 'PING') {
            // Respond to ping to indicate this tab is active
            sendResponse({ active: true, platform: 'bluesky' });
        } else if (request.type === 'STOP_SCAN') {
            // Send benchmark results before stopping
            sendBenchmarkResults();
            sendResponse({ stopped: true });
        }
    } catch (error) {
        console.error('[Bluesky] Error handling message:', error);
        sendResponse({ error: error.message });
    }
    return true;
});

// Pattern matching fallback when background script is unavailable
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

function patternAnalyzeFallback(text) {
    if (!text) {
        return {
            commissionStatus: 'unclear',
            confidence: 0.3,
            method: 'pattern-fallback',
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
        method: 'pattern-fallback',
        triggers: [...new Set(triggers)] // Unique triggers
    };
}

function patternAnalyzeComponentsFallback(components) {
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
        const displayNameResult = patternAnalyzeFallback(components.displayName);
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
        const bioResult = patternAnalyzeFallback(components.bio);
        results.bio = bioResult;
        
        if (bioResult.confidence > highestConfidence) {
            highestConfidence = bioResult.confidence;
            overallStatus = bioResult.commissionStatus;
        }
        allTriggers.push(...bioResult.triggers);
    }
    
    // Analyze posts if present
    if (components.posts && Array.isArray(components.posts)) {
        const postResults = [];
        for (const post of components.posts) {
            if (post.text) {
                const postResult = patternAnalyzeFallback(post.text);
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
        method: 'pattern-fallback',
        triggers: [...new Set(allTriggers)].slice(0, 5) // Top 5 unique triggers
    };
}

// Robust analysis request function with retry logic and fallback
async function sendAnalysisRequestWithRetry(analysisRequest, artistData, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[Bluesky] Analysis attempt ${attempt}/${maxRetries} for:`, artistData.handle);
            
            // Check extension context before attempting to send message
            if (!isExtensionContextValid()) {
                throw new Error('Extension context invalidated');
            }
            
            const response = await new Promise((resolve, reject) => {
                // Set a shorter timeout for faster fallback
                const timeout = setTimeout(() => {
                    reject(new Error('Analysis request timeout'));
                }, 15000); // 15 second timeout
                
                try {
                    chrome.runtime.sendMessage(analysisRequest, (response) => {
                        clearTimeout(timeout);
                        
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message));
                            return;
                        }
                        
                        if (response && response.success) {
                            const result = {
                                ...artistData,
                                analysis: response.result,
                                confidence: response.result.confidence,
                                commissionStatus: response.result.commissionStatus,
                                triggers: response.result.triggers
                            };
                            resolve(result);
                        } else {
                            reject(new Error(response?.error || 'Analysis failed'));
                        }
                    });
                } catch (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
            
            console.log('[Bluesky] Received analysis response:', response);
            return response;
            
        } catch (error) {
            console.warn(`[Bluesky] Analysis attempt ${attempt} failed:`, error.message);
            
            // Check if this is a connection error that suggests background script is unavailable
            const isConnectionError = error.message.includes('Receiving end does not exist') ||
                                     error.message.includes('message channel closed') ||
                                     error.message.includes('Extension context invalidated');
            
            if (isConnectionError || attempt === maxRetries) {
                console.log(`[Bluesky] Using pattern matching fallback for:`, artistData.handle);
                
                // Use local pattern matching fallback
                const fallbackResult = patternAnalyzeComponentsFallback(analysisRequest.components);
                
                const result = {
                    ...artistData,
                    analysis: fallbackResult,
                    confidence: fallbackResult.confidence,
                    commissionStatus: fallbackResult.commissionStatus,
                    triggers: fallbackResult.triggers
                };
                
                console.log('[Bluesky] Fallback analysis result:', result);
                return result;
            }
            
            // Wait before retrying, but only for non-connection errors
            if (!isConnectionError && attempt < maxRetries) {
                const delay = 2000; // Fixed 2 second delay
                console.log(`[Bluesky] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
}

// Auto-start if we're on a Bluesky profile page
if (window.location.hostname === 'bsky.app' && 
    window.location.pathname.includes('/profile/')) {
    console.log('[Bluesky] On Bluesky profile page, ready to scan');
}