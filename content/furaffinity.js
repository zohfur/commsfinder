// Furaffinity scraper

// 1. Check if user is logged in, get username
// 2. Check user's Favs at https://furaffinity.net/controls/favorites/, scrape each unique artist's profile page
// 3. Check user's watchlist at https://furaffinity.net/controls/buddylist/, scrape each user's profile page
// 4. Check the following places on each profile page:
//
// - Profile Bio
// - recent gallery names/descriptions
// - profile Accepting Commissions status
// - most recent Journal
//
// 5. Weigh total confidence score by the results for each piece of information
// 6. Return the following information:
// - Artist display name
// - Artist FA username
// - Artist profile URL
// - Artist profile image URL
// - total confidence score
//

// How to tell if user is logged in
// Check for img class="loggedin_user_avatar", should have alt text with the username e.g. alt="zohfur". If doesn't exist, user is not logged in and we need to prompt them to do so (or let them skip FA)

// Watchlist page scraping
// section-body -> pagination-links for going through all pages
// section-body -> flex-watchlist -> flex-item-watchlist -> flex-item-watchlist.a should have href to the artist's profile page (e.g. <a href="/user/-cuty/" target="_blank"></a>

// Favorites page scraping
// Favorites pages show only 48 entries at a time, more than 48 will go to next page
// e.g. page 1 (1-48 entries) being https://www.furaffinity.net/controls/favorites/
// page 2 (49-96 entries) being https://www.furaffinity.net/controls/favorites/1/ and so on
// Each favorite is a figure element with the submission ID, it will have a child with a link to the artists' page
// e.g. section > figure (e.g. id="sid-61562249") > figcaption > label > p:nth-child(3) > a
// <a href="/user/zohfur/" title="Zohfur">Zohfur</a>

// Artist profile page scraping (the important part here)
// Avatar: <userpage-nav-avatar> <a class="current" href="/user/ARTIST_USERNAME"> <img alt="ARTIST_USERNAME" src="ARTIST_AVATAR_URL" /> </a> </userpage-nav-avatar>
// Artist display name: <span class="js-displayName">ARTIST_DISPLAY_NAME</span>
// Artist profile URL: the page you're on to get any of this
// Artist username: the username of the page you're on https://www.furaffinity.net/user/ARTIST_USERNAME/ 
// Artist bio: <div class="section-body userpage-profile"></div> and all its children
// Artist pinned journal: <div class="user-submitted-links"></div> and all its children
// Artist accepting commissions status: #userpage-contact-item > div:nth-child(2) 
//
// <div class="table-row">
// <div class="userpage-profile-question"><strong class="highlight">Accepting Commissions</strong></div>
// YES_OR_NO</div> YES_OR_NO contains either "Yes" or "No"
//
// Artist recent gallery is a bit tricky since it doesn't actually load everything, instead dynamically replacing the preview with the new description on hover. 
// All we care about from the gallery are the name, description, date, and tags of each post. #gallery-preview > div.userpage-featured-title > h2 > a
// .preview_img > a (this contains the link to the post and the sid) > img (contains data-tags attribute)
// This is the JS code that does that:
//
{/* <script type="text/javascript">
        document.addEventListener('DOMContentLoaded', () => {
    //
    document.querySelectorAll('span.popup_date').forEach((elem) => {
        //
        elem.addEventListener('click', (event) => {
            //
            event.preventDefault();

            const elm = event.currentTarget;
            const tmp = elm.title;
            elm.title = elm.innerHTML;
            elm.innerHTML = tmp;
        });
    });
});
    (() => {
        const submission_data = JSON.parse(document.getElementById('js-submissionData').textContent);
        const uploads = document.querySelectorAll("img[data-tags]");

        async function delay(ms) {
            return new Promise((res) => {
                setTimeout(res, ms);
            });
        }

        uploads.forEach((upload_elem) => {
            upload_elem.addEventListener('mouseover', async (event) => {
                // Wait .3 seconds before changing
                await delay(300);

                // Are we still hovering over the element? No? Ignore!
                if (!upload_elem.matches(':hover')) {
                    return;
                }

                // Get the associated main preview image
                const elem = event.srcElement;
                const elem_figure = elem.closest('figure');

                if (elem_figure) {
                    const main_preview_div = document.getElementById(elem.getAttribute('preview') + '-preview');
                    const preview_img = main_preview_div.querySelector('img');

                    const img_id = elem_figure.id.substr(4);
                    const img_url = '/view/' + img_id;
                    const img_data = submission_data[img_id];

                    // Update the preview <img> and it's associated info
                    preview_img.src = elem.src.replace(/@\d+-/, '@600-');
                    preview_img.setAttribute('data-tags', elem.getAttribute('data-tags'));

                    // Update the preview <img> <a>
                    const preview_img_a = preview_img.closest('a');
                    preview_img_a.className = 'r-' + img_data['icon_rating'];
                    preview_img_a.href = img_url;
                    preview_img_a.id = 'sid_' + img_id;

                    // Update the description!
                    const title_link_a = main_preview_div.querySelector('.preview_title a');
                    title_link_a.href = img_url;
                    title_link_a.textContent = img_data['title'];

                    // Update who owns it.
                    const preview_user_a = main_preview_div.querySelector('a.preview_user');

                    if (preview_user_a) {
                        preview_user_a.href = '/user/' + window.encodeURIComponent(img_data['lower']) + '/';
                        preview_user_a.textContent = img_data['username'];
                    }

                    // Popup date update
                    const popup_date_span = main_preview_div.querySelector('span.popup_date');
                    const is_title_the_date = popup_date_span.title.slice(-1) == 'M';

                    popup_date_span.title = (is_title_the_date ? img_data['date_full'] : img_data['date_fuzzy']);
                    popup_date_span.textContent = (is_title_the_date ? img_data['date_fuzzy'] : img_data['date_full']);
                }
            })
        })
    })();

</script> */}

// Scraping from posts on their respective pages
// Submission title: div.submission-title > h2 > p
// Submission date: span.popup_date contains title="MMM D, YYYY HH:MM AM/PM"
// Submission description: div.submission-description and all its children
// Submission tags: section.tags-row contains spans which contain spans which contain an A element with the tag name.
// (example: #columnpage > div.submission-sidebar > section.tags-row > span:nth-child(2) > span > a:nth-child(1) contains "sunglasses" )

console.log('CommsFinder: FurAffinity content script loaded');

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
            🔍 CommsFinder Scanning...
        </div>
        <div id="commsfinder-status" style="margin-bottom: 10px;">Initializing...</div>
        <div style="background: #333; height: 8px; border-radius: 4px; overflow: hidden;">
            <div id="commsfinder-progress-bar" style="
                background: linear-gradient(90deg, #4CAF50, #45a049);
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
        case 'checking_login':
            statusText = 'Checking login status...';
            progress = 5;
            break;
        case 'gathering_artists':
            statusText = 'Gathering artist list...';
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
    RATE_LIMIT_DELAY: 2000, // 2 seconds between requests
    ERROR_RETRY_DELAY: 30000, // 30 seconds on error
    MAX_RETRIES: 3,
    FAVORITES_PER_PAGE: 48,
    MAX_GALLERY_ITEMS: 10, // Limit gallery items to analyze per artist
    MAX_JOURNAL_LENGTH: 5000, // Limit journal text length
};

// Progress tracking
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
        this.updateThrottleMs = 10; // ~60fps
        this.artists = null; // Store the full artists list
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
            // Queue update for next frame
            this.pendingUpdate = requestAnimationFrame(() => {
                this.sendUpdate();
                this.lastUpdate = performance.now();
                this.pendingUpdate = null;
            });
        }
    }

    sendUpdate() {
        // Calculate overall progress including sub-task progress
        let overallPercentage = 0;
        if (this.total > 0) {
            const baseProgress = (this.completed / this.total) * 100;
            if (this.subProgress > 0) {
                // Enhanced sub-task contribution calculation
                const subTaskWeight = 1 / this.total;
                const subTaskProgress = this.subProgress / 100;
                const weightedSubProgress = subTaskWeight * subTaskProgress;
                overallPercentage = baseProgress + (weightedSubProgress * 100);
            } else {
                overallPercentage = baseProgress;
            }
            
            // Ensure progress never decreases and stays within bounds
            overallPercentage = Math.min(Math.max(overallPercentage, baseProgress), 100);
        }

        const data = {
            phase: this.phase,
            total: this.total,
            completed: this.completed,
            currentArtist: this.currentArtist,
            errors: this.errors,
            rateLimited: this.rateLimited,
            percentage: Math.round(overallPercentage * 10) / 10, // Round to 1 decimal
            subTask: this.subTask,
            subProgress: this.subProgress
        };
        
        // Include artists array for resumption if it exists
        if (this.artists) {
            data.artists = this.artists;
        }
        
        // Update local overlay
        updateProgressOverlay(this.phase, data);
        
        // Send to background using more efficient message format
        chrome.runtime.sendMessage({
            type: 'SCAN_PROGRESS',
            platform: 'furaffinity',
            data: data
        });
    }

    // Helper method to interpolate progress between steps
    interpolateProgress(startProgress, endProgress, elapsed, duration) {
        const progress = Math.min(elapsed / duration, 1);
        return startProgress + (endProgress - startProgress) * progress;
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

// Check if user is logged in
function checkLoginStatus() {
    const loggedInAvatar = document.querySelector('img.loggedin_user_avatar');
    const loggedInUsername = document.querySelector('#my-username a');
    
    if (loggedInAvatar || loggedInUsername) {
        return {
            isLoggedIn: true,
            username: loggedInAvatar.alt || loggedInUsername.textContent
        };
    } else {
        return {
            isLoggedIn: false,
            username: null
        };
    }
}

// Scrape favorites page
async function scrapeFavoritesPage(pageNum = 0) {
    const url = pageNum === 0 
        ? 'https://www.furaffinity.net/controls/favorites/'
        : `https://www.furaffinity.net/controls/favorites/${pageNum}/`;
    
    console.log(`Fetching favorites from: ${url}`);
    
    try {
        const response = await fetch(url, {
            credentials: 'include',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'User-Agent': navigator.userAgent
            }
        });
        
        console.log(`Favorites fetch response: ${response.status} ${response.statusText}`);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        console.log(`Received HTML, length: ${html.length}`);
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const artists = new Set();
        
        // Find all favorite figures
        const figures = doc.querySelectorAll('section figure[id^="sid-"]');
        console.log(`Found ${figures.length} figure elements`);
        
        figures.forEach(figure => {
            // Find artist link in the figure
            const artistLink = figure.querySelector('figcaption label p:nth-child(3) a');
            if (artistLink && artistLink.href) {
                const username = artistLink.href.match(/\/user\/([^/]+)/)?.[1];
                if (username) {
                    artists.add(username);
                    console.log(`Found artist: ${username}`);
                }
            }
        });
        
        // Check if there's a next page
        const nextLink = Array.from(doc.querySelectorAll('.pagination a')).find(a => a.textContent.includes('Next'));
        const hasNextPage = nextLink !== null || figures.length >= CONFIG.FAVORITES_PER_PAGE;
        
        console.log(`Page ${pageNum} complete. Artists found: ${artists.size}, hasNextPage: ${hasNextPage}`);
        
        return {
            artists: Array.from(artists),
            hasNextPage
        };
    } catch (error) {
        console.error(`Error scraping favorites page ${pageNum}:`, error);
        throw error;
    }
}

// Scrape watchlist page
async function scrapeWatchlistPage(pageNum = 1) {
    const url = `https://www.furaffinity.net/controls/buddylist/${pageNum}/`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        const artists = new Set();
        
        // Find all watchlist items
        const watchlistItems = doc.querySelectorAll('.flex-watchlist .flex-item-watchlist a[href^="/user/"]');
        watchlistItems.forEach(link => {
            const username = link.href.match(/\/user\/([^/]+)/)?.[1];
            if (username) {
                artists.add(username);
            }
        });
        
        // Check if there's a next page
        const nextPageLink = Array.from(doc.querySelectorAll('.pagination-links a')).find(a => a.textContent.includes('Next'));
        const hasNextPage = nextPageLink !== null;
        
        return {
            artists: Array.from(artists),
            hasNextPage
        };
    } catch (error) {
        console.error('Error scraping watchlist page:', error);
        throw error;
    }
}

// Get all unique artists from favorites and watchlist
async function getAllArtists() {
    console.log('Getting all artists...');
    progress.update({ phase: 'gathering_artists' });
    const allArtists = new Set();
    
    // Scrape favorites
    try {
        console.log('Starting favorites scraping...');
        updateProgressOverlay('gathering_artists', { source: 'Scanning favorites...' });
        let pageNum = 0;
        let hasMore = true;
        const seenOnPreviousPages = new Set();
        
        while (hasMore) {
            console.log(`Scraping favorites page ${pageNum}...`);
            const { artists, hasNextPage } = await scrapeFavoritesPage(pageNum);
            console.log(`Found ${artists.length} artists on page ${pageNum}`);
            
            // Stop if no artists found on the page
            if (artists.length === 0) {
                console.log('No artists found on page, stopping favorites scan');
                break;
            }
            
            // Check if all artists on this page are duplicates
            const newArtists = artists.filter(artist => !seenOnPreviousPages.has(artist));
            if (newArtists.length === 0) {
                console.log('All artists on this page are duplicates, stopping favorites scan');
                break;
            }
            
            // Add new artists to our sets
            newArtists.forEach(artist => {
                allArtists.add(artist);
                seenOnPreviousPages.add(artist);
            });
            
            // Also track artists we've seen for duplicate detection
            artists.forEach(artist => seenOnPreviousPages.add(artist));
            
            hasMore = hasNextPage && newArtists.length > 0; // Only continue if we found new artists
            pageNum++;
            
            if (pageNum > 10) { // Safety limit
                console.warn('Reached page limit for favorites');
                break;
            }
            
            await rateLimitedDelay();
        }
        console.log(`Favorites scraping complete. Total unique artists so far: ${allArtists.size}`);
    } catch (error) {
        console.error('Error getting favorites:', error);
        progress.update({ errors: progress.errors + 1 });
    }
    
    // Scrape watchlist
    try {
        console.log('Starting watchlist scraping...');
        updateProgressOverlay('gathering_artists', { source: 'Scanning watchlist...' });
        let pageNum = 1;
        let hasMore = true;
        const seenOnPreviousPages = new Set();
        
        while (hasMore) {
            console.log(`Scraping watchlist page ${pageNum}...`);
            const { artists, hasNextPage } = await scrapeWatchlistPage(pageNum);
            console.log(`Found ${artists.length} artists on page ${pageNum}`);
            
            // Stop if no artists found on the page
            if (artists.length === 0) {
                console.log('No artists found on page, stopping watchlist scan');
                break;
            }
            
            // Check if all artists on this page are duplicates
            const newArtists = artists.filter(artist => !seenOnPreviousPages.has(artist));
            if (newArtists.length === 0) {
                console.log('All artists on this page are duplicates, stopping watchlist scan');
                break;
            }
            
            // Add new artists to our sets
            newArtists.forEach(artist => {
                allArtists.add(artist);
                seenOnPreviousPages.add(artist);
            });
            
            // Also track artists we've seen for duplicate detection
            artists.forEach(artist => seenOnPreviousPages.add(artist));
            
            hasMore = hasNextPage && newArtists.length > 0; // Only continue if we found new artists
            pageNum++;
            
            if (pageNum > 10) { // Safety limit
                console.warn('Reached page limit for watchlist');
                break;
            }
            
            await rateLimitedDelay();
        }
        console.log(`Watchlist scraping complete. Total unique artists: ${allArtists.size}`);
    } catch (error) {
        console.error('Error getting watchlist:', error);
        progress.update({ errors: progress.errors + 1 });
    }
    
    const artistArray = Array.from(allArtists);
    console.log(`getAllArtists complete. Returning ${artistArray.length} unique artists`);
    return artistArray;
}

// Extract text content safely with progress updates
function extractTextContent(element, taskName = '', startProgress = 0, endProgress = 0) {
    if (!element) return '';
    
    const text = element.textContent;
    if (!text) return '';

    // For longer text content, show micro-progress updates
    if (text.length > 1000 && taskName && endProgress > startProgress) {
        const words = text.split(/\s+/);
        const updateInterval = Math.max(1, Math.floor(words.length / 10)); // Update progress ~10 times
        
        let processedText = '';
        for (let i = 0; i < words.length; i++) {
            processedText += words[i] + ' ';
            
            if (i % updateInterval === 0) {
                const subProgress = startProgress + 
                    ((endProgress - startProgress) * (i / words.length));
                progress.update({
                    subTask: taskName,
                    subProgress: Math.round(subProgress)
                });
            }
        }
        return processedText.trim();
    }
    
    return text.trim();
}

// Scrape artist profile
async function scrapeArtistProfile(username) {
    const profileUrl = `https://www.furaffinity.net/user/${username}/`;
    
    for (let retry = 0; retry < CONFIG.MAX_RETRIES; retry++) {
        try {
            console.log('[CommsFinder] Fetching profile:', profileUrl);
            progress.update({
                currentArtist: username,
                subTask: 'Fetching profile page',
                subProgress: 5
            });

            const response = await fetch(profileUrl);
            if (!response.ok) {
                if (response.status === 429 || response.status === 503) {
                    await errorDelay();
                    continue;
                }
                throw new Error(`HTTP ${response.status}`);
            }
            
            const html = await response.text();
            console.log('[CommsFinder] Got profile HTML, length:', html.length);
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            progress.update({
                currentArtist: username,
                subTask: 'Extracting basic info',
                subProgress: 15
            });

            // Extract basic info
            const avatarImg = doc.querySelector('userpage-nav-avatar img');
            const displayNameElem = doc.querySelector('span.js-displayName');
            
            progress.update({
                currentArtist: username,
                subTask: 'Analyzing bio',
                subProgress: 25
            });

            // Extract bio with progress updates
            const bioElem = doc.querySelector('.userpage-profile.section-body');
            const bio = extractTextContent(bioElem, 'Analyzing bio', 25, 35);
            
            progress.update({
                currentArtist: username,
                subTask: 'Checking commission status',
                subProgress: 40
            });

            // Extract commission status
            let commissionStatus = 'unknown';
            const commissionRow = Array.from(doc.querySelectorAll('.table-row')).find(row => {
                const question = row.querySelector('.userpage-profile-question');
                return question && question.textContent.includes('Accepting Commissions');
            });
            
            if (commissionRow) {
                const statusText = commissionRow.textContent;
                if (statusText.includes('Yes')) {
                    commissionStatus = 'open';
                } else if (statusText.includes('No')) {
                    commissionStatus = 'closed';
                }
            }
            
            progress.update({
                currentArtist: username,
                subTask: 'Reading journal',
                subProgress: 55
            });

            // Extract journal with progress updates
            const journalElem = doc.querySelector('.user-submitted-links');
            const journal = extractTextContent(journalElem, 'Processing journal', 55, 65).substring(0, CONFIG.MAX_JOURNAL_LENGTH);
            
            progress.update({
                currentArtist: username,
                subTask: 'Scanning gallery',
                subProgress: 70
            });

            // Get gallery preview data
            console.log('[CommsFinder] Starting gallery scrape for:', username);
            console.log('[CommsFinder] Gallery elements found:', doc.querySelectorAll('.userpage-gallery').length);
            console.log('[CommsFinder] Gallery img elements:', doc.querySelectorAll('.userpage-gallery img').length);
            console.log('[CommsFinder] Gallery img[data-tags] elements:', doc.querySelectorAll('.userpage-gallery img[data-tags]').length);
            
            const galleryData = await scrapeGalleryPreview(doc, username);
            console.log('[CommsFinder] Gallery data result:', galleryData);
            
            progress.update({
                currentArtist: username,
                subTask: 'Finalizing artist data',
                subProgress: 95
            });
            
            // Prepare artist data
            const artistData = {
                username: username,
                displayName: extractTextContent(displayNameElem) || username,
                platform: 'furaffinity',
                profileUrl: profileUrl,
                avatarUrl: avatarImg ? avatarImg.src : null,
                bio: bio,
                journal: journal,
                commissionStatus: commissionStatus,
                galleryItems: galleryData,
                lastUpdated: Date.now()
            };
            
            console.log('[CommsFinder] Prepared artist data:', artistData);
            return artistData;
            
        } catch (error) {
            console.error(`[CommsFinder] Error scraping profile for ${username} (attempt ${retry + 1}):`, error);
            progress.update({ errors: progress.errors + 1 });
            
            if (retry < CONFIG.MAX_RETRIES - 1) {
                await errorDelay();
            }
        }
    }
    
    return null;
}

// Scrape gallery preview items
async function scrapeGalleryPreview(doc, username) {
    const galleryItems = [];
    
    try {
        console.log('[CommsFinder] Starting gallery preview scrape for:', username);
        
        progress.update({
            currentArtist: username,
            subTask: 'Reading gallery metadata',
            subProgress: 75
        });
        
        // Get submission data from the JSON script tag
        const submissionDataScript = doc.getElementById('js-submissionData');
        let submissionData = {};
        if (submissionDataScript) {
            try {
                submissionData = JSON.parse(submissionDataScript.textContent);
                console.log('[CommsFinder] Found submission data:', Object.keys(submissionData).length, 'items');
            } catch (e) {
                console.warn('[CommsFinder] Failed to parse submission data:', e);
            }
        }
        
        // Get gallery preview items from the latest submissions section
        const gallerySection = doc.getElementById('gallery-latest-submissions');
        if (!gallerySection) {
            console.warn('[CommsFinder] No gallery section found');
            return galleryItems;
        }

        const figures = gallerySection.querySelectorAll('figure[id^="sid-"]');
        console.log('[CommsFinder] Found gallery figures:', figures.length);
        
        const itemsToScrape = Math.min(figures.length, CONFIG.MAX_GALLERY_ITEMS);
        
        for (let i = 0; i < itemsToScrape; i++) {
            const figure = figures[i];
            const imgElement = figure.querySelector('img[data-tags]');
            if (!imgElement) continue;

            // Extract submission ID from figure
            const submissionId = figure.id.replace('sid-', '');
            const submissionMetadata = submissionData[submissionId] || {};
            
            // Get tags from the image element
            const tags = imgElement.getAttribute('data-tags') || '';
            
            // Get submission URL from the link
            const linkElement = figure.querySelector('a');
            // Ensure absolute URL for CSP-safe navigation
            let submissionUrl = linkElement ? linkElement.getAttribute('href') : '';
            if (submissionUrl && submissionUrl.startsWith('/')) {
                submissionUrl = `https://www.furaffinity.net${submissionUrl}`;
            }
            
            const item = {
                id: submissionId,
                title: submissionMetadata.title || '',
                tags: tags,
                date: submissionMetadata.date_full || '',
                url: submissionUrl
            };
            
            console.log('[CommsFinder] Scraped gallery item:', item);
            galleryItems.push(item);
        }
        
        // If we need more data, scrape individual submissions
        if (galleryItems.length < CONFIG.MAX_GALLERY_ITEMS) {
            const additionalCount = Math.min(
                CONFIG.MAX_GALLERY_ITEMS - galleryItems.length,
                3 // Limit additional scraping
            );
            
            console.log('[CommsFinder] Scraping additional submissions:', additionalCount);
            
            for (let i = 0; i < additionalCount; i++) {
                if (galleryItems[i] && galleryItems[i].url) {
                    const submissionData = await scrapeSubmission(galleryItems[i].url);
                    if (submissionData) {
                        Object.assign(galleryItems[i], submissionData);
                        console.log('[CommsFinder] Enhanced gallery item with submission data:', galleryItems[i]);
                    }
                    await rateLimitedDelay();
                }
            }
        }

        console.log('[CommsFinder] Final gallery items:', galleryItems);
    } catch (error) {
        console.error('[CommsFinder] Error scraping gallery preview:', error);
    }
    
    return galleryItems;
}

// Scrape individual submission
async function scrapeSubmission(url) {
    try {
        const fullUrl = url.startsWith('http') ? url : `https://www.furaffinity.net${url}`;
        const response = await fetch(fullUrl);
        if (!response.ok) return null;
        
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Extract submission details
        const titleElem = doc.querySelector('div.submission-title h2 p');
        const dateElem = doc.querySelector('span.popup_date');
        const descElem = doc.querySelector('div.submission-description');
        
        // Extract tags
        const tags = [];
        doc.querySelectorAll('section.tags-row a').forEach(tagLink => {
            tags.push(tagLink.textContent.trim());
        });
        
        return {
            title: extractTextContent(titleElem),
            date: dateElem ? dateElem.getAttribute('title') : '',
            description: extractTextContent(descElem).substring(0, 1000),
            tags: tags.join(', ')
        };
    } catch (error) {
        console.error('Error scraping submission:', error);
        return null;
    }
}

// Main scanning function
async function scanFurAffinity(existingProgress = null) {
    console.log('Starting FurAffinity scan...', existingProgress ? 'Resuming from saved progress' : 'Fresh scan');
    
    // Create and show overlay
    createProgressOverlay();
    updateProgressOverlay('show');
    
    // Check login status
    progress.update({ phase: 'checking_login' });
    const loginStatus = checkLoginStatus();
    
    if (!loginStatus.isLoggedIn) {
        console.warn('User not logged in to FurAffinity');
        updateProgressOverlay('error', { error: 'Not logged in to FurAffinity' });
        chrome.runtime.sendMessage({
            type: 'SCAN_ERROR',
            platform: 'furaffinity',
            error: 'Not logged in to FurAffinity'
        });
        return;
    }
    
    console.log(`Logged in as: ${loginStatus.username}`);
    
    try {
        let artists = [];
        let startIndex = 0;

        // If we have existing progress, try to resume
        if (existingProgress?.artists?.length > 0) {
            console.log('Resuming from saved artist list:', existingProgress);
            artists = existingProgress.artists;
            startIndex = existingProgress.completed || 0;
            
            // Update progress tracker with existing data
            progress.update({
                phase: 'scanning_artists',
                total: artists.length,
                completed: startIndex,
                currentArtist: startIndex < artists.length ? artists[startIndex] : null
            });
        } else {
            // Get all unique artists
            artists = await getAllArtists();
            console.log(`Found ${artists.length} unique artists to scan`);
            
            progress.update({
                phase: 'scanning_artists',
                total: artists.length,
                completed: 0
            });
        }
        
        const results = [];
        
        // Scan each artist, starting from the saved index
        for (let i = startIndex; i < artists.length; i++) {
            const artist = artists[i];
            progress.update({
                currentArtist: artist,
                completed: i,
                artists: artists // Store full artist list in progress
            });
            
            const artistData = await scrapeArtistProfile(artist);
            
            if (artistData) {
                try {
                    // Send to AI analyzer
                    const analysisRequest = {
                        type: 'analyze_components',
                        components: formatDataForAnalysis(artistData),
                        context: 'furaffinity_profile',
                        metadata: artistData
                    };
                    
                    console.log('[CommsFinder] Sending analysis request:', analysisRequest);

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

                    console.log('[CommsFinder] Received analysis response:', response);
                    
                    if (response && response.success) {
                        const result = {
                            ...artistData,
                            analysis: response.result,
                            confidence: response.result.confidence,
                            commissionStatus: response.result.commissionStatus,
                            triggers: response.result.triggers
                        };
                        
                        console.log('[CommsFinder] Final artist result:', result);
                        
                        // Add to results array for local tracking
                        results.push(result);
                        
                        // Report found artist
                        chrome.runtime.sendMessage({
                            type: 'ARTIST_FOUND',
                            data: result
                        });
                    } else {
                        console.error('[CommsFinder] Analysis failed:', response?.error || 'Unknown error');
                    }
                } catch (error) {
                    console.error('[CommsFinder] Analysis request failed:', error);
                }
            }
            
            await rateLimitedDelay();
        }
        
        // Report completion
        progress.update({
            phase: 'completed',
            completed: artists.length,
            total: artists.length
        });
        
        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            platform: 'furaffinity',
            results: results
        });
        
    } catch (error) {
        console.error('FurAffinity scan error:', error);
        updateProgressOverlay('error', { error: error.message });
        chrome.runtime.sendMessage({
            type: 'SCAN_ERROR',
            platform: 'furaffinity',
            error: error.message
        });
    }
}

// Format artist data for AI analysis
function formatDataForAnalysis(artistData) {
    console.log('[CommsFinder] Formatting artist data for analysis:', artistData);
    const formatted = {
        bio: artistData.bio || '',
        commissionStatus: artistData.commissionStatus !== 'unknown' ? artistData.commissionStatus : '',
        journal: artistData.journal ? {
            text: artistData.journal,
            date: artistData.lastUpdated // Use the profile's last update time for journal
        } : null,
        galleryItems: artistData.galleryItems ? artistData.galleryItems.map(item => ({
            title: item.title || '',
            description: item.description || '',
            tags: item.tags || '',
            date: item.date || artistData.lastUpdated, // Fallback to profile update time if no item date
            url: item.url || '' // Preserve the URL
        })) : []
    };
    console.log('[CommsFinder] Formatted data:', formatted);
    return formatted;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_SCAN' && request.platform === 'furaffinity') {
        scanFurAffinity(request.existingProgress);
        sendResponse({ started: true });
    } else if (request.type === 'PING') {
        // Respond to ping to indicate this tab is active
        sendResponse({ active: true, platform: 'furaffinity' });
    }
    return true;
});

// Auto-start if we're on a FA control page
if (window.location.hostname === 'www.furaffinity.net' && 
    window.location.pathname.includes('/controls/')) {
    console.log('On FurAffinity controls page, ready to scan');
}