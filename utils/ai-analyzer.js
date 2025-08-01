// AI-powered text analyzer for commission detection
// This script contains the core AI logic and is designed to run inside a Web Worker.

import * as ort from 'onnxruntime-web';
import { DistilBertTokenizer } from './tokenizer.js';
import { debugLog } from './shared.js';

// Configure ONNX Runtime for the extension environment
// Enable multi-threading for significant performance boost
ort.env.wasm.numThreads = 0; // Let ORT decide optimal thread count
ort.env.wasm.simd = true;
ort.env.wasm.proxy = true; // Enable proxy worker for better UI responsiveness
ort.env.wasm.wasmPaths = '../onnxruntime-web/';



// The primary class for performing AI analysis.
export class AIAnalyzer {
    static instance = null;

    constructor(options = {}) {
        this.model = 'zohfur/distilbert-commissions-ONNX';
        this.quantization = options.quantization || 'quantized';
        this.modelName = null;
        this.modelConfig = null;
        this.modelTemperature = options.temperature || 1.0;
        this.debugMode = false;
        this.session = null;
        this.tokenizer = null;
        this.labelMapping = {
            'LABEL_0': 'open',
            'LABEL_1': 'closed', 
            'LABEL_2': 'unclear'
        };
        this.initialize();
    }
    

    async initialize() {        
        try {
            debugLog('[AIAnalyzer] Initializing...');

            if (this.session && this.tokenizer) {
                debugLog('[AI Analyzer] Model is already initialized.');
                return;
            }
            debugLog(`[AI Analyzer] Initializing model: ${this.model}`);

            try {
                debugLog(`[AI Analyzer] Initializing tokenizer...`);
                // Initialize tokenizer
                this.tokenizer = new DistilBertTokenizer();
                await this.tokenizer.initialize(this.model);
                debugLog('[AI Analyzer] Tokenizer initialized successfully');

                // Get model path for the current quantization
                const modelPath = this.getModelPath();
                debugLog(`[AI Analyzer] Loading ONNX model: ${modelPath}`);

                // Create inference session with optimizations
                const sessionOptions = {
                    executionProviders: this.getExecutionProviders(),
                    graphOptimizationLevel: 'all',
                    enableCpuMemArena: true,
                    enableMemPattern: true,
                    logSeverityLevel: 2, // Warning level
                    logVerbosityLevel: 0,
                };

                this.session = await ort.InferenceSession.create(modelPath, sessionOptions);
                debugLog('[AI Analyzer] ONNX model loaded successfully');
                debugLog('[AI Analyzer] Model inputs:', this.session.inputNames);
                debugLog('[AI Analyzer] Model outputs:', this.session.outputNames);
                
                debugLog('[AI Analyzer] Model initialization complete.');
            } catch (error) {
                console.error('[AI Analyzer] Fatal error during model initialization:', error);
                throw error;
            }

            debugLog('[AIAnalyzer] Initialization complete');
        } catch (error) {
            console.error('Error initializing AI analyzer:', error);
            throw error;
        }
    }

    // Get the model path based on current quantization
    getModelPath() {
        const quantizations = {
            'full': 'onnx/model.onnx',
            'fp16': 'onnx/model_fp16.onnx', 
            'quantized': 'onnx/model_quantized.onnx',
            'int8': 'onnx/model_int8.onnx',
            'uint8': 'onnx/model_uint8.onnx', // Recommended for CPU
            'q4f16': 'onnx/model_q4f16.onnx',
            'bnb4': 'onnx/model_bnb4.onnx',
            'q4': 'onnx/model_q4.onnx'
        };
        
        const modelFile = quantizations[this.quantization] || quantizations['quantized'];
        // TODO: Implement local caching via Cache API or IndexedDB
        // For now, direct HuggingFace loading (consider caching for production)
        return `https://huggingface.co/${this.model}/resolve/main/${modelFile}`;
    }

    // Get execution providers based on environment
    getExecutionProviders() {
        const providers = ['wasm'];
        
        // Only try WebGPU if we're not in a service worker context
        // Service workers don't support dynamic imports required by WebGPU backend
        const isServiceWorker = typeof importScripts === 'function';
        
        if (isServiceWorker) {
            debugLog('[AI Analyzer] Service worker context detected, using WASM backend only');
        } else if (typeof navigator !== 'undefined' && navigator.gpu) {
            debugLog('[AI Analyzer] WebGPU available, adding to execution providers');
            providers.unshift('webgpu');
        }
        
        debugLog('[AI Analyzer] Using execution providers:', providers);
        return providers;
    }

    // Sets a new quantization and clears the existing session
    setQuantization(quantizationType) {
        this.quantization = quantizationType;
        this.session = null; // Clear existing session
        this.tokenizer = null; // Clear tokenizer
        debugLog(`[AI Analyzer] Quantization changed to: ${this.quantization}`);
    }



    async analyze(text, context = 'bio') {
        try {
            debugLog('[AIAnalyzer] Analyzing text:', { text, context });

            if (!this.session || !this.tokenizer) {
                throw new Error('Model not initialized. Call initialize() before analyzing.');
            }

            return await this.analyzeWithClassification(text);

        } catch (error) {
            console.error('Analysis error:', error);
            throw error;
        }
    }

    // Batch analysis for multiple texts - much faster than individual calls
    async batchAnalyze(texts) {
        try {
            debugLog('[AIAnalyzer] Batch analyzing texts:', texts.length);

            if (!this.session || !this.tokenizer) {
                throw new Error('Model not initialized. Call initialize() before analyzing.');
            }

            if (!texts || texts.length === 0) {
                return [];
            }

            // Process texts in smaller batches to avoid memory issues
            const batchSize = 8; // Adjust based on your model's memory requirements
            const results = [];

            for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                const batchResults = await this.processBatch(batch);
                results.push(...batchResults);
            }

            return results;

        } catch (error) {
            console.error('Batch analysis error:', error);
            throw error;
        }
    }

    async processBatch(texts) {
        // Tokenize all texts in the batch
        const encodedBatch = texts.map(text => 
            this.tokenizer.encode(text, {
                maxLength: 512,
                padding: true,
                truncation: true,
                addSpecialTokens: true
            })
        );

        // Find the maximum length for padding
        const maxLength = Math.max(...encodedBatch.map(encoded => encoded.input_ids.length));

        // Pad all sequences to the same length
        const batchInputIds = [];
        const batchAttentionMasks = [];

        for (const encoded of encodedBatch) {
            const paddedInputIds = [...encoded.input_ids];
            const paddedAttentionMask = [...encoded.attention_mask];
            
            // Pad to max length
            while (paddedInputIds.length < maxLength) {
                paddedInputIds.push(0); // PAD token
                paddedAttentionMask.push(0);
            }
            
            batchInputIds.push(...paddedInputIds);
            batchAttentionMasks.push(...paddedAttentionMask);
        }

        // Create batch tensors
        const inputTensor = new ort.Tensor('int64', 
            new BigInt64Array(batchInputIds.map(id => BigInt(id))), 
            [texts.length, maxLength]
        );
        const attentionMaskTensor = new ort.Tensor('int64', 
            new BigInt64Array(batchAttentionMasks.map(mask => BigInt(mask))), 
            [texts.length, maxLength]
        );

        const feeds = {
            input_ids: inputTensor,
            attention_mask: attentionMaskTensor
        };

        debugLog('[AIAnalyzer] Running batch ONNX inference...');
        
        // Run batch inference
        const results = await this.session.run(feeds);
        
        // Process batch results
        const logits = results.logits.data;
        const numClasses = 3; // LABEL_0, LABEL_1, LABEL_2
        const batchResults = [];

        for (let i = 0; i < texts.length; i++) {
            const startIdx = i * numClasses;
            const endIdx = startIdx + numClasses;
            const textLogits = Array.from(logits.slice(startIdx, endIdx));
            
            const probabilities = this.softmax(textLogits);
            
            const formattedResults = probabilities.map((score, index) => ({
                label: `LABEL_${index}`,
                score: score
            }));

            formattedResults.sort((a, b) => b.score - a.score);
            
            const primaryResult = formattedResults[0];
            const commissionStatus = this.labelMapping[primaryResult.label] || 'unclear';

            batchResults.push({
                commissionStatus,
                confidence: primaryResult.score,
                method: 'ai-classification-batch',
                triggers: this.findTriggerWords(texts[i], commissionStatus),
                allResults: formattedResults
            });
        }

        return batchResults;
    }

    // Analyze using ONNX Runtime inference
    async analyzeWithClassification(text) {
        try {
            // Tokenize the input text
            const encoded = this.tokenizer.encode(text, {
                maxLength: 512,
                padding: true,
                truncation: true,
                addSpecialTokens: true
            });

            debugLog('[AI Analyzer] Tokenized input:', {
                inputIds: encoded.input_ids.slice(0, 10), // Log first 10 tokens
                length: encoded.input_ids.length
            });

            // Prepare inputs for ONNX Runtime
            const inputTensor = new ort.Tensor('int64', new BigInt64Array(encoded.input_ids.map(id => BigInt(id))), [1, encoded.input_ids.length]);
            const attentionMaskTensor = new ort.Tensor('int64', new BigInt64Array(encoded.attention_mask.map(mask => BigInt(mask))), [1, encoded.attention_mask.length]);

            const feeds = {
                input_ids: inputTensor,
                attention_mask: attentionMaskTensor
            };

            debugLog('[AI Analyzer] Running ONNX inference...');
            
            // Run inference
            const results = await this.session.run(feeds);
            
            // Get logits from the output
            const logits = results.logits.data;
            debugLog('[AI Analyzer] Raw logits:', Array.from(logits));

            // Apply softmax to get probabilities
            const probabilities = this.softmax(Array.from(logits));
            debugLog('[AI Analyzer] Probabilities:', probabilities);

            // Create result in the same format as transformers.js
            const formattedResults = probabilities.map((score, index) => ({
                label: `LABEL_${index}`,
                score: score
            }));

            // Sort by score (highest first)
            formattedResults.sort((a, b) => b.score - a.score);

            debugLog('[AI Analyzer] Classification result:', formattedResults);

            // The custom model outputs three labels: LABEL_0 (open), LABEL_1 (closed), LABEL_2 (unclear)
            const primaryResult = formattedResults[0];
            const label = primaryResult.label;
            
            // Map the label to our result format
            let commissionStatus;
            
            if (label === 'LABEL_0') {
                commissionStatus = 'open';
            } else if (label === 'LABEL_1') {
                commissionStatus = 'closed';
            } else if (label === 'LABEL_2') {
                commissionStatus = 'unclear';
            } else {
                // Fallback for unexpected labels
                console.warn(`[AI Analyzer] Unexpected label: ${label}`);
                commissionStatus = 'unclear';
            }

            return {
                commissionStatus,
                confidence: primaryResult.score,
                method: 'ai-classification',
                triggers: this.findTriggerWords(text, commissionStatus),
                allResults: formattedResults // Include all results for debugging
            };
        } catch (error) {
            console.error('[AI Analyzer] Error in ONNX inference:', error);
            throw error;
        }
    }

    // Apply softmax function to convert logits to probabilities
    softmax(logits) {
        const maxLogit = Math.max(...logits);
        const expValues = logits.map(x => Math.exp(x - maxLogit));
        const sumExp = expValues.reduce((sum, val) => sum + val, 0);
        return expValues.map(val => val / sumExp);
    }
    // Fallback pattern-matching analysis.
    fallbackAnalysis(text) {
        const patterns = {
            open: /(?:commissions?|comms?)\s*(?:are\s+)?open|taking\s+(?:commissions?|comms?)|slots?\s+(?:available|open)/i,
            closed: /(?:commissions?|comms?)\s*(?:are\s+)?closed?|not\s+taking\s+(?:commissions?|comms?)|queue\s+(?:is\s+)?full/i,
        };
        const hasOpen = patterns.open.test(text);
        const hasClosed = patterns.closed.test(text);
        
        let commissionStatus;
        let confidence = 0.3;
        
        if (hasOpen && !hasClosed) {
            commissionStatus = 'open';
            confidence = 0.7;
        } else if (hasClosed && !hasOpen) {
            commissionStatus = 'closed';
            confidence = 0.7;
        } else {
            commissionStatus = 'unclear';
            confidence = 0.3;
        }

        return {
            commissionStatus,
            confidence,
            method: 'pattern-matching',
            triggers: this.findTriggerWords(text, commissionStatus),
        };
    }

    // Finds words that likely triggered the analysis result.
    findTriggerWords(text, commissionStatus) {
        const triggers = [];
        const patterns = commissionStatus === 'open'
            ? [/commissions?\s*open/i, /comms?\s*open/i, /taking\s+commissions?/i, /slots?\s+available/i]
            : [/commissions?\s*closed/i, /comms?\s*closed/i, /not\s+taking/i, /queue\s+full/i];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                triggers.push(match[0]);
            }
        }
        return [...new Set(triggers)]; // Return unique triggers
    }

    // Apply temperature scaling to classification results
    applyTemperatureScaling(results) {
        // Temperature scaling adjusts confidence scores
        // Higher temperature = lower confidence, more uncertainty
        // Lower temperature = higher confidence, more certainty
        
        return results.map(result => {
            // For classification models, we scale the score
            // using a modified approach since we don't have raw logits
            let scaledScore = result.score;
            
            if (this.temperature > 1.0) {
                // Higher temperature reduces confidence
                // Use a power function to reduce high confidence scores more
                scaledScore = Math.pow(result.score, 1 / this.temperature);
            } else if (this.temperature < 1.0) {
                // Lower temperature increases confidence
                scaledScore = Math.pow(result.score, this.temperature);
            }
            
            // Ensure score stays in valid range
            scaledScore = Math.max(0, Math.min(1, scaledScore));
            
            return {
                ...result,
                score: scaledScore
            };
        });
    }

    // Helper to calculate time-based weight
    calculateTimeWeight(timestamp) {
        const age = Date.now() - timestamp;
        const daysOld = age / (24 * 60 * 60 * 1000);
        
        if (daysOld < 7) return 1.0;
        if (daysOld < 30) return 0.8;
        if (daysOld < 90) return 0.5;
        return 0.3;
    }

    // Check for silver bullet phrases
    checkSilverBullets(text, timestamp, isDisplayName = false) {
        // Use word boundaries and more precise patterns to avoid false matches
        const openPhrases = isDisplayName ? [
            /\bcomm?s?\s*(?:are\s+)?open\b/i,
            /\bc0mm?s?\s*(?:are\s+)?open\b/i,
            /\bc0mm?s?\s*0pen\b/i,
            /\bc\*mm?s?\s*open\b/i,
            /\bcommissions?\s*(?:are\s+)?open\b/i,
            /\btaking\s+comm?s?\b/i,
            /\btaking\s+commissions?\b/i,
            /\bcomm?s?\s+slots?\s+(?:open|available)\b/i,
            /\bopen\s+for\s+comm?s?\b/i,
            /\bopen\s+comm?s?\b/i,
            /\bcommissions?\s*:\s*open\b/i,
            /\bcommisisons\s+open\b/i,
            /\bСommission\s*-\s*open\b/i
        ] : [
            /\bcommissions?\s*(?:are\s+)?open\b/i,
            /\btaking\s+commissions?\b/i,
            /\bcommissions?\s*slots?\b/i,
            /\bcommissions?\s*available\b/i,
            /\bslots?\s+available\b/i,
            /\bopen\s+for\s+comm?s?\b/i,
            /\baccept(?:ing)?\s+comm?s?\b/i,
            /\bcommissions?\s*:\s*open\b/i,
            /\bcommisisons\s+open\b/i,
            /\bСommission\s*-\s*open\b/i
        ];

        const closedPhrases = isDisplayName ? [
            /\bcomm?s?\s*(?:are\s+)?closed?\b/i,
            /\bc\*mm?s?\s*closed?\b/i,
            /\bcom?s?\s*closed?\b/i,
            /\bcommissions?\s*(?:are\s+)?closed?\b/i,
            /\bnot\s+taking\s+comm?s?\b/i,
            /\bnot\s+taking\s+commissions?\b/i,
            /\bno\s+comm?s?\b/i,
            /\bclosed\s+(?:for\s+)?comm?s?\b/i,
            /\bhiatus\b/i,
            /\bcomm?s?\s*(?:are\s+)?(?:full|unavailable)\b/i,
            /\bcommissions?\s*:\s*closed\b/i
        ] : [
            /\bcommissions?\s*(?:are\s+)?closed?\b/i,
            /\bnot\s+taking\s+commissions?\b/i,
            /\bcommissions?\s*(?:are\s+)?(?:full|unavailable)\b/i,
            /\bqueue\s*(?:is\s+)?(?:full|closed)\b/i,
            /\bno\s+comm?s?\b/i,
            /\bclosed\s+(?:for\s+)?comm?s?\b/i,
            /\bcommissions?\s*:\s*closed\b/i,
            /\bhiatus\b/i,
            /\bnot\s+accept(?:ing)?\s+comm?s?\b/i
        ];

        // For display names, we don't apply time weighting since they're current
        const timeWeight = isDisplayName ? 1.0 : this.calculateTimeWeight(timestamp);
        
        // Only consider silver bullets for recent content or display names
        if (!isDisplayName && timeWeight < 0.5) return null;

        // For display names, we want to be more aggressive with matching
        const baseConfidence = isDisplayName ? 0.95 : 0.9;

        debugLog(`[AI Analyzer] Checking silver bullets in ${isDisplayName ? 'display name' : 'text'}:`, text);

        // Check for both open and closed matches to find the most specific one
        let openMatch = null;
        let closedMatch = null;

        // Find all open matches
        for (const phrase of openPhrases) {
            const match = text.match(phrase);
            if (match) {
                openMatch = match;
                debugLog('[AI Analyzer] Found OPEN silver bullet candidate:', match[0]);
                break; // Use first match
            }
        }

        // Find all closed matches
        for (const phrase of closedPhrases) {
            const match = text.match(phrase);
            if (match) {
                closedMatch = match;
                debugLog('[AI Analyzer] Found CLOSED silver bullet candidate:', match[0]);
                break; // Use first match
            }
        }

        // If both open and closed matches exist, prioritize the more specific/stronger signal
        if (openMatch && closedMatch) {
            debugLog('[AI Analyzer] Found both open and closed candidates, prioritizing closed (more decisive)');
            // "Closed" signals are generally more decisive than "open" signals
            // because artists usually announce when they're closed more explicitly
            return {
                type: 'closed',
                confidence: baseConfidence * timeWeight,
                trigger: closedMatch[0]
            };
        } else if (closedMatch) {
            debugLog('[AI Analyzer] Found CLOSED silver bullet:', closedMatch[0]);
            return {
                type: 'closed',
                confidence: baseConfidence * timeWeight,
                trigger: closedMatch[0]
            };
        } else if (openMatch) {
            debugLog('[AI Analyzer] Found OPEN silver bullet:', openMatch[0]);
            return {
                type: 'open',
                confidence: baseConfidence * timeWeight,
                trigger: openMatch[0]
            };
        }

        debugLog('[AI Analyzer] No silver bullets found in:', text);
        return null;
    }

    // Convert label to score points
    getLabelScore(result) {
        switch(result.commissionStatus) {
            case 'open': return result.confidence;
            case 'closed': return -result.confidence;
            default: return 0;
        }
    }

    // Calculate gallery item score
    async analyzeGalleryItem(item) {
        debugLog('[AIAnalyzer] Starting gallery item analysis:', item);

        const itemText = `${item.title || ''} ${item.description || ''} ${item.tags || ''}`.trim();
        if (!itemText) {
            debugLog('[AIAnalyzer] No text content in gallery item, skipping');
            return null;
        }

        // Check for silver bullets first
        const timestamp = item.date ? new Date(item.date).getTime() : Date.now();
        const silverBullet = this.checkSilverBullets(itemText, timestamp);
        if (silverBullet) {
            debugLog('[AIAnalyzer] Found silver bullet in gallery item:', silverBullet);
            return {
                score: silverBullet.type === 'open' ? silverBullet.confidence : -silverBullet.confidence,
                confidence: silverBullet.confidence,
                commissionStatus: silverBullet.type,
                isSilverBullet: true,
                trigger: silverBullet.trigger,
                url: item.url || '' // Preserve URL for silver bullet matches
            };
        }

        // Regular analysis
        const result = await this.analyze(itemText);
        debugLog('[AIAnalyzer] Gallery item analysis result:', result);
        
        return {
            score: this.getLabelScore(result),
            confidence: result.confidence,
            commissionStatus: result.commissionStatus,
            text: itemText, // Include the analyzed text for debugging
            url: item.url || '' // Preserve URL for regular matches
        };
    }

    // Calculate post score (for Bluesky posts)
    async analyzePost(post) {
        debugLog('[AIAnalyzer] Starting post analysis:', post);

        const postText = (post.text || '').trim();
        if (!postText) {
            debugLog('[AIAnalyzer] No text content in post, skipping');
            return null;
        }

        // Check for silver bullets first
        const timestamp = post.date ? new Date(post.date).getTime() : Date.now();
        const silverBullet = this.checkSilverBullets(postText, timestamp);
        if (silverBullet) {
            debugLog('[AIAnalyzer] Found silver bullet in post:', silverBullet);
            return {
                score: silverBullet.type === 'open' ? silverBullet.confidence : -silverBullet.confidence,
                confidence: silverBullet.confidence,
                commissionStatus: silverBullet.type,
                isSilverBullet: true,
                trigger: silverBullet.trigger,
                url: post.url || '',
                isPinned: post.isPinned || false
            };
        }

        // Regular analysis
        const result = await this.analyze(postText);
        debugLog('[AIAnalyzer] Post analysis result:', result);
        
        return {
            score: this.getLabelScore(result),
            confidence: result.confidence,
            commissionStatus: result.commissionStatus,
            text: postText,
            url: post.url || '',
            isPinned: post.isPinned || false
        };
    }

    // Analyze individual components and combine scores
    async analyzeComponents(components) {
        if (!this.session || !this.tokenizer) {
            throw new Error('Model not initialized. Call initialize() before analyzing.');
        }

        debugLog('[AIAnalyzer] Starting component analysis:', components);

        const results = {
            displayName: null,
            bio: null,
            commissionStatus: null,
            journal: null,
            gallery: null,
            posts: null
        };

        let totalWeight = 0;
        let weightedScore = 0;
        let highestConfidence = 0;
        let hasSilverBullet = false;

        // Collect all texts that need AI analysis (non-silver bullet)
        const textsToAnalyze = [];
        const textMeta = [];

        // Process display name
        if (components.displayName) {
            debugLog('[AIAnalyzer] Processing display name component');
            const silverBullet = this.checkSilverBullets(components.displayName, Date.now(), true);
            if (silverBullet) {
                results.displayName = {
                    score: silverBullet.type === 'open' ? silverBullet.confidence : -silverBullet.confidence,
                    confidence: silverBullet.confidence,
                    commissionStatus: silverBullet.type,
                    isSilverBullet: true,
                    trigger: silverBullet.trigger
                };
                hasSilverBullet = true;
            } else {
                textsToAnalyze.push(components.displayName);
                textMeta.push({ type: 'displayName', weight: 0.3 });
            }
        }

        // Process bio
        if (components.bio) {
            debugLog('[AIAnalyzer] Processing bio component');
            const silverBullet = this.checkSilverBullets(components.bio, Date.now());
            if (silverBullet) {
                results.bio = {
                    score: silverBullet.type === 'open' ? silverBullet.confidence : -silverBullet.confidence,
                    confidence: silverBullet.confidence,
                    commissionStatus: silverBullet.type,
                    isSilverBullet: true,
                    trigger: silverBullet.trigger
                };
                hasSilverBullet = true;
            } else {
                textsToAnalyze.push(components.bio);
                textMeta.push({ type: 'bio', weight: 0.4 });
            }
        }

        // Process commission status
        if (components.commissionStatus) {
            debugLog('[AIAnalyzer] Processing commission status component');
            textsToAnalyze.push(components.commissionStatus);
            textMeta.push({ type: 'commissionStatus', weight: 0.2 });
        }

        // Process journal
        if (components.journal?.text) {
            debugLog('[AIAnalyzer] Processing journal component');
            const timeWeight = this.calculateTimeWeight(components.journal.date);
            
            const silverBullet = this.checkSilverBullets(components.journal.text, components.journal.date);
            if (silverBullet) {
                results.journal = {
                    score: silverBullet.type === 'open' ? silverBullet.confidence : -silverBullet.confidence,
                    confidence: silverBullet.confidence,
                    commissionStatus: silverBullet.type,
                    isSilverBullet: true,
                    isPinned: components.journal.isPinned || false,
                    trigger: silverBullet.trigger
                };
                hasSilverBullet = true;
            } else {
                textsToAnalyze.push(components.journal.text);
                textMeta.push({ 
                    type: 'journal', 
                    weight: 0.2 * timeWeight,
                    isPinned: components.journal.isPinned || false
                });
            }
        }

        // Process gallery items in batch
        if (components.galleryItems?.length > 0) {
            debugLog('[AIAnalyzer] Processing gallery items');
            for (const item of components.galleryItems) {
                if (item.title) {
                    textsToAnalyze.push(item.title);
                    textMeta.push({ 
                        type: 'galleryItem', 
                        item: item,
                        timeWeight: this.calculateTimeWeight(new Date(item.date).getTime())
                    });
                }
            }
        }

        // Process posts in batch
        if (components.posts?.length > 0) {
            debugLog('[AIAnalyzer] Processing posts');
            for (const post of components.posts) {
                if (post.text) {
                    textsToAnalyze.push(post.text);
                    textMeta.push({ 
                        type: 'post', 
                        post: post,
                        timeWeight: this.calculateTimeWeight(new Date(post.date).getTime())
                    });
                }
            }
        }

        // Batch analyze all collected texts
        let batchResults = [];
        if (textsToAnalyze.length > 0) {
            debugLog(`[AIAnalyzer] Batch analyzing ${textsToAnalyze.length} texts`);
            batchResults = await this.batchAnalyze(textsToAnalyze);
        }

        // Process batch results
        let batchIndex = 0;
        for (const meta of textMeta) {
            const result = batchResults[batchIndex++];
            
            switch (meta.type) {
                case 'displayName': {
                    results.displayName = {
                        score: this.getLabelScore(result),
                        confidence: result.confidence,
                        commissionStatus: result.commissionStatus
                    };
                    const displayNameWeight = 0.3;
                    weightedScore += results.displayName.score * displayNameWeight;
                    totalWeight += displayNameWeight;
                    highestConfidence = Math.max(highestConfidence, results.displayName.confidence);
                    break;
                }

                case 'bio': {
                    results.bio = {
                        score: this.getLabelScore(result),
                        confidence: result.confidence,
                        commissionStatus: result.commissionStatus
                    };
                    const bioWeight = 0.4;
                    weightedScore += results.bio.score * bioWeight;
                    totalWeight += bioWeight;
                    highestConfidence = Math.max(highestConfidence, results.bio.confidence);
                    break;
                }

                case 'commissionStatus': {
                    results.commissionStatus = {
                        score: this.getLabelScore(result),
                        confidence: result.confidence,
                        commissionStatus: result.commissionStatus
                    };
                    const statusWeight = 0.2;
                    weightedScore += results.commissionStatus.score * statusWeight;
                    totalWeight += statusWeight;
                    highestConfidence = Math.max(highestConfidence, results.commissionStatus.confidence);
                    break;
                }

                case 'journal': {
                    results.journal = {
                        score: this.getLabelScore(result),
                        confidence: result.confidence,
                        commissionStatus: result.commissionStatus,
                        isPinned: meta.isPinned
                    };
                    weightedScore += results.journal.score * meta.weight;
                    totalWeight += meta.weight;
                    highestConfidence = Math.max(highestConfidence, results.journal.confidence);
                    break;
                }
            }
        }

        // Process gallery and post results after main components
        if (components.galleryItems?.length > 0) {
            const galleryResults = [];
            let galleryScore = 0;
            let galleryConfidence = 0;
            let recentItemCount = 0;
            let galleryStatus = 'unclear';

            // Find gallery items in batch results
            for (let i = 0; i < textMeta.length; i++) {
                const meta = textMeta[i];
                if (meta.type === 'galleryItem') {
                    const result = batchResults[i];
                    galleryResults.push({
                        title: meta.item.title || '',
                        url: meta.item.url || '',
                        date: meta.item.date || '',
                        score: this.getLabelScore(result),
                        confidence: result.confidence,
                        commissionStatus: result.commissionStatus,
                        timeWeight: meta.timeWeight
                    });
                    
                    galleryScore += this.getLabelScore(result) * meta.timeWeight;
                    galleryConfidence = Math.max(galleryConfidence, result.confidence);
                    if (meta.timeWeight > 0.5) recentItemCount++;
                }
            }

            if (galleryResults.length > 0) {
                galleryScore /= galleryResults.length;
                
                if (galleryScore > 0.2) {
                    galleryStatus = 'open';
                } else if (galleryScore < -0.2) {
                    galleryStatus = 'closed';
                }

                results.gallery = {
                    items: galleryResults,
                    score: galleryScore,
                    confidence: galleryConfidence,
                    commissionStatus: galleryStatus
                };

                const galleryWeight = recentItemCount > 0 ? 0.15 : 0.1;
                weightedScore += galleryScore * galleryWeight;
                totalWeight += galleryWeight;
                highestConfidence = Math.max(highestConfidence, galleryConfidence);
            }
        }

        // Process posts results
        if (components.posts?.length > 0) {
            const postResults = [];
            let postsScore = 0;
            let postsConfidence = 0;
            let recentPostCount = 0;
            let postsStatus = 'unclear';
            let totalPostWeight = 0;
            let hasPinnedPost = false;

            // Find post items in batch results
            for (let i = 0; i < textMeta.length; i++) {
                const meta = textMeta[i];
                if (meta.type === 'post') {
                    const result = batchResults[i];
                    
                    let postWeight = meta.timeWeight;
                    if (meta.post.isPinned && result.commissionStatus !== 'unclear') {
                        postWeight *= 3;
                        hasPinnedPost = true;
                    }
                    
                    postResults.push({
                        text: meta.post.text || '',
                        url: meta.post.url || '',
                        date: meta.post.date || '',
                        engagement: meta.post.engagement || {},
                        isPinned: meta.post.isPinned || false,
                        score: this.getLabelScore(result),
                        confidence: result.confidence,
                        commissionStatus: result.commissionStatus,
                        timeWeight: meta.timeWeight,
                        postWeight: postWeight
                    });
                    
                    postsScore += this.getLabelScore(result) * postWeight;
                    totalPostWeight += postWeight;
                    postsConfidence = Math.max(postsConfidence, result.confidence);
                    if (meta.timeWeight > 0.5) recentPostCount++;
                }
            }

            if (postResults.length > 0 && totalPostWeight > 0) {
                postsScore /= totalPostWeight;
                
                if (postsScore > 0.2) {
                    postsStatus = 'open';
                } else if (postsScore < -0.2) {
                    postsStatus = 'closed';
                }

                results.posts = {
                    items: postResults,
                    score: postsScore,
                    confidence: postsConfidence,
                    commissionStatus: postsStatus,
                    hasPinnedPost: hasPinnedPost
                };

                let postsWeight = recentPostCount > 0 ? 0.25 : 0.15;
                if (hasPinnedPost) postsWeight *= 1.5;
                
                weightedScore += postsScore * postsWeight;
                totalWeight += postsWeight;
                highestConfidence = Math.max(highestConfidence, postsConfidence);
            }
        }

        // Continue with final score calculation

        // Normalize final score to -1 to 1 range
        const normalizedScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

        // Calculate confidence with adjusted weights
        let confidence;
        let finalCommissionStatus;
        let silverBulletComponent = null;

        // If we have a silver bullet, it overrides other signals
        if (hasSilverBullet) {
            if (this.debugMode) {
                console.log('[AI Analyzer] Processing silver bullets with priority order...');
                console.log('[AI Analyzer] Results summary:', {
                    bio: results.bio ? {
                        isSilverBullet: results.bio.isSilverBullet,
                        status: results.bio.commissionStatus
                    } : 'null',
                    displayName: results.displayName ? {
                        isSilverBullet: results.displayName.isSilverBullet,
                        status: results.displayName.commissionStatus
                    } : 'null',
                    journal: results.journal ? {
                        isSilverBullet: results.journal.isSilverBullet,
                        status: results.journal.commissionStatus
                    } : 'null'
                });
            }

            // Find the silver bullet that determined the status with STRICT priority order:
            // 1. Bio (ABSOLUTE highest priority - most reliable indicator)
            // 2. Display name (second priority - current status)
            // 3. Journal (third priority - may be pinned/important)
            // 4. Gallery items (lower priority - may be older)
            // 5. Posts (lowest priority - may be older)
            
            // Check bio first (ABSOLUTE priority - bio silver bullets override everything)
            if (results.bio?.isSilverBullet) {
                silverBulletComponent = results.bio;
                silverBulletComponent.source = 'bio';
                if (this.debugMode) {
                    console.log('[AI Analyzer] Using bio silver bullet (highest priority):', silverBulletComponent);
                }
            }
            // Check display name second
            else if (results.displayName?.isSilverBullet) {
                silverBulletComponent = results.displayName;
                silverBulletComponent.source = 'displayName';
                if (this.debugMode) {
                    console.log('[AI Analyzer] Using display name silver bullet:', silverBulletComponent);
                }
            }
            // Check journal third
            else if (results.journal?.isSilverBullet) {
                silverBulletComponent = results.journal;
                silverBulletComponent.source = 'journal';
                if (this.debugMode) {
                    console.log('[AI Analyzer] Using journal silver bullet:', silverBulletComponent);
                }
            }
            // Check gallery items
            else if (results.gallery?.items) {
                for (const item of results.gallery.items) {
                    if (item.isSilverBullet) {
                        silverBulletComponent = {
                            commissionStatus: item.commissionStatus,
                            confidence: item.confidence,
                            trigger: item.trigger,
                            source: 'gallery'
                        };
                        if (this.debugMode) {
                            console.log('[AI Analyzer] Using gallery silver bullet:', silverBulletComponent);
                        }
                        break; // Use first silver bullet found in gallery
                    }
                }
            }
            // Check posts last
            else if (results.posts?.items) {
                for (const item of results.posts.items) {
                    if (item.isSilverBullet) {
                        silverBulletComponent = {
                            commissionStatus: item.commissionStatus,
                            confidence: item.confidence,
                            trigger: item.trigger,
                            source: 'posts'
                        };
                        if (this.debugMode) {
                            console.log('[AI Analyzer] Using posts silver bullet:', silverBulletComponent);
                        }
                        break; // Use first silver bullet found in posts
                    }
                }
            }
            
            if (silverBulletComponent) {
                finalCommissionStatus = silverBulletComponent.commissionStatus;
                confidence = silverBulletComponent.confidence;
                
                if (this.debugMode) {
                    console.log(`[AI Analyzer] FINAL: Using silver bullet from ${silverBulletComponent.source}:`, 
                        { status: finalCommissionStatus, confidence, trigger: silverBulletComponent.trigger, source: silverBulletComponent.source });
                }
            } else {
                // This should not happen if hasSilverBullet is true, but fallback just in case
                console.error('[AI Analyzer] ERROR: hasSilverBullet was true but no silver bullet component found!');
                console.error('[AI Analyzer] Results state:', results);
                finalCommissionStatus = normalizedScore > 0 ? 'open' : 'closed';
                confidence = Math.min(1, Math.max(0.8, highestConfidence));
            }
        } else {
            // No silver bullets - use weighted scoring
            confidence = Math.min(1, Math.max(0, 
                (Math.abs(normalizedScore) * 0.7) +
                (highestConfidence * 0.3)
            ));

            // Final determination based on adjusted thresholds
            if (normalizedScore > 0.15) {
                finalCommissionStatus = 'open';
            } else if (normalizedScore < -0.2) {
                finalCommissionStatus = 'closed';
            } else {
                finalCommissionStatus = 'unclear';
                // Lower confidence for unclear results
                confidence = Math.min(confidence, 0.7);
            }
        }

        // Extract triggers for the final result
        let finalTriggers = [];
        if (hasSilverBullet && silverBulletComponent && silverBulletComponent.trigger) {
            finalTriggers = [silverBulletComponent.trigger];
            if (this.debugMode) {
                console.log('[AI Analyzer] Using silver bullet trigger:', finalTriggers);
            }
        } else {
            // If no silver bullet, collect triggers from other analysis methods
            finalTriggers = this.findTriggerWords(
                `${components.displayName || ''} ${components.bio || ''}`, 
                finalCommissionStatus
            );
            if (this.debugMode) {
                console.log('[AI Analyzer] Using pattern-based triggers:', finalTriggers);
            }
        }

        const finalResult = {
            commissionStatus: finalCommissionStatus,
            confidence,
            components: results,
            score: normalizedScore,
            method: 'component-analysis',
            hasSilverBullet,
            triggers: finalTriggers
        };

        if (this.debugMode) {
            console.log('[AI Analyzer] ===== FINAL ANALYSIS RESULT =====');
            console.log('[AI Analyzer] Commission Status:', finalCommissionStatus);
            console.log('[AI Analyzer] Confidence:', confidence);
            console.log('[AI Analyzer] Has Silver Bullet:', hasSilverBullet);
            console.log('[AI Analyzer] Triggers:', finalTriggers);
            console.log('[AI Analyzer] Source:', silverBulletComponent?.source || 'weighted-analysis');
            console.log('[AI Analyzer] ================================');
        }

        debugLog('[AIAnalyzer] Final analysis result:', finalResult);
        return finalResult;
    }

    // Helper to get weighted score from a result
    getWeightedScore(result) {
        if (result.commissionStatus === 'open') return result.confidence;
        if (result.commissionStatus === 'closed') return -result.confidence;
        return 0; // Unclear results contribute 0
    }
} 