// Shared utility functions for Commsfinder extension

/**
 * Shared utility functions used across the extension
 */
class CommissionfinderUtils {
  
  /**
   * Debounce function to limit rapid function calls
   */
  static debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  }
  
  /**
   * Throttle function to limit function calls to specific intervals
   */
  static throttle(func, delay) {
    let lastCall = 0;
    return function (...args) {
      const now = Date.now();
      if (now - lastCall >= delay) {
        lastCall = now;
        return func.apply(this, args);
      }
    };
  }
  
  /**
   * Safe delay function that can be cancelled
   */
  static createCancellableDelay(ms) {
    let timeoutId;
    const promise = new Promise((resolve) => {
      timeoutId = setTimeout(resolve, ms);
    });
    
    promise.cancel = () => {
      clearTimeout(timeoutId);
    };
    
    return promise;
  }
  
  /**
   * Validate URL format
   */
  static isValidUrl(string) {
    try {
      const url = new URL(string);
      return ['http:', 'https:'].includes(url.protocol);
    } catch (error) {
      console.error('Error validating URL:', error);
      return false;
    }
  }
  
  /**
   * Extract domain from URL
   */
  static extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      console.error('Error extracting domain:', error);
      return null;
    }
  }
  
  /**
   * Sanitize text for display (prevent XSS)
   */
  static sanitizeText(text) {
    if (typeof text !== 'string') return '';
    
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Format confidence percentage with appropriate styling class
   */
  static formatConfidence(confidence) {
    const percent = Math.round(confidence * 100);
    let className = 'low';
    
    if (percent >= 70) className = 'high';
    else if (percent >= 50) className = 'medium';
    
    return {
      percent,
      className,
      display: `${percent}%`
    };
  }
  
  /**
   * Format relative time display
   */
  static formatTimeAgo(timestamp) {
    if (!timestamp) return 'never';
    
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    
    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 4) return `${weeks}w ago`;
    if (months < 12) return `${months}mo ago`;
    
    const years = Math.floor(months / 12);
    return `${years}y ago`;
  }
  
  /**
   * Generate a simple hash for text (for deduplication)
   */
  static simpleHash(text) {
    let hash = 0;
    if (text.length === 0) return hash;
    
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    return hash.toString(36);
  }
  
  /**
   * Check if two artist objects represent the same artist
   */
  static isSameArtist(artist1, artist2) {
    if (!artist1 || !artist2) return false;
    
    // Same platform and username
    if (artist1.platform === artist2.platform && 
        artist1.username === artist2.username) {
      return true;
    }
    
    // Same profile URL
    if (artist1.profileUrl === artist2.profileUrl) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Merge two artist objects, keeping the higher confidence data
   */
  static mergeArtistData(existing, newData) {
    if (!existing) return newData;
    if (!newData) return existing;
    
    const merged = { ...existing };
    
    // Update with higher confidence data
    if (newData.confidence > existing.confidence) {
      merged.confidence = newData.confidence;
      merged.triggers = newData.triggers || existing.triggers;
      merged.method = newData.method || existing.method;
    }
    
    // Always update timestamp
    merged.lastUpdated = Math.max(existing.lastUpdated || 0, newData.lastUpdated || 0);
    
    // Update bio and other profile data if more recent
    if ((newData.lastUpdated || 0) > (existing.lastUpdated || 0)) {
      merged.bio = newData.bio || existing.bio;
      merged.avatarUrl = newData.avatarUrl || existing.avatarUrl;
      merged.displayName = newData.displayName || existing.displayName;
    }
    
    return merged;
  }
  
  /**
   * Get platform-specific information
   */
  static getPlatformInfo(platform) {
    const platforms = {
      furaffinity: {
        name: 'FurAffinity',
        icon: '../logos/fa.webp',
        color: '#ff6f46',
        baseUrl: 'https://www.furaffinity.net'
      },
      bluesky: {
        name: 'Bluesky',
        icon: '../logos/bsky.svg',
        color: '#0085ff',
        baseUrl: 'https://bsky.app'
      },
      twitter: {
        name: 'Twitter/X',
        icon: '../logos/twitter.svg',
        color: '#1da1f2',
        baseUrl: 'https://twitter.com'
      }
    };
    
    return platforms[platform] || {
      name: platform,
      icon: '🔍',
      color: '#666666',
      baseUrl: ''
    };
  }
  
  /**
   * Validate artist data object
   */
  static validateArtistData(data) {
    const required = ['username', 'platform', 'profileUrl', 'confidence'];
    const errors = [];
    
    for (const field of required) {
      if (data[field] === undefined || data[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
      errors.push('Confidence must be a number between 0 and 1');
    }
    
    if (data.profileUrl && !this.isValidUrl(data.profileUrl)) {
      errors.push('Invalid profile URL format');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Create a deep copy of an object
   */
  static deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const cloned = {};
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }
  }
  
  /**
   * Log messages with consistent formatting
   */
  static log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[Commsfinder ${timestamp}]`;
    
    switch (level) {
      case 'error':
        console.error(`${prefix} ❌`, message, data);
        break;
      case 'warn':
        console.warn(`${prefix} ⚠️`, message, data);
        break;
      case 'info':
        console.info(`${prefix} ℹ️`, message, data);
        break;
      case 'debug':
        console.debug(`${prefix} 🐛`, message, data);
        break;
      default:
        console.log(`${prefix}`, message, data);
    }
  }
  
  /**
   * Create a formatted error object
   */
  static createError(message, code = null, details = null) {
    const error = new Error(message);
    if (code) error.code = code;
    if (details) error.details = details;
    return error;
  }
  
  /**
   * Retry a function with exponential backoff
   */
  static async retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        const delay = baseDelay * Math.pow(2, attempt);
        this.log('warn', `Attempt ${attempt + 1} failed, retrying in ${delay}ms`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
  
  /**
   * Check if we're running in the extension context
   */
  static isExtensionContext() {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  }
  
  /**
   * Get extension version from manifest
   */
  static getExtensionVersion() {
    if (this.isExtensionContext()) {
      return chrome.runtime.getManifest().version;
    }
    return 'unknown';
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.CommissionfinderUtils = CommissionfinderUtils;
}

// Export for modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CommissionfinderUtils;
}

// Utility functions shared across content scripts

/**
 * Helper function to get execution context
 * @returns {'content-script'|'worker'|'background'|'unknown'} The current execution context
 */
export function getExecutionContext() {
  if (typeof window !== 'undefined' && window.document) {
    return 'content-script';
  } else if (typeof importScripts === 'function') {
    return 'worker';
  } else if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
    return 'background';
  }
  return 'unknown';
}

// Send message to background script
export async function sendToBackground(type, data = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...data }, resolve);
  });
}

// Get stored settings
export async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['settings'], (result) => {
      resolve(result.settings || {});
    });
  });
}

// Save settings
export async function saveSettings(settings) {
  return chrome.storage.local.set({ settings });
}

// Sleep helper
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
} 

/**
 * Debug logging function that only logs if debug mode is enabled
 * @param {string} message - The message to log
 * @param {...any} args - Additional arguments to log
 */
export function debugLog(message, ...args) {
  if (typeof isDebugMode !== 'undefined' && isDebugMode) {
    console.log(message, ...args);
  }
} 