// Bluesky content script for commission scanning

console.log('CommsFinder: Bluesky content script loaded');

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
};

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
            
            chrome.runtime.sendMessage({
                type: 'SCAN_PROGRESS',
                platform: 'bluesky',
                data: data
            }).catch(error => {
                console.warn('[Bluesky] Failed to send progress update:', error);
            });
        } catch (error) {
            console.error('[Bluesky] Error in sendUpdate:', error);
        }
    }
}

const progress = new ProgressTracker();

// Helper functions
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
    for (let retry = 0; retry < CONFIG.MAX_RETRIES; retry++) {
        try {
            console.log(`[Bluesky] Fetching profile and posts for: ${userHandle}`);
            
            progress.update({
                currentArtist: userHandle,
                subTask: 'Fetching profile',
                subProgress: 10
            });

            // Get profile
            const profileResponse = await fetch(`${CONFIG.API_BASE}/app.bsky.actor.getProfile?actor=${userDid}`);
            if (!profileResponse.ok) {
                if (profileResponse.status === 429) {
                    await errorDelay();
                    continue;
                }
                throw new Error(`Profile HTTP ${profileResponse.status}`);
            }
            
            const profile = await profileResponse.json();
            
            progress.update({
                currentArtist: userHandle,
                subTask: 'Fetching posts',
                subProgress: 30
            });

            // Get recent posts
            const postsResponse = await fetch(`${CONFIG.API_BASE}/app.bsky.feed.getAuthorFeed?actor=${userDid}&limit=${CONFIG.MAX_POSTS_PER_USER}`);
            if (!postsResponse.ok) {
                if (postsResponse.status === 429) {
                    await errorDelay();
                    continue;
                }
                throw new Error(`Posts HTTP ${postsResponse.status}`);
            }
            
            const postsData = await postsResponse.json();
            
            progress.update({
                currentArtist: userHandle,
                subTask: 'Processing posts',
                subProgress: 60
            });

            // Process posts to extract relevant data
            let processedPosts = processPosts(postsData.feed || []);
            let pinnedPost = null;

            // Fetch pinned post if it exists
            if (profile.pinnedPost) {
                console.log(`[Bluesky] Found pinned post reference: ${profile.pinnedPost.uri}`);
                progress.update({
                    currentArtist: userHandle,
                    subTask: 'Fetching pinned post',
                    subProgress: 70
                });

                pinnedPost = await fetchPinnedPost(profile.pinnedPost.uri);
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
            
            // Get most recent non-pinned post
            const recentPost = processedPosts.find(post => !post.isPinned) || null;
            
            progress.update({
                currentArtist: userHandle,
                subTask: 'Finalizing data',
                subProgress: 95
            });

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
            
            console.log(`[Bluesky] Processed user data for: ${userHandle}`, artistData);
            return artistData;
            
        } catch (error) {
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
        
        const [, did, rkey] = uriParts;
        
        // Fetch the post using getPostThread
        const response = await fetch(`${CONFIG.API_BASE}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}`);
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
    
    const formatted = {
        displayName: artistData.displayName || '',
        bio: artistData.bio || '',
        commissionStatus: '', // Bluesky doesn't have explicit commission status
        posts: artistData.posts ? artistData.posts.map(post => ({
            text: post.text || '',
            date: post.timestamp,
            url: post.url || '',
            isPinned: post === artistData.pinnedPost,
            engagement: {
                likes: post.likeCount,
                reposts: post.repostCount,
                replies: post.replyCount
            }
        })) : []
    };
    
    console.log('[Bluesky] Formatted data:', formatted);
    return formatted;
}

// Main scanning function
async function scanBluesky(existingProgress = null) {
    console.log('[Bluesky] Starting Bluesky scan...', existingProgress ? 'Resuming from saved progress' : 'Fresh scan');
    
    createProgressOverlay();
    updateProgressOverlay('show');
    
    // Check authentication
    progress.update({ phase: 'checking_auth' });
    const authStatus = await checkAuthStatus();
    
    if (!authStatus.isAuthenticated) {
        console.warn('[Bluesky] User not authenticated to Bluesky');
        updateProgressOverlay('error', { error: 'Not logged in to Bluesky or unable to access profile' });
        chrome.runtime.sendMessage({
            type: 'SCAN_ERROR',
            platform: 'bluesky',
            error: 'Not logged in to Bluesky or unable to access profile'
        }).catch(error => {
            console.warn('[Bluesky] Failed to send scan error message:', error);
        });
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
            
            progress.update({
                phase: 'scanning_artists',
                total: following.length,
                completed: 0
            });
        }
        
        const results = [];
        
        // Scan each user, starting from the saved index
        for (let i = startIndex; i < following.length; i++) {
            const user = following[i];
            
            progress.update({
                currentArtist: user.handle,
                completed: i,
                following: following // Store full following list in progress
            });
            
            const artistData = await getUserProfileAndPosts(user.did, user.handle);
            
            if (artistData) {
                try {
                    // Send to AI analyzer
                    const analysisRequest = {
                        type: 'analyze_components',
                        components: formatDataForAnalysis(artistData),
                        context: 'bluesky_profile',
                        metadata: artistData
                    };
                    
                    console.log('[Bluesky] Sending analysis request:', analysisRequest);

                    // Convert to Promise-based approach
                    const response = await new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage(analysisRequest, (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                            }
                            resolve(response);
                        });
                    });

                    console.log('[Bluesky] Received analysis response:', response);
                    
                    if (response && response.success) {
                        const result = {
                            ...artistData,
                            analysis: response.result,
                            confidence: response.result.confidence,
                            commissionStatus: response.result.commissionStatus,
                            triggers: response.result.triggers
                        };
                        
                        console.log('[Bluesky] Final artist result:', result);
                        
                        // Add to results array for local tracking
                        results.push(result);
                        
                        // Report found artist
                        chrome.runtime.sendMessage({
                            type: 'ARTIST_FOUND',
                            data: result
                        }).catch(error => {
                            console.warn('[Bluesky] Failed to send artist found message:', error);
                        });
                    } else {
                        console.error('[Bluesky] Analysis failed:', response?.error || 'Unknown error');
                    }
                } catch (error) {
                    console.error('[Bluesky] Analysis request failed:', error);
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
        
        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            platform: 'bluesky',
            results: results
        }).catch(error => {
            console.warn('[Bluesky] Failed to send scan complete message:', error);
        });
        
    } catch (error) {
        console.error('[Bluesky] Scan error:', error);
        updateProgressOverlay('error', { error: error.message });
        chrome.runtime.sendMessage({
            type: 'SCAN_ERROR',
            platform: 'bluesky',
            error: error.message
        }).catch(error => {
            console.warn('[Bluesky] Failed to send scan error message:', error);
        });
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
        }
    } catch (error) {
        console.error('[Bluesky] Error handling message:', error);
        sendResponse({ error: error.message });
    }
    return true;
});

// Auto-start if we're on a Bluesky profile page
if (window.location.hostname === 'bsky.app' && 
    window.location.pathname.includes('/profile/')) {
    console.log('[Bluesky] On Bluesky profile page, ready to scan');
}