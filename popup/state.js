// Simple state store for the popup.
// Replace scattered instance variables with a centralized reactive-ish store.
// In a future refactor, CommissionsfinderPopup would drive all reads/writes through this.

/**
 * Create a new state store for the popup.
 * @returns {object} The store with get/set/subscribe methods.
 */
export function createPopupStore() {
  const state = {
    currentResults: [],
    filteredResults: [],
    favorites: new Set(),
    blacklist: new Set(),
    showBlacklisted: false,
    showGeneralTags: false,
    isScanning: false,
    settings: {
      aiEnabled: true,
      selectedQuantization: 'full',
      debugMode: false,
      zenMode: false,
      demoMode: false,
      platforms: { furaffinity: true, twitter: false, bluesky: true },
    },
    lastScanSettings: null,
    lastScanDate: null,
    scanProgressByPlatform: {},
    loginRequiredPause: null,
    activeScansInProgress: false,
    searchTokens: [],
    promoHiddenForever: false,
    promoHiddenUntil: null,
    feedbackHiddenForever: false,
    feedbackHiddenUntil: null,
  };

  const listeners = new Set();

  return {
    get(key) {
      return state[key];
    },

    set(key, value) {
      state[key] = value;
      // Notify listeners
      for (const fn of listeners) {
        try { fn(key, value, state); } catch (e) { /* ignore */ }
      }
    },

    getAll() {
      return { ...state };
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    // Convenience: bulk update multiple keys
    patch(updates) {
      for (const [key, value] of Object.entries(updates)) {
        state[key] = value;
      }
      for (const fn of listeners) {
        try { fn(null, null, state); } catch (e) { /* ignore */ }
      }
    },
  };
}
