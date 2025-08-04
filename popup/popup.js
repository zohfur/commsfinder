// Popup JavaScript for Commsfinder extension
console.log('Commsfinder popup loaded');

class CommisionsfinderPopup {
  constructor() {
    this.isScanning = false;
    this.currentResults = [];
    this.filteredResults = [];
    this.favorites = new Set();
    this.blacklist = new Set();
    this.showBlacklisted = false;
    this.searchInstance = null; // Fuse.js instance
    this.debugSearch = false; // Enable search debugging (toggle with window.popup.toggleSearchDebug())
    this.searchDebounceTimer = null; // For debounced search
    this.settings = {
      aiEnabled: true,  // AI enabled by default since no-AI mode is still in development
      selectedQuantization: 'full',
      debugMode: false, // Debug mode disabled by default
      zenMode: false, // Zen mode disabled by default
      demoMode: false, // Demo mode disabled by default
      platforms: {
        furaffinity: true,
        twitter: false, // Twitter is disabled, reasons explained in the disclaimer
        bluesky: true
      }
    };
    
    this.initializeElements();
    this.bindEvents();
    this.loadSettings();
    this.loadResults();
    this.checkModelStatus();
    this.checkBenchmarkAvailability();
    this.loadFavoritesAndBlacklist();
    this.checkDisclaimerAcknowledgment();
  }
  
  initializeElements() {
    // Peep the horror.

    // Main elements
    this.scanBtn = document.getElementById('scanBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.scanProgress = document.getElementById('scanProgress');
    this.progressFill = document.getElementById('progressFill');
    this.progressText = document.getElementById('progressText');
    
    // Status elements
    this.statusIndicator = document.getElementById('statusIndicator');
    this.statusText = document.getElementById('statusText');
    this.lastScan = document.getElementById('lastScan');
    this.statusDot = this.statusIndicator.querySelector('.status-dot');
    
    // Platform checkboxes
    this.platformFuraffinity = document.getElementById('platformFuraffinity');
    this.platformBluesky = document.getElementById('platformBluesky');
    this.platformTwitter = document.getElementById('platformTwitter');
    
    // Results elements
    this.resultsSection = document.getElementById('resultsSection');
    this.resultsList = document.getElementById('resultsList');
    this.resultsCount = document.getElementById('resultsCount');
    this.confidenceFilter = document.getElementById('confidenceFilter');
    this.platformFilter = document.getElementById('platformFilter');
    this.searchFilter = document.getElementById('searchFilter');
    this.clearSearchBtn = document.getElementById('clearSearchBtn');
    this.showBlacklistedCheckbox = document.getElementById('showBlacklisted');
    this.emptyState = document.getElementById('emptyState');
    
    // Action buttons
    this.clearBtn = document.getElementById('clearBtn');
    this.exportBtn = document.getElementById('exportBtn');
    
    // Settings modal
    this.settingsBtn = document.getElementById('settingsBtn');
    this.settingsModal = document.getElementById('settingsModal');
    this.modalClose = document.getElementById('modalClose');
    this.aiEnabled = document.getElementById('aiEnabled');
    this.modelSelector = document.getElementById('modelSelector');
    this.modelTemperature = document.getElementById('modelTemperature');
    this.temperatureValue = document.getElementById('temperatureValue');
    this.clearAllData = document.getElementById('clearAllData');
    this.debugMode = document.getElementById('debugMode');
    this.zenMode = document.getElementById('zenMode');
    this.demoMode = document.getElementById('demoMode');
    
    // Loading overlay
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.resultsLoadingOverlay = document.getElementById('resultsLoadingOverlay');

    // CommsClassifier promo, roadmap, and feedback
    this.commsClassifierPromo = document.getElementById('commsClassifierPromo');
    this.promoCloseBtn = document.getElementById('promoCloseBtn');
    this.promoHideOptions = document.getElementById('promoHideOptions');
    this.promoHideForever = document.getElementById('promoHideForever');
    this.promoHideFor3Days = document.getElementById('promoHideFor3Days');
    this.roadmapSection = document.querySelector('.roadmap-section');
    this.roadmapToggleBtn = document.getElementById('roadmapToggleBtn');
    this.roadmapContent = document.getElementById('roadmapContent');
    this.feedbackSection = document.querySelector('.feedback-section');
    this.feedbackCloseBtn = document.getElementById('feedbackCloseBtn');
    this.feedbackHideOptions = document.getElementById('feedbackHideOptions');
    this.feedbackHideForever = document.getElementById('feedbackHideForever');
    this.feedbackHideFor3Days = document.getElementById('feedbackHideFor3Days');

    // Benchmark elements
    this.benchmarkGroup = document.getElementById('benchmarkGroup');
    this.runBenchmarkBtn = document.getElementById('runBenchmarkBtn');
    this.benchmarkProgress = document.querySelector('.benchmark-progress');
    this.benchmarkResults = document.getElementById('benchmarkResults');
    this.benchmarkTable = this.benchmarkResults.querySelector('table');
    
    // Disclaimer elements
    this.disclaimerOverlay = document.getElementById('disclaimerOverlay');
    this.disclaimerPage1 = document.getElementById('disclaimerPage1');
    this.disclaimerPage2 = document.getElementById('disclaimerPage2');
    this.disclaimerNextBtn = document.getElementById('disclaimerNextBtn');
    this.disclaimerBackBtn = document.getElementById('disclaimerBackBtn');
    this.disclaimerOkBtn = document.getElementById('disclaimerOkBtn');
  }

  // Pretend you didn't see that.
  
  bindEvents() {
    // Scan and stop buttons
    this.scanBtn.addEventListener('click', () => this.startScan());
    this.stopBtn.addEventListener('click', () => this.stopScan());
    
    // Platform checkboxes
    this.platformFuraffinity.addEventListener('change', () => this.updatePlatformSettings());
    this.platformBluesky.addEventListener('change', () => this.updatePlatformSettings());
    // Twitter is disabled, no event listener needed
    // this.platformTwitter.addEventListener('change', () => this.updatePlatformSettings());
    
    // Filters
    this.confidenceFilter.addEventListener('change', () => this.applyFilters());
    this.platformFilter.addEventListener('change', () => this.applyFilters());
    this.searchFilter.addEventListener('input', () => this.debouncedSearch());
    this.clearSearchBtn.addEventListener('click', () => this.clearSearch());
    this.showBlacklistedCheckbox.addEventListener('change', () => {
      this.showBlacklisted = this.showBlacklistedCheckbox.checked;
      this.applyFilters();
    });
    
    // Action buttons
    this.clearBtn.addEventListener('click', () => this.clearResults());
    this.exportBtn.addEventListener('click', () => this.exportResults());
    
    // Settings modal
    this.settingsBtn.addEventListener('click', () => this.openSettings());
    this.modalClose.addEventListener('click', () => this.closeSettings());
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.closeSettings();
    });
    
    // Settings controls
    this.aiEnabled.addEventListener('change', () => this.updateSettings());
    this.modelSelector.addEventListener('change', () => this.updateModelSettings());
    this.modelTemperature.addEventListener('input', () => {
      this.temperatureValue.textContent = this.modelTemperature.value;
      this.updateTemperature(parseFloat(this.modelTemperature.value));
    });
    this.clearAllData.addEventListener('click', () => this.clearAllData());
    this.debugMode.addEventListener('change', () => this.updateDebugMode());
    this.zenMode.addEventListener('change', () => this.updateZenMode());
    this.demoMode.addEventListener('change', () => this.updateDemoMode());
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleBackgroundMessage(message, sender, sendResponse);
    });

    // Global click handler to close platform dropdowns
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.platform-dropdown') && !e.target.closest('.platform-dropdown-trigger')) {
        document.querySelectorAll('.platform-dropdown').forEach(dropdown => {
          dropdown.style.display = 'none';
        });
      }
    });

    // Add gallery items toggle handler
    document.addEventListener('click', (e) => {
        const galleryToggle = e.target.closest('[data-gallery-toggle]');
        if (galleryToggle) {
            const header = galleryToggle;
            const list = header.nextElementSibling;
            header.classList.toggle('expanded');
            list.classList.toggle('expanded');
        }

        // Handle gallery item clicks
        const galleryItem = e.target.closest('.gallery-item');
        if (galleryItem) {
            e.preventDefault();
            e.stopPropagation();
            const url = galleryItem.getAttribute('href');
            if (url) {
                chrome.tabs.create({ url: url });
            }
        }
    });

    // Handle Twitter "why?" link click
    const twitterWhyLink = document.getElementById('twitterWhyLink');
    if (twitterWhyLink) {
      twitterWhyLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.showTwitterDisabledReason();
      });
    }

    // Roadmap toggle
    this.roadmapToggleBtn.addEventListener('click', () => this.toggleRoadmap());

    // Promo section close and hide buttons
    if (this.promoCloseBtn) {
      this.promoCloseBtn.addEventListener('click', () => this.showPromoHideOptions());
    }
    if (this.promoHideForever) {
      this.promoHideForever.addEventListener('click', () => this.hidePromoForever());
    }
    if (this.promoHideFor3Days) {
      this.promoHideFor3Days.addEventListener('click', () => this.hidePromoFor3Days());
    }

    // Feedback section close and hide buttons
    if (this.feedbackCloseBtn) {
      this.feedbackCloseBtn.addEventListener('click', () => this.showFeedbackHideOptions());
    }
    if (this.feedbackHideForever) {
      this.feedbackHideForever.addEventListener('click', () => this.hideFeedbackForever());
    }
    if (this.feedbackHideFor3Days) {
      this.feedbackHideFor3Days.addEventListener('click', () => this.hideFeedbackFor3Days());
    }

    // Benchmark button
    if (this.runBenchmarkBtn) {
      this.runBenchmarkBtn.addEventListener('click', () => this.startBenchmark());
    }
    
    // Disclaimer buttons
    if (this.disclaimerNextBtn) {
      this.disclaimerNextBtn.addEventListener('click', () => this.showDisclaimerPage2());
    }
    if (this.disclaimerBackBtn) {
      this.disclaimerBackBtn.addEventListener('click', () => this.showDisclaimerPage1());
    }
    if (this.disclaimerOkBtn) {
      this.disclaimerOkBtn.addEventListener('click', () => this.acceptDisclaimer());
    }
  }
  
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        'aiEnabled', 'selectedQuantization', 'platforms', 'modelTemperature', 'debugMode', 'zenMode', 'demoMode', 'roadmapMinimized',
        'promoHiddenForever', 'promoHiddenUntil', 'feedbackHiddenForever', 'feedbackHiddenUntil'
      ]);
      
      if (result.aiEnabled !== undefined) {
        this.settings.aiEnabled = result.aiEnabled;
        this.aiEnabled.checked = result.aiEnabled;
      } else {
        // If no stored setting, use default (true) and ensure checkbox reflects this
        this.settings.aiEnabled = true;
        this.aiEnabled.checked = true;
      }
      
      if (result.selectedQuantization !== undefined) {
        this.settings.selectedQuantization = result.selectedQuantization;
        this.modelSelector.value = result.selectedQuantization;
      }
      
      if (result.modelTemperature !== undefined) {
        this.modelTemperature.value = result.modelTemperature;
        this.temperatureValue.textContent = result.modelTemperature;
      }
      
      if (result.debugMode !== undefined) {
        this.settings.debugMode = result.debugMode;
        this.debugMode.checked = result.debugMode;
      }
      
      if (result.zenMode !== undefined) {
        this.settings.zenMode = result.zenMode;
        this.zenMode.checked = result.zenMode;
        this.toggleZenMode(result.zenMode);
      }
      
      if (result.demoMode !== undefined) {
        this.settings.demoMode = result.demoMode;
        this.demoMode.checked = result.demoMode;
      }
      
      if (result.platforms) {
        this.settings.platforms = { ...this.settings.platforms, ...result.platforms };
        this.platformFuraffinity.checked = this.settings.platforms.furaffinity;
        this.platformBluesky.checked = this.settings.platforms.bluesky;
        // Twitter is disabled, always set to false regardless of stored settings
        this.platformTwitter.checked = false;
        this.settings.platforms.twitter = false;
      }
      
      // Restore roadmap state
      if (result.roadmapMinimized !== undefined && result.roadmapMinimized) {
        this.roadmapSection.classList.add('minimized');
        const toggleIcon = this.roadmapToggleBtn.querySelector('.toggle-icon');
        toggleIcon.textContent = '❯';
        this.roadmapToggleBtn.title = 'Expand Roadmap';
      }

      // Check promo hiding preferences
      const now = Date.now();
      if (result.promoHiddenForever || (result.promoHiddenUntil && now < result.promoHiddenUntil)) {
        if (this.commsClassifierPromo) {
          this.commsClassifierPromo.style.display = 'none';
        }
      }

      // Check feedback hiding preferences
      if (result.feedbackHiddenForever || (result.feedbackHiddenUntil && now < result.feedbackHiddenUntil)) {
        if (this.feedbackSection) {
          this.feedbackSection.style.display = 'none';
        }
      }

      // Show/hide model selection based on AI enabled status
      const modelSelectionGroup = document.getElementById('modelSelectionGroup');
      if (modelSelectionGroup) {
        modelSelectionGroup.style.display = this.settings.aiEnabled ? 'block' : 'none';
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }
  
  async loadFavoritesAndBlacklist() {
    try {
      const { favorites = [], blacklist = [] } = await chrome.storage.local.get(['favorites', 'blacklist']);
      this.favorites = new Set(favorites);
      this.blacklist = new Set(blacklist);
    } catch (error) {
      console.error('Error loading favorites/blacklist:', error);
    }
  }
  
  async toggleFavorite(artistId) {
    if (this.favorites.has(artistId)) {
      this.favorites.delete(artistId);
    } else {
      this.favorites.add(artistId);
    }
    
    await chrome.storage.local.set({ favorites: Array.from(this.favorites) });
    this.applyFilters();
  }
  
  async toggleBlacklist(artistId) {
    if (this.blacklist.has(artistId)) {
      this.blacklist.delete(artistId);
    } else {
      this.blacklist.add(artistId);
      // Remove from favorites if blacklisting
      this.favorites.delete(artistId);
      await chrome.storage.local.set({ favorites: Array.from(this.favorites) });
    }
    
    await chrome.storage.local.set({ blacklist: Array.from(this.blacklist) });
    this.applyFilters();
  }
  
  async loadResults() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_RESULTS' });
      
      if (response.success) {
        this.currentResults = response.results || [];
        // Clear search instance when new data is loaded
        this.searchInstance = null;
        this.updateLastScanTime(response.lastScanDate);
        this.updatePlatformFilterOptions();
        this.applyFilters();
        this.updateUI();
        
        // Determine actual scan state - use activeScansInProgress for UI state
        const isActivelyScanning = response.activeScansInProgress || false;
        const canResume = response.scanInProgress && !isActivelyScanning;
        
        this.isScanning = isActivelyScanning;
        this.updateScanStatus(isActivelyScanning);
        
        // Update button states based on actual scan status
        if (isActivelyScanning) {
          // Scan is actively running - show stop button
          this.showProgress(true);
          this.showResultsLoading(true);
          this.stopBtn.style.display = 'block';
          this.scanBtn.style.display = 'none';
          this.scanBtn.disabled = true;
          this.scanBtn.querySelector('.scan-text').textContent = 'Scanning...';
          
          // Load progress data for each platform
          const storage = await chrome.storage.local.get([
            'furaffinity_progress', 'twitter_progress', 'bluesky_progress'
          ]);
          
          // Update progress for the most active platform
          for (const platform of ['furaffinity', 'twitter', 'bluesky']) {
            const progressData = storage[`${platform}_progress`];
            if (progressData && progressData.phase !== 'completed') {
              this.updateScanProgress(platform, progressData);
            }
          }
        } else {
          // Scan is not actively running - show scan/resume button
          this.showProgress(false);
          this.stopBtn.style.display = 'none';
          this.scanBtn.style.display = 'block';
          this.scanBtn.disabled = false;
          
          // Determine button text based on whether there's incomplete progress
          if (canResume) {
            this.scanBtn.querySelector('.scan-text').textContent = 'Resume Scan';
          } else {
            this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
          }
        }
      }
    } catch (error) {
      console.error('Error loading results:', error);
      // Reset to default state on error
      this.isScanning = false;
      this.updateScanStatus(false);
      this.showProgress(false);
      this.showResultsLoading(false);
      this.stopBtn.style.display = 'none';
      this.scanBtn.style.display = 'block';
      this.scanBtn.disabled = false;
      this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
    }
  }
  
  updatePlatformSettings() {
    this.settings.platforms = {
      furaffinity: this.platformFuraffinity.checked,
      bluesky: this.platformBluesky.checked,
      twitter: false // Twitter is disabled, always set to false
    };
    
    chrome.storage.local.set({ platforms: this.settings.platforms });
  }
  
  updateSettings() {
    this.settings.aiEnabled = this.aiEnabled.checked;
    
    chrome.storage.local.set({
      aiEnabled: this.settings.aiEnabled
    });
    
    // Show/hide model selection based on AI enabled status
    const modelSelectionGroup = document.getElementById('modelSelectionGroup');
    if (modelSelectionGroup) {
      modelSelectionGroup.style.display = this.settings.aiEnabled ? 'block' : 'none';
    }
    
    // Re-apply filters in case the mode affects results
    this.applyFilters();
    
    // Update model status when AI is toggled
    this.checkModelStatus();
  }

  async updateModelSettings() {
    this.settings.selectedQuantization = this.modelSelector.value;
    
    chrome.storage.local.set({
      selectedQuantization: this.settings.selectedQuantization
    });
    
    // Clear any existing model cache and update status
    try {
      await chrome.runtime.sendMessage({
        type: 'MODEL_CHANGED',
        modelName: this.settings.selectedQuantization
      });
      
      // Update model status to reflect the change
      this.checkModelStatus();
      
      this.showSuccess('Quantization changed successfully. You may need to redownload the model.');
    } catch (error) {
      console.error('Error updating quantization:', error);
      this.showError('Failed to update quantization: ' + error.message);
    }
  }
  
  async startScan() {
    if (this.isScanning) return;
    
    const enabledPlatforms = Object.keys(this.settings.platforms)
      .filter(platform => this.settings.platforms[platform]);
    
    if (enabledPlatforms.length === 0) {
      this.showError('Please select at least one platform to scan');
      return;
    }
    
    try {
      // Update UI state immediately
      this.isScanning = true;
      this.updateScanStatus(true);
      this.showProgress(true);
      this.showResultsLoading(true);
      this.stopBtn.style.display = 'block';
      this.scanBtn.style.display = 'none';
      
      // Send scan request - expect quick response
      const response = await chrome.runtime.sendMessage({
        type: 'SCAN_REQUEST',
        platforms: enabledPlatforms
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to start scan');
      }
      
      // Success - scan is now running in background
      this.updateProgressText('Scan initiated...');
      
    } catch (error) {
      console.error('Scan failed:', error);
      // Reset UI state
      this.isScanning = false;
      this.updateScanStatus(false);
      this.showProgress(false);
      this.showResultsLoading(false);
      this.stopBtn.style.display = 'none';
      this.scanBtn.style.display = 'block';
      this.showError(error.message || 'Failed to start scan');
    }
  }

  async stopScan() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STOP_SCAN'
      });

      if (response.success) {
        this.showSuccess('Scan paused. Progress has been saved.');
        this.isScanning = false;
        this.updateScanStatus(false);
        this.showProgress(false);
        this.showResultsLoading(false);
        this.stopBtn.style.display = 'none';
        this.scanBtn.style.display = 'block';
        this.scanBtn.querySelector('.scan-text').textContent = 'Resume Scan';
      } else {
        throw new Error(response.error || 'Failed to stop scan');
      }
    } catch (error) {
      console.error('Error stopping scan:', error);
      this.showError(error.message);
    }
  }

  handleBackgroundMessage(message) {
    switch (message.type) {
      case 'RESULTS_UPDATED':
        this.currentResults = message.data || [];
        // Clear search instance when results are updated
        this.searchInstance = null;
        this.updatePlatformFilterOptions();
        this.applyFilters();
        this.updateUI();
        break;
        
      case 'SCAN_FINISHED':
        this.isScanning = false;
        this.updateScanStatus(false);
        this.showProgress(false);
        this.showResultsLoading(false);
        this.stopBtn.style.display = 'none';
        this.scanBtn.style.display = 'block';
        this.scanBtn.disabled = false;
        this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
        this.currentResults = message.data || [];
        // Clear search instance when scan finishes
        this.searchInstance = null;
        this.updateLastScanTime(Date.now());
        this.updatePlatformFilterOptions();
        this.applyFilters();
        this.updateUI();
        this.showSuccess(`Scan complete! Found ${this.currentResults.length} artists with open commissions.`);
        break;
        
      case 'SCAN_ERROR':
        this.isScanning = false;
        this.updateScanStatus(false);
        this.showProgress(false);
        this.showResultsLoading(false);
        this.stopBtn.style.display = 'none';
        this.scanBtn.style.display = 'block';
        this.scanBtn.disabled = false;
        this.showError(message.error || 'Scan failed');
        break;

      case 'MODEL_DOWNLOAD_PROGRESS':
        this.updateProgressText(`Downloading AI model: ${message.data.status}`);
        this.progressFill.style.width = `${message.data.progress}%`;
        break;

      case 'SCAN_PROGRESS_UPDATE':
        // If we receive progress updates but UI doesn't show scanning, fix the state
        if (!this.isScanning && message.data.phase !== 'completed') {
          console.log('[Popup] Detected active scan from progress update, updating UI state');
          this.isScanning = true;
          this.updateScanStatus(true);
          this.showProgress(true);
          this.showResultsLoading(true);
          this.stopBtn.style.display = 'block';
          this.scanBtn.style.display = 'none';
          this.scanBtn.disabled = true;
          this.scanBtn.querySelector('.scan-text').textContent = 'Scanning...';
        }
        this.updateScanProgress(message.platform, message.data);
        break;

      case 'SCAN_ERROR_UPDATE':
        this.showError(`${message.platform}: ${message.error}`);
        break;
    }
  }
  
  // Transform confidence score to represent "likelihood of open commissions"
  // 0% = definitely closed, 50% = unclear, 100% = definitely open
  transformConfidenceScore(result) {
    // Handle multi-platform artists
    if (result.platforms && result.platforms.length > 1 && result.platformData) {
      // Calculate average confidence across all platforms
      let totalConfidence = 0;
      let validPlatforms = 0;

      result.platforms.forEach(platform => {
        const platformData = result.platformData[platform];
        if (platformData) {
          const rawConfidence = platformData.confidence || 0;
          const status = platformData.commissionStatus || 'unclear';
          
          // Transform individual platform confidence using same logic as single platform
          let transformedConfidence;
          switch (status) {
            case 'open':
              transformedConfidence = rawConfidence;
              break;
            case 'closed':
              transformedConfidence = 1 - rawConfidence;
              break;
            case 'unclear':
            default:
              transformedConfidence = 0.4 + (rawConfidence * 0.2); // Maps 0-1 to 0.4-0.6
              break;
          }
          
          totalConfidence += transformedConfidence;
          validPlatforms++;
        }
      });

      // Return average if we have valid platforms, otherwise fallback to single platform logic
      if (validPlatforms > 0) {
        return totalConfidence / validPlatforms;
      }
    }

    // Single platform logic (unchanged)
    const rawConfidence = result.confidence || 0;
    const status = result.commissionStatus || 'unclear';
    
    switch (status) {
      case 'open':
        return rawConfidence;
      case 'closed':
        return 1 - rawConfidence;
      case 'unclear':
      default:
        return 0.4 + (rawConfidence * 0.2);
    }
  }
  
  // Get the display confidence percentage (for UI)
  getDisplayConfidence(result) {
    return Math.round(this.transformConfidenceScore(result) * 100);
  }
  
  // Get the raw confidence for silver bullet components (for detailed view)
  getRawConfidencePercent(confidence) {
    return Math.round((confidence || 0) * 100);
  }

  // Initialize Fuse.js search instance
  initializeSearch(data) {
    if (this.debugSearch) {
      console.log('[Search] Initializing Fuse.js with data:', data.length, 'items');
    }
    
    // Prepare data for search by normalizing fields
    const searchData = data.map(item => ({
      ...item,
      // Ensure displayName exists
      displayName: item.displayName || item.username || 'Unknown Artist',
      // Ensure username exists  
      username: item.username || '',
      // Ensure bio is a string
      bio: item.bio || '',
      // Convert triggers array to searchable string
      triggers: Array.isArray(item.triggers) ? item.triggers.join(' ') : (item.triggers || ''),
      // Add platform name as searchable field
      platformName: this.formatPlatformName(item.platform)
    }));
    
    // Configure Fuse.js options for optimal artist search
    const fuseOptions = {
      // Search configuration
      includeScore: true,
      shouldSort: true,
      threshold: 0.4, // Lower = more strict, higher = more fuzzy (0-1)
      location: 0,    // Where to start searching
      distance: 100,  // How far to search
      minMatchCharLength: 1, // Minimum character length to match
      
      // Fields to search in (with weights)
      keys: [
        {
          name: 'displayName',
          weight: 0.4 // Highest priority
        },
        {
          name: 'username', 
          weight: 0.3 // Second priority
        },
        {
          name: 'bio',
          weight: 0.15 // Third priority  
        },
        {
          name: 'triggers',
          weight: 0.1 // Fourth priority
        },
        {
          name: 'platformName',
          weight: 0.05 // Lowest priority
        }
      ]
    };
    
    // Create new Fuse instance
    this.searchInstance = new Fuse(searchData, fuseOptions);
    
    if (this.debugSearch) {
      console.log('[Search] Fuse.js initialized with options:', fuseOptions);
      console.log('[Search] Sample processed data:', searchData.slice(0, 2));
    }
  }

  // Enhanced fuzzy search using Fuse.js
  performFuzzySearch(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
      if (this.debugSearch) {
        console.log('[Search] Empty search term, returning all results');
      }
      return this.currentResults;
    }
    
    const trimmedSearch = searchTerm.trim();
    
    if (this.debugSearch) {
      console.log('[Search] Performing search for:', trimmedSearch);
      console.log('[Search] Searching in dataset of', this.currentResults.length, 'items');
    }
    
    // Initialize search if needed
    if (!this.searchInstance || this.searchInstance.list !== this.currentResults) {
      this.initializeSearch(this.currentResults);
    }
    
    // Perform the search
    const searchResults = this.searchInstance.search(trimmedSearch);
    
    if (this.debugSearch) {
      console.log('[Search] Fuse.js returned', searchResults.length, 'results');
      console.log('[Search] Top 3 results:', searchResults.slice(0, 3));
    }
    
    // Extract items from Fuse.js results and restore original data structure
    const items = searchResults.map(result => {
      // Get the original item from currentResults to avoid using modified search data
      const originalItem = this.currentResults.find(item => 
        item.username === result.item.username && 
        item.platform === result.item.platform
      );
      
      return {
        ...(originalItem || result.item), // Use original if found, fallback to search item
        searchScore: result.score // Add search score for debugging
      };
    });
    
    if (this.debugSearch) {
      console.log('[Search] Extracted', items.length, 'items from Fuse.js results');
      if (items.length > 0) {
        console.log('[Search] First result:', {
          name: items[0].displayName,
          username: items[0].username,
          score: items[0].searchScore
        });
      }
    }
    
    return items;
  }

  applyFilters() {
    if (this.debugSearch) {
      console.log('[Search] --- APPLYING FILTERS ---');
      console.log('[Search] Current results count:', this.currentResults.length);
    }
    
    const minConfidence = parseFloat(this.confidenceFilter.value);
    const platformFilter = this.platformFilter.value;
    const searchTerm = this.searchFilter.value.trim();
    
    // Show/hide clear search button
    if (this.clearSearchBtn) {
      this.clearSearchBtn.style.display = searchTerm ? 'block' : 'none';
    }
    
    if (this.debugSearch) {
      console.log('[Search] Filter settings:', {
        minConfidence,
        platformFilter,
        searchTerm,
        showBlacklisted: this.showBlacklisted
      });
    }
    
    // Step 1: Apply search filter first (if any)
    let searchFilteredResults = this.currentResults;
    if (searchTerm) {
      searchFilteredResults = this.performFuzzySearch(searchTerm);
      if (this.debugSearch) {
        console.log('[Search] After search filter:', searchFilteredResults.length, 'results');
      }
    }
    
    // Step 2: Apply other filters to search results
    this.filteredResults = searchFilteredResults.filter(result => {
      const artistId = `${result.platform}_${result.username}`;
      const isBlacklisted = this.blacklist.has(artistId);
      
      // Skip blacklisted unless show blacklisted is checked
      if (isBlacklisted && !this.showBlacklisted) {
        if (this.debugSearch && searchTerm) {
          console.log('[Search] Filtering out blacklisted artist:', result.displayName);
        }
        return false;
      }
      
      // Use transformed confidence score for filtering
      const transformedConfidence = this.transformConfidenceScore(result);
      const meetsConfidence = transformedConfidence >= minConfidence;
      if (!meetsConfidence && this.debugSearch && searchTerm) {
        console.log('[Search] Filtering out low confidence artist:', result.displayName, 'confidence:', transformedConfidence);
      }
      
      // Handle platform filtering for both single and multi-platform artists
      let meetsPlatform = !platformFilter;
      if (platformFilter) {
        // Check if the artist is on the selected platform
        if (result.platforms && result.platforms.length > 1) {
          // Multi-platform artist - check if they're on the selected platform
          meetsPlatform = result.platforms.includes(platformFilter);
        } else {
          // Single platform artist
          meetsPlatform = result.platform === platformFilter;
        }
        
        if (!meetsPlatform && this.debugSearch && searchTerm) {
          console.log('[Search] Filtering out wrong platform artist:', result.displayName, 'platform:', result.platform);
        }
      }
      
      return meetsConfidence && meetsPlatform;
    });
    
    if (this.debugSearch) {
      console.log('[Search] After all filters:', this.filteredResults.length, 'results');
    }
    
    // Step 3: Sort results: favorites first, then by search score (if search active), then by confidence
    this.filteredResults.sort((a, b) => {
      const aId = `${a.platform}_${a.username}`;
      const bId = `${b.platform}_${b.username}`;
      const aFavorited = this.favorites.has(aId);
      const bFavorited = this.favorites.has(bId);
      
      // If one is favorited and the other isn't, favorited comes first
      if (aFavorited && !bFavorited) return -1;
      if (!aFavorited && bFavorited) return 1;
      
      // If search is active and we have search scores, sort by search relevance
      if (searchTerm && a.searchScore !== undefined && b.searchScore !== undefined) {
        // Lower score = better match in Fuse.js
        const scoreDiff = a.searchScore - b.searchScore;
        if (Math.abs(scoreDiff) > 0.01) { // Only if scores are meaningfully different
          return scoreDiff;
        }
      }
      
      // Otherwise sort by transformed confidence (likelihood of open commissions)
      const aTransformed = this.transformConfidenceScore(a);
      const bTransformed = this.transformConfidenceScore(b);
      return bTransformed - aTransformed;
    });
    
    if (this.debugSearch) {
      console.log('[Search] Final sorted results:', this.filteredResults.length);
      if (this.filteredResults.length > 0 && searchTerm) {
        console.log('[Search] Top result:', {
          name: this.filteredResults[0].displayName,
          searchScore: this.filteredResults[0].searchScore,
          confidence: this.getDisplayConfidence(this.filteredResults[0])
        });
      }
      console.log('[Search] --- FILTERS COMPLETE ---');
    }
    
    this.displayResults();
    this.updatePlatformFilterOptions();
  }
  
  // Get available platforms from current results with counts
  getAvailablePlatforms() {
    const platformCounts = {};
    
    this.currentResults.forEach(result => {
      if (result.platforms && result.platforms.length > 1) {
        // Multi-platform artist - count for each platform they're on
        result.platforms.forEach(platform => {
          platformCounts[platform] = (platformCounts[platform] || 0) + 1;
        });
      } else {
        // Single platform artist
        const platform = result.platform;
        platformCounts[platform] = (platformCounts[platform] || 0) + 1;
      }
    });
    
    return platformCounts;
  }
  
  // Update platform filter dropdown based on available results
  updatePlatformFilterOptions() {
    const availablePlatforms = this.getAvailablePlatforms();
    const platformFilter = this.platformFilter;
    const currentValue = platformFilter.value;
    
    // Clear existing options except "All Platforms"
    platformFilter.innerHTML = '<option value="">All Platforms</option>';
    
    // Add platform options with counts
    const allPlatforms = [
      { key: 'furaffinity', name: 'FurAffinity', icon: '🎨' }, // Keep emoji for dropdown text
      { key: 'bluesky', name: 'Bluesky', icon: '🌊' }, // Keep emoji for dropdown text
      { key: 'twitter', name: 'Twitter/X', icon: '🐦', disabled: true } // Keep emoji for dropdown text
    ];
    
    allPlatforms.forEach(platform => {
      const count = availablePlatforms[platform.key] || 0;
      const option = document.createElement('option');
      option.value = platform.key;
      
      if (platform.disabled) {
        // Platform is disabled (like Twitter)
        option.textContent = `${platform.icon} ${platform.name} (Disabled)`;
        option.disabled = true;
        option.style.color = '#6b7280';
      } else if (count > 0) {
        option.textContent = `${platform.icon} ${platform.name} (${count})`;
        option.disabled = false;
      } else {
        option.textContent = `${platform.icon} ${platform.name} (No results)`;
        option.disabled = true;
        option.style.color = '#6b7280';
      }
      
      platformFilter.appendChild(option);
    });
    
    // Restore previous selection if it's still valid
    if (currentValue && availablePlatforms[currentValue] > 0) {
      platformFilter.value = currentValue;
    } else if (currentValue && availablePlatforms[currentValue] === 0) {
      // Reset to "All Platforms" if selected platform has no results
      platformFilter.value = '';
    }
  }
  
  displayResults() {
    // Always show the results section to maintain search context
    this.hideEmptyState();
    this.hideFilteredEmptyState();
    this.showResults();
    
    // Clear the results list
    this.resultsList.innerHTML = '';
    
    if (this.filteredResults.length === 0) {
      // Show empty list with helpful message instead of hiding the interface
      this.showEmptyResultsList();
      return;
    }
    
    // Show actual results
    this.filteredResults.forEach(result => {
      const resultElement = this.createResultElement(result);
      this.resultsList.appendChild(resultElement);
    });
    
    this.resultsCount.textContent = `${this.filteredResults.length} artist${this.filteredResults.length !== 1 ? 's' : ''}`;
  }
  
  showEmptyResultsList() {
    // Update results count to show 0
    this.resultsCount.textContent = '0 artists';
    
    // Get context for the message
    const searchTerm = this.searchFilter.value.trim();
    const platformFilter = this.platformFilter.value;
    const confidenceFilter = parseFloat(this.confidenceFilter.value);
    const isSearchActive = searchTerm !== '';
    
    // Create message container
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-results-message';
    
    let messageHTML = '';
    
    if (this.currentResults.length === 0) {
      // No scan results at all
      messageHTML = `
        <div style="font-size: 24px; margin-bottom: 16px;">🎯</div>
        <h3>No Commission Results</h3>
        <p>Run a scan to find artists with open commissions.</p>
      `;
    } else if (isSearchActive) {
      // Search active but no results
      messageHTML = `
        <div style="font-size: 24px; margin-bottom: 16px;">🔍</div>
        <h3>No Artists Found</h3>
        <p>No artists match your search for "<strong style="color: #ffffff;">${searchTerm}</strong>".</p>
      `;
      
      // Add suggestions
      let suggestions = ['Check your spelling', 'Try a shorter search term', 'Search for username instead'];
      if (platformFilter || confidenceFilter > 0 || !this.showBlacklisted) {
        suggestions.unshift('Try clearing other filters');
      }
      
      messageHTML += `
        <p class="suggestions">
          <strong>Suggestions:</strong><br>
          • ${suggestions.join('<br>• ')}
        </p>
      `;
    } else {
      // Filters active but no results
      messageHTML = `
        <div style="font-size: 24px; margin-bottom: 16px;">🔍</div>
        <h3>No Results Match Your Filters</h3>
      `;
      
      // Build filter description
      let filterDetails = [];
      if (platformFilter) {
        const platformName = this.formatPlatformName(platformFilter);
        filterDetails.push(`showing only ${platformName}`);
      }
      if (confidenceFilter > 0) {
        filterDetails.push(`confidence ${Math.round(confidenceFilter * 100)}%+`);
      }
      if (!this.showBlacklisted) {
        filterDetails.push('hiding blacklisted artists');
      }
      
      if (filterDetails.length > 0) {
        messageHTML += `
          <p>
            You have ${this.currentResults.length} total result${this.currentResults.length !== 1 ? 's' : ''}, but none match your current filters.
          </p>
          <p style="font-size: 13px; opacity: 0.8;">
            Current filters: ${filterDetails.join(', ')}
          </p>
        `;
      }
    }
    
    emptyMessage.innerHTML = messageHTML;
    this.resultsList.appendChild(emptyMessage);
  }
  
  hideFilteredEmptyState() {
    // No longer needed since we show empty results inline
    // Keeping method for compatibility but it's useless now :p
  }
  
  createResultElement(result) {
    const element = document.createElement('div');
    element.className = 'result-item fade-in';
    
    // Use final confidence for main display (represents likelihood of open commissions)
    const confidencePercent = this.getDisplayConfidence(result);
    const confidenceClass = confidencePercent >= 70 ? 'high' : 
                           confidencePercent >= 50 ? 'medium' : 'low';
    
    const timeAgo = this.formatTimeAgo(result.lastUpdated);
    const platformIconPaths = this.getPlatformIcons(result);
    const platformNames = this.formatPlatformNames(result);
    
    // Create platform icon HTML
    let platformIconsHtml = '';
    if (Array.isArray(platformIconPaths)) {
      platformIconsHtml = platformIconPaths.map(iconPath => 
        `<img src="${iconPath}" alt="Platform" class="platform-icon-img">`
      ).join('');
    } else {
      platformIconsHtml = `<img src="${platformIconPaths}" alt="Platform" class="platform-icon-img">`;
    }
    // Handle triggers - might be array or string after search processing
    let triggers;
    let hasTriggers = false;
    if (result.triggers) {
      if (Array.isArray(result.triggers) && result.triggers.length > 0) {
        triggers = result.triggers.slice(0, 2).join(', ');
        hasTriggers = true;
      } else if (typeof result.triggers === 'string' && result.triggers.trim()) {
        // If it's a string, split it and take first 2 parts
        const triggerParts = result.triggers.trim().split(' ').filter(t => t.length > 0);
        triggers = triggerParts.slice(0, 2).join(', ');
        hasTriggers = true;
      } else {
        if (this.debugSearch) {
          console.warn('[Search] Unexpected triggers format:', typeof result.triggers, result.triggers);
        }
        triggers = result.method || `detected ${timeAgo}`;
        hasTriggers = false;
      }
    } else {
      triggers = result.method || `detected ${timeAgo}`;
      hasTriggers = false;
    }
    
    const artistId = `${result.platform}_${result.username}`;
    const isFavorited = this.favorites.has(artistId);
    const isBlacklisted = this.blacklist.has(artistId);
    
    // Apply demo mode transformations
    const displayName = this.settings.demoMode ? this.getDemoDisplayName(result.displayName) : result.displayName;
    const avatarClasses = this.settings.demoMode ? 'result-avatar demo-blur' : 'result-avatar';
    
    element.innerHTML = `
      <img src="${result.avatarUrl || this.getDefaultAvatar()}" 
           alt="${displayName}" 
           class="${avatarClasses}">
      <div class="result-info" style="cursor: pointer;">
        <div class="result-name" title="${displayName}">${displayName}</div>
        <div class="result-platform">
          ${platformIconsHtml} ${platformNames}
          ${result.platforms && result.platforms.length > 1 ? 
            `<span class="platform-dropdown-trigger" title="Choose platform">▼</span>` : ''}
        </div>
        <div class="result-triggers" title="${triggers}">
          ${hasTriggers ? `"${triggers}"<br><span class="detection-time">detected ${timeAgo}</span>` : triggers}
        </div>
        ${result.platforms && result.platforms.length > 1 ? this.createPlatformDropdown(result) : ''}
      </div>
      <div class="result-confidence">
        <div class="confidence-score ${confidenceClass}">
          ${confidencePercent}%
        </div>
      </div>
      <div class="result-actions">
        <button class="action-btn favorite-btn ${isFavorited ? 'active' : ''}" 
                title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}"
                data-artist-id="${artistId}">
          ${isFavorited ? '⭐' : '☆'}
        </button>
        <button class="action-btn blacklist-btn ${isBlacklisted ? 'active' : ''}" 
                title="${isBlacklisted ? 'Remove from blacklist' : 'Add to blacklist'}"
                data-artist-id="${artistId}">
          ⛔
        </button>
      </div>
      <div class="confidence-details-wrapper">
        <div class="confidence-details">
          ${this.createConfidenceDetails(result)}
        </div>
      </div>
    `;
    
    // Apply favorited/blacklisted CSS classes to the element
    if (isFavorited) {
      element.classList.add('favorited');
    }
    if (isBlacklisted) {
      element.classList.add('blacklisted');
    }
    
    // Add error handler for avatar image (CSP-compliant)
    const avatarImg = element.querySelector('.result-avatar');
    avatarImg.addEventListener('error', () => {
      avatarImg.src = this.getDefaultAvatar();
    });
    
    // Add click handler for the info section only
    const infoSection = element.querySelector('.result-info');
    infoSection.addEventListener('click', (e) => {
      // Don't open profile if clicking on dropdown elements
      if (e.target.closest('.platform-dropdown-trigger') || e.target.closest('.platform-dropdown')) {
        return;
      }
      this.openArtistProfile(result);
    });
    
    // Add handlers for platform dropdown
    const dropdownTrigger = element.querySelector('.platform-dropdown-trigger');
    const dropdown = element.querySelector('.platform-dropdown');
    
    if (dropdownTrigger && dropdown) {
      dropdownTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other dropdowns
        document.querySelectorAll('.platform-dropdown').forEach(d => {
          if (d !== dropdown) d.style.display = 'none';
        });
        // Toggle this dropdown
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
      });
      
      // Add handlers for dropdown items
      dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.platform-dropdown-item');
        if (item) {
          const platform = item.dataset.platform;
          this.openArtistProfile(result, platform);
          dropdown.style.display = 'none';
        }
      });
    }
    
    // Add handlers for favorite/blacklist buttons
    const favoriteBtn = element.querySelector('.favorite-btn');
    const blacklistBtn = element.querySelector('.blacklist-btn');
    
    // Add click handler for the confidence score
    const confidenceScore = element.querySelector('.confidence-score');
    confidenceScore.addEventListener('click', (e) => {
      e.stopPropagation();
      this.expandConfidenceDetails(result, element);
    });
    
    favoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFavorite(artistId);
      favoriteBtn.classList.toggle('active');
      favoriteBtn.textContent = favoriteBtn.classList.contains('active') ? '⭐' : '☆';
      // Toggle the CSS class on the result item
      element.classList.toggle('favorited');
    });
    
    blacklistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleBlacklist(artistId);
      blacklistBtn.classList.toggle('active');
      // Toggle the CSS class on the result item
      element.classList.toggle('blacklisted');
      // Remove favorited class if blacklisting
      if (blacklistBtn.classList.contains('active')) {
        element.classList.remove('favorited');
        const favBtn = element.querySelector('.favorite-btn');
        if (favBtn) {
          favBtn.classList.remove('active');
          favBtn.textContent = '☆';
        }
      }
    });
    
    return element;
  }
  
  createPlatformDropdown(result) {
    if (!result.platforms || result.platforms.length <= 1) {
      return '';
    }
    
    const dropdownItems = result.platforms.map(platform => {
      const platformData = result.platformData && result.platformData[platform];
      const confidence = platformData ? this.getRawConfidencePercent(platformData.confidence) : 0;
      const status = platformData ? platformData.commissionStatus : 'unclear';
      const statusIcon = status === 'open' ? '✅' : status === 'closed' ? '❌' : '❓';
      
      return `
        <div class="platform-dropdown-item" data-platform="${platform}">
          <img src="${this.getPlatformIcon(platform)}" alt="${this.formatPlatformName(platform)}" class="platform-icon-img" style="width: 16px; height: 16px; margin-right: 4px; vertical-align: middle;">
          <span class="platform-name">${this.formatPlatformName(platform)}</span>
          <span class="platform-status">${statusIcon} ${confidence}%</span>
        </div>
      `;
    }).join('');
    
    return `
      <div class="platform-dropdown" style="display: none;">
        ${dropdownItems}
      </div>
    `;
  }
  
  openArtistProfile(result, platformOverride = null) {
    let urlToOpen = result.profileUrl;
    
    // If a specific platform is requested and we have platform data for it
    if (platformOverride && result.platformData && result.platformData[platformOverride]) {
      urlToOpen = result.platformData[platformOverride].profileUrl;
    }
    
    chrome.tabs.create({ url: urlToOpen });
  }
  
  getPlatformIcon(platform) {
    const icons = {
      furaffinity: '../logos/fa.webp',
      bluesky: '../logos/bsky.svg',
      twitter: '../logos/twitter.svg'
    };
    return icons[platform] || '🔍';
  }
  
  // Get combined platform icons for multi-platform artists
  getPlatformIcons(result) {
    if (result.platforms && result.platforms.length > 1) {
      // Multiple platforms - show combined icons
      return result.platforms.map(p => this.getPlatformIcon(p));
    } else {
      // Single platform
      return [this.getPlatformIcon(result.platform)];
    }
  }
  
  formatPlatformName(platform) {
    const names = {
      furaffinity: 'FurAffinity',
      bluesky: 'Bluesky',
      twitter: 'Twitter/X'
    };
    return names[platform] || platform;
  }
  
  // Get formatted platform names for multi-platform artists
  formatPlatformNames(result) {
    if (result.platforms && result.platforms.length > 1) {
      // Multiple platforms - show combined names
      const names = result.platforms.map(p => this.formatPlatformName(p));
      if (names.length === 2) {
        return names.join(' + ');
      } else {
        return names.slice(0, -1).join(', ') + ' + ' + names[names.length - 1];
      }
    } else {
      // If only single platform
      return this.formatPlatformName(result.platform);
    }
  }
  
  getDefaultAvatar() {
    // Placeholder avatar
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMjAiIGZpbGw9IiMzNzQxNTEiLz4KPGNpcmNsZSBjeD0iMjAiIGN5PSIxNiIgcj0iNiIgZmlsbD0iIzZCNzI4MCIvPgo8cGF0aCBkPSJNNCAzMmMwLTggOC04IDE2LTggczE2IDAgMTYgOCIgZmlsbD0iIzZCNzI4MCIvPgo8L3N2Zz4K';
  }
  
  getDemoDisplayName(originalName) {
    // Generate random demo names by concatenating two random parts
    const nameParts = [
      'Crungy', 'Spingus', 'Bongus', 'Roingus', 'Boingu', 'Goobus', 'Gooperson',
      'Man #3', 'Scrimmy', 'Bingus', 'Scrumpus', 'Croungus', 'The Horror',
      'Crimbus', 'Chongo', 'Chungus', 'Scungus', 'Scrimblo', 'Person', 'Crogus',
      'Bean', 'Baby Corn', 'Jorge', 'Creature #2', 'Beebo', 'Gary', 'Glorbo',
      'Glorp', 'John Art', 'Kyle', 'McGuy', 'Mister'
    ];
    
    // Use the original name to generate consistent indices
    let hash = 0;
    for (let i = 0; i < originalName.length; i++) {
      const char = originalName.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Generate two consistent indices based on the hash
    const firstIndex = Math.abs(hash) % nameParts.length;
    const secondIndex = Math.abs(hash >> 8) % nameParts.length;
    
    // Ensure we don't get the same part twice
    const adjustedSecondIndex = (secondIndex === firstIndex) ? 
      (secondIndex + 1) % nameParts.length : secondIndex;
    
    return `${nameParts[firstIndex]} ${nameParts[adjustedSecondIndex]}`;
  }
  
  getDemoLoremText(originalText, maxLength = 100) {
    const loremWords = [
      'Lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
      'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
      'magna', 'aliqua', 'Ut', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
      'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
      'consequat', 'Duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate',
      'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'Excepteur', 'sint',
      'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia',
      'deserunt', 'mollit', 'anim', 'id', 'est', 'laborum'
    ];
    
    // Generate text with similar length to original
    const targetLength = Math.min(originalText.length, maxLength);
    let result = '';
    let wordIndex = 0;
    
    while (result.length < targetLength) {
      if (result.length > 0) result += ' ';
      result += loremWords[wordIndex % loremWords.length];
      wordIndex++;
    }
    
    // Trim to target length if necessary
    if (result.length > targetLength) {
      result = result.substring(0, targetLength - 3) + '...';
    }
    
    return result;
  }

  expandConfidenceDetails(result, element) {
    // Close any other expanded items
    const allItems = this.resultsList.querySelectorAll('.result-item');
    allItems.forEach(item => {
      if (item !== element && item.classList.contains('expanded')) {
        item.classList.remove('expanded');
      }
    });

    // Toggle expanded state for clicked item
    element.classList.toggle('expanded');
  }

  getStatusClass(commissionStatus) {
    switch (commissionStatus) {
      case 'open': return 'open';
      case 'closed': return 'closed';
      case 'unclear': return 'unclear';
      default: return 'unclear';
    }
  }

  getStatusLabel(commissionStatus) {
    switch (commissionStatus) {
      case 'open': return '✅ Open';
      case 'closed': return '❌ Closed';
      case 'unclear': return '❓ Unclear';
      default: return '❓ Unclear';
    }
  }

  createConfidenceDetails(result) {
    const { analysis } = result;
    if (!analysis?.components) return '';

    const components = analysis.components;
    let details = '';

    // Display name component (always show if present)
    if (components.displayName || result.displayName) {
        const originalDisplayName = result.displayName || '';
        const displayNameText = this.settings.demoMode ? this.getDemoDisplayName(originalDisplayName) : originalDisplayName;
        // Show raw confidence for individual components (how confident we are in this determination)
        const confidence = this.getRawConfidencePercent(components.displayName?.confidence);
        const confidenceClass = confidence >= 70 ? 'high' : 
                            confidence >= 50 ? 'medium' : 'low';
        details += `
            <div class="confidence-component">
                <div class="confidence-component-header">
                    <span class="confidence-component-title">Display Name</span>
                    <span class="confidence-component-score ${confidenceClass}">${confidence}%</span>
                </div>
                <div class="confidence-text">${displayNameText}</div>
                <div class="confidence-status ${this.getStatusClass(components.displayName?.commissionStatus || 'unclear')}">
                    ${this.getStatusLabel(components.displayName?.commissionStatus || 'unclear')}
                </div>
                ${components.displayName?.isSilverBullet ? '<div class="confidence-highlight">★ High Confidence Match</div>' : ''}
            </div>
        `;
    }

    // Bio component
    if (components.bio) {
        const bioText = this.settings.demoMode ? this.getDemoLoremText(result.bio || '', 200) : (result.bio || '');
        // Show raw confidence for individual components
        const confidence = this.getRawConfidencePercent(components.bio.confidence);
        const confidenceClass = confidence >= 70 ? 'high' : 
                            confidence >= 50 ? 'medium' : 'low';
        details += `
            <div class="confidence-component">
                <div class="confidence-component-header">
                    <span class="confidence-component-title">Profile Bio</span>
                    <span class="confidence-component-score ${confidenceClass}">${confidence}%</span>
                </div>
                <div class="confidence-text">${bioText}</div>
                <div class="confidence-status ${this.getStatusClass(components.bio.commissionStatus)}">
                    ${this.getStatusLabel(components.bio.commissionStatus)}
                </div>
                ${components.bio.isSilverBullet ? '<div class="confidence-highlight">★ High Confidence Match</div>' : ''}
            </div>
        `;
    }

    // Commission status component (if present)
    if (components.commissionStatus) {
        // Show raw confidence for individual components
        const confidence = this.getRawConfidencePercent(components.commissionStatus.confidence);
        const confidenceClass = confidence >= 70 ? 'high' : 
                            confidence >= 50 ? 'medium' : 'low';
        details += `
            <div class="confidence-component">
                <div class="confidence-component-header">
                    <span class="confidence-component-title">Commission Status</span>
                    <span class="confidence-component-score ${confidenceClass}">${confidence}%</span>
                </div>
                <div class="confidence-status ${this.getStatusClass(components.commissionStatus.commissionStatus)}">
                    ${this.getStatusLabel(components.commissionStatus.commissionStatus)}
                </div>
                ${components.commissionStatus.isSilverBullet ? '<div class="confidence-highlight">★ High Confidence Match</div>' : ''}
            </div>
        `;
    }

    // Journal component (only for FurAffinity)
    if (result.platform === 'furaffinity' && components.journal) {
        // Show raw confidence for individual components
        const confidence = this.getRawConfidencePercent(components.journal.confidence);
        const confidenceClass = confidence >= 70 ? 'high' : 
                            confidence >= 50 ? 'medium' : 'low';
        const timeAgo = components.journal.date ? ` ${this.formatTimeAgo(components.journal.date)}` : '';
        details += `
            <div class="confidence-component">
                <div class="confidence-component-header">
                    <span class="confidence-component-title">Recent Journal</span>
                    <span class="confidence-component-score ${confidenceClass}">${confidence}%</span>
                </div>
                <div class="confidence-status ${this.getStatusClass(components.journal.commissionStatus)}">
                    ${this.getStatusLabel(components.journal.commissionStatus)}${timeAgo}
                </div>
                ${components.journal.isSilverBullet ? '<div class="confidence-highlight">★ High Confidence Match</div>' : ''}
            </div>
        `;
    }

    // Gallery component (only for FurAffinity)
    if (result.platform === 'furaffinity' && components.gallery) {
        const galleryItems = components.gallery.items || [];
        // Show raw confidence for gallery component
        const confidence = this.getRawConfidencePercent(components.gallery.confidence);
        const confidenceClass = confidence >= 70 ? 'high' : 
                            confidence >= 50 ? 'medium' : 'low';
        
        details += `
            <div class="confidence-component">
                <div class="confidence-component-header">
                    <span class="confidence-component-title">Gallery Items</span>
                    <span class="confidence-component-score ${confidenceClass}">${confidence}%</span>
                </div>
                <div class="confidence-status ${this.getStatusClass(components.gallery.commissionStatus || 'unclear')}">
                    ${this.getStatusLabel(components.gallery.commissionStatus || 'unclear')} ${galleryItems.length} items analyzed
                </div>
                <div class="gallery-items">
                    <div class="gallery-items-header" data-gallery-toggle>
                        <span>View Gallery Items</span>
                        <span class="chevron">▼</span>
                    </div>
                    <div class="gallery-items-list">
                        ${galleryItems.map(item => {
                            // Show raw confidence for individual gallery items
                            const itemConfidence = this.getRawConfidencePercent(item.confidence);
                            const timeAgo = item.date ? this.formatTimeAgo(new Date(item.date).getTime()) : '';
                            const shortTitle = item.title ? 
                                (item.title.length > 25 ? item.title.substring(0, 22) + '...' : item.title) : 
                                'Untitled';
                            
                            const demoTitle = this.settings.demoMode ? this.getDemoLoremText(item.title || 'Untitled', 25) : shortTitle;
                            
                            return `
                                <a href="${item.url}" class="gallery-item" target="_blank" rel="noopener noreferrer">
                                    <span class="gallery-item-title">${demoTitle}</span>
                                    <span class="gallery-item-status ${this.getStatusClass(item.commissionStatus)}">
                                        ${this.getStatusLabel(item.commissionStatus).replace('✅ ', '').replace('❌ ', '').replace('❓ ', '')}
                                    </span>
                                    <span class="gallery-item-confidence">${itemConfidence}%</span>
                                </a>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // Posts component (only for Bluesky)
    if (result.platform === 'bluesky' && components.posts) {
        const postItems = components.posts.items || [];
        // Show raw confidence for posts component
        const confidence = this.getRawConfidencePercent(components.posts.confidence);
        const confidenceClass = confidence >= 70 ? 'high' : 
                            confidence >= 50 ? 'medium' : 'low';
        
        details += `
            <div class="confidence-component">
                <div class="confidence-component-header">
                    <span class="confidence-component-title">Recent Posts</span>
                    <span class="confidence-component-score ${confidenceClass}">${confidence}%</span>
                </div>
                <div class="confidence-status ${this.getStatusClass(components.posts.commissionStatus || 'unclear')}">
                    ${this.getStatusLabel(components.posts.commissionStatus || 'unclear')} ${postItems.length} posts analyzed
                </div>
                <div class="gallery-items">
                    <div class="gallery-items-header" data-gallery-toggle>
                        <span>View Recent Posts</span>
                        <span class="chevron">▼</span>
                    </div>
                    <div class="gallery-items-list">
                        ${postItems.map(post => {
                            // Show raw confidence for individual posts
                            const postConfidence = this.getRawConfidencePercent(post.confidence);
                            const timeAgo = post.date ? this.formatTimeAgo(new Date(post.date).getTime()) : '';
                            const shortText = post.text ? 
                                (post.text.length > 30 ? post.text.substring(0, 27) + '...' : post.text) : 
                                'No text';
                            const pinnedIndicator = post.isPinned ? '📌 ' : '';
                            
                            const demoText = this.settings.demoMode ? this.getDemoLoremText(post.text || 'No text', 30) : shortText;
                            
                            return `
                                <a href="${post.url}" class="gallery-item" target="_blank" rel="noopener noreferrer">
                                    <span class="gallery-item-title">${pinnedIndicator}${demoText}</span>
                                    <span class="gallery-item-status ${this.getStatusClass(post.commissionStatus)}">
                                        ${this.getStatusLabel(post.commissionStatus).replace('✅ ', '').replace('❌ ', '').replace('❓ ', '')}
                                    </span>
                                    <span class="gallery-item-confidence">${postConfidence}%</span>
                                </a>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // Final determination
    // Use transformed confidence for final display (represents likelihood of open commissions)
    const finalConfidence = this.getDisplayConfidence(result);
    const finalConfidenceClass = finalConfidence >= 70 ? 'high' : 
                                finalConfidence >= 50 ? 'medium' : 'low';
    details += `
        <div class="confidence-component">
            <div class="confidence-component-header">
                <span class="confidence-component-title">Final Determination</span>
                <span class="confidence-component-score ${finalConfidenceClass}">Likelihood of Open: ${finalConfidence}%</span>
            </div>
            <div class="confidence-status ${result.commissionStatus}">
                ${this.getStatusLabel(result.commissionStatus)}
            </div>
            ${analysis.hasSilverBullet ? '<div class="confidence-highlight">★ Contains High Confidence Matches</div>' : ''}
        </div>
    `;

    return details;
}
  
  formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  }
  
  updateLastScanTime(timestamp) {
    if (!timestamp) {
      this.lastScan.textContent = 'Never scanned';
      return;
    }
    
    const timeAgo = this.formatTimeAgo(timestamp);
    this.lastScan.textContent = `Last scan: ${timeAgo}`;
  }
  
  updateScanStatus(isScanning) {
    this.isScanning = isScanning;
    
    if (isScanning) {
      this.statusText.textContent = 'Scanning platforms...';
      this.statusDot.className = 'status-dot scanning';
      this.scanBtn.disabled = true;
      this.scanBtn.querySelector('.scan-text').textContent = 'Scanning...';
      this.stopBtn.style.display = 'block';
      this.scanBtn.style.display = 'none';
    } else {
      this.statusText.textContent = 'Ready to scan';
      this.statusDot.className = 'status-dot';
      this.scanBtn.disabled = false;
      this.scanBtn.style.display = 'block';
      this.stopBtn.style.display = 'none';
    
    }
  }
  
  showProgress(show) {
    this.scanProgress.style.display = show ? 'block' : 'none';
    if (show) {
      this.progressFill.style.width = '0%';
      this.currentProgressAnimation = null;
    }
  }

  showResultsLoading(show) {
    if (this.resultsLoadingOverlay) {
      this.resultsLoadingOverlay.style.display = show ? 'flex' : 'none';
    }
  }

  updateScanProgress(platform, progressData) {
    console.log('Updating scan progress:', platform, progressData);
    
    // Find the platform option element
    const platformOption = document.querySelector(`.platform-option[data-platform="${platform}"]`);
    if (!platformOption) return;
    
    // Get the progress bar element
    const progressBar = platformOption.querySelector('.platform-progress');
    if (!progressBar) return;

    // Update progress based on phase
    let statusText = '';
    let targetProgress = 0;
    let status = '';
    
    switch (progressData.phase) {
      case 'checking_login':
        statusText = `${platform}: Checking login status...`;
        targetProgress = 5;
        status = 'scanning';
        break;
      case 'gathering_artists':
        statusText = `${platform}: Gathering artist list...`;
        targetProgress = 10;
        status = 'scanning';
        break;
      case 'scanning_artists':
        if (progressData.currentArtist) {
          let subTaskInfo = '';
          if (progressData.subTask && progressData.subProgress) {
            subTaskInfo = ` - ${progressData.subTask} (${progressData.subProgress}%)`;
          }
          const artistName = this.settings.demoMode ? this.getDemoDisplayName(progressData.currentArtist) : progressData.currentArtist;
          statusText = `${platform}: Scanning ${artistName} (${progressData.completed}/${progressData.total})`;
          if (subTaskInfo) {
            statusText += `\n${subTaskInfo}`;
          }
        } else {
          statusText = `${platform}: Scanning artists...`;
        }
        targetProgress = progressData.percentage || 0;
        status = 'scanning';
        break;
      case 'completed':
        statusText = `${platform}: Completed!`;
        targetProgress = 100;
        status = 'completed';
        break;
      case 'error':
        statusText = `${platform}: ${progressData.error || 'Error occurred'}`;
        status = 'error';
        break;
      default:
        statusText = `${platform}: ${progressData.phase}`;
        targetProgress = progressData.percentage || 0;
        status = 'scanning';
    }

    // Update platform option status
    platformOption.setAttribute('data-status', status);

    // Get current progress
    const currentProgress = parseFloat(progressBar.style.width) || 0;
    
    // Cancel any existing animation for this platform
    if (this.platformAnimations?.[platform]) {
      cancelAnimationFrame(this.platformAnimations[platform]);
    }
    
    // Initialize platform animations object if it doesn't exist
    if (!this.platformAnimations) {
      this.platformAnimations = {};
    }
    
    // Animate progress smoothly using requestAnimationFrame
    const startTime = performance.now();
    const duration = 100;
    
    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease out cubic function for smooth animation
      const easeOut = (t) => 1 - Math.pow(1 - t, 3);
      const easedProgress = easeOut(progress);
      
      // Calculate intermediate progress
      const currentValue = currentProgress + (targetProgress - currentProgress) * easedProgress;
      
      // Update progress bar and text
      progressBar.style.width = `${currentValue}%`;
      this.updateProgressText(statusText);
      
      // Continue animation if not complete
      if (progress < 1) {
        this.platformAnimations[platform] = requestAnimationFrame(animate);
      } else {
        delete this.platformAnimations[platform];
      }
    };
    
    this.platformAnimations[platform] = requestAnimationFrame(animate);

    // Show rate limiting status
    if (progressData.rateLimited) {
      statusText += ' (Rate limited, waiting...)';
    }

    // Update UI
    this.updateProgressText(statusText);
    this.progressFill.style.width = `${Math.min(targetProgress, 100)}%`;
    
    // Add error indicator if needed
    if (progressData.errors > 0) {
      this.progressText.innerHTML = `${statusText} <span style="color: #f59e0b;">(${progressData.errors} errors)</span>`;
    }
  }
  
  updateProgressText(text) {
    this.progressText.textContent = text;
  }
  
  showResults() {
    this.resultsSection.style.display = 'block';
    this.resultsSection.classList.add('fade-in');
  }
  
  showEmptyState() {
    this.resultsSection.style.display = 'none';
    this.hideFilteredEmptyState();
    this.emptyState.style.display = 'block';
  }
  
  hideEmptyState() {
    this.emptyState.style.display = 'none';
  }
  
  updateUI() {
    if (this.currentResults.length > 0) {
      // Have scan results - show the results section and let displayResults handle the rest
      this.hideEmptyState();
      this.showResults();
      this.applyFilters(); // This will call displayResults() which handles empty filtered lists
      
      // Show the CommsClassifier promo, roadmap, and feedback after a successful scan
      if (this.commsClassifierPromo) {
        this.commsClassifierPromo.style.display = 'block';
      }
      if (this.roadmapSection) {
        this.roadmapSection.style.display = 'block';
      }
      if (this.feedbackSection) {
        this.feedbackSection.style.display = 'block';
      }
    } else {
      // No scan results at all - show the main empty state
      this.showEmptyState();
      
      // Hide the CommsClassifier promo, roadmap, and feedback when there are no results
      if (this.commsClassifierPromo) {
        this.commsClassifierPromo.style.display = 'none';
      }
      if (this.roadmapSection) {
        this.roadmapSection.style.display = 'none';
      }
      if (this.feedbackSection) {
        this.feedbackSection.style.display = 'none';
      }
    }
  }
  
  async clearResults() {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_RESULTS' });
      this.currentResults = [];
      this.filteredResults = [];
      this.showEmptyState();
      this.updateLastScanTime(null);
    } catch (error) {
      console.error('Error clearing results:', error);
    }
  }
  
  exportResults() {
    if (this.filteredResults.length === 0) {
      this.showError('No results to export');
      return;
    }
    
    // Use transformed confidence for export (represents likelihood of open commissions)
    const data = this.filteredResults.map(result => ({
      artist: result.displayName,
      username: result.username,
      platform: result.platform,
      confidence: this.getDisplayConfidence(result) + '%',
      profileUrl: result.profileUrl,
      triggers: result.triggers?.join(', ') || '',
      scanDate: new Date(result.lastUpdated).toISOString()
    }));
    
    const csv = this.convertToCSV(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `commissions-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  convertToCSV(data) {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => 
          `"${(row[header] || '').toString().replace(/"/g, '""')}"`
        ).join(',')
      )
    ].join('\n');
    
    return csv;
  }
  
  openSettings() {
    this.settingsModal.style.display = 'flex';
  }
  
  closeSettings() {
    this.settingsModal.style.display = 'none';
  }

  toggleRoadmap() {
    const isMinimized = this.roadmapSection.classList.contains('minimized');
    const toggleIcon = this.roadmapToggleBtn.querySelector('.toggle-icon');
    
    if (isMinimized) {
      // Expand
      this.roadmapSection.classList.remove('minimized');
      toggleIcon.textContent = '⇓';
      this.roadmapToggleBtn.title = 'Minimize Roadmap';
    } else {
      // Minimize
      this.roadmapSection.classList.add('minimized');
      toggleIcon.textContent = '❯❯';
      this.roadmapToggleBtn.title = 'Expand Roadmap';
    }

    // Save the state to storage
    chrome.storage.local.set({
      roadmapMinimized: !isMinimized
    });
  }
  
  async clearAllData() {
    if (confirm('Are you sure you want to clear all scan results and settings? This will remove all cached artist data and start fresh.')) {
      try {
        await chrome.storage.local.clear();
        
        // Reset local state
        this.currentResults = [];
        this.filteredResults = [];
        this.favorites = new Set();
        this.blacklist = new Set();
        
        // Update UI
        this.showEmptyState();
        this.updateLastScanTime(null);
        this.updateScanStatus(false);
        this.showProgress(false);
        this.showResultsLoading(false);
        this.stopBtn.style.display = 'none';
        this.scanBtn.style.display = 'block';
        this.scanBtn.disabled = false;
        this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
        
        // Reload default settings
        this.loadSettings();
        
        this.showSuccess('All data cleared successfully');
      } catch (error) {
        console.error('Error clearing data:', error);
        this.showError('Failed to clear data');
      }
    }
  }
  
  showSuccess(message) {
    this.showNotification(message, 'success');
  }

  async updateTemperature(temperature) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_TEMPERATURE',
        temperature: temperature
      });
      
      if (response.success) {
        await chrome.storage.local.set({ modelTemperature: temperature });
      } else {
        throw new Error(response.error || 'Failed to update temperature');
      }
    } catch (error) {
      console.error('Error updating temperature:', error);
      this.showError('Failed to update temperature');
    }
  }
  
  showError(message) {
    this.showNotification(message, 'error');
    this.statusDot.className = 'status-dot error';
    this.statusText.textContent = 'Error occurred';
  }
  
  showNotification(message, type) {
    // Create a simple notification
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#10b981' : '#ef4444'};
      color: white;
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 13px;
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }

  showTwitterDisabledReason() {
    const message = `Twitter/X integration is temporarily disabled.

Reason: Twitter eliminated all free APIs and scraping capabilities. The current pricing options are:
• Enterprise API: $50,000+ per month
• Third-party alternatives: ~$40/month + $0.40 per 1,000 requests

We may implement Twitter support in the future if we reach enough users to justify the cost, potentially through a premium subscription or Patreon support.

For now, please use FurAffinity and Bluesky for commission scanning.`;

    alert(message);
  }

  async checkModelStatus() {
    if (!this.settings.aiEnabled) {
      return;
    }

    try {
      // Send the currently selected quantization to check its status
      const response = await chrome.runtime.sendMessage({ 
        type: 'GET_MODEL_STATUS',
        modelName: this.settings.selectedQuantization
      });
      
      // No UI updates needed since we handle model download during scan
      if (!response.isCached) {
        console.log('Model not downloaded yet - will download during scan if needed');
      }
    } catch (error) {
      console.error('Error checking model status:', error);
    }
  }

  getQuantizationDisplayName(quantizationType) {
    const displayNames = {
      'full': 'Full Precision (268 MB)',
      'fp16': 'FP16 (134 MB)',
      'quantized': 'Quantized INT8 (67.5 MB)',
      'int8': 'INT8 (67.5 MB)',
      'uint8': 'UINT8 (67.5 MB)',
      'q4f16': 'Q4F16 (73 MB)',
      'bnb4': 'BNB4 (122 MB)',
      'q4': 'Q4 (125 MB)'
    };
    return displayNames[quantizationType] || quantizationType;
  }

  // Search debugging and utility methods
  toggleSearchDebug() {
    this.debugSearch = !this.debugSearch;
    console.log('[Search] Debug mode:', this.debugSearch ? 'ENABLED' : 'DISABLED');
  }

  debouncedSearch() {
    // Clear existing timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    
    // Set new timer for 150ms delay
    this.searchDebounceTimer = setTimeout(() => {
      this.applyFilters();
    }, 150);
  }

  clearSearch() {
    if (this.debugSearch) {
      console.log('[Search] Clearing search input and filters');
    }
    
    // Clear debounce timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    
    this.searchFilter.value = '';
    this.searchInstance = null;
    this.applyFilters();
  }

  getSearchStats() {
    const stats = {
      totalResults: this.currentResults.length,
      filteredResults: this.filteredResults.length,
      searchActive: this.searchFilter.value.trim() !== '',
      searchTerm: this.searchFilter.value.trim(),
      fuseInitialized: this.searchInstance !== null
    };
    
    console.log('[Search] Current stats:', stats);
    return stats;
  }

  // Test search functionality (call from console: window.popup.testSearch('artist name'))
  testSearch(testTerm) {
    console.log('\n=== TESTING SEARCH FUNCTIONALITY ===');
    console.log('Test term:', testTerm);
    console.log('Current data:', this.currentResults.length, 'items');
    
    if (this.currentResults.length === 0) {
      console.log('❌ No data to search in. Run a scan first.');
      return;
    }
    
    // Save current search term
    const originalTerm = this.searchFilter.value;
    
    // Set test term and run search
    this.searchFilter.value = testTerm;
    this.applyFilters();
    
    console.log('Search results:', this.filteredResults.length, 'items');
    if (this.filteredResults.length > 0) {
      console.log('Top 3 results:');
      this.filteredResults.slice(0, 3).forEach((result, index) => {
        console.log(`${index + 1}. ${result.displayName} (${result.username}) - Score: ${result.searchScore?.toFixed(3) || 'N/A'}`);
      });
    }
    
    // Restore original search term
    this.searchFilter.value = originalTerm;
    this.applyFilters();
    
    console.log('=== TEST COMPLETE ===\n');
  }

  async startModelDownload() {
    // This function is no longer needed as model download is handled by the background script
    // Keeping it for now, but it will be removed in a future edit.
    console.log('Model download initiated (handled by background script)');
    this.showSuccess('Model download initiated (handled by background script)');
  }

  updateModelDownloadProgress(status, progress) {
    // This function is no longer needed as model download is handled by the background script
    // Keeping it for now, but it will be removed in a future edit.
    console.log('Model download progress update:', status, progress);
  }

  async checkBenchmarkAvailability() {
    try {
        // Try to import the benchmark module
        const benchmarkModule = await import('/benchmark.js');
        if (benchmarkModule && benchmarkModule.BenchmarkRunner) {
            // Show benchmark button if module exists
            if (this.benchmarkGroup) {
                this.benchmarkGroup.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Failed to load benchmark module:', error);
        // Module not found, hide benchmark button
        if (this.benchmarkGroup) {
            this.benchmarkGroup.style.display = 'none';
        }
    }
  }

  async startBenchmark() {
    try {
        // Disable the button and show progress
        this.runBenchmarkBtn.disabled = true;
        this.benchmarkProgress.style.display = 'block';
        this.benchmarkResults.style.display = 'none';
        this.benchmarkTable.innerHTML = '';

        const { BenchmarkRunner } = await import('/benchmark.js');
        const runner = new BenchmarkRunner();

        const results = await runner.runBenchmark((message, progress) => {
            this.benchmarkProgress.querySelector('.benchmark-progress-fill').style.width = `${progress}%`;
            this.benchmarkProgress.querySelector('.benchmark-text').textContent = message;
        });

        // Create table header
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th>Model</th>
            <th>F1 Score</th>
            <th>Precision</th>
            <th>Recall</th>
            <th>Samples/sec</th>
            <th>Total Time</th>
            <th>Samples</th>
        `;
        this.benchmarkTable.appendChild(headerRow);

        // Add results rows
        results.forEach(result => {
            const row = document.createElement('tr');
            const f1Class = this.getMetricClass(parseFloat(result.f1Score));
            const precisionClass = this.getMetricClass(parseFloat(result.precision));
            const recallClass = this.getMetricClass(parseFloat(result.recall));
            const speedClass = this.getSpeedClass(parseFloat(result.samplesPerSecond));
            
            row.innerHTML = `
                <td>${this.getQuantizationDisplayName(result.quantization)}</td>
                <td class="${f1Class}">${(parseFloat(result.f1Score) * 100).toFixed(1)}%</td>
                <td class="${precisionClass}">${(parseFloat(result.precision) * 100).toFixed(1)}%</td>
                <td class="${recallClass}">${(parseFloat(result.recall) * 100).toFixed(1)}%</td>
                <td class="${speedClass}">${result.samplesPerSecond}/s</td>
                <td>${result.totalTimeSeconds}s</td>
                <td>${result.total}</td>
            `;
            this.benchmarkTable.appendChild(row);
        });

        // Show results
        this.benchmarkResults.style.display = 'block';
        this.benchmarkProgress.style.display = 'none';
        this.runBenchmarkBtn.disabled = false;

    } catch (error) {
        console.error('Benchmark error:', error);
        this.showError('Failed to run benchmark: ' + error.message);
        this.runBenchmarkBtn.disabled = false;
        this.benchmarkProgress.style.display = 'none';
    }
}

getMetricClass(value) {
    if (value >= 0.8) return 'accuracy-high';
    if (value >= 0.6) return 'accuracy-medium';
    return 'accuracy-low';
}

getSpeedClass(samplesPerSecond) {
    if (samplesPerSecond >= 2.0) return 'speed-high';
    if (samplesPerSecond >= 1.0) return 'speed-medium';
    return 'speed-low';
}

  async updateDebugMode() {
    this.settings.debugMode = this.debugMode.checked;
    
    try {
      await chrome.storage.local.set({
        debugMode: this.settings.debugMode
      });
      
      // Notify background script about debug mode change
      await chrome.runtime.sendMessage({
        type: 'UPDATE_DEBUG_MODE',
        debugMode: this.settings.debugMode
      });
      
      this.showSuccess(`Debug mode ${this.settings.debugMode ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error updating debug mode:', error);
      this.showError('Failed to update debug mode');
    }
  }
  
  async updateZenMode() {
    this.settings.zenMode = this.zenMode.checked;
    
    try {
      await chrome.storage.local.set({
        zenMode: this.settings.zenMode
      });
      
      this.toggleZenMode(this.settings.zenMode);
      this.showSuccess(`Zen mode ${this.settings.zenMode ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error updating zen mode:', error);
      this.showError('Failed to update zen mode');
    }
  }
  
  async updateDemoMode() {
    this.settings.demoMode = this.demoMode.checked;
    
    try {
      await chrome.storage.local.set({
        demoMode: this.settings.demoMode
      });
      
      // Re-render results to apply demo mode changes
      this.displayResults();
      this.showSuccess(`Demo mode ${this.settings.demoMode ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Error updating demo mode:', error);
      this.showError('Failed to update demo mode');
    }
  }
  
  toggleZenMode(enabled) {
    // Hide/show promo section
    if (this.commsClassifierPromo) {
      this.commsClassifierPromo.style.display = enabled ? 'none' : '';
    }
    
    // Hide/show roadmap section
    if (this.roadmapSection) {
      this.roadmapSection.style.display = enabled ? 'none' : '';
    }
    
    // Hide/show feedback section
    if (this.feedbackSection) {
      this.feedbackSection.style.display = enabled ? 'none' : '';
    }
  }

  // Promo section hide methods
  showPromoHideOptions() {
    if (this.promoHideOptions) {
      this.promoHideOptions.style.display = 'block';
    }
  }

  async hidePromoForever() {
    try {
      await chrome.storage.local.set({ promoHiddenForever: true });
      if (this.commsClassifierPromo) {
        this.commsClassifierPromo.style.display = 'none';
      }
      this.showSuccess('Promo section hidden permanently');
    } catch (error) {
      console.error('Error hiding promo forever:', error);
      this.showError('Failed to hide promo section');
    }
  }

  async hidePromoFor3Days() {
    try {
      const hiddenUntil = Date.now() + (3 * 24 * 60 * 60 * 1000); // 3 days from now
      await chrome.storage.local.set({ promoHiddenUntil: hiddenUntil });
      if (this.commsClassifierPromo) {
        this.commsClassifierPromo.style.display = 'none';
      }
      this.showSuccess('Promo section hidden for 3 days');
    } catch (error) {
      console.error('Error hiding promo for 3 days:', error);
      this.showError('Failed to hide promo section');
    }
  }

  // Feedback section hide methods
  showFeedbackHideOptions() {
    if (this.feedbackHideOptions) {
      this.feedbackHideOptions.style.display = 'block';
    }
  }

  async hideFeedbackForever() {
    try {
      await chrome.storage.local.set({ feedbackHiddenForever: true });
      if (this.feedbackSection) {
        this.feedbackSection.style.display = 'none';
      }
      this.showSuccess('Feedback section hidden permanently');
    } catch (error) {
      console.error('Error hiding feedback forever:', error);
      this.showError('Failed to hide feedback section');
    }
  }

  async hideFeedbackFor3Days() {
    try {
      const hiddenUntil = Date.now() + (3 * 24 * 60 * 60 * 1000); // 3 days from now
      await chrome.storage.local.set({ feedbackHiddenUntil: hiddenUntil });
      if (this.feedbackSection) {
        this.feedbackSection.style.display = 'none';
      }
      this.showSuccess('Feedback section hidden for 3 days');
    } catch (error) {
      console.error('Error hiding feedback for 3 days:', error);
      this.showError('Failed to hide feedback section');
    }
  }

  async checkDisclaimerAcknowledgment() {
    try {
      const result = await chrome.storage.local.get(['disclaimerAcknowledged']);
      if (!result.disclaimerAcknowledged) {
        this.showDisclaimer();
      }
    } catch (error) {
      console.error('Error checking disclaimer acknowledgment:', error);
      // If there's an error checking, show the disclaimer to be safe
      this.showDisclaimer();
    }
  }

  showDisclaimer() {
    if (this.disclaimerOverlay) {
      document.body.classList.add('disclaimer-active');
      this.disclaimerOverlay.style.display = 'flex';
      this.showDisclaimerPage1();
    }
  }

  hideDisclaimer() {
    if (this.disclaimerOverlay) {
      document.body.classList.remove('disclaimer-active');
      this.disclaimerOverlay.style.display = 'none';
    }
  }

  showDisclaimerPage1() {
    if (this.disclaimerPage1 && this.disclaimerPage2) {
      this.disclaimerPage1.style.display = 'block';
      this.disclaimerPage2.style.display = 'none';
    }
  }

  showDisclaimerPage2() {
    if (this.disclaimerPage1 && this.disclaimerPage2) {
      this.disclaimerPage1.style.display = 'none';
      this.disclaimerPage2.style.display = 'block';
    }
  }

  async acceptDisclaimer() {
    try {
      await chrome.storage.local.set({ disclaimerAcknowledged: true });
      this.hideDisclaimer();
      this.showSuccess('Welcome to Commsfinder!');
    } catch (error) {
      console.error('Error saving disclaimer acknowledgment:', error);
      this.showError('Failed to save acknowledgment');
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const popup = new CommisionsfinderPopup();
  // Expose for debugging (can call window.popup.testSearch('term') in console)
  window.popup = popup;
});

// Add notification animations to document
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);