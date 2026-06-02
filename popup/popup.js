/* global Fuse */
// Popup JavaScript for Commsfinder extension

const E621_TAG_ALIASES = {
  'goo_(disambiguation)': 'goo',
  goo_disambiguation: 'goo',
  hypno: 'hypnosis',
};

const LOCAL_E621_TAG_SUGGESTIONS = [
  'anthro',
  'digital_art',
  'goo',
  'hypnosis',
  'painting',
  'traditional_art',
  'transformation',
  'werewolf',
];

class CommissionsfinderPopup {
  constructor() {
    this.isScanning = false;
    this.currentResults = [];
    this.filteredResults = [];
    this.favorites = new Set();
    this.blacklist = new Set();
    this.showBlacklisted = false;
    this.showGeneralTags = false;
    this.searchInstance = null; // Fuse.js instance
    this.debugSearch = false; // Enable search debugging (toggle with window.popup.toggleSearchDebug())
    this.searchDebounceTimer = null; // For debounced search
    this.searchTokens = [];
    this.tagAutocompleteCache = new Map();
    this.tagAutocompleteTimer = null;
    this.e621EmbeddingsLoaded = false;
    this.e621EmbeddingsLoadPromise = null;
    this.e621AliasMap = new Map(Object.entries(E621_TAG_ALIASES));
    this.e621ImplicationMap = new Map();
    this.e621Tags = [];
    this.e621TagExpansionCache = new Map();
    this.profileThemeCache = new Map();
    this.lastScanSettings = null;
    this.pendingScanSettings = null;
    this.scanProgressByPlatform = {};
    this.promoHiddenForever = false; // Cache for promo hide forever preference
    this.promoHiddenUntil = null; // Cache for promo hide until timestamp
    this.feedbackHiddenForever = false; // Cache for feedback hide forever preference
    this.feedbackHiddenUntil = null; // Cache for feedback hide until timestamp
    this.lastFocusedElement = null;
    this.activeFocusTrap = null;
    this.loginRequiredPause = null;
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
    // Check disclaimer status immediately to prevent flash (don't await, fire and forget)
    // Disclaimer is hidden by default in CSS, so no flash occurs
    this.checkDisclaimerAcknowledgmentQuick();
    // Initialize async operations
    this.initializeAsync();
  }
  
  async checkDisclaimerAcknowledgmentQuick() {
    // Quick async check - disclaimer is hidden by default in CSS, so no flash
    // This runs immediately without blocking to show disclaimer ASAP if needed
    try {
      const result = await chrome.storage.local.get(['disclaimerAcknowledged']);
      if (result.disclaimerAcknowledged !== true) {
        // Not acknowledged, show it immediately
        this.showDisclaimer();
      }
      // If acknowledged, it stays hidden (hidden by default in CSS)
    } catch (error) {
      console.error('[Commsfinder] Error in quick disclaimer check:', error);
      // On error, show disclaimer to be safe
      this.showDisclaimer();
    }
  }
  
  async initializeAsync() {
    // Load settings first
    await this.loadSettings();
    
    // Then load popup-critical data in parallel. The larger e621 dictionaries
    // are loaded lazily when search needs them.
    await Promise.all([
      this.loadResults(),
      this.loadFavoritesAndBlacklist()
    ]);

    this.searchInstance = null;
    this.applyFilters();
    
    // Check model status and benchmark availability (non-blocking)
    this.checkModelStatus();
    this.checkBenchmarkAvailability();
    
    // Do a final async check to ensure disclaimer state is correct (redundant but safe)
    await this.checkDisclaimerAcknowledgment();
  }
  
  initializeElements() {
    // Peep the horror.

    // Main elements
    this.scanBtn = document.getElementById('scanBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.scanProgress = document.getElementById('scanProgress');
    this.progressBar = document.getElementById('progressBar');
    this.progressFill = document.getElementById('progressFill');
    this.progressText = document.getElementById('progressText');
    
    // Status elements
    this.statusIndicator = document.getElementById('statusIndicator');
    this.scanStatus = document.getElementById('scanStatus');
    this.statusText = document.getElementById('statusText');
    this.lastScan = document.getElementById('lastScan');
    this.statusDot = this.statusIndicator.querySelector('.status-dot');
    this.scanStatusStats = document.getElementById('scanStatusStats');
    this.platformProfileCounts = {
      furaffinity: document.getElementById('furaffinityProfileCount'),
      bluesky: document.getElementById('blueskyProfileCount')
    };
    
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
    this.platformFilterIcons = document.getElementById('platformFilterIcons');
    this.searchFilter = document.getElementById('searchFilter');
    this.searchChipInput = document.getElementById('searchChipInput');
    this.searchChips = document.getElementById('searchChips');
    this.searchAutocomplete = document.getElementById('searchAutocomplete');
    this.clearSearchBtn = document.getElementById('clearSearchBtn');
    this.showBlacklistedCheckbox = document.getElementById('showBlacklisted');
    this.showGeneralTagsCheckbox = document.getElementById('showGeneralTags');
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
    this.clearAllDataBtn = document.getElementById('clearAllData');
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
    this.disclaimerDialog = document.getElementById('disclaimerDialog');
    this.disclaimerPage1 = document.getElementById('disclaimerPage1');
    this.disclaimerPage2 = document.getElementById('disclaimerPage2');
    this.disclaimerNextBtn = document.getElementById('disclaimerNextBtn');
    this.disclaimerBackBtn = document.getElementById('disclaimerBackBtn');
    this.disclaimerOkBtn = document.getElementById('disclaimerOkBtn');

    // Login-required pause elements
    this.loginRequiredOverlay = document.getElementById('loginRequiredOverlay');
    this.loginRequiredDialog = document.getElementById('loginRequiredDialog');
    this.loginRequiredTitle = document.getElementById('loginRequiredTitle');
    this.loginRequiredDescription = document.getElementById('loginRequiredDescription');
    this.loginRequiredDetail = document.getElementById('loginRequiredDetail');
    this.loginRequiredPlatformIcon = document.getElementById('loginRequiredPlatformIcon');
    this.openLoginTabBtn = document.getElementById('openLoginTabBtn');
    this.resumeLoginScanBtn = document.getElementById('resumeLoginScanBtn');
    this.cancelLoginRequiredBtn = document.getElementById('cancelLoginRequiredBtn');
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
    this.platformFilter.addEventListener('change', () => {
      this.updatePlatformFilterIcon();
      this.applyFilters();
    });
    this.searchFilter.addEventListener('input', () => this.handleSearchInput());
    this.searchFilter.addEventListener('focus', () => this.primeE621EmbeddingsForSearch());
    this.searchFilter.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
    this.searchFilter.addEventListener('blur', () => {
      setTimeout(() => this.hideTagAutocomplete(), 150);
    });
    if (this.searchChipInput) {
      this.searchChipInput.addEventListener('click', () => this.searchFilter.focus());
    }
    this.clearSearchBtn.addEventListener('click', () => this.clearSearch());
    this.showBlacklistedCheckbox.addEventListener('change', () => {
      this.showBlacklisted = this.showBlacklistedCheckbox.checked;
      this.applyFilters();
    });
    this.showGeneralTagsCheckbox.addEventListener('change', () => {
      this.showGeneralTags = this.showGeneralTagsCheckbox.checked;
      this.displayResults();
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
    const syncTemperatureTrack = () => {
      const min = parseFloat(this.modelTemperature.min) || 0;
      const max = parseFloat(this.modelTemperature.max) || 1;
      const val = parseFloat(this.modelTemperature.value) || min;
      const pct = max === min ? 0 : ((val - min) / (max - min)) * 100;
      this.modelTemperature.style.setProperty('--track-fill', `${pct}%`);
    };
    this.modelTemperature.addEventListener('input', () => {
      this.temperatureValue.textContent = this.modelTemperature.value;
      syncTemperatureTrack();
      this.updateTemperature(parseFloat(this.modelTemperature.value));
    });
    syncTemperatureTrack();
    this._syncTemperatureTrack = syncTemperatureTrack;
    this.clearAllDataBtn.addEventListener('click', () => this.clearAllData());
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
        document.querySelectorAll('.platform-dropdown-trigger').forEach(trigger => {
          trigger.setAttribute('aria-expanded', 'false');
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

    if (this.openLoginTabBtn) {
      this.openLoginTabBtn.addEventListener('click', () => this.openLoginTab());
    }
    if (this.resumeLoginScanBtn) {
      this.resumeLoginScanBtn.addEventListener('click', () => this.resumeLoginRequiredScan());
    }
    if (this.cancelLoginRequiredBtn) {
      this.cancelLoginRequiredBtn.addEventListener('click', () => this.cancelLoginRequiredScan());
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
      if (this._syncTemperatureTrack) this._syncTemperatureTrack();
      
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
        // Twitter is disabled and may be absent from popup markup.
        if (this.platformTwitter) {
          this.platformTwitter.checked = false;
        }
        this.settings.platforms.twitter = false;
      }
      
      // Restore roadmap state
      if (result.roadmapMinimized !== undefined && result.roadmapMinimized) {
        this.roadmapSection.classList.add('minimized');
        this.roadmapToggleBtn.title = 'Expand Roadmap';
        this.roadmapToggleBtn.setAttribute('aria-expanded', 'false');
      } else {
        this.roadmapToggleBtn.setAttribute('aria-expanded', 'true');
      }

      // Check promo hiding preferences and cache them
      const now = Date.now();
      this.promoHiddenForever = result.promoHiddenForever === true;
      this.promoHiddenUntil = result.promoHiddenUntil && now < result.promoHiddenUntil ? result.promoHiddenUntil : null;
      if (this.promoHiddenForever || this.promoHiddenUntil) {
        if (this.commsClassifierPromo) {
          this.commsClassifierPromo.style.display = 'none';
        }
      }

      // Check feedback hiding preferences and cache them
      this.feedbackHiddenForever = result.feedbackHiddenForever === true;
      this.feedbackHiddenUntil = result.feedbackHiddenUntil && now < result.feedbackHiddenUntil ? result.feedbackHiddenUntil : null;
      if (this.feedbackHiddenForever || this.feedbackHiddenUntil) {
        if (this.feedbackSection) {
          this.feedbackSection.style.display = 'none';
        }
      }

      // Show/hide model selection based on AI enabled status
      const modelSelectionGroup = document.getElementById('modelSelectionGroup');
      if (modelSelectionGroup) {
        modelSelectionGroup.style.display = this.settings.aiEnabled ? 'flex' : 'none';
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
        const progressStorage = await chrome.storage.local.get([
          'furaffinity_progress', 'bluesky_progress'
        ]);
        this.lastScanSettings = response.lastScanSettings || this.inferLegacyLastScanSettings(response.lastScanDate, progressStorage);
        // Clear search instance when new data is loaded
        this.searchInstance = null;
        this.updateLastScanTime(response.lastScanDate);
        this.updateScanSummary(progressStorage);
        this.updatePlatformFilterOptions();
        this.applyFilters();
        this.updateUI();
        
        // Determine actual scan state - use activeScansInProgress for UI state
        const isActivelyScanning = response.activeScansInProgress || false;
        const canResume = response.scanInProgress && !isActivelyScanning;
        this.loginRequiredPause = response.loginRequiredPause || null;
        
        this.isScanning = isActivelyScanning;
        this.updateScanStatus(isActivelyScanning);
        
        // Update button states based on actual scan status
        if (isActivelyScanning) {
          this.hideLoginRequiredOverlay();
          // Scan is actively running - show stop button
          this.showProgress(true);
          this.showResultsLoading(true);
          this.stopBtn.style.display = 'block';
          this.scanBtn.style.display = 'none';
          this.scanBtn.disabled = true;
          this.scanBtn.querySelector('.scan-text').textContent = 'Scanning...';
          
          // Update progress for the most active platform
          for (const platform of ['furaffinity', 'bluesky']) {
            const progressData = progressStorage[`${platform}_progress`];
            if (progressData && progressData.phase !== 'completed') {
              this.updateScanProgress(platform, progressData);
            }
          }
        } else {
          // Scan is not actively running - show scan/resume button
          this.showProgress(false);
          this.stopBtn.style.display = 'none';
          this.scanBtn.style.display = '';
          this.scanBtn.disabled = false;
          
          // Determine button text based on whether there's incomplete progress
          if (canResume) {
            this.scanBtn.querySelector('.scan-text').textContent = 'Resume Scan';
          } else {
            this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
          }

          if (this.loginRequiredPause) {
            this.showLoginRequiredOverlay(this.loginRequiredPause);
          } else {
            this.hideLoginRequiredOverlay();
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
      this.scanBtn.style.display = '';
      this.scanBtn.disabled = false;
      this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
    }
  }
  
  async updatePlatformSettings() {
    this.settings.platforms = {
      furaffinity: this.platformFuraffinity.checked,
      bluesky: this.platformBluesky.checked,
      twitter: false // Twitter is disabled, always set to false
    };
    this.updateScanSummary();
    
    try {
      await chrome.storage.local.set({ platforms: this.settings.platforms });
    } catch (error) {
      console.error('Error saving platform settings:', error);
      this.showError('Failed to save platform settings');
    }
  }
  
  async updateSettings() {
    this.settings.aiEnabled = this.aiEnabled.checked;
    
    try {
      await chrome.storage.local.set({
        aiEnabled: this.settings.aiEnabled
      });
      
      // Show/hide model selection based on AI enabled status
      const modelSelectionGroup = document.getElementById('modelSelectionGroup');
      if (modelSelectionGroup) {
        modelSelectionGroup.style.display = this.settings.aiEnabled ? 'flex' : 'none';
      }
      
      // Re-apply filters in case the mode affects results
      this.applyFilters();
      
      // Update model status when AI is toggled
      this.checkModelStatus();
    } catch (error) {
      console.error('Error saving AI enabled setting:', error);
      this.showError('Failed to save setting');
    }
  }

  async updateModelSettings() {
    this.settings.selectedQuantization = this.modelSelector.value;
    
    try {
      await chrome.storage.local.set({
        selectedQuantization: this.settings.selectedQuantization
      });
      
      // Clear any existing model cache and update status
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
    this.hideLoginRequiredOverlay();
    
    const enabledPlatforms = Object.keys(this.settings.platforms)
      .filter(platform => this.settings.platforms[platform]);
    
    if (enabledPlatforms.length === 0) {
      this.showError('Please select at least one platform to scan');
      return;
    }
    
    try {
      const scanSettings = this.createScanSettingsSnapshot(enabledPlatforms);
      this.pendingScanSettings = scanSettings;
      this.lastScanSettings = scanSettings;
      this.scanProgressByPlatform = {};
      enabledPlatforms.forEach(platform => {
        this.scanProgressByPlatform[platform] = { percentage: 0 };
      });
      await chrome.storage.local.set({ activeScanSettings: scanSettings });

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
        platforms: enabledPlatforms,
        scanSettings
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
        this.scanBtn.style.display = '';
        this.pendingScanSettings = null;
        this.showError(error.message || 'Failed to start scan');
    }
  }

  createScanSettingsSnapshot(platforms) {
    return {
      platforms: [...platforms],
      mode: this.settings.aiEnabled ? 'discriminative' : 'pattern',
      model: this.settings.aiEnabled ? (this.settings.selectedQuantization || 'full') : null,
      startedAt: Date.now()
    };
  }

  inferLegacyLastScanSettings(lastScanDate, progressStorage = {}) {
    if (!lastScanDate) return null;
    const platforms = ['furaffinity', 'bluesky'].filter(platform => {
      const progress = progressStorage[`${platform}_progress`];
      return progress?.total > 0 || this.getPlatformResultCount(platform) > 0;
    });
    return {
      platforms: platforms.length ? platforms : ['furaffinity', 'bluesky'],
      mode: this.settings.aiEnabled ? 'discriminative' : 'pattern',
      model: this.settings.aiEnabled ? (this.settings.selectedQuantization || 'full') : null,
      completedAt: lastScanDate
    };
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
        this.scanBtn.style.display = '';
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
        if (Array.isArray(message.data)) {
          this.currentResults = message.data;
        } else if (message.data?.artist) {
          const { artist, index } = message.data;
          if (Number.isInteger(index) && index >= 0 && index <= this.currentResults.length) {
            this.currentResults[index] = artist;
          } else {
            this.currentResults.push(artist);
          }
        } else {
          this.currentResults = [];
        }
        // Clear search instance when results are updated
        this.searchInstance = null;
        this.updatePlatformFilterOptions();
        this.applyFilters();
        this.updateUI();
        break;
        
      case 'SCAN_FINISHED':
        this.hideLoginRequiredOverlay();
        this.isScanning = false;
        this.updateScanStatus(false);
        this.showProgress(false);
        this.showResultsLoading(false);
        this.stopBtn.style.display = 'none';
        this.scanBtn.style.display = '';
        this.scanBtn.disabled = false;
        this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
        this.currentResults = message.data || [];
        this.lastScanSettings = this.pendingScanSettings || this.createScanSettingsSnapshot(
          Object.keys(this.settings.platforms).filter(platform => this.settings.platforms[platform])
        );
        this.pendingScanSettings = null;
        // Clear search instance when scan finishes
        this.searchInstance = null;
        this.updateLastScanTime(Date.now());
        this.updateScanSummary();
        this.updatePlatformFilterOptions();
        this.applyFilters();
        this.updateUI();
        this.showSuccess(`Scan complete! Found ${this.currentResults.length} artists with open commissions.`);
        break;
        
      case 'SCAN_ERROR':
        this.hideLoginRequiredOverlay();
        this.isScanning = false;
        this.updateScanStatus(false);
        this.showProgress(false);
        this.showResultsLoading(false);
        this.stopBtn.style.display = 'none';
        this.scanBtn.style.display = '';
        this.scanBtn.disabled = false;
        this.showError(message.error || 'Scan failed');
        break;

      case 'MODEL_DOWNLOAD_PROGRESS':
        this.updateProgressText(`Downloading model: ${message.data.status}`);
        this.setOverallProgress(message.data.progress);
        break;

      case 'SCAN_PROGRESS_UPDATE':
        // If we receive progress updates but UI doesn't show scanning, fix the state
        if (!this.isScanning && message.data.phase !== 'completed') {
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

      case 'LOGIN_REQUIRED':
        this.loginRequiredPause = message.data || null;
        this.isScanning = false;
        this.updateScanStatus(false);
        this.showProgress(false);
        this.showResultsLoading(false);
        this.stopBtn.style.display = 'none';
        this.scanBtn.style.display = '';
        this.scanBtn.disabled = false;
        this.scanBtn.querySelector('.scan-text').textContent = 'Resume Scan';
        this.showLoginRequiredOverlay(this.loginRequiredPause);
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

  escapeHtml(value) {
    // Escape every HTML meta-character explicitly. A textContent->innerHTML
    // round-trip leaves quotes intact, which allows attribute breakout when the
    // result is interpolated into a quoted attribute (alt="...", data-tag="...").
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeAttribute(value) {
    return this.escapeHtml(value).replace(/`/g, '&#96;');
  }

  sanitizeUrl(url, fallback = '') {
    if (!url || typeof url !== 'string') {
      return fallback;
    }

    try {
      const parsed = new URL(url, window.location.href);
      const allowedProtocols = ['http:', 'https:', 'chrome-extension:', 'moz-extension:'];
      if (!allowedProtocols.includes(parsed.protocol)) {
        return fallback;
      }
      return parsed.href;
    } catch {
      return fallback;
    }
  }

  getVisibleProfileTags(result, limit = null) {
    const tags = Array.isArray(result.profileTags) ? result.profileTags : [];
    const visibleTags = this.showGeneralTags
      ? tags
      : tags.filter(tag => tag.category !== 'general');

    return Number.isInteger(limit) ? visibleTags.slice(0, limit) : visibleTags;
  }

  getProfileTagsHtml(result, limit = 12, options = {}) {
    const allTags = Array.isArray(result.profileTags) ? result.profileTags : [];
    const tags = options.includeGeneral
      ? (Number.isInteger(limit) ? allTags.slice(0, limit) : allTags)
      : this.getVisibleProfileTags(result, limit);
    if (tags.length === 0) return '';

    return `
      <div class="result-tags">
        ${tags.map(tag => {
          const matchedAliases = Array.isArray(tag.matchedAliases) && tag.matchedAliases.length > 0
            ? `Matched: ${tag.matchedAliases.join(', ')}`
            : `Aliases: ${(tag.aliases || []).slice(0, 8).join(', ')}`;
          const occurrenceCount = this.getTagOccurrenceCount(tag);
          return `
            <span class="result-tag" title="${this.escapeHtml(`${matchedAliases} | ${occurrenceCount} occurrences`)}">
              <span class="result-tag-name">${this.escapeHtml(tag.label || tag.tag)}</span>
              <span class="result-tag-count">${occurrenceCount}</span>
            </span>
          `;
        }).join('')}
      </div>
    `;
  }

  async loadJsonResource(path) {
    const url = chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }
    return response.json();
  }

  async loadE621Embeddings() {
    if (this.e621EmbeddingsLoaded) return true;
    if (this.e621EmbeddingsLoadPromise) return this.e621EmbeddingsLoadPromise;

    this.e621EmbeddingsLoadPromise = (async () => {
      try {
        const [aliases, implications, tags] = await Promise.all([
          this.loadJsonResource('e621-embeddings/aliases.json'),
          this.loadJsonResource('e621-embeddings/implications.json'),
          this.loadJsonResource('e621-embeddings/tags.json'),
        ]);

        this.e621AliasMap = new Map([
          ...Object.entries(E621_TAG_ALIASES),
          ...Object.entries(aliases || {}).map(([alias, canonical]) => [
            this.normalizeRawE621Tag(alias),
            this.normalizeRawE621Tag(canonical),
          ]),
        ]);

        this.e621ImplicationMap = new Map(Object.entries(implications || {}).map(([childTag, parentTags]) => [
          this.resolveE621Alias(childTag),
          [...new Set((Array.isArray(parentTags) ? parentTags : [])
            .map(parentTag => this.resolveE621Alias(parentTag))
            .filter(Boolean))],
        ]));

        this.e621Tags = (Array.isArray(tags) ? tags : [])
          .map(tag => this.resolveE621Alias(tag))
          .filter(Boolean);
        this.e621TagExpansionCache.clear();
        this.e621EmbeddingsLoaded = true;

        if (this.debugSearch) {
          console.log('[Search] Loaded e621 embeddings:', {
            aliases: this.e621AliasMap.size,
            implications: this.e621ImplicationMap.size,
            tags: this.e621Tags.length,
          });
        }
        return true;
      } catch (error) {
        console.warn('[Search] Failed to load e621 embeddings; falling back to scanned tags only:', error);
        return false;
      } finally {
        this.e621EmbeddingsLoadPromise = null;
      }
    })();

    return this.e621EmbeddingsLoadPromise;
  }

  primeE621EmbeddingsForSearch() {
    if (this.e621EmbeddingsLoaded || this.e621EmbeddingsLoadPromise) return;

    this.loadE621Embeddings().then((loaded) => {
      if (!loaded) return;
      this.updateTagAutocomplete();
      if (this.getActiveSearchTerm()) {
        this.searchInstance = null;
        this.applyFilters();
      }
    });
  }

  normalizeRawE621Tag(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/^[-+~]+/, '')
      .replace(/&/g, ' and ')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9:><=._*()-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  resolveE621Alias(value) {
    const normalized = this.normalizeRawE621Tag(value);
    return this.e621AliasMap.get(normalized) || normalized;
  }

  normalizeSearchTag(value) {
    return this.resolveE621Alias(value);
  }

  normalizeSearchText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/[^\p{L}\p{N}#><:=.()]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getActiveSearchTerm() {
    return [...this.searchTokens, this.searchFilter.value.trim()]
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  tokenizeSearchQuery(query) {
    const tokens = [];
    let current = '';
    let inQuote = false;

    for (const char of String(query || '')) {
      if (char === '"') {
        inQuote = !inQuote;
        current += char;
        continue;
      }

      if (!inQuote && /\s/.test(char)) {
        if (current.trim()) tokens.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim()) tokens.push(current.trim());
    return tokens.map(token => token.replace(/^"|"$/g, '').trim()).filter(Boolean);
  }

  stripSearchPrefix(token) {
    const prefix = {
      negative: false,
      optional: false,
    };
    let value = String(token || '').trim();

    while (value.length > 1 && ['-', '~'].includes(value[0])) {
      if (value[0] === '-') prefix.negative = !prefix.negative;
      if (value[0] === '~') prefix.optional = true;
      value = value.slice(1);
    }

    return { ...prefix, value };
  }

  parseSearchQuery(query) {
    const tokens = this.tokenizeSearchQuery(query);
    const parsed = {
      positiveTerms: [],
      negativeTerms: [],
      optionalTerms: [],
      groups: [],
      optionalGroups: [],
      filters: [],
      order: null,
      rawTerms: [],
    };

    const parseTokenInto = (token, target) => {
      const { negative, optional, value } = this.stripSearchPrefix(token);
      const filterMatch = value.match(/^([a-z_]+):(>=|<=|>|<|=)?(.+)$/i);

      if (filterMatch) {
        const [, field, operator = '=', rawValue] = filterMatch;
        const filter = {
          field: field.toLowerCase(),
          operator,
          value: rawValue.trim().replace(/^"|"$/g, ''),
          negative,
        };

        if (filter.field === 'order') {
          parsed.order = {
            value: filter.value.toLowerCase(),
            reversed: negative,
          };
        } else {
          target.filters.push(filter);
        }
        return;
      }

      const canonicalTerm = this.normalizeSearchTag(value);
      if (!canonicalTerm) return;

      if (negative) {
        target.negativeTerms.push(canonicalTerm);
      } else if (optional) {
        target.optionalTerms.push(canonicalTerm);
      } else {
        target.positiveTerms.push(canonicalTerm);
      }
    };

    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      const groupPrefix = this.stripSearchPrefix(token);

      if (groupPrefix.value === '(') {
        const group = {
          positiveTerms: [],
          negativeTerms: [],
          optionalTerms: [],
          filters: [],
          negative: groupPrefix.negative,
          optional: groupPrefix.optional,
        };

        index++;
        while (index < tokens.length && tokens[index] !== ')') {
          parseTokenInto(tokens[index], group);
          index++;
        }

        if (group.optional) {
          parsed.optionalGroups.push(group);
        } else {
          parsed.groups.push(group);
        }
        parsed.rawTerms.push(token);
        continue;
      }

      parseTokenInto(token, parsed);
      parsed.rawTerms.push(token);
    }

    return parsed;
  }

  getResultSearchFields(result) {
    const profileTagText = Array.isArray(result.profileTags)
      ? result.profileTags
          .flatMap(tag => [tag.tag, tag.label, ...(tag.aliases || []), ...(tag.matchedAliases || [])])
          .join(' ')
      : '';

    const normalizedTagText = [
      result.tagSearchText || '',
      Array.isArray(result.tagAliases) ? result.tagAliases.join(' ') : '',
      profileTagText,
    ].join(' ');

    return {
      text: this.normalizeSearchText([
        result.displayName,
        result.username,
        result.bio,
        Array.isArray(result.triggers) ? result.triggers.join(' ') : result.triggers,
        this.formatPlatformName(result.platform),
      ].join(' ')),
      tags: this.normalizeSearchText(normalizedTagText),
      canonicalTags: new Set(this.getResultTagNames(result)),
    };
  }

  getE621TagExpansion(tagName) {
    const canonicalTag = this.resolveE621Alias(tagName);
    if (!canonicalTag) return [];
    if (this.e621TagExpansionCache.has(canonicalTag)) {
      return this.e621TagExpansionCache.get(canonicalTag);
    }

    const expandedTags = new Set([canonicalTag]);
    const visit = (tag, depth = 0) => {
      if (depth > 20 || expandedTags.size > 200) return;
      const impliedTags = this.e621ImplicationMap.get(tag) || [];
      for (const impliedTag of impliedTags) {
        const canonicalImpliedTag = this.resolveE621Alias(impliedTag);
        if (!canonicalImpliedTag || expandedTags.has(canonicalImpliedTag)) continue;
        expandedTags.add(canonicalImpliedTag);
        visit(canonicalImpliedTag, depth + 1);
      }
    };

    visit(canonicalTag);
    const result = [...expandedTags];
    this.e621TagExpansionCache.set(canonicalTag, result);
    return result;
  }

  getResultTagNames(result) {
    const tags = [];
    if (Array.isArray(result.profileTags)) {
      result.profileTags.forEach(tag => {
        tags.push(tag.tag, tag.label, ...(tag.aliases || []), ...(tag.matchedAliases || []));
      });
    }
    if (Array.isArray(result.tagAliases)) {
      tags.push(...result.tagAliases);
    }
    if (result.tagSearchText) {
      tags.push(...result.tagSearchText.split(/\s+/));
    }

    return [...new Set(tags.flatMap(tag => this.getE621TagExpansion(tag)).filter(Boolean))];
  }

  resultMatchesSearchTerm(result, term) {
    const fields = this.getResultSearchFields(result);
    const textTerm = this.normalizeSearchText(term);
    const tagTerm = this.normalizeSearchTag(term);
    const isWildcard = tagTerm.includes('*');

    if (isWildcard) {
      const pattern = new RegExp(`^${tagTerm.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
      return [...fields.canonicalTags].some(tag => pattern.test(tag));
    }

    return fields.canonicalTags.has(tagTerm)
      || fields.tags.includes(textTerm)
      || fields.text.includes(textTerm);
  }

  compareRangeValue(actual, rawValue, operator = '=') {
    const value = String(rawValue || '').trim().toLowerCase();
    if (value.includes('..')) {
      const [minRaw, maxRaw] = value.split('..');
      const min = minRaw === '' ? null : Number(minRaw);
      const max = maxRaw === '' ? null : Number(maxRaw);
      if (min !== null && (!Number.isFinite(min) || actual < min)) return false;
      if (max !== null && (!Number.isFinite(max) || actual > max)) return false;
      return true;
    }

    if (value.includes(',')) {
      return value.split(',').some(part => this.compareRangeValue(actual, part, '='));
    }

    const inlineOperatorMatch = value.match(/^(>=|<=|>|<|=)(.+)$/);
    const effectiveOperator = inlineOperatorMatch ? inlineOperatorMatch[1] : operator;
    const numericValue = Number(inlineOperatorMatch ? inlineOperatorMatch[2] : value);
    if (!Number.isFinite(numericValue)) return false;

    switch (effectiveOperator) {
      case '>': return actual > numericValue;
      case '>=': return actual >= numericValue;
      case '<': return actual < numericValue;
      case '<=': return actual <= numericValue;
      case '=':
      default: return actual === numericValue;
    }
  }

  getSearchFilterValue(result, field) {
    const normalizedField = field.toLowerCase();
    switch (normalizedField) {
      case 'score':
      case 'confidence':
        return this.getDisplayConfidence(result);
      case 'posts':
      case 'post_count':
      case 'postcount':
        return Number(result.e621PostCount || 0);
      case 'tagcount':
      case 'tags':
        return Array.isArray(result.profileTags) ? result.profileTags.length : 0;
      default:
        return null;
    }
  }

  resultMatchesSearchFilter(result, filter) {
    let matched = true;
    switch (filter.field) {
      case 'name':
      case 'artist':
      case 'user':
      case 'username':
        matched = this.normalizeSearchText(`${result.displayName || ''} ${result.username || ''}`)
          .includes(this.normalizeSearchText(filter.value));
        break;
      case 'bio':
      case 'description':
        matched = this.normalizeSearchText(result.bio || '').includes(this.normalizeSearchText(filter.value));
        break;
      case 'platform':
        matched = result.platform === filter.value
          || (Array.isArray(result.platforms) && result.platforms.includes(filter.value));
        break;
      case 'status':
        matched = String(result.commissionStatus || '').toLowerCase() === String(filter.value || '').toLowerCase();
        break;
      case 'score':
      case 'confidence':
      case 'posts':
      case 'post_count':
      case 'postcount':
      case 'tagcount':
      case 'tags': {
        const actual = this.getSearchFilterValue(result, filter.field);
        matched = actual !== null && this.compareRangeValue(actual, filter.value, filter.operator);
        break;
      }
      default:
        matched = false;
        break;
    }

    return filter.negative ? !matched : matched;
  }

  resultMatchesSearchGroup(result, group) {
    const positiveMatch = group.positiveTerms.every(term => this.resultMatchesSearchTerm(result, term));
    const negativeMatch = group.negativeTerms.every(term => !this.resultMatchesSearchTerm(result, term));
    const optionalMatch = group.optionalTerms.length === 0
      || group.optionalTerms.some(term => this.resultMatchesSearchTerm(result, term));
    const filterMatch = group.filters.every(filter => this.resultMatchesSearchFilter(result, filter));
    const matched = positiveMatch && negativeMatch && optionalMatch && filterMatch;

    return group.negative ? !matched : matched;
  }

  resultMatchesParsedSearch(result, parsedQuery) {
    const positiveMatch = parsedQuery.positiveTerms.every(term => this.resultMatchesSearchTerm(result, term));
    if (!positiveMatch) return false;

    const negativeMatch = parsedQuery.negativeTerms.every(term => !this.resultMatchesSearchTerm(result, term));
    if (!negativeMatch) return false;

    const optionalConditions = [
      ...parsedQuery.optionalTerms.map(term => () => this.resultMatchesSearchTerm(result, term)),
      ...(parsedQuery.optionalGroups || []).map(group => () => this.resultMatchesSearchGroup(result, group)),
    ];
    const optionalMatch = optionalConditions.length === 0 || optionalConditions.some(matches => matches());
    if (!optionalMatch) return false;

    const groupMatch = parsedQuery.groups.every(group => this.resultMatchesSearchGroup(result, group));
    if (!groupMatch) return false;

    return parsedQuery.filters.every(filter => this.resultMatchesSearchFilter(result, filter));
  }

  getSearchOrderValue(result, orderValue) {
    const normalizedOrder = String(orderValue || '').replace(/_(asc|desc)$/, '');
    switch (normalizedOrder) {
      case 'score':
      case 'confidence':
        return this.getDisplayConfidence(result);
      case 'posts':
      case 'postcount':
      case 'post_count':
        return Number(result.e621PostCount || 0);
      case 'tagcount':
      case 'tags':
        return Array.isArray(result.profileTags) ? result.profileTags.length : 0;
      case 'name':
        return String(result.displayName || result.username || '').toLowerCase();
      case 'username':
      case 'user':
        return String(result.username || '').toLowerCase();
      case 'platform':
        return String(result.platform || '').toLowerCase();
      case 'created':
      case 'date':
      case 'updated':
      case 'id':
        return Number(result.lastUpdated || 0);
      default:
        return null;
    }
  }

  compareSearchOrder(a, b, order) {
    const orderValue = String(order.value || '').toLowerCase();
    const explicitAsc = orderValue.endsWith('_asc');
    const explicitDesc = orderValue.endsWith('_desc');
    const reversed = order.reversed || explicitAsc;
    const direction = reversed && !explicitDesc ? 1 : -1;
    const aValue = this.getSearchOrderValue(a, orderValue);
    const bValue = this.getSearchOrderValue(b, orderValue);

    if (aValue === null || bValue === null || aValue === bValue) return 0;
    if (typeof aValue === 'string' || typeof bValue === 'string') {
      const stringDirection = explicitDesc || order.reversed ? -1 : 1;
      return String(aValue).localeCompare(String(bValue)) * stringDirection;
    }
    return aValue > bValue ? direction : -direction;
  }

  // Initialize Fuse.js search instance
  initializeSearch(data) {
    if (this.debugSearch) {
      console.log('[Search] Initializing Fuse.js with data:', data.length, 'items');
    }
    
    // Prepare data for search by normalizing fields
    const searchData = data.map((item, index) => ({
      ...item,
      __resultIndex: index,
      // Ensure displayName exists
      displayName: item.displayName || item.username || 'Unknown Artist',
      // Ensure username exists  
      username: item.username || '',
      // Ensure bio is a string
      bio: item.bio || '',
      // Convert triggers array to searchable string
      triggers: Array.isArray(item.triggers) ? item.triggers.join(' ') : (item.triggers || ''),
      // Include canonical tags and aliases so alternate phrasing finds tagged profiles
      profileTagSearch: [
        item.tagSearchText || '',
        Array.isArray(item.tagAliases) ? item.tagAliases.join(' ') : '',
        Array.isArray(item.profileTags)
          ? item.profileTags
              .flatMap(tag => [tag.tag, tag.label, ...(tag.aliases || []), ...(tag.matchedAliases || [])])
              .join(' ')
          : ''
      ].join(' '),
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
          name: 'profileTagSearch',
          weight: 0.25 // Deterministic profile tags and aliases
        },
        {
          name: 'bio',
          weight: 0.12 // Profile text
        },
        {
          name: 'triggers',
          weight: 0.08 // Commission detection snippets
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

  // Enhanced fuzzy search using Fuse.js plus e621-style tag/filter syntax
  performFuzzySearch(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
      if (this.debugSearch) {
        console.log('[Search] Empty search term, returning all results');
      }
      return this.currentResults;
    }
    
    const trimmedSearch = searchTerm.trim();
    const parsedQuery = this.parseSearchQuery(trimmedSearch);
    const fuseQuery = parsedQuery.positiveTerms.join(' ');
    const usesAdvancedTagSyntax = parsedQuery.positiveTerms.some(term => term.includes('*'))
      || parsedQuery.optionalTerms.length > 0
      || parsedQuery.groups.length > 0;
    
    if (this.debugSearch) {
      console.log('[Search] Performing search for:', trimmedSearch);
      console.log('[Search] Parsed query:', parsedQuery);
      console.log('[Search] Searching in dataset of', this.currentResults.length, 'items');
    }

    if (!fuseQuery || usesAdvancedTagSyntax) {
      return this.currentResults.filter(result => this.resultMatchesParsedSearch(result, parsedQuery));
    }
    
    // Initialize search if needed
    if (!this.searchInstance || this.searchInstance.list !== this.currentResults) {
      this.initializeSearch(this.currentResults);
    }
    
    // Perform the search
    const searchResults = this.searchInstance.search(fuseQuery);
    
    if (this.debugSearch) {
      console.log('[Search] Fuse.js returned', searchResults.length, 'results');
      console.log('[Search] Top 3 results:', searchResults.slice(0, 3));
    }
    
    // Extract items from Fuse.js results and restore original data structure
    const items = searchResults.map(result => {
      // Use captured index first; fall back to key lookup for older data.
      const originalItem = Number.isInteger(result.item.__resultIndex)
        ? this.currentResults[result.item.__resultIndex]
        : this.currentResults.find(item =>
            item.username === result.item.username &&
            item.platform === result.item.platform
          );
      
      return {
        ...(originalItem || result.item), // Use original if found, fallback to search item
        searchScore: result.score // Add search score for debugging
      };
    }).filter(result => this.resultMatchesParsedSearch(result, parsedQuery));
    
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
    const searchTerm = this.getActiveSearchTerm();
    const parsedSearchQuery = searchTerm ? this.parseSearchQuery(searchTerm) : null;
    
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
    
    // Step 3: Sort results: favorites first, then explicit order metatags, then open likelihood.
    this.filteredResults.sort((a, b) => {
      const aId = `${a.platform}_${a.username}`;
      const bId = `${b.platform}_${b.username}`;
      const aFavorited = this.favorites.has(aId);
      const bFavorited = this.favorites.has(bId);
      
      // If one is favorited and the other isn't, favorited comes first
      if (aFavorited && !bFavorited) return -1;
      if (!aFavorited && bFavorited) return 1;

      const orderDiff = parsedSearchQuery?.order
        ? this.compareSearchOrder(a, b, parsedSearchQuery.order)
        : 0;
      if (orderDiff !== 0) return orderDiff;
      
      const aTransformed = this.transformConfidenceScore(a);
      const bTransformed = this.transformConfidenceScore(b);
      const confidenceDiff = bTransformed - aTransformed;
      if (Math.abs(confidenceDiff) > 0.001) return confidenceDiff;

      // Keep search relevance only as a tie-breaker so likely-open artists stay first.
      if (searchTerm && a.searchScore !== undefined && b.searchScore !== undefined) {
        return a.searchScore - b.searchScore;
      }

      return 0;
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
      { key: 'furaffinity', name: 'FurAffinity' },
      { key: 'bluesky', name: 'Bluesky' }
    ];
    
    allPlatforms.forEach(platform => {
      const count = availablePlatforms[platform.key] || 0;
      const option = document.createElement('option');
      option.value = platform.key;
      
      if (platform.disabled) {
        // Platform is disabled (like Twitter)
        option.textContent = `${platform.name} (Disabled)`;
        option.disabled = true;
        option.style.color = '#6b7280';
      } else if (count > 0) {
        option.textContent = `${platform.name} (${count})`;
        option.disabled = false;
      } else {
        option.textContent = `${platform.name} (No results)`;
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
    this.updatePlatformFilterIcon();
  }

  updatePlatformFilterIcon() {
    if (!this.platformFilterIcons || !this.platformFilter) return;
    const value = this.platformFilter.value;
    if (value === 'furaffinity' || value === 'bluesky') {
      this.platformFilterIcons.innerHTML = `<img src="${this.escapeAttribute(this.getPlatformIcon(value))}" alt="">`;
    } else {
      this.platformFilterIcons.innerHTML = `
        <img src="${this.escapeAttribute(this.getPlatformIcon('furaffinity'))}" alt="">
        <img src="${this.escapeAttribute(this.getPlatformIcon('bluesky'))}" alt="">
      `;
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
    this.filteredResults.forEach((result, index) => {
      const resultElement = this.createResultElement(result);
      resultElement.style.setProperty('--result-enter-delay', `${Math.min(index, 8) * 24}ms`);
      this.resultsList.appendChild(resultElement);
    });
    
    this.resultsCount.textContent = `${this.filteredResults.length} artist${this.filteredResults.length !== 1 ? 's' : ''}`;
  }
  
  showEmptyResultsList() {
    // Update results count to show 0
    this.resultsCount.textContent = '0 artists';
    
    // Get context for the message
    const searchTerm = this.getActiveSearchTerm();
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
      const safeSearchTerm = this.escapeHtml(searchTerm);
      // Search active but no results
      messageHTML = `
        <div style="font-size: 24px; margin-bottom: 16px;">🔍</div>
        <h3>No Artists Found</h3>
        <p>No artists match your search for "<strong class="empty-search-term">${safeSearchTerm}</strong>".</p>
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
    const profileTagsHtml = this.getProfileTagsHtml(result, 16);

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
    const safeDisplayName = this.escapeHtml(displayName);
    const safeDisplayNameAttr = this.escapeAttribute(displayName);
    const safeTriggers = this.escapeHtml(triggers);
    const safeTriggersAttr = this.escapeAttribute(triggers);
    const safeDetectionText = this.escapeHtml(`detected ${timeAgo}`);
    const safeAvatarUrl = this.sanitizeUrl(result.avatarUrl, this.getDefaultAvatar());
    const safeBadgeIcon = this.sanitizeUrl(this.getPlatformIcon(result.platform));

    element.innerHTML = `
      <div class="result-avatar-wrap">
        <img src="${safeAvatarUrl}"
             alt="${safeDisplayNameAttr}"
             class="${avatarClasses}">
        ${safeBadgeIcon ? `<span class="result-platform-badge result-platform-badge-${this.escapeAttribute(result.platform)}"><img src="${safeBadgeIcon}" alt="" aria-hidden="true"></span>` : ''}
      </div>
      <div class="result-info">
        <div class="result-profile-main">
          <div class="result-name" title="${safeDisplayNameAttr}">${safeDisplayName}</div>
          <div class="result-triggers" title="${safeTriggersAttr}">
            ${hasTriggers ? `"${safeTriggers}"<br><span class="detection-time">${safeDetectionText}</span>` : safeTriggers}
          </div>
          ${profileTagsHtml}
        </div>
        ${result.platforms && result.platforms.length > 1 ?
          `<div class="result-platform-menu">
            <button class="platform-dropdown-trigger" type="button" aria-haspopup="menu" aria-expanded="false" title="Choose platform for ${safeDisplayNameAttr}">Choose platform ▾</button>
            ${this.createPlatformDropdown(result)}
          </div>` : ''}
      </div>
      <div class="result-side">
        <button class="confidence-score ${confidenceClass}" type="button" aria-label="View confidence details for ${safeDisplayNameAttr}">
          ${confidencePercent}%
        </button>
        <div class="result-actions">
          <button class="action-btn favorite-btn ${isFavorited ? 'active' : ''}"
                  data-tooltip="${isFavorited ? 'Remove from Favorites' : 'Add to Favorites'}"
                  data-artist-id="${artistId}">
            ${this.getFavoriteIconSvg(isFavorited)}
          </button>
          <button class="action-btn blacklist-btn ${isBlacklisted ? 'active' : ''}"
                  data-tooltip="${isBlacklisted ? 'Remove from Blacklist' : 'Add to Blacklist'}"
                  data-artist-id="${artistId}">
            ${this.getBlacklistIconSvg()}
          </button>
        </div>
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
    if (avatarImg) {
      avatarImg.addEventListener('error', () => {
        avatarImg.src = this.getDefaultAvatar();
      });
    }
    
    // Whole card opens the profile (inner buttons stopPropagation)
    element.setAttribute('role', 'button');
    element.setAttribute('tabindex', '0');
    element.setAttribute('aria-label', `Open profile for ${displayName}`);
    element.addEventListener('click', () => {
      this.openArtistProfile(result);
    });
    element.addEventListener('keydown', (e) => {
      if (e.target !== element) {
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openArtistProfile(result);
      }
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
        dropdownTrigger.setAttribute('aria-expanded', dropdown.style.display !== 'none' ? 'true' : 'false');
      });
      
      // Add handlers for dropdown items
      dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.platform-dropdown-item');
        if (item) {
          const platform = item.dataset.platform;
          this.openArtistProfile(result, platform);
          dropdown.style.display = 'none';
          dropdownTrigger.setAttribute('aria-expanded', 'false');
        }
      });
    }
    
    // Add handlers for favorite/blacklist buttons
    const favoriteBtn = element.querySelector('.favorite-btn');
    const blacklistBtn = element.querySelector('.blacklist-btn');
    
    // Add click handler for the confidence score
    const confidenceScore = element.querySelector('.confidence-score');
    if (confidenceScore) {
      confidenceScore.addEventListener('click', (e) => {
        e.stopPropagation();
        this.expandConfidenceDetails(result, element);
      });
    }
    
    favoriteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFavorite(artistId);
      favoriteBtn.classList.toggle('active');
      this.bumpActionButton(favoriteBtn);
      const isFav = favoriteBtn.classList.contains('active');
      favoriteBtn.innerHTML = this.getFavoriteIconSvg(isFav);
      favoriteBtn.dataset.tooltip = isFav ? 'Remove from Favorites' : 'Add to Favorites';
      // Toggle the CSS class on the result item
      element.classList.toggle('favorited');
    });
    
    blacklistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleBlacklist(artistId);
      blacklistBtn.classList.toggle('active');
      this.bumpActionButton(blacklistBtn);
      const isBlack = blacklistBtn.classList.contains('active');
      blacklistBtn.innerHTML = this.getBlacklistIconSvg();
      blacklistBtn.dataset.tooltip = isBlack ? 'Remove from Blacklist' : 'Add to Blacklist';
      // Toggle the CSS class on the result item
      element.classList.toggle('blacklisted');
      // Remove favorited class if blacklisting
      if (isBlack) {
        element.classList.remove('favorited');
        const favBtn = element.querySelector('.favorite-btn');
        if (favBtn) {
          favBtn.classList.remove('active');
          this.bumpActionButton(favBtn);
          favBtn.innerHTML = this.getFavoriteIconSvg(false);
          favBtn.dataset.tooltip = 'Add to Favorites';
        }
      }
    });
    
    return element;
  }

  bumpActionButton(button) {
    if (!button) return;
    button.classList.remove('action-btn-bump');
    void button.offsetWidth;
    button.classList.add('action-btn-bump');
    button.addEventListener('animationend', () => {
      button.classList.remove('action-btn-bump');
    }, { once: true });
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
      
      const platformName = this.formatPlatformName(platform);
      const safePlatformName = this.escapeHtml(platformName);
      const safePlatformAttr = this.escapeAttribute(platform);
      return `
        <button class="platform-dropdown-item" type="button" role="menuitem" data-platform="${safePlatformAttr}">
          <img src="${this.sanitizeUrl(this.getPlatformIcon(platform))}" alt="" class="platform-icon-img" aria-hidden="true">
          <span class="platform-name">${safePlatformName}</span>
          <span class="platform-status">${statusIcon} ${confidence}%</span>
        </button>
      `;
    }).join('');
    
    return `
      <div class="platform-dropdown" style="display: none;" role="menu" aria-label="Platform links">
        ${dropdownItems}
      </div>
    `;
  }
  
  openArtistProfile(result, platformOverride = null) {
    this.showArtistProfile(result, platformOverride);
  }

  getPlatformSnapshot(result, platformOverride = null) {
    if (!platformOverride || !result.platformData || !result.platformData[platformOverride]) {
      return result;
    }

    return {
      ...result,
      ...result.platformData[platformOverride],
      platform: platformOverride,
      platforms: result.platforms,
      platformData: result.platformData,
      profileTags: result.profileTags,
      tagAliases: result.tagAliases,
      tagMatches: result.tagMatches,
      e621ArtistTag: result.e621ArtistTag,
      e621PostCount: result.e621PostCount
    };
  }

  classifyProfileUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      const path = parsed.pathname.replace(/\/$/, '');

      if (host === 'bsky.app') {
        return { platform: 'bluesky', name: 'Bluesky', label: path.split('/').filter(Boolean).pop() || host };
      }
      if (host === 'furaffinity.net') {
        return { platform: 'furaffinity', name: 'FurAffinity', label: path.split('/').filter(Boolean).pop() || host };
      }
      if (host === 'twitter.com' || host === 'x.com') {
        return { platform: 'twitter', name: 'Twitter/X', label: path.split('/').filter(Boolean)[0] || host };
      }
      if (host === 't.me' || host === 'telegram.me') {
        return { platform: 'telegram', name: 'Telegram', label: `${host}${path}` };
      }
      if (host === 'discord.gg' || host === 'discord.com' || host === 'discordapp.com') {
        return { platform: 'discord', name: 'Discord', label: 'Discord' };
      }
      if (host.endsWith('.carrd.co') || host === 'carrd.co') {
        return { platform: 'website', name: 'Website', label: host };
      }
      if (host === 'linktr.ee' || host === 'linktree.com') {
        return { platform: 'website', name: 'Website', label: `${host}${path}` };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Build the list of social/profile links for an artist
  getProfileLinks(result) {
    const links = [];
    const seen = new Set();
    const platforms = (Array.isArray(result.platforms) && result.platforms.length)
      ? result.platforms
      : [result.platform];

    platforms.forEach(platform => {
      if (!platform) return;
      const data = result.platformData && result.platformData[platform];
      const url = (data && data.profileUrl) || (platform === result.platform ? result.profileUrl : '');
      const safeUrl = this.sanitizeUrl(url);
      if (!safeUrl || seen.has(safeUrl)) return;
      seen.add(safeUrl);
      links.push({
        platform,
        url: safeUrl,
        name: this.formatPlatformName(platform),
        username: (data && data.username) || (platform === result.platform ? result.username : ''),
        icon: this.sanitizeUrl(this.getPlatformIcon(platform))
      });
    });

    // e621 artist tag link (if matched during scanning)
    if (result.e621ArtistTag) {
      const e621Url = this.sanitizeUrl(`https://e621.net/posts?tags=${encodeURIComponent(result.e621ArtistTag)}`);
      if (e621Url && !seen.has(e621Url)) {
        seen.add(e621Url);
        links.push({
          platform: 'e621',
          url: e621Url,
          name: 'e621',
          icon: this.sanitizeUrl(this.getPlatformIcon('e621'))
        });
      }
    }

    const bioTexts = [
      result.bio,
      ...Object.values(result.platformData || {}).map(data => data && data.bio)
    ].filter(Boolean);
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    bioTexts.forEach(text => {
      let match;
      while ((match = urlRegex.exec(text)) !== null) {
        const rawUrl = match[0].replace(/[.,;:!?)\]]+$/, '');
        const safeUrl = this.sanitizeUrl(rawUrl);
        if (!safeUrl || seen.has(safeUrl)) continue;
        const classified = this.classifyProfileUrl(safeUrl);
        if (!classified) continue;
        seen.add(safeUrl);
        links.push({
          platform: classified.platform,
          url: safeUrl,
          name: classified.name,
          username: classified.label,
          icon: this.sanitizeUrl(this.getPlatformIcon(classified.platform))
        });
      }
    });

    return links;
  }

  getExternalLinkLabel(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname}`.replace(/\/$/, '');
    } catch {
      return url;
    }
  }

  getProfileHandleLabel(link) {
    if (link.platform === 'telegram') {
      return link.username || link.name;
    }
    if (link.username) {
      return `@${link.username}`;
    }
    return link.name;
  }

  // Collect recent works/uploads across platform components
  getProfileWorks(result) {
    const components = result.analysis?.components || {};
    const worksByKey = new Map();
    const addWork = (item) => {
      if (!item) return;
      const key = item.url || item.id || `${item.title || item.text}-${item.date || item.timestamp || ''}`;
      const existing = worksByKey.get(key) || {};
      worksByKey.set(key, {
        ...existing,
        ...item,
        thumbnailUrl: item.thumbnailUrl || existing.thumbnailUrl,
        imageUrl: item.imageUrl || existing.imageUrl,
        previewUrl: item.previewUrl || existing.previewUrl,
        description: item.description || existing.description,
        date: item.date || existing.date
      });
    };

    if (Array.isArray(result.galleryItems)) {
      result.galleryItems.forEach(addWork);
    }
    if (Array.isArray(result.posts)) {
      result.posts.forEach(addWork);
    }
    const pools = [components.gallery, components.posts];
    pools.forEach(pool => {
      if (pool && Array.isArray(pool.items)) {
        pool.items.forEach(addWork);
      }
    });
    return [...worksByKey.values()].slice(0, 8);
  }

  getProfileBios(result, profile) {
    const bios = [];
    const seen = new Set();
    const addBio = (bio) => {
      if (!bio || typeof bio !== 'string') return;
      const trimmed = bio.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      bios.push(this.settings.demoMode ? this.getDemoLoremText(trimmed, 420) : trimmed);
    };

    addBio(profile.bio);
    if (result.platformData) {
      Object.values(result.platformData).forEach(data => addBio(data && data.bio));
    }
    addBio(result.bio);

    return bios;
  }

  getProfileStatusMeta(profile) {
    const confidencePercent = this.getDisplayConfidence(profile);
    const status = profile.commissionStatus || 'unclear';

    if (status === 'open' && confidencePercent >= 70) {
      return { className: 'open', icon: '✓', label: 'Commissions Open' };
    }

    if (status === 'closed') {
      return { className: 'closed', icon: '−', label: 'Closed' };
    }

    return { className: 'unclear', icon: '?', label: 'Unsure' };
  }

  getFavoriteIconSvg(active = false) {
    return `
      <svg class="action-icon favorite-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.7 14.7 9l5.9.9-4.3 4.2 1 5.9-5.3-2.8L6.7 20l1-5.9-4.3-4.2L9.3 9 12 3.7Z" ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
      </svg>
    `;
  }

  getBlacklistIconSvg() {
    return `
      <svg class="action-icon blacklist-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M7.1 16.9 16.9 7.1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </svg>
    `;
  }

  getWorkImageUrl(item) {
    return this.sanitizeUrl(
      item.thumbnailUrl ||
      item.thumbnail ||
      item.imageUrl ||
      item.image ||
      item.previewUrl ||
      ''
    );
  }

  getWorkDateLabel(item) {
    const rawDate = item.date || item.dateTimestamp || item.createdAt || item.timestamp || item.lastUpdated;
    if (!rawDate) return '';
    return this.formatTimeAgo(rawDate);
  }

  formatCompactNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
  }

  getProfileStatsHtml(profile) {
    if (profile.platform === 'bluesky' && Number.isFinite(Number(profile.followerCount))) {
      return `<div class="profile-stats-line">${this.escapeHtml(this.formatCompactNumber(profile.followerCount))} followers</div>`;
    }

    if (profile.platform === 'furaffinity') {
      const stats = profile.stats || {};
      const parts = [
        ['Views', profile.viewCount ?? stats.views],
        ['Submissions', profile.submissionCount ?? stats.submissions],
        ['Favs', profile.favCount ?? stats.favs]
      ]
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([label, value]) => `${label}: ${this.formatCompactNumber(value)}`);
      if (parts.length) {
        return `<div class="profile-stats-line">${this.escapeHtml(parts.join(' · '))}</div>`;
      }
    }

    return '';
  }

  // Escape text and turn URLs into clickable links (opened via the [data-url] handler)
  linkifyText(text) {
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    let out = '';
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      out += this.escapeHtml(text.slice(lastIndex, match.index));
      const trailing = (match[0].match(/[.,;:!?)\]]+$/) || [''])[0];
      const rawUrl = match[0].slice(0, match[0].length - trailing.length);
      const safeUrl = this.sanitizeUrl(rawUrl);
      if (safeUrl) {
        out += `<a class="profile-bio-link" role="link" tabindex="0" data-url="${this.escapeAttribute(safeUrl)}">${this.escapeHtml(rawUrl)}</a>`;
      } else {
        out += this.escapeHtml(rawUrl);
      }
      out += this.escapeHtml(trailing);
      lastIndex = match.index + match[0].length;
    }
    out += this.escapeHtml(text.slice(lastIndex));
    return out.replace(/\n/g, '<br>');
  }

  async hydrateProfileHeroBackground(hero, profile, result) {
    try {
      const bannerUrl = await this.fetchProfileBannerUrl(profile) || await this.fetchProfileBannerUrl(result);
      const safeBannerUrl = this.sanitizeUrl(bannerUrl);
      if (!safeBannerUrl || !hero?.isConnected) return;

      hero.style.backgroundImage = `url("${safeBannerUrl}")`;
      hero.classList.add('has-banner');
      hero.classList.remove('profile-hero-fallback');
    } catch {
      // Missing banners should never block opening an artist profile.
    }
  }

  async fetchProfileBannerUrl(profile) {
    if (!profile || !profile.platform) return '';

    if (profile.platform === 'bluesky') {
      const actor = profile.username || '';
      if (!actor) return '';
      const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`);
      if (!response.ok) return '';
      const data = await response.json();
      return data.banner || '';
    }

    if (profile.platform === 'furaffinity') {
      const profileUrl = profile.profileUrl || (profile.username ? `https://www.furaffinity.net/user/${profile.username}/` : '');
      const safeProfileUrl = this.sanitizeUrl(profileUrl);
      if (!safeProfileUrl) return '';
      const response = await fetch(safeProfileUrl);
      if (!response.ok) return '';
      const html = await response.text();
      return this.extractProfileBackgroundFromHtml(html, safeProfileUrl);
    }

    return '';
  }

  extractProfileBackgroundFromHtml(html, profileUrl) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const resolve = (rawUrl) => {
      if (!rawUrl) return '';
      try {
        const cleaned = String(rawUrl)
          .replace(/^url\(["']?|["']?\)$/g, '')
          .replace(/^["']|["']$/g, '');
        return new URL(cleaned, profileUrl).href;
      } catch {
        return '';
      }
    };
    const fromStyle = (element) => {
      const style = element?.getAttribute('style') || '';
      const match = style.match(/url\(["']?([^"')]+)["']?\)/i);
      return resolve(match?.[1]);
    };
    const fromImage = (image) => {
      const srcset = image?.getAttribute('srcset')?.split(',')?.[0]?.trim()?.split(/\s+/)?.[0];
      return resolve(
        image?.getAttribute('src') ||
        image?.getAttribute('data-src') ||
        image?.getAttribute('data-fullview-src') ||
        image?.getAttribute('data-preview-src') ||
        srcset
      );
    };

    const imageSelectors = [
      '.userpage-profile-banner img',
      '.userpage-banner img',
      '.profile-banner img',
      '#userpage-header img',
      '[class*="banner" i] img',
      '[id*="banner" i] img',
      '[class*="cover" i] img',
      '[id*="cover" i] img',
      'img[src*="/userbanners/"]',
      'img[src*="/banners/"]',
      'img[src*="banner"]'
    ];

    for (const selector of imageSelectors) {
      const url = fromImage(doc.querySelector(selector));
      if (url) return url;
    }

    const styledCandidates = [
      ...doc.querySelectorAll('[class*="banner" i], [id*="banner" i], [class*="cover" i], [id*="cover" i], [class*="header" i], [id*="header" i], [style*="background"]')
    ];

    for (const element of styledCandidates) {
      const url = fromStyle(element);
      if (url && /banner|cover|userpage|furaffinity|facdn|fa\.net/i.test(url)) {
        return url;
      }
    }

    return '';
  }

  setProfileThemeVars(page, theme) {
    if (!page || !theme) return;
    page.style.setProperty('--profile-theme-primary', theme.primary);
    page.style.setProperty('--profile-theme-secondary', theme.secondary);
    page.style.setProperty('--profile-theme-accent', theme.accent);
  }

  getFallbackProfileTheme(platform = '') {
    const themes = {
      bluesky: { primary: '13 35 64', secondary: '8 14 32', accent: '65 156 255' },
      furaffinity: { primary: '58 35 17', secondary: '18 17 22', accent: '235 129 39' }
    };
    return themes[platform] || { primary: '34 25 55', secondary: '13 14 28', accent: '142 119 255' };
  }

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }

    return { h, s, l };
  }

  hslToRgb(h, s, l) {
    const hueToRgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    if (s === 0) {
      const gray = Math.round(l * 255);
      return [gray, gray, gray];
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
      Math.round(hueToRgb(p, q, h) * 255),
      Math.round(hueToRgb(p, q, h - 1 / 3) * 255)
    ];
  }

  formatRgbTriplet(rgb) {
    return rgb.map(value => Math.max(0, Math.min(255, Math.round(value)))).join(' ');
  }

  async extractAvatarTheme(avatarUrl, platform = '') {
    const safeAvatarUrl = this.sanitizeUrl(avatarUrl);
    if (!safeAvatarUrl) return this.getFallbackProfileTheme(platform);
    if (this.profileThemeCache.has(safeAvatarUrl)) {
      return this.profileThemeCache.get(safeAvatarUrl);
    }

    const response = await fetch(safeAvatarUrl);
    if (!response.ok) throw new Error('Avatar theme fetch failed');
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    const size = 48;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, size, size);
    bitmap.close?.();

    const data = context.getImageData(0, 0, size, size).data;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let weightSum = 0;
    let accent = [142, 119, 255];
    let accentScore = -1;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 96) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const hsl = this.rgbToHsl(r, g, b);
      if (hsl.l < 0.05 || hsl.l > 0.96) continue;

      const weight = 0.55 + hsl.s;
      rSum += r * weight;
      gSum += g * weight;
      bSum += b * weight;
      weightSum += weight;

      const score = hsl.s * (1 - Math.abs(hsl.l - 0.52));
      if (score > accentScore) {
        accentScore = score;
        accent = [r, g, b];
      }
    }

    if (!weightSum) return this.getFallbackProfileTheme(platform);

    const avg = [rSum / weightSum, gSum / weightSum, bSum / weightSum];
    const avgHsl = this.rgbToHsl(avg[0], avg[1], avg[2]);
    const accentHsl = this.rgbToHsl(accent[0], accent[1], accent[2]);
    const primary = this.hslToRgb(avgHsl.h, Math.max(0.24, avgHsl.s * 0.8), 0.18);
    const secondary = this.hslToRgb((avgHsl.h + 0.07) % 1, Math.max(0.2, avgHsl.s * 0.55), 0.08);
    const vibrant = this.hslToRgb(accentHsl.h, Math.max(0.44, accentHsl.s), Math.min(0.68, Math.max(0.42, accentHsl.l)));
    const theme = {
      primary: this.formatRgbTriplet(primary),
      secondary: this.formatRgbTriplet(secondary),
      accent: this.formatRgbTriplet(vibrant)
    };
    this.profileThemeCache.set(safeAvatarUrl, theme);
    return theme;
  }

  async applyProfileTheme(page, avatarUrl, platform) {
    this.setProfileThemeVars(page, this.getFallbackProfileTheme(platform));
    try {
      const theme = await this.extractAvatarTheme(avatarUrl, platform);
      if (page?.isConnected) {
        this.setProfileThemeVars(page, theme);
      }
    } catch {
      // Keep the platform fallback if palette extraction fails.
    }
  }

  showArtistProfile(result, platformOverride = null) {
    const page = document.getElementById('artistProfilePage');
    const scroll = document.getElementById('profileScroll');
    const footer = document.getElementById('profileFooter');
    if (!page || !scroll || !footer) return;

    const profile = this.getPlatformSnapshot(result, platformOverride);
    const statusMeta = this.getProfileStatusMeta(profile);
    const confidencePercent = this.getDisplayConfidence(profile);

    const rawDisplayName = profile.displayName || result.displayName || profile.username || 'Unknown Artist';
    const displayName = this.settings.demoMode ? this.getDemoDisplayName(rawDisplayName) : rawDisplayName;
    const username = profile.username || result.username || '';

    const safeName = this.escapeHtml(displayName || 'Unknown Artist');
    const safeUsername = this.escapeHtml(username);
    const avatarClasses = this.settings.demoMode ? 'profile-avatar demo-blur' : 'profile-avatar';
    const safeAvatarUrl = this.sanitizeUrl(profile.avatarUrl || result.avatarUrl, this.getDefaultAvatar());
    this.applyProfileTheme(page, safeAvatarUrl, profile.platform || result.platform);
    const safeBannerUrl = this.sanitizeUrl(
      profile.profileBackgroundUrl ||
      profile.bannerUrl ||
      profile.banner ||
      profile.backgroundUrl ||
      result.profileBackgroundUrl ||
      result.bannerUrl ||
      result.banner ||
      result.backgroundUrl ||
      ''
    );

    const links = this.getProfileLinks(result);
    const bios = this.getProfileBios(result, profile);
    const handleLinks = links.filter(l => l.platform !== 'e621');
    const usernamesHtml = handleLinks.length
      ? handleLinks.map(l => `<span class="profile-handle platform-${this.escapeAttribute(l.platform)}">${l.icon ? `<img src="${l.icon}" alt="" aria-hidden="true">` : ''}<span>${this.escapeHtml(this.getProfileHandleLabel(l))}</span></span>`).join('')
      : (username ? `<span class="profile-handle">@${safeUsername}</span>` : '');
    const profileStatsHtml = this.getProfileStatsHtml(profile);

    const works = this.getProfileWorks(profile);
    const worksHtml = works.length ? `
      <section class="profile-section">
        <h3 class="profile-section-title">Recent Work</h3>
        <div class="profile-works">
          ${works.map(item => {
            const itemStatus = this.getStatusClass(item.commissionStatus);
            const itemTitle = item.title || item.text || 'Untitled';
            const demoTitle = this.settings.demoMode ? this.getDemoLoremText(itemTitle, 40) : itemTitle;
            const safeWorkUrl = this.sanitizeUrl(item.url);
            const safeWorkUrlAttr = this.escapeAttribute(safeWorkUrl);
            const safeImageUrl = this.getWorkImageUrl(item);
            const safeImageUrlAttr = this.escapeAttribute(safeImageUrl);
            const dateLabel = this.getWorkDateLabel(item);
            return `
              <button class="profile-work" type="button" ${safeWorkUrl ? `data-url="${safeWorkUrlAttr}"` : ''}>
                ${safeImageUrl ? `<img src="${safeImageUrlAttr}" alt="" class="profile-work-image">` : '<span class="profile-work-placeholder" aria-hidden="true"></span>'}
                <span class="profile-work-title">${this.escapeHtml(demoTitle)}</span>
                ${dateLabel ? `<span class="profile-work-date">${this.escapeHtml(dateLabel)}</span>` : ''}
                <span class="profile-work-status ${itemStatus}">${this.getStatusLabel(item.commissionStatus).replace(/^[^\s]+\s/, '')}</span>
              </button>
            `;
          }).join('')}
        </div>
      </section>
    ` : '';

    scroll.innerHTML = `
      <button class="profile-back-btn" id="profileBackBtn" type="button" aria-label="Back to results">
        <span aria-hidden="true">←</span> Back
      </button>
      <div class="profile-hero ${safeBannerUrl ? 'has-banner' : 'profile-hero-fallback'}">
        <div class="profile-hero-scrim"></div>
        <div class="profile-pawmark" aria-hidden="true"></div>
        <div class="profile-avatar-wrap">
          <img src="${safeAvatarUrl}" alt="${this.escapeAttribute(displayName)}" class="${avatarClasses}">
          <span class="profile-status-orb ${statusMeta.className}" title="${this.escapeAttribute(statusMeta.label)}">
            <span class="profile-status-icon" aria-hidden="true">${this.escapeHtml(statusMeta.icon)}</span>
            <span class="profile-status-text">${this.escapeHtml(statusMeta.label)}</span>
          </span>
        </div>
      </div>
      <div class="profile-identity">
        <h2 class="profile-name">${safeName}</h2>
        <div class="profile-handles">${usernamesHtml}</div>
        ${profileStatsHtml}
        <div class="profile-confidence-pill ${confidencePercent >= 70 ? 'high' : confidencePercent >= 50 ? 'medium' : 'low'}">${confidencePercent}% match</div>
      </div>
      ${bios.length ? `<section class="profile-section profile-about-section">${bios.map(bio => `<p class="profile-bio">${this.linkifyText(bio)}</p>`).join('')}</section>` : ''}
      ${worksHtml}
    `;

    const hero = scroll.querySelector('.profile-hero');
    if (hero && safeBannerUrl) {
      hero.style.backgroundImage = `url("${safeBannerUrl}")`;
    }
    if (hero) {
      this.hydrateProfileHeroBackground(hero, profile, result);
    }

    footer.innerHTML = links.length
      ? links.map(l => `
          <button class="profile-link-btn" type="button" data-url="${this.escapeAttribute(l.url)}">
            ${l.icon ? `<img src="${l.icon}" alt="" aria-hidden="true">` : '<span class="profile-link-glyph" aria-hidden="true">↗</span>'}
            <span class="platform-name platform-${this.escapeAttribute(l.platform)}">${this.escapeHtml(l.name)}</span>
          </button>
        `).join('')
      : '<span class="profile-no-links">No links found</span>';

    // Avatar fallback
    const avatarImg = scroll.querySelector('.profile-avatar');
    if (avatarImg) {
      avatarImg.addEventListener('error', () => { avatarImg.src = this.getDefaultAvatar(); });
    }

    // Back button
    const backBtn = scroll.querySelector('#profileBackBtn');
    if (backBtn) backBtn.addEventListener('click', () => this.hideArtistProfile());

    // Open links / works in new tabs
    page.querySelectorAll('[data-url]').forEach(el => {
      const open = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const url = el.dataset.url;
        if (url) chrome.tabs.create({ url });
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          open(e);
        }
      });
    });

    scroll.scrollTop = 0;
    this.lastArtistProfileFocus = document.activeElement;
    page.style.display = 'flex';
    page.classList.add('fade-in');
    document.documentElement.classList.add('profile-open');
    document.body.classList.add('profile-open');
    this.activateFocusTrap(page, () => this.hideArtistProfile());
  }

  hideArtistProfile() {
    const page = document.getElementById('artistProfilePage');
    if (!page) {
      return;
    }

    const finishClose = () => {
      page.style.display = 'none';
      page.classList.remove('fade-in', 'profile-exit');
      document.documentElement.classList.remove('profile-open');
      document.body.classList.remove('profile-open');
      this.deactivateFocusTrap();
      if (this.lastArtistProfileFocus && typeof this.lastArtistProfileFocus.focus === 'function') {
        this.lastArtistProfileFocus.focus();
        this.lastArtistProfileFocus = null;
      }
    };

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      finishClose();
      return;
    }

    page.classList.add('profile-exit');
    page.addEventListener('animationend', finishClose, { once: true });
    setTimeout(() => {
      if (page.classList.contains('profile-exit')) {
        finishClose();
      }
    }, 240);
  }
  
  getPlatformIcon(platform) {
    const icons = {
      furaffinity: '../logos/fa.webp',
      bluesky: '../logos/bsky.svg',
      twitter: '../logos/twitter.svg',
      e621: '../logos/e621.svg',
      telegram: '../logos/telegram.svg',
      discord: '../logos/discord.svg',
      website: '../logos/link.svg'
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
      twitter: 'Twitter/X',
      e621: 'e621',
      telegram: 'Telegram',
      discord: 'Discord',
      website: 'Website'
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

  getTagOccurrenceCount(tag) {
    if (Number.isFinite(tag.postCount)) return tag.postCount;
    const sourceCount = Array.isArray(tag.sources) ? tag.sources.length : 0;
    const aliasCount = Array.isArray(tag.matchedAliases) ? tag.matchedAliases.length : 0;
    return Math.max(sourceCount, aliasCount, 1);
  }

  createTagDetails(result) {
    const tags = this.getVisibleProfileTags(result);
    if (tags.length === 0) return '';

    return `
        <div class="confidence-component">
            <div class="confidence-component-header">
                <span class="confidence-component-title">Tags Found</span>
                <span class="confidence-component-score">${tags.length}</span>
            </div>
            <div class="details-tag-list">
                ${tags.map(tag => {
                  const label = tag.label || tag.tag;
                  const count = this.getTagOccurrenceCount(tag);
                  const title = tag.postCount
                    ? `${count} e621 post occurrences`
                    : `${count} local matches`;
                  return `
                    <span class="details-tag" title="${this.escapeHtml(title)}">
                        <span class="details-tag-name">${this.escapeHtml(label)}</span>
                        <span class="details-tag-count">${count}</span>
                    </span>
                  `;
                }).join('')}
            </div>
        </div>
    `;
  }

  createConfidenceDetails(result) {
    const { analysis } = result;
    if (!analysis?.components) return this.createTagDetails(result);

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

    details += this.createTagDetails(result);

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
    const rawTimestamp = typeof timestamp === 'string' ? timestamp.trim() : timestamp;
    let then = Number(rawTimestamp);
    if (typeof rawTimestamp === 'string' && rawTimestamp !== '' && !Number.isFinite(then)) {
      then = Date.parse(rawTimestamp);
    }
    if (Number.isFinite(then) && then > 0 && then < 100000000000) {
      then *= 1000;
    }
    if (!Number.isFinite(then) || then <= 0) {
      return '';
    }

    const now = Date.now();
    const diff = Math.max(0, now - then);
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

  getPlatformResultCount(platform) {
    return this.currentResults.filter(result => {
      if (result.platform === platform) return true;
      return Array.isArray(result.platforms) && result.platforms.includes(platform);
    }).length;
  }

  formatPlatformCount(count) {
    return `${count || 0} profile${count === 1 ? '' : 's'}`;
  }

  updateScanSummary(progressByPlatform = {}) {
    Object.entries(progressByPlatform || {}).forEach(([key, value]) => {
      if (key.endsWith('_progress')) {
        this.scanProgressByPlatform[key.replace('_progress', '')] = value || {};
      }
    });

    ['furaffinity', 'bluesky'].forEach(platform => {
      const progress = progressByPlatform[`${platform}_progress`] || {};
      const total = Number.isFinite(progress.total) && progress.total > 0
        ? progress.total
        : this.getPlatformResultCount(platform);
      const countEl = this.platformProfileCounts?.[platform];
      if (countEl) {
        countEl.textContent = this.formatPlatformCount(total);
      }
    });

    const scanSettings = this.lastScanSettings;
    const sourcePlatforms = scanSettings?.platforms || [];
    const enabledSourceNames = scanSettings
      ? sourcePlatforms.map(platform => platform === 'furaffinity' ? 'FA' : this.formatPlatformName(platform))
      : [];
    const sourceStat = this.scanStatusStats?.querySelector('[data-scan-stat="sources"]');
    if (sourceStat) {
      sourceStat.textContent = scanSettings && enabledSourceNames.length
        ? `Last sources: ${enabledSourceNames.join(' + ')}`
        : 'Last scan: none yet';
    }

    const modeStat = this.scanStatusStats?.querySelector('[data-scan-stat="mode"]');
    if (modeStat) {
      modeStat.textContent = scanSettings
        ? this.formatScanMode(scanSettings)
        : 'Ready';
    }

    this.updateOverallScanFill();
  }

  getPlatformProgressPercent(platform) {
    if (!this.isScanning && this.lastScanSettings?.platforms?.includes(platform)) {
      return 100;
    }

    const progress = this.scanProgressByPlatform?.[platform] || {};
    if (progress.phase === 'completed') return 100;
    if (Number.isFinite(progress.percentage)) return Math.max(0, Math.min(100, progress.percentage));
    if (Number.isFinite(progress.completed) && Number.isFinite(progress.total) && progress.total > 0) {
      return Math.max(0, Math.min(100, (progress.completed / progress.total) * 100));
    }

    return 0;
  }

  updateOverallScanFill() {
    if (!this.scanStatus) return;

    const fills = window.__scanFills || {};
    const platforms = (this.lastScanSettings?.platforms?.length
      ? this.lastScanSettings.platforms
      : ['furaffinity', 'bluesky'].filter(platform => this.settings.platforms[platform]))
      .filter(platform => platform === 'furaffinity' || platform === 'bluesky');

    const allKnown = ['furaffinity', 'bluesky'];
    allKnown.forEach((p) => {
      if (fills[p]) {
        fills[p].el.style.left = '0%';
        fills[p].el.style.width = '0%';
      }
    });

    if (!platforms.length) return;

    const segment = 100 / platforms.length;
    let cursor = 0;
    platforms.forEach((platform) => {
      const contribution = segment * (this.getPlatformProgressPercent(platform) / 100);
      const fill = fills[platform];
      if (fill) {
        fill.el.style.left = `${cursor.toFixed(2)}%`;
        fill.el.style.width = `${contribution.toFixed(2)}%`;
      }
      cursor += contribution;
    });
  }

  formatScanMode(scanSettings) {
    if (!scanSettings || scanSettings.mode === 'pattern') {
      return 'Pattern mode';
    }
    return 'Discriminative mode';
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
      this.scanBtn.style.display = '';
      this.stopBtn.style.display = 'none';
    
    }
  }
  
  showProgress(show) {
    this.scanProgress.style.display = show ? 'block' : 'none';
    if (show) {
      this.setOverallProgress(0);
      this.currentProgressAnimation = null;
    }
  }

  setOverallProgress(value) {
    const progress = Math.max(0, Math.min(100, Number(value) || 0));
    this.progressFill.style.width = `${progress}%`;
    if (this.progressBar) {
      this.progressBar.setAttribute('aria-valuenow', String(Math.round(progress)));
    }
  }

  showResultsLoading(show) {
    if (this.resultsLoadingOverlay) {
      this.resultsLoadingOverlay.style.display = show ? 'flex' : 'none';
    }
  }

  updateScanProgress(platform, progressData) {
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
      case 'checking_auth':
        statusText = `${platform}: Checking login status...`;
        targetProgress = 5;
        status = 'scanning';
        break;
      case 'login_required':
        statusText = `${platform}: Login needed before scanning can continue`;
        targetProgress = progressData.percentage || 5;
        status = 'error';
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
    this.setOverallProgress(targetProgress);
    this.updateScanSummary({
      [`${platform}_progress`]: progressData
    });
    
    // Add error indicator if needed
    if (progressData.errors > 0) {
      this.progressText.textContent = statusText;
      const errorCount = document.createElement('span');
      errorCount.className = 'progress-error-count';
      errorCount.textContent = ` (${progressData.errors} errors)`;
      this.progressText.appendChild(errorCount);
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
      // But respect "Hide Forever" and "Hide for 3 days" preferences
      if (this.commsClassifierPromo && !this.isPromoHidden()) {
        this.commsClassifierPromo.style.display = 'block';
      }
      if (this.roadmapSection) {
        this.roadmapSection.style.display = 'block';
      }
      if (this.feedbackSection && !this.isFeedbackHidden()) {
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
    this.lastFocusedElement = document.activeElement;
    this.settingsModal.style.display = 'flex';
    this.activateFocusTrap(this.settingsModal, () => this.closeSettings());
  }
  
  closeSettings() {
    this.settingsModal.style.display = 'none';
    this.deactivateFocusTrap();
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  getFocusableElements(container) {
    if (!container) {
      return [];
    }

    return Array.from(
      container.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  activateFocusTrap(container, onEscape) {
    if (!container) {
      return;
    }

    this.deactivateFocusTrap();

    const keyHandler = (event) => {
      if (event.key === 'Escape' && typeof onEscape === 'function') {
        event.preventDefault();
        onEscape();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusable = this.getFocusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', keyHandler);
    this.activeFocusTrap = { container, keyHandler };

    const focusable = this.getFocusableElements(container);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else if (typeof container.focus === 'function') {
      container.focus();
    }
  }

  deactivateFocusTrap() {
    if (!this.activeFocusTrap) {
      return;
    }

    const { container, keyHandler } = this.activeFocusTrap;
    container.removeEventListener('keydown', keyHandler);
    this.activeFocusTrap = null;
  }

  showLoginRequiredOverlay(pauseInfo) {
    if (!this.loginRequiredOverlay || !pauseInfo) {
      return;
    }

    const platformName = pauseInfo.platformName || this.formatPlatformName(pauseInfo.platform);
    this.loginRequiredPause = pauseInfo;

    if (this.loginRequiredTitle) {
      this.loginRequiredTitle.textContent = `Log in to ${platformName}`;
    }
    if (this.loginRequiredDescription) {
      this.loginRequiredDescription.textContent =
        `Commsfinder paused the scan because ${platformName} needs an active login.`;
    }
    if (this.loginRequiredDetail) {
      this.loginRequiredDetail.textContent =
        'Log in on the platform tab, then return here and resume the scan.';
    }
    if (this.openLoginTabBtn) {
      this.openLoginTabBtn.textContent = `Open ${platformName}`;
    }
    if (this.loginRequiredPlatformIcon) {
      this.loginRequiredPlatformIcon.src = this.getPlatformIcon(pauseInfo.platform);
      this.loginRequiredPlatformIcon.alt = '';
    }

    this.lastFocusedElement = document.activeElement;
    document.body.classList.add('login-required-active');
    this.loginRequiredOverlay.style.display = 'flex';
    this.activateFocusTrap(this.loginRequiredDialog || this.loginRequiredOverlay);
  }

  hideLoginRequiredOverlay() {
    if (!this.loginRequiredOverlay) {
      return;
    }

    document.body.classList.remove('login-required-active');
    this.loginRequiredOverlay.style.display = 'none';
    if (this.activeFocusTrap?.container === this.loginRequiredDialog || this.activeFocusTrap?.container === this.loginRequiredOverlay) {
      this.deactivateFocusTrap();
    }
    if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
      this.lastFocusedElement.focus();
    }
  }

  async openLoginTab() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'OPEN_LOGIN_TAB' });
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to open platform login');
      }
    } catch (error) {
      console.error('Error opening login tab:', error);
      this.showError(error.message || 'Failed to open platform login');
    }
  }

  resumeLoginRequiredScan() {
    this.hideLoginRequiredOverlay();
    this.startScan();
  }

  async cancelLoginRequiredScan() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CANCEL_SCAN' });
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to cancel scan');
      }

      this.loginRequiredPause = null;
      this.isScanning = false;
      this.updateScanStatus(false);
      this.showProgress(false);
      this.showResultsLoading(false);
      this.stopBtn.style.display = 'none';
      this.scanBtn.style.display = '';
      this.scanBtn.disabled = false;
      this.scanBtn.querySelector('.scan-text').textContent = 'Scan for Open Commissions';
      this.hideLoginRequiredOverlay();
    } catch (error) {
      console.error('Error cancelling login-required scan:', error);
      this.showError(error.message || 'Failed to cancel scan');
    }
  }

  async toggleRoadmap() {
    const isMinimized = this.roadmapSection.classList.contains('minimized');
    const toggleIcon = this.roadmapToggleBtn.querySelector('.toggle-icon');
    
    if (isMinimized) {
      // Expand
      this.roadmapSection.classList.remove('minimized');
      this.roadmapToggleBtn.title = 'Minimize Roadmap';
      this.roadmapToggleBtn.setAttribute('aria-expanded', 'true');
    } else {
      // Minimize
      this.roadmapSection.classList.add('minimized');
      this.roadmapToggleBtn.title = 'Expand Roadmap';
      this.roadmapToggleBtn.setAttribute('aria-expanded', 'false');
    }
    void toggleIcon;

    // Save the state to storage
    try {
      await chrome.storage.local.set({
        roadmapMinimized: !isMinimized
      });
    } catch (error) {
      console.error('Error saving roadmap state:', error);
    }
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
        this.scanBtn.style.display = '';
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
      await chrome.runtime.sendMessage({
        type: 'GET_MODEL_STATUS',
        modelName: this.settings.selectedQuantization
      });
      
      // No UI updates needed since model download is handled during scan.
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

  handleSearchInput() {
    this.primeE621EmbeddingsForSearch();
    this.updateTagAutocomplete();
    this.debouncedSearch();
  }

  handleSearchKeydown(e) {
    if (e.key === 'Escape') {
      this.hideTagAutocomplete();
      return;
    }

    if (['Enter', 'Tab', ',', ' '].includes(e.key)) {
      const token = this.searchFilter.value.trim().replace(/,$/, '');
      if (!token) return;
      if (e.key === ' ' && (token.match(/"/g) || []).length % 2 === 1) return;
      e.preventDefault();
      this.addSearchToken(token);
    }
  }

  addSearchToken(token) {
    const trimmedToken = String(token || '').trim();
    if (!trimmedToken) return;

    this.searchTokens.push(trimmedToken);
    this.searchFilter.value = '';
    this.renderSearchChips();
    this.hideTagAutocomplete();
    this.applyFilters();
  }

  removeSearchToken(index) {
    this.searchTokens.splice(index, 1);
    this.renderSearchChips();
    this.applyFilters();
    this.searchFilter.focus();
  }

  renderSearchChips() {
    if (!this.searchChips) return;

    this.searchChips.innerHTML = this.searchTokens.map((token, index) => `
      <span class="search-chip ${token.startsWith('-') ? 'search-chip-negative' : ''}">
        <span class="search-chip-text">${this.escapeHtml(token)}</span>
        <button type="button" class="search-chip-remove" data-index="${index}" aria-label="Remove ${this.escapeHtml(token)}">×</button>
      </span>
    `).join('');

    this.searchChips.querySelectorAll('.search-chip-remove').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeSearchToken(Number(button.dataset.index));
      });
    });
  }

  getLocalTagAutocompleteOptions(prefix) {
    const normalizedPrefix = this.normalizeSearchTag(prefix);
    if (!normalizedPrefix) return [];

    const suggestions = new Map();
    const addSuggestion = (tag, count = 0, source = 'local', rank = Number.MAX_SAFE_INTEGER) => {
      const normalizedTag = this.normalizeSearchTag(tag);
      if (!normalizedTag || !normalizedTag.startsWith(normalizedPrefix)) return;
      const existing = suggestions.get(normalizedTag);
      if (!existing || count > existing.count || (count === existing.count && rank < existing.rank)) {
        suggestions.set(normalizedTag, { tag: normalizedTag, count, source, rank });
      }
    };

    LOCAL_E621_TAG_SUGGESTIONS.forEach(tag => addSuggestion(tag, 1));
    Object.entries(E621_TAG_ALIASES).forEach(([alias, canonical]) => {
      addSuggestion(alias, 1);
      addSuggestion(canonical, 1);
    });
    this.e621Tags.forEach((tag, index) => addSuggestion(tag, 0, 'e621', index));
    this.e621AliasMap.forEach((canonical, alias) => {
      addSuggestion(alias, 0, 'e621');
      addSuggestion(canonical, 0, 'e621');
    });

    this.currentResults.forEach(result => {
      (result.profileTags || []).forEach(tag => {
        const count = this.getTagOccurrenceCount(tag);
        addSuggestion(tag.tag, count);
        addSuggestion(tag.label, count);
        (tag.aliases || []).forEach(alias => addSuggestion(alias, count));
      });
    });

    return [...suggestions.values()]
      .sort((a, b) => b.count - a.count || a.rank - b.rank || a.tag.localeCompare(b.tag))
      .slice(0, 8);
  }

  async fetchE621TagAutocompleteOptions(prefix) {
    const normalizedPrefix = this.normalizeSearchTag(prefix);
    if (normalizedPrefix.length < 2) return [];
    if (this.tagAutocompleteCache.has(normalizedPrefix)) {
      return this.tagAutocompleteCache.get(normalizedPrefix);
    }

    const url = new URL('https://e621.net/tags.json');
    url.searchParams.set('search[name_matches]', `${normalizedPrefix}*`);
    url.searchParams.set('search[order]', 'count');
    url.searchParams.set('limit', '8');

    try {
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`e621 autocomplete failed with ${response.status}`);
      const payload = await response.json();
      const options = (Array.isArray(payload) ? payload : [])
        .map(tag => ({
          tag: this.normalizeSearchTag(tag.name),
          count: tag.post_count || 0,
          source: 'e621',
        }))
        .filter(option => option.tag)
        .slice(0, 8);
      this.tagAutocompleteCache.set(normalizedPrefix, options);
      return options;
    } catch (error) {
      if (this.debugSearch) {
        console.warn('[Search] e621 autocomplete failed:', error);
      }
      return [];
    }
  }

  updateTagAutocomplete() {
    if (!this.searchAutocomplete) return;
    const rawPrefix = this.searchFilter.value.trim().replace(/^[-~]+/, '');
    if (!rawPrefix || rawPrefix.includes(':')) {
      this.hideTagAutocomplete();
      return;
    }

    const localOptions = this.getLocalTagAutocompleteOptions(rawPrefix);
    this.renderTagAutocomplete(localOptions);
    if (this.e621EmbeddingsLoaded || this.e621EmbeddingsLoadPromise) return;

    if (this.tagAutocompleteTimer) {
      clearTimeout(this.tagAutocompleteTimer);
    }
    this.tagAutocompleteTimer = setTimeout(async () => {
      const remoteOptions = await this.fetchE621TagAutocompleteOptions(rawPrefix);
      const latestPrefix = this.searchFilter.value.trim().replace(/^[-~]+/, '');
      if (latestPrefix !== rawPrefix) return;
      const merged = new Map();
      [...localOptions, ...remoteOptions].forEach(option => {
        if (!merged.has(option.tag)) merged.set(option.tag, option);
      });
      this.renderTagAutocomplete([...merged.values()].slice(0, 10));
    }, 250);
  }

  renderTagAutocomplete(options) {
    if (!this.searchAutocomplete) return;
    if (!options.length) {
      this.hideTagAutocomplete();
      return;
    }

    const currentPrefix = this.searchFilter.value.trim().match(/^[-~]+/)?.[0] || '';
    this.searchAutocomplete.innerHTML = options.map(option => `
      <button type="button" class="tag-suggestion" data-tag="${this.escapeHtml(option.tag)}">
        <span>${this.escapeHtml(`${currentPrefix}${option.tag}`)}</span>
        <span class="tag-suggestion-meta">${option.source}${option.count ? ` · ${option.count}` : ''}</span>
      </button>
    `).join('');
    this.searchAutocomplete.style.display = 'block';

    this.searchAutocomplete.querySelectorAll('.tag-suggestion').forEach(button => {
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const selectedTag = `${currentPrefix}${button.dataset.tag}`;
        this.addSearchToken(selectedTag);
      });
    });
  }

  hideTagAutocomplete() {
    if (this.searchAutocomplete) {
      this.searchAutocomplete.style.display = 'none';
      this.searchAutocomplete.innerHTML = '';
    }
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
    
    this.searchTokens = [];
    this.searchFilter.value = '';
    this.renderSearchChips();
    this.hideTagAutocomplete();
    this.searchInstance = null;
    this.applyFilters();
  }

  getSearchStats() {
    const stats = {
      totalResults: this.currentResults.length,
      filteredResults: this.filteredResults.length,
      searchActive: this.getActiveSearchTerm() !== '',
      searchTerm: this.getActiveSearchTerm(),
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

  async loadBenchmarkModule() {
    // Keep benchmark optional, this file is local and may be missing in many environments.
    return import(/* webpackIgnore: true */ '/benchmark.js');
  }

  async checkBenchmarkAvailability() {
    try {
      const benchmarkModule = await this.loadBenchmarkModule();
      const hasRunner = Boolean(benchmarkModule && benchmarkModule.BenchmarkRunner);
      if (this.benchmarkGroup) {
        this.benchmarkGroup.style.display = hasRunner ? 'flex' : 'none';
      }
    } catch {
      // Module not found, hide benchmark button.
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

      const benchmarkModule = await this.loadBenchmarkModule();
      if (!benchmarkModule || !benchmarkModule.BenchmarkRunner) {
        throw new Error('Benchmark module is unavailable in this build.');
      }

      const runner = new benchmarkModule.BenchmarkRunner();

      const report = await runner.runFullScanBenchmark((message, progress) => {
        this.benchmarkProgress.querySelector('.benchmark-progress-fill').style.width = `${progress}%`;
        this.benchmarkProgress.querySelector('.benchmark-text').textContent = message;
      });
      const results = [];
      for (const [platform, platformResults] of Object.entries(report.platformResults || {})) {
        results.push({
          platform: platform.charAt(0).toUpperCase() + platform.slice(1),
          step: `Total: ${platformResults.profileCount || 0} profiles scanned`,
          profileCount: platformResults.profileCount || 0,
          totalTime: platformResults.totalTimeSeconds || 0,
          isHeader: true
        });
        for (const step of platformResults.steps || []) {
          results.push({
            platform: platform.charAt(0).toUpperCase() + platform.slice(1),
            step: step.step,
            totalSeconds: step.totalSeconds || 0,
            averageMs: step.averageMs || 0,
            count: step.count || 0,
            percentage: step.percentage || 0,
            isHeader: false
          });
        }
      }

        // Create table header
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = `
            <th>Platform</th>
            <th>Step</th>
            <th>Profiles</th>
            <th>Total Time</th>
            <th>Average Time</th>
            <th>Count</th>
            <th>% of Total</th>
        `;
        this.benchmarkTable.appendChild(headerRow);

        const summaryRow = document.createElement('tr');
        summaryRow.style.fontWeight = 'bold';
        summaryRow.style.backgroundColor = '#111827';
        const safeResultCount = this.escapeHtml(String(report.run.resultCount));
        const safeWallClock = this.escapeHtml(`${report.run.wallClockSeconds.toFixed(2)}s`);
        summaryRow.innerHTML = `
            <td>Full Scan</td>
            <td colspan="2">Wall clock time</td>
            <td>${safeResultCount}</td>
            <td>${safeWallClock}</td>
            <td colspan="2">Report downloaded</td>
        `;
        this.benchmarkTable.appendChild(summaryRow);

        // Add results rows
        results.forEach(result => {
            const row = document.createElement('tr');
            
            // Style header rows differently
            if (result.isHeader) {
                row.style.fontWeight = 'bold';
                row.style.backgroundColor = '#374151';
                row.style.color = '#e5e7eb';
                const safePlatform = this.escapeHtml(result.platform);
                const safeStep = this.escapeHtml(result.step);
                row.innerHTML = `
                    <td>${safePlatform}</td>
                    <td colspan="2">${safeStep}</td>
                    <td>${this.escapeHtml(String(result.profileCount))}</td>
                    <td>${this.escapeHtml(`${result.totalTime.toFixed(2)}s`)}</td>
                    <td colspan="2">-</td>
                `;
            } else {
                // Color code based on percentage (red for high, green for low)
                const percentage = parseFloat(result.percentage);
                let rowClass = '';
                if (percentage > 30) {
                    rowClass = 'benchmark-slow';
                } else if (percentage > 15) {
                    rowClass = 'benchmark-medium';
                } else {
                    rowClass = 'benchmark-fast';
                }
                
                row.className = rowClass;
                const safePlatform = this.escapeHtml(result.platform);
                const safeStep = this.escapeHtml(result.step);
                row.innerHTML = `
                    <td>${safePlatform}</td>
                    <td>${safeStep}</td>
                    <td>-</td>
                    <td>${this.escapeHtml(`${result.totalSeconds.toFixed(2)}s`)}</td>
                    <td>${this.escapeHtml(`${result.averageMs.toFixed(0)}ms`)}</td>
                    <td>${this.escapeHtml(String(result.count))}</td>
                    <td>${this.escapeHtml(`${result.percentage.toFixed(1)}%`)}</td>
                `;
            }
            
            this.benchmarkTable.appendChild(row);
        });

        // Show results
      this.benchmarkResults.style.display = 'block';
      this.benchmarkProgress.style.display = 'none';
      this.runBenchmarkBtn.disabled = false;

    } catch (error) {
      console.error('Benchmark error:', error);
      const message = String(error?.message || error || '');
      const isMissingModule =
        message.includes('Benchmark module is unavailable') ||
        message.includes('Failed to fetch dynamically imported module') ||
        message.includes('Cannot find module');
      this.showNotification(
        isMissingModule
          ? 'Benchmark tools are not installed in this environment.'
          : `Failed to run benchmark: ${message}`,
        'error'
      );
      this.runBenchmarkBtn.disabled = false;
      this.benchmarkProgress.style.display = 'none';
      if (isMissingModule && this.benchmarkGroup) {
        this.benchmarkGroup.style.display = 'none';
      }
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
  
  // Helper methods to check if sections should be hidden
  isPromoHidden() {
    if (this.promoHiddenForever) return true;
    if (this.promoHiddenUntil && Date.now() < this.promoHiddenUntil) return true;
    return false;
  }
  
  isFeedbackHidden() {
    if (this.feedbackHiddenForever) return true;
    if (this.feedbackHiddenUntil && Date.now() < this.feedbackHiddenUntil) return true;
    return false;
  }
  
  toggleZenMode(enabled) {
    // Hide/show promo section (but respect "Hide Forever" and "Hide for 3 days" preferences)
    if (this.commsClassifierPromo) {
      if (enabled || this.isPromoHidden()) {
        this.commsClassifierPromo.style.display = 'none';
      } else {
        this.commsClassifierPromo.style.display = '';
      }
    }
    
    // Hide/show roadmap section
    if (this.roadmapSection) {
      this.roadmapSection.style.display = enabled ? 'none' : '';
    }
    
    // Hide/show feedback section (but respect "Hide Forever" and "Hide for 3 days" preferences)
    if (this.feedbackSection) {
      if (enabled || this.isFeedbackHidden()) {
        this.feedbackSection.style.display = 'none';
      } else {
        this.feedbackSection.style.display = '';
      }
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
      this.promoHiddenForever = true; // Update cache
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
      this.promoHiddenUntil = hiddenUntil; // Update cache
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
      this.feedbackHiddenForever = true; // Update cache
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
      this.feedbackHiddenUntil = hiddenUntil; // Update cache
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
      
      // Check if disclaimerAcknowledged is explicitly true
      if (result.disclaimerAcknowledged === true) {
        this.hideDisclaimer();
      } else {
        this.showDisclaimer();
      }
    } catch (error) {
      console.error('[Commsfinder] Error checking disclaimer acknowledgment:', error);
      // If there's an error checking, show the disclaimer to be safe
      this.showDisclaimer();
    }
  }

  showDisclaimer() {
    if (this.disclaimerOverlay) {
      this.lastFocusedElement = document.activeElement;
      document.body.classList.add('disclaimer-active');
      this.disclaimerOverlay.style.display = 'flex';
      this.showDisclaimerPage1();
      this.activateFocusTrap(this.disclaimerDialog || this.disclaimerOverlay);
    }
  }

  hideDisclaimer() {
    if (this.disclaimerOverlay) {
      document.body.classList.remove('disclaimer-active');
      this.disclaimerOverlay.style.display = 'none';
      this.deactivateFocusTrap();
      if (this.lastFocusedElement && typeof this.lastFocusedElement.focus === 'function') {
        this.lastFocusedElement.focus();
      }
    }
  }

  showDisclaimerPage1() {
    if (this.disclaimerPage1 && this.disclaimerPage2) {
      this.disclaimerPage1.style.display = 'block';
      this.disclaimerPage2.style.display = 'none';
      if (this.disclaimerDialog) {
        this.disclaimerDialog.setAttribute('aria-labelledby', 'disclaimerTitlePage1');
        this.disclaimerDialog.setAttribute('aria-describedby', 'disclaimerDescriptionPage1');
      }
      if (this.disclaimerNextBtn) {
        this.disclaimerNextBtn.focus();
      }
    }
  }

  showDisclaimerPage2() {
    if (this.disclaimerPage1 && this.disclaimerPage2) {
      this.disclaimerPage1.style.display = 'none';
      this.disclaimerPage2.style.display = 'block';
      if (this.disclaimerDialog) {
        this.disclaimerDialog.setAttribute('aria-labelledby', 'disclaimerTitlePage2');
        this.disclaimerDialog.setAttribute('aria-describedby', 'disclaimerDescriptionPage2');
      }
      if (this.disclaimerBackBtn) {
        this.disclaimerBackBtn.focus();
      }
    }
  }

  async acceptDisclaimer() {
    try {
      // Save the acknowledgment
      await chrome.storage.local.set({ disclaimerAcknowledged: true });
      
      // Verify it was saved by reading it back
      const verification = await chrome.storage.local.get(['disclaimerAcknowledged']);
      if (verification.disclaimerAcknowledged === true) {
        this.hideDisclaimer();
        this.showSuccess('Welcome to Commsfinder!');
      } else {
        console.error('[Commsfinder] Disclaimer acknowledgment verification failed');
        throw new Error('Verification failed: disclaimer acknowledgment was not saved');
      }
    } catch (error) {
      console.error('[Commsfinder] Error saving disclaimer acknowledgment:', error);
      this.showError('Failed to save acknowledgment. Please try again.');
      // Don't hide the disclaimer if save failed
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const popup = new CommissionsfinderPopup();
  // Expose for debugging (can call window.popup.testSearch('term') in console)
  window.popup = popup;

  // MOTD: bundled at build time via webpack require, no fetch needed
  try {
    // eslint-disable-next-line no-undef
    const motds = require('../motd.json');
    const entries = Object.entries(motds);
    if (entries.length) {
      const [msg, url] = entries[Math.floor(Math.random() * entries.length)];
      const subtitle = document.querySelector('.header-subtitle');
      if (subtitle) {
        if (url && url.startsWith('http')) {
          subtitle.innerHTML = '';
          const a = document.createElement('a');
          a.href = url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = msg;
          a.className = 'motd-link';
          subtitle.appendChild(a);
        } else {
          subtitle.textContent = msg;
        }
      }
    }
  } catch (err) { console.warn('[MOTD]', err); }

  if (typeof window.mountDitheredWave === 'function') {
    const PRESETS = {
      furaffinity: {
        mode: 'bayer',
        matrixSize: 4,
        waveColor: '#ffb347',
        baseColor: '#1a0a00',
        pixelSize: 2,
        colorNum: 8,
        waveSpeed: 0.1,
        waveFrequency: 2.4,
        waveAmplitude: 0.5,
      },
      bluesky: {
        mode: 'dots',
        matrixSize: 8,
        waveColor: '#5bb8ff',
        baseColor: '#000614',
        pixelSize: 2,
        colorNum: 2,
        waveSpeed: 0.1,
        waveFrequency: 2.6,
        waveAmplitude: 0.5,
      },
    };

    window.__ditherPlatforms = [];
    document.querySelectorAll('.platform-option').forEach((opt) => {
      const progressEl = opt.querySelector('.platform-progress');
      if (!progressEl) return;
      const preset = PRESETS[opt.dataset.platform];
      if (preset) {
        window.__ditherPlatforms.push(window.mountDitheredWave(progressEl, preset));
      }
    });

    const headerEl = document.querySelector('.header');
    if (headerEl) {
      window.__ditherHeader = window.mountDitheredWave(headerEl, {
        mode: 'bayer',
        matrixSize: 8,
        waveColor: '#ffffff',
        baseColor: '#000000',
        pixelSize: 2,
        colorNum: 8,
        waveSpeed: 0.069,
        waveFrequency: 2.2,
        waveAmplitude: 0.5,
      });
    }

    const statusEl = document.getElementById('scanStatus');
    if (statusEl) {
      const track = document.createElement('div');
      track.className = 'scan-fill-track';
      statusEl.insertBefore(track, statusEl.firstChild);
      window.__scanFills = {};
      ['furaffinity', 'bluesky'].forEach((platform) => {
        const fill = document.createElement('div');
        fill.className = `scan-fill scan-fill-${platform}`;
        fill.style.left = '0%';
        fill.style.width = '0%';
        track.appendChild(fill);
        const handle = window.mountDitheredWave(fill, PRESETS[platform]);
        window.__scanFills[platform] = { el: fill, handle };
      });
    }
  }
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
