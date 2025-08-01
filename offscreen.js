// Offscreen document script for managing AI Worker
// This runs in a hidden document context where Web Workers are available

console.log('[Offscreen] Script loading...');

let aiWorker = null;
let workerInitialized = false;
let initializationPromise = null;

// Initialize AI Worker in offscreen context
async function createAIWorker(options) {
    if (workerInitialized && aiWorker) {
        console.log('[Offscreen] Worker already initialized, returning success');
        return { success: true };
    }
    
    if (initializationPromise) {
        console.log('[Offscreen] Initialization already in progress, waiting...');
        return initializationPromise;
    }
    
    initializationPromise = (async () => {
        try {
            console.log('[Offscreen] Creating AI Worker...');
            
            // Create the worker
            const workerUrl = chrome.runtime.getURL('utils/ai-worker.js');
            console.log('[Offscreen] Worker URL:', workerUrl);
            
            // Test if the worker file is accessible
            try {
                const response = await fetch(workerUrl);
                if (!response.ok) {
                    throw new Error(`Worker file not accessible: ${response.status} ${response.statusText}`);
                }
                console.log('[Offscreen] Worker file is accessible');
            } catch (fetchError) {
                console.error('[Offscreen] Worker file fetch error:', fetchError);
                throw new Error(`Cannot access worker file: ${fetchError.message}`);
            }
            
            aiWorker = new Worker(workerUrl, { 
                type: 'module',
                name: 'offscreen-ai-worker'
            });
            
            console.log('[Offscreen] Worker created successfully');
            
            // Set up error handling
            aiWorker.onerror = (error) => {
                console.error('[Offscreen] AI Worker error:', {
                    message: error.message,
                    filename: error.filename,
                    lineno: error.lineno,
                    colno: error.colno,
                    error: error.error
                });
                workerInitialized = false;
                aiWorker = null;
                initializationPromise = null;
            };
            
            console.log('[Offscreen] Initializing AI Worker with options:', options);
            
            // Send initialization message and wait for response
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error('[Offscreen] Worker initialization timeout after 60 seconds');
                    reject(new Error('Worker initialization timeout'));
                }, 60000); // 60 second timeout for model loading
                
                const messageHandler = (event) => {
                    console.log('[Offscreen] Received message from worker:', event.data);
                    if (event.data.type === 'initialized') {
                        console.log('[Offscreen] Worker initialized successfully');
                        clearTimeout(timeout);
                        aiWorker.removeEventListener('message', messageHandler);
                        resolve();
                    } else if (event.data.type === 'error') {
                        console.error('[Offscreen] Worker initialization error:', event.data.error);
                        clearTimeout(timeout);
                        aiWorker.removeEventListener('message', messageHandler);
                        reject(new Error(event.data.error));
                    }
                };
                
                aiWorker.addEventListener('message', messageHandler);
                console.log('[Offscreen] Sending init message to worker');
                aiWorker.postMessage({ 
                    type: 'init', 
                    options: options
                });
            });
            
            workerInitialized = true;
            console.log('[Offscreen] AI Worker initialized successfully');
            return { success: true };
        } catch (error) {
            console.error('[Offscreen] Failed to initialize AI Worker:', error);
            // Reset all state on failure
            if (aiWorker) {
                try {
                    aiWorker.terminate();
                } catch (termError) {
                    console.warn('[Offscreen] Error terminating failed worker:', termError);
                }
            }
            initializationPromise = null;
            aiWorker = null;
            workerInitialized = false;
            return { success: false, error: error.message };
        }
    })();
    
    return initializationPromise;
}

// Perform AI analysis via worker
async function performAnalysis(type, data) {
    try {
        // Check if worker needs initialization or re-initialization
        if (!aiWorker || !workerInitialized) {
            console.log('[Offscreen] Worker not available, checking initialization...');
            
            // Wait for any ongoing initialization to complete
            if (initializationPromise) {
                console.log('[Offscreen] Waiting for initialization to complete...');
                const initResult = await initializationPromise;
                if (!initResult.success) {
                    throw new Error(`Worker initialization failed: ${initResult.error}`);
                }
            } else {
                // No initialization in progress, but worker not available
                throw new Error('AI Worker not available and no initialization in progress. Call INIT_AI_WORKER first.');
            }
        }

        // Wait for any ongoing initialization to complete (if it started while we were checking)
        if (initializationPromise) {
            console.log('[Offscreen] Waiting for initialization to complete...');
            const initResult = await initializationPromise;
            if (!initResult.success) {
                throw new Error(`Worker initialization failed: ${initResult.error}`);
            }
        }

        // Final check of worker state
        if (!aiWorker || !workerInitialized) {
            throw new Error('AI Worker not available after initialization');
        }

        console.log('[Offscreen] Sending analysis request to worker:', type, 'Worker state:', {
            hasWorker: !!aiWorker,
            initialized: workerInitialized,
            hasPendingInit: !!initializationPromise
        });
        
        const result = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Analysis timeout'));
            }, 30000);

            const messageHandler = (event) => {
                if (event.data.type === 'result') {
                    clearTimeout(timeout);
                    aiWorker.removeEventListener('message', messageHandler);
                    resolve(event.data.data);
                } else if (event.data.type === 'error') {
                    clearTimeout(timeout);
                    aiWorker.removeEventListener('message', messageHandler);
                    reject(new Error(event.data.error));
                }
            };
            
            aiWorker.addEventListener('message', messageHandler);
            
            if (type === 'analyze') {
                aiWorker.postMessage({ type: 'analyze', text: data.text, context: data.context });
            } else if (type === 'analyze_components') {
                aiWorker.postMessage({ type: 'analyze_components', components: data.components });
            }
        });

        console.log('[Offscreen] Analysis complete via worker');
        return { success: true, result };

    } catch (error) {
        console.error('[Offscreen] AI analysis failed:', error);
        return { success: false, error: error.message };
    }
}

// Terminate worker
function terminateWorker() {
    if (aiWorker) {
        aiWorker.terminate();
        aiWorker = null;
    }
    workerInitialized = false;
    initializationPromise = null;
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Offscreen] Received message:', { 
        type: message.type, 
        messageId: message.messageId,
        sender: sender.url,
        hasText: !!message.text,
        hasComponents: !!message.components,
        hasOptions: !!message.options,
        timestamp: message.timestamp
    });
    
    // Only handle messages from the background script or extension itself
    // Ignore messages from content scripts (they should go to background first)
    if (sender.tab) {
        console.log('[Offscreen] Ignoring message from content script (should go to background):', message.type);
        // Don't call sendResponse for content script messages to avoid interfering
        return false;
    }
    
    // Validate message structure
    if (!message || !message.type) {
        console.error('[Offscreen] Invalid message received:', message);
        sendResponse({ success: false, error: 'Invalid message format' });
        return false;
    }

    // Handle synchronous messages immediately
    switch (message.type) {
        case 'SCAN_PROGRESS':
        case 'SCAN_PROGRESS_UPDATE':
        case 'STOP_SCAN':
        case 'GET_RESULTS':
        case 'GET_MODEL_STATUS':
        case 'ARTIST_FOUND':
        case 'RESULTS_UPDATED':
        case 'SCAN_COMPLETE':
        case 'SCAN_FINISHED':
            // These messages are not meant for the offscreen document
            // They should be handled by the popup or background script
            console.log('[Offscreen] Ignoring message meant for background/popup:', message.type);
            sendResponse({ success: true, ignored: true });
            return false; // Sync response, don't keep channel open
            
        case 'TERMINATE_AI_WORKER':
            console.log('[Offscreen] Terminating AI Worker');
            terminateWorker();
            sendResponse({ success: true });
            return false; // Sync response, don't keep channel open
    }

    // Handle async messages
    (async () => {
        try {
            let result;
            
            switch (message.type) {
                case 'INIT_AI_WORKER':
                    console.log(`[Offscreen] Initializing AI Worker with options (ID: ${message.messageId}):`, message.options);
                    result = await createAIWorker(message.options);
                    console.log(`[Offscreen] AI Worker init result (ID: ${message.messageId}):`, result);
                    break;
                    
                case 'AI_ANALYZE':
                    console.log(`[Offscreen] Processing AI_ANALYZE request (ID: ${message.messageId})`);
                    result = await performAnalysis('analyze', {
                        text: message.text,
                        context: message.context
                    });
                    console.log(`[Offscreen] AI_ANALYZE result (ID: ${message.messageId}):`, result.success);
                    break;
                    
                case 'AI_ANALYZE_COMPONENTS':
                    console.log(`[Offscreen] Processing AI_ANALYZE_COMPONENTS request (ID: ${message.messageId})`);
                    result = await performAnalysis('analyze_components', {
                        components: message.components
                    });
                    console.log(`[Offscreen] AI_ANALYZE_COMPONENTS result (ID: ${message.messageId}):`, result.success);
                    break;
                    
                case 'analyze_components':
                    // This should be AI_ANALYZE_COMPONENTS - might be a routing issue
                    console.warn(`[Offscreen] Received analyze_components instead of AI_ANALYZE_COMPONENTS (ID: ${message.messageId})`);
                    result = await performAnalysis('analyze_components', {
                        components: message.components
                    });
                    console.log(`[Offscreen] Legacy analyze_components result (ID: ${message.messageId}):`, result.success);
                    break;
                    
                default:
                    console.error('[Offscreen] Unknown message type:', message.type);
                    result = { success: false, error: `Unknown message type: ${message.type}` };
            }
            
            // Send the response
            if (result) {
                console.log(`[Offscreen] Sending response for message ID: ${message.messageId}`, { success: result.success });
                sendResponse(result);
            } else {
                console.log(`[Offscreen] Sending error response for message ID: ${message.messageId} - no result generated`);
                sendResponse({ success: false, error: 'No result generated' });
            }
            
        } catch (error) {
            console.error(`[Offscreen] Error handling message ID: ${message.messageId}:`, error);
            sendResponse({ success: false, error: error.message || 'Unknown error in offscreen handler' });
        }
    })().catch(error => {
        console.error(`[Offscreen] Async handler error for message ID: ${message.messageId}:`, error);
        sendResponse({ success: false, error: error.message || 'Async handler failed' });
    });
    
    return true; // Keep the message channel open for async response
});

console.log('[Offscreen] Message listener registered.');