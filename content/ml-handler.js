// ML Handler Content Script
(() => {
    console.log('[ML Handler] Script loading...');

    // Check if we're running in extension context
    const isExtensionContext = typeof chrome !== 'undefined' && 
                              chrome.runtime && 
                              chrome.runtime.id;

    if (!isExtensionContext) {
        console.warn('[ML Handler] Not running in extension context, some features will be disabled');
        return;
    }

    let aiWorker = null;
    let isInitialized = false;
    let initializationPromise = null;
    let initializationTimeout = null;

    // Initialize or get the AI worker
    async function getAIWorker() {
        console.log('[ML Handler] Getting AI worker...');
        
        if (!aiWorker && !initializationPromise) {
            console.log('[ML Handler] Starting worker initialization');
            
            // Clear any existing timeout
            if (initializationTimeout) {
                clearTimeout(initializationTimeout);
            }

            initializationPromise = (async () => {
                try {
                    console.log('[ML Handler] Creating worker...');
                    const workerUrl = chrome.runtime.getURL('dist/utils/ai-worker.js');
                    console.log(`[ML Handler] Worker URL: ${workerUrl}`);

                    aiWorker = new Worker(workerUrl, { 
                        type: 'module',
                        name: 'ai-worker'
                    });
                    console.log('[ML Handler] Worker created');

                    // Add a robust error handler
                    aiWorker.onerror = (error) => {
                        console.error('[ML Handler] A critical error occurred in the AI worker.');
                        
                        // Log the raw error event for deep inspection
                        console.error('[ML Handler] Raw error event:', error);

                        // Attempt to extract as much detail as possible
                        if (error.message) {
                            console.error(`[ML Handler] Error Message: ${error.message}`);
                        }
                        if (error.filename) {
                            console.error(`[ML Handler] Error Filename: ${error.filename}:${error.lineno}:${error.colno}`);
                        }
                        
                        // The actual Error object is often nested
                        if (error.error) {
                            console.error('[ML Handler] Nested Error Object:', error.error);
                            console.error(`[ML Handler] Nested Error Stack: ${error.error.stack}`);
                        }

                        // Fallback for unusual error structures
                        try {
                            console.error('[ML Handler] Full error object (stringified):', JSON.stringify(error, Object.getOwnPropertyNames(error)));
                        } catch (e) {
                            console.error('[ML Handler] Could not stringify the full error object.');
                        }

                        isInitialized = false;
                        aiWorker = null;
                        // Reject the promise to signal failure
                        if (initializationPromise) {
                            initializationPromise.catch(e => console.error("Error during promise rejection:", e));
                        }
                    };

                    // Add message error handler
                    aiWorker.addEventListener('messageerror', (error) => {
                        console.error('[ML Handler] Worker message error:', {
                            message: error.data,
                            lastError: error.lastError,
                            type: error.type
                        });
                    });

                    const { debugMode, selectedQuantization } = await chrome.storage.local.get(['debugMode', 'selectedQuantization']);

                    // Wait for worker to initialize
                    await new Promise((resolve, reject) => {
                        // Set a timeout
                        initializationTimeout = setTimeout(() => {
                            console.error('[ML Handler] Worker initialization timeout');
                            reject(new Error('Worker initialization timeout'));
                        }, 30000); // Increased timeout to 30 seconds

                        // Listen for initialization message
                        const initHandler = (event) => {
                            if (event.data.type === 'initialized') {
                                console.log('[ML Handler] Worker initialization complete');
                                clearTimeout(initializationTimeout);
                                aiWorker.removeEventListener('message', initHandler);
                                isInitialized = true;
                                resolve();
                            } else if (event.data.type === 'progress') {
                                // Log model loading progress
                                const progressData = event.data.data;
                                if (progressData.status === 'progress') {
                                    const percentage = Math.round(progressData.progress);
                                    console.log(`[ML Handler] Model loading: ${percentage}% (${progressData.file})`);
                                }
                            } else if (event.data.type === 'error') {
                                console.error('[ML Handler] Worker initialization error:', event.data.error);
                                clearTimeout(initializationTimeout);
                                aiWorker.removeEventListener('message', initHandler);
                                reject(new Error(event.data.error.message || event.data.error));
                            }
                        };
                        aiWorker.addEventListener('message', initHandler);

                        // Send init message with selected quantization
                        console.log('[ML Handler] Sending init message to worker with quantization:', selectedQuantization);
                        aiWorker.postMessage({
                            type: 'init',
                            options: {
                                debugMode: debugMode === true,
                                quantization: selectedQuantization || 'quantized'
                            }
                        });
                    });

                } catch (error) {
                    console.error('[ML Handler] Worker initialization failed:', error);
                    if (aiWorker) {
                        aiWorker.terminate();
                    }
                    aiWorker = null;
                    isInitialized = false;
                    throw error;
                } finally {
                    initializationPromise = null;
                    if (initializationTimeout) {
                        clearTimeout(initializationTimeout);
                        initializationTimeout = null;
                    }
                }
            })();
        }

        try {
            await initializationPromise;
            return aiWorker;
        } catch (error) {
            console.error('[ML Handler] Failed to get worker:', error);
            throw error;
        }
    }

    // Process text using ML
    async function processText(text, context = 'bio') {
        console.log('[ML Handler] Processing text:', { textLength: text.length, context });
        
        try {
            const worker = await getAIWorker();
            if (!worker || !isInitialized) {
                throw new Error('Worker not available or not initialized');
            }

            console.log('[ML Handler] Sending analysis request to worker');
            const result = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Analysis timeout'));
                }, 30000);

                const messageHandler = (event) => {
                    if (event.data.type === 'result') {
                        clearTimeout(timeout);
                        worker.removeEventListener('message', messageHandler);
                        resolve(event.data.data);
                    } else if (event.data.type === 'error') {
                        clearTimeout(timeout);
                        worker.removeEventListener('message', messageHandler);
                        reject(new Error(event.data.error));
                    }
                };
                
                worker.addEventListener('message', messageHandler);
                worker.postMessage({ type: 'analyze', text, context });
            });

            console.log('[ML Handler] Analysis complete:', result);
            return result;

        } catch (error) {
            console.error('[ML Handler] Processing failed:', error);
            throw error;
        }
    }

    // Initialize worker immediately
    console.log('[ML Handler] Starting immediate initialization');
    getAIWorker().then(() => {
        console.log('[ML Handler] Initial worker setup complete');
    }).catch(error => {
        console.error('[ML Handler] Initial worker setup failed:', error);
    });

    // Set up message listener
    try {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('[ML Handler] Received message:', request.type);

            if (request.type === 'ping') {
                sendResponse({ success: true });
                return true;
            }

            if (request.type === 'analyze_text') {
                // Process text and send response
                processText(request.text, request.context)
                    .then(result => {
                        console.log('[ML Handler] Sending success response');
                        sendResponse({ success: true, result });
                    })
                    .catch(error => {
                        console.error('[ML Handler] Sending error response:', error);
                        sendResponse({ success: false, error: error.message });
                    });
                
                return true; // Will respond asynchronously
            }
        });
        console.log('[ML Handler] Message listener registered');
    } catch (error) {
        console.error('[ML Handler] Failed to register message listener:', error);
    }

    console.log('[ML Handler] Content script loaded and ready');
})(); 