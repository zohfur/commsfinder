// AI Worker script
// This script acts as a bridge between the content scripts and the AI analyzer.

import { AIAnalyzer } from './ai-analyzer.js';

// This console log is useful for confirming the worker is starting.
console.log('[AI Worker] Script loading...');

let analyzer = null;

// Listen for messages from the main thread (ml-handler.js)
self.addEventListener('message', async (event) => {
    const { type, text, context, options } = event.data;
    console.log(`[AI Worker] Received message of type: ${type}`);

    try {
        switch (type) {
            case 'init': {
                // Initialize the analyzer. This is the first message that must be sent.
                if (analyzer) {
                    console.warn('[AI Worker] Analyzer is already initialized.');
                    return;
                }
                console.log('[AI Worker] Initializing AIAnalyzer...');
                // Pass model and quantization to the analyzer
                const analyzerOptions = {
                    ...options,
                    model: 'zohfur/distilbert-commissions-ONNX',
                    quantization: options.quantization || 'quantized'
                };
                analyzer = new AIAnalyzer(analyzerOptions);
                
                // Initialize the analyzer
                await analyzer.initialize();
                
                self.postMessage({ type: 'initialized' });
                console.log('[AI Worker] Analyzer initialized successfully.');
                break;
            }

            case 'analyze': {
                // Perform text analysis.
                if (!analyzer) {
                    throw new Error('Analyzer not initialized. Send "init" message first.');
                }
                if (!text) {
                    throw new Error('No text provided for analysis.');
                }
                
                console.log('[AI Worker] Starting analysis...');
                const result = await analyzer.analyze(text, context);
                console.log('[AI Worker] Analysis complete.');
                
                // Send the result back to the main thread.
                self.postMessage({ type: 'result', data: result });
                break;
            }

            case 'analyze_components': {
                // Perform component analysis.
                if (!analyzer) {
                    throw new Error('Analyzer not initialized. Send "init" message first.');
                }
                if (!event.data.components) {
                    throw new Error('No components provided for analysis.');
                }
                
                console.log('[AI Worker] Starting component analysis...');
                const result = await analyzer.analyzeComponents(event.data.components);
                console.log('[AI Worker] Component analysis complete.');
                
                // Send the result back to the main thread.
                self.postMessage({ type: 'result', data: result });
                break;
            }

            case 'batch_analyze': {
                // Perform batch text analysis.
                if (!analyzer) {
                    throw new Error('Analyzer not initialized. Send "init" message first.');
                }
                if (!event.data.texts || !Array.isArray(event.data.texts)) {
                    throw new Error('No texts array provided for batch analysis.');
                }
                
                console.log(`[AI Worker] Starting batch analysis of ${event.data.texts.length} texts...`);
                const results = await analyzer.batchAnalyze(event.data.texts);
                console.log('[AI Worker] Batch analysis complete.');
                
                // Send the result back to the main thread.
                self.postMessage({ type: 'result', data: results });
                break;
            }

            case 'change_quantization':
                // Change the quantization used by the analyzer
                if (!analyzer) {
                    throw new Error('Analyzer not initialized. Send "init" message first.');
                }
                
                console.log('[AI Worker] Changing quantization to:', options.quantization);
                analyzer.setQuantization(options.quantization);
                
                // Re-initialize with the new quantization
                await analyzer.initialize();
                
                self.postMessage({ type: 'quantization_changed', quantization: options.quantization });
                console.log('[AI Worker] Quantization changed successfully to:', options.quantization);
                break;

            default:
                throw new Error(`[AI Worker] Unknown message type: ${type}`);
        }
    } catch (error) {
        console.error('[AI Worker] Error processing message:', error);
        // Propagate the error back to the main thread.
        self.postMessage({
            type: 'error',
            error: error.message || 'An unknown error occurred in the AI worker.'
        });
    }
});

console.log('[AI Worker] Event listener registered.'); 