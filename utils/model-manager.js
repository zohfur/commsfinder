// utils/model-manager.js

const CACHE_NAME = 'commsfinder-model-cache-v1';

// Model base configuration
const MODEL_NAME = 'zohfur/distilbert-commissions-ONNX';
const MODEL_DISPLAY_NAME = 'DistilBERT Commissions';

// Available quantizations with their configurations
const QUANTIZATIONS = {
  'full': {
    name: 'Maximum Accuracy (Full precision)',
    onnxFile: 'onnx/model.onnx',
    description: 'Highest accuracy, largest size'
  },
  'fp16': {
    name: 'High accuracy (FP16)',
    onnxFile: 'onnx/model_fp16.onnx',
    description: 'Half precision, good balance'
  },
  'quantized': {
    name: 'Quantized INT8 (67.5 MB)',
    onnxFile: 'onnx/model_quantized.onnx',
    description: 'Good balance of size and accuracy'
  },
  'int8': {
    name: 'INT8 (67.5 MB)',
    onnxFile: 'onnx/model_int8.onnx',
    description: 'Integer quantization'
  },
  'uint8': {
    name: 'UINT8 (67.5 MB)',
    onnxFile: 'onnx/model_uint8.onnx',
    description: 'Unsigned integer quantization'
  },
  'q4f16': {
    name: 'Q4F16 (73 MB)',
    onnxFile: 'onnx/model_q4f16.onnx',
    description: '4-bit weights with FP16 activations'
  },
  'bnb4': {
    name: 'BNB4 (122 MB)',
    onnxFile: 'onnx/model_bnb4.onnx',
    description: '4-bit bitsandbytes quantization'
  },
  'q4': {
    name: 'Q4 (125 MB)',
    onnxFile: 'onnx/model_q4.onnx',
    description: '4-bit quantization'
  }
};

// Current quantization (default to quantized for good balance)
let currentQuantization = 'quantized';

/**
 * Sets the current quantization to use
 * @param {string} quantizationType - The quantization type
 */
export function setCurrentQuantization(quantizationType) {
  if (!QUANTIZATIONS[quantizationType]) {
    throw new Error(`Unsupported quantization: ${quantizationType}`);
  }
  currentQuantization = quantizationType;
}

/**
 * Gets the current quantization type
 * @returns {string} The current quantization type
 */
export function getCurrentQuantization() {
  return currentQuantization;
}

/**
 * Gets all available quantizations
 * @returns {object} All quantization configurations
 */
export function getAvailableQuantizations() {
  return QUANTIZATIONS;
}

/**
 * Gets the model name
 * @returns {string} The model name
 */
export function getModelName() {
  return MODEL_NAME;
}

// async function hasWebGPU() {
//   // returns 0 for webgpu with f16, 1 for webgpu without f16, 2 for no webgpu
//   // Check if we're in a service worker context where navigator might not be available
//   if (typeof navigator === 'undefined' || !("gpu" in navigator)) {
//     console.log('No WebGPU detected (service worker or no GPU support), using WASM only');
//     return 2;
//   }
//   try {
//     const adapter = await navigator.gpu.requestAdapter()
//     if (adapter.features.has('shader-f16')) {
//       console.log('WebGPU detected with f16, using WebGPU');
//       return 0;
//     }
//     console.log('WebGPU detected without f16, using WebGPU');
//     return 1;
//   } catch (e) {
//     console.warn('WebGPU detection failed:', e);
//     return 2;
//   }
// }

/**
 * Gets the model display name
 * @returns {string} The model display name
 */
export function getModelDisplayName() {
  return MODEL_DISPLAY_NAME;
}

/**
 * Gets the configuration for the model with a specific quantization
 * @param {string} quantizationType - The quantization type (optional, defaults to current)
 * @returns {object} The model configuration
 */
export function getModelConfig(quantizationType = currentQuantization) {
  const quantization = QUANTIZATIONS[quantizationType];
  if (!quantization) {
    throw new Error(`Unsupported quantization: ${quantizationType}`);
  }
  
  const config = {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    enableCpuMemArena: true,
    enableGraphCapture: false,
    enableMemPattern: true,
    preferredOutputLocation: 'cpu',
    name: `${MODEL_DISPLAY_NAME} (${quantization.name})`,
    files: [
      'config.json',
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'vocab.txt',
      quantization.onnxFile
    ],
    // WASM execution provider configuration
    wasm: {
      numThreads: 1,
      simd: true,
      proxy: false,
      initTimeout: 15000
    }
  }

  // Add WebGPU config if available
  // Note: hasWebGPU is async but we can't make getModelConfig async due to usage patterns
  // In service worker context, WebGPU is typically not available anyway
  if (typeof navigator !== 'undefined' && "gpu" in navigator) {
    // Only try WebGPU if we're not in a service worker context
    config.executionProviders = ['webgpu'];
    config.enableGraphCapture = true;
    config.preferredOutputLocation = 'gpu-buffer';
  }

  return config;
}

/**
 * Gets the main ONNX model file path for a given quantization
 * @param {string} quantizationType - The quantization type (optional, defaults to current)
 * @returns {string} The path to the main ONNX file
 */
export function getMainOnnxFile(quantizationType = currentQuantization) {
  const quantization = QUANTIZATIONS[quantizationType];
  if (!quantization) {
    throw new Error(`Unsupported quantization: ${quantizationType}`);
  }
  return quantization.onnxFile;
}

/**
 * Constructs the full remote URL for a model file.
 * @param {string} file - The relative path of the model file.
 * @returns {string} The full remote URL to the file on Hugging Face Hub.
 */
function getModelFileRemoteUrl(file) {
  return `https://huggingface.co/${MODEL_NAME}/resolve/main/${file}`;
}

/**
 * Opens and returns the model cache.
 * @returns {Promise<Cache>} The cache instance.
 */
async function getModelCache() {
  // Check if Cache API is available
  // Use 'self' instead of 'window' for service worker compatibility
  const globalContext = typeof window !== 'undefined' ? window : self;
  if (!('caches' in globalContext)) {
    throw new Error('Cache API is not supported in this browser. Please use a modern browser.');
  }
  
  // Log cache initialization
  console.log('[Model Manager] Initializing cache with service worker compatibility');
  
  try {
    return await globalContext.caches.open(CACHE_NAME);
  } catch (error) {
    console.error('[Model Manager] Failed to open cache:', error);
    
    // Handle Edge-specific cache issues
    if (error instanceof DOMException) {
      switch (error.name) {
        case 'QuotaExceededError':
          throw new Error('Browser storage quota exceeded. Please clear some browser data and try again.');
        case 'SecurityError':
          throw new Error('Cache access denied. This may be due to browser security settings.');
        default:
          throw new Error(`Cache error: ${error.name} - ${error.message}`);
      }
    }
    
    throw new Error(`Failed to open cache: ${error.message || error.toString()}`);
  }
}

/**
 * Checks if all model files are present in the cache for a specific quantization.
 * @param {string} quantizationType - The quantization type (optional, defaults to current)
 * @returns {Promise<boolean>} True if the model is fully cached, false otherwise.
 */
export async function isModelCached(quantizationType = currentQuantization) {
  try {
    const cache = await getModelCache();
    const config = getModelConfig(quantizationType);
    
    for (const file of config.files) {
      const url = getModelFileRemoteUrl(file);
      try {
        const response = await cache.match(url);
        if (!response) {
          console.log(`[Model Manager] Cache miss for: ${file} (${quantizationType})`);
          return false;
        }
      } catch (cacheError) {
        console.warn(`[Model Manager] Cache match failed for ${file}:`, cacheError);
        return false;
      }
    }
    console.log(`[Model Manager] Model ${MODEL_NAME} (${quantizationType}) is fully cached.`);
    return true;
  } catch (error) {
    console.warn('[Model Manager] Cache check failed, assuming model is not cached:', error);
    return false;
  }
}

/**
 * Downloads all model files from the Hugging Face Hub and stores them in the cache.
 * @param {function(string, number): void} progressCallback - A function to call with progress updates.
 * @param {string} quantizationType - The quantization type (optional, defaults to current)
 */
export async function downloadAndCacheModel(progressCallback, quantizationType = currentQuantization) {
  const cache = await getModelCache();
  const config = getModelConfig(quantizationType);
  const quantization = QUANTIZATIONS[quantizationType];
  const totalFiles = config.files.length;
  let filesDownloaded = 0;

  for (const file of config.files) {
    const url = getModelFileRemoteUrl(file);
    const isOnnxFile = file.endsWith('.onnx');
    const fileType = isOnnxFile ? `${quantization.name} model` : 'configuration file';
    
    progressCallback(`Downloading ${fileType}: ${file}...`, (filesDownloaded / totalFiles) * 100);
    
    try {
      // Check if fetch API is available
      if (typeof fetch === 'undefined') {
        throw new Error('Fetch API is not supported in this browser. Please use a modern browser.');
      }
      
      // Add timeout and better error handling for Edge compatibility
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      let response;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            mode: 'cors',
            credentials: 'omit',
            headers: {
              'Accept': '*/*',
              'Cache-Control': 'no-cache',
              'User-Agent': 'CommsFinder-Extension/1.0.4'
            }
          });
          break; // Success, exit retry loop
        } catch (fetchError) {
          retryCount++;
          console.warn(`[Model Manager] Fetch attempt ${retryCount} failed for ${file}:`, fetchError);
          
          // Handle specific Edge-related errors
          if (fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch')) {
            console.warn('[Model Manager] Network error detected, this might be a CORS or connectivity issue');
          }
          
          if (retryCount >= maxRetries) {
            // Provide more helpful error message for Edge
            const errorMessage = fetchError.name === 'TypeError' && fetchError.message.includes('Failed to fetch') 
              ? `Network error downloading ${file}. This might be due to browser security settings or network connectivity.`
              : `Failed to download ${file} after ${maxRetries} attempts: ${fetchError.message}`;
            throw new Error(errorMessage);
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
        }
      }
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to download ${file}: ${response.status} ${response.statusText}`);
      }
      
      // Log file size for debugging
      const contentLength = response.headers.get('content-length');
      if (contentLength && isOnnxFile) {
        const sizeMB = Math.round(parseInt(contentLength) / (1024 * 1024));
        console.log(`[Model Manager] Downloading ${file}: ${sizeMB}MB`);
      }
      
      // Use the remote URL as the cache key
      try {
        await cache.put(url, response);
        filesDownloaded++;
      } catch (cacheError) {
        console.warn(`[Model Manager] Cache put failed for ${file}, but download succeeded:`, cacheError);
        // Don't fail the entire download if caching fails
        filesDownloaded++;
      }
      
      if (isOnnxFile) {
        progressCallback(`${quantization.name} model downloaded successfully`, (filesDownloaded / totalFiles) * 100);
      }
    } catch (error) {
      console.error(`[Model Manager] Error downloading ${file}:`, error);
      throw error; // Propagate the error to the caller
    }
  }
  
  progressCallback(`Download complete! (${config.name})`, 100);
  console.log(`[Model Manager] Model ${MODEL_NAME} (${quantizationType}) downloaded and cached successfully.`);
}

/**
 * Clears the cache for a specific quantization or all quantizations.
 * @param {string} quantizationType - The quantization type (optional, clears all if not specified)
 */
export async function clearModelCache(quantizationType = null) {
  if (quantizationType) {
    const cache = await getModelCache();
    const config = getModelConfig(quantizationType);
    
    for (const file of config.files) {
      const url = getModelFileRemoteUrl(file);
      await cache.delete(url);
    }
    console.log(`[Model Manager] Model cache cleared for ${MODEL_NAME} (${quantizationType}).`);
  } else {
    // Use 'self' instead of 'window' for service worker compatibility
    const globalContext = typeof window !== 'undefined' ? window : self;
    await globalContext.caches.delete(CACHE_NAME);
    console.log('[Model Manager] All model caches cleared.');
  }
}

/**
 * Validates that all files for a quantization are accessible on Hugging Face
 * @param {string} quantizationType - The quantization type to validate
 * @returns {Promise<object>} Validation result with status and details
 */
export async function validateModelFiles(quantizationType = currentQuantization) {
  const config = getModelConfig(quantizationType);
  const quantization = QUANTIZATIONS[quantizationType];
  const results = {
    valid: true,
    quantization: quantizationType,
    quantizationName: quantization.name,
    files: [],
    errors: []
  };

  for (const file of config.files) {
    const url = getModelFileRemoteUrl(file);
    try {
      const response = await fetch(url, { method: 'HEAD' }); // Only check headers
      const fileInfo = {
        file,
        url,
        exists: response.ok,
        size: response.headers.get('content-length') ? 
               Math.round(parseInt(response.headers.get('content-length')) / (1024 * 1024)) + 'MB' : 
               'Unknown',
        isOnnxFile: file.endsWith('.onnx')
      };
      results.files.push(fileInfo);
      
      if (!response.ok) {
        results.valid = false;
        results.errors.push(`File not found: ${file} (${response.status})`);
      }
    } catch (error) {
      results.valid = false;
      results.errors.push(`Error checking ${file}: ${error.message}`);
      results.files.push({
        file,
        url,
        exists: false,
        error: error.message,
        isOnnxFile: file.endsWith('.onnx')
      });
    }
  }

  console.log(`[Model Manager] Validation result for ${MODEL_NAME} (${quantizationType}):`, results);
  return results;
}

/**
 * A custom cache implementation that can be passed to the transformers.js pipeline.
 * This intercepts requests and serves them from our managed cache.
 */
export const customCache = {
  async match(request) {
    try {
      const cache = await getModelCache();
      const response = await cache.match(request);
      if (response) {
        console.log(`[Model Manager] Cache hit for: ${request.url}`);
        return response;
      }
      console.log(`[Model Manager] Cache miss for: ${request.url}`);
      return undefined; // Let the library handle the fetch
    } catch (error) {
      console.warn(`[Model Manager] Cache match error for ${request.url}:`, error);
      return undefined; // Let the library handle the fetch
    }
  },
  async put(request, response) {
    try {
      // The library will call this after fetching a file. We'll add it to our cache.
      const cache = await getModelCache();
      await cache.put(request, response);
      return Promise.resolve();
    } catch (error) {
      console.warn(`[Model Manager] Cache put error for ${request.url}:`, error);
      // Don't fail the operation if caching fails
      return Promise.resolve();
    }
  }
}; 