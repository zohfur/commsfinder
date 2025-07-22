// AI-powered text analyzer for commission detection
// This script contains the core AI logic and is designed to run inside a Web Worker.

import { pipeline, env, AutoTokenizer, AutoModelForCausalLM } from '@xenova/transformers';
import { debugLog } from './shared.js';

// Configure transformers.js environment for the extension
// These settings are safe to be set in the worker.
env.allowLocalModels = false; // We use a custom cache, not local models
env.useCustomCache = true;

// Since we are running in a Chrome extension, we must configure the transformers.js library
// to use the local paths to the onnxruntime-web worker files.
// The wasm proxy is disabled because it creates a worker from a blob, which violates
// the Content Security Policy of Manifest V3 extensions. The wasm compilation will
// happen in our own worker, which is fine.
env.backends.onnx.wasm = {
  // Enable multithreading with 4 threads (0 means use all available cores)
  numThreads: 1,
  // Disable proxy worker since it's not compatible with Chrome extension CSP
  proxy: false,
  // Set paths relative to the worker's location in /dist/utils/
  wasmPaths: '../onnxruntime-web/',

};

// The primary class for performing AI analysis.
export class AIAnalyzer {
    constructor(options = {}) {
        this.model = options.model || 'zohfur/distilbert-commissions-ONNX';
        this.quantization = options.quantization || 'quantized';
        this.modelName = null;
        this.modelConfig = null;
        this.modelTemperature = options.temperature || 1.0;
        this.debugMode = false;
        this.initialize();
    }

    async initialize(progressCallback = null) {
        try {
            // Get debug mode setting
            const { debugMode } = await chrome.storage.local.get('debugMode');
            this.debugMode = debugMode || false;

            if (this.debugMode) {
                console.log('[AIAnalyzer] Initializing...');
            }

            if (this.pipeline) {
                console.warn('[AI Analyzer] Model is already initialized.');
                return;
            }
            if (this.debugMode) {
                console.log(`[AI Analyzer] Initializing model: ${this.model}`);
            }
            try {
                if (this.isGenerativeModel(this.model)) {
                    // For generative models like Phi-3.5, use the specialized approach
                    if (this.debugMode) {
                        console.log('[AI Analyzer] Initializing generative model with AutoModelForCausalLM');
                        console.log('[AI Analyzer] Model name:', this.model);
                    }
                    
                    try {
                        // Initialize tokenizer and model separately for better control
                        if (this.debugMode) {
                            console.log('[AI Analyzer] Loading tokenizer...');
                        }
                        this.tokenizer = await AutoTokenizer.from_pretrained(this.model, {
                            progress_callback: progressCallback,
                        });
                        
                        if (this.debugMode) {
                            console.log('[AI Analyzer] Tokenizer loaded, loading model...');
                        }
                        this.generativeModel = await AutoModelForCausalLM.from_pretrained(this.model, {
                            dtype: "q4f16",
                            use_external_data_format: true,
                            progress_callback: progressCallback,
                        });
                        
                        // Create a custom pipeline wrapper
                        this.pipeline = {
                            tokenizer: this.tokenizer,
                            model: this.generativeModel,
                            type: 'generative'
                        };
                        
                        if (this.debugMode) {
                            console.log('[AI Analyzer] Generative model initialized successfully');
                        }
                    } catch (error) {
                        console.error('[AI Analyzer] Error initializing generative model:', error);
                        throw error;
                    }
                } else {
                    // For classification models, use the standard pipeline approach
                    const task = this.getTaskType();
                    
                    if (this.debugMode) {
                        console.log(`[AI Analyzer] Initializing classification model with task: ${task}`);
                    }
                    
                    this.pipeline = await pipeline(task, this.model, {
                        progress_callback: progressCallback,
                    });
                    
                    if (this.debugMode) {
                        console.log('[AI Analyzer] Classification model initialized successfully');
                    }
                }
                
                if (this.debugMode) {
                    console.log('[AI Analyzer] Model pipeline initialized successfully.');
                }
            } catch (error) {
                console.error('[AI Analyzer] Fatal error during model initialization:', error);
                throw error; // Re-throw to be caught by the worker's error handler
            }

            if (this.debugMode) {
                console.log('[AIAnalyzer] Initialization complete');
            }
        } catch (error) {
            console.error('Error initializing AI analyzer:', error);
            throw error;
        }
    }

    // Sets a new quantization and clears the existing pipeline
    setQuantization(quantizationType) {
        this.quantization = quantizationType;
        this.pipeline = null; // Clear existing pipeline
        this.tokenizer = null; // Clear tokenizer
        this.generativeModel = null; // Clear generative model
        if (this.debugMode) {
            console.log(`[AI Analyzer] Quantization changed to: ${this.quantization}`);
        }
    }

    // Determines the appropriate task type for the model
    getTaskType() {
        // Our custom commission detection model is a text-classification model
        return 'text-classification';
    }

    // Determines if this is a model that should use AutoModelForCausalLM
    isGenerativeModel() {
        // Our custom DistilBERT model is not a generative model
        return false;
    }

    async analyze(text, context = 'bio') {
        try {
            if (this.debugMode) {
                console.log('[AIAnalyzer] Analyzing text:', { text, context });
            }

            if (!this.pipeline) {
                throw new Error('Model not initialized. Call initialize() before analyzing.');
            }

            if (this.pipeline.type === 'generative' || this.isGenerativeModel(this.model)) {
                return await this.analyzeWithGeneration(text);
            } else {
                return await this.analyzeWithClassification(text);
            }
        } catch (error) {
            console.error('Analysis error:', error);
            throw error;
        }
    }

    // Analyze using text classification models
    async analyzeWithClassification(text) {
        const result = await this.pipeline(text);
        if (this.debugMode) {
            console.log('[AI Analyzer] Classification result:', result);
        }

        // Apply temperature scaling to all results if temperature > 1
        let scaledResults = result;
        if (this.temperature !== 1.0) {
            scaledResults = this.applyTemperatureScaling(result);
            if (this.debugMode) {
                console.log('[AI Analyzer] Temperature-scaled results:', scaledResults);
            }
        }

        // The custom model outputs three labels: open, closed, unclear
        const primaryResult = scaledResults[0];
        const label = primaryResult.label.toLowerCase();
        
        // Map the label to our result format
        let commissionStatus;
        
        if (label === 'open' || label === 'label_0') { // LABEL_0 might be open
            commissionStatus = 'open';
        } else if (label === 'closed' || label === 'label_1') { // LABEL_1 might be closed
            commissionStatus = 'closed';
        } else if (label === 'unclear' || label === 'label_2') { // LABEL_2 might be unclear
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
            allResults: scaledResults // Include all results for debugging
        };
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

        if (this.debugMode) {
            console.log(`[AI Analyzer] Checking silver bullets in ${isDisplayName ? 'display name' : 'text'}:`, text);
        }

        // Check for both open and closed matches to find the most specific one
        let openMatch = null;
        let closedMatch = null;

        // Find all open matches
        for (const phrase of openPhrases) {
            const match = text.match(phrase);
            if (match) {
                openMatch = match;
                if (this.debugMode) {
                    console.log('[AI Analyzer] Found OPEN silver bullet candidate:', match[0]);
                }
                break; // Use first match
            }
        }

        // Find all closed matches
        for (const phrase of closedPhrases) {
            const match = text.match(phrase);
            if (match) {
                closedMatch = match;
                if (this.debugMode) {
                    console.log('[AI Analyzer] Found CLOSED silver bullet candidate:', match[0]);
                }
                break; // Use first match
            }
        }

        // If both open and closed matches exist, prioritize the more specific/stronger signal
        if (openMatch && closedMatch) {
            if (this.debugMode) {
                console.log('[AI Analyzer] Found both open and closed candidates, prioritizing closed (more decisive)');
            }
            // "Closed" signals are generally more decisive than "open" signals
            // because artists usually announce when they're closed more explicitly
            return {
                type: 'closed',
                confidence: baseConfidence * timeWeight,
                trigger: closedMatch[0]
            };
        } else if (closedMatch) {
            if (this.debugMode) {
                console.log('[AI Analyzer] Found CLOSED silver bullet:', closedMatch[0]);
            }
            return {
                type: 'closed',
                confidence: baseConfidence * timeWeight,
                trigger: closedMatch[0]
            };
        } else if (openMatch) {
            if (this.debugMode) {
                console.log('[AI Analyzer] Found OPEN silver bullet:', openMatch[0]);
            }
            return {
                type: 'open',
                confidence: baseConfidence * timeWeight,
                trigger: openMatch[0]
            };
        }

        if (this.debugMode) {
            console.log('[AI Analyzer] No silver bullets found in:', text);
        }
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
        // console.log('[AIAnalyzer] Starting post analysis:', post);

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
        // console.log('[AIAnalyzer] Post analysis result:', result);
        
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
        if (!this.pipeline) {
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

        // Analyze display name (base weight: 0.3)
        if (components.displayName) {
            debugLog('[AIAnalyzer] Analyzing display name component');
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
                const displayNameResult = await this.analyze(components.displayName);
                results.displayName = {
                    score: this.getLabelScore(displayNameResult),
                    confidence: displayNameResult.confidence,
                    commissionStatus: displayNameResult.commissionStatus
                };
            }
            
            const displayNameWeight = results.displayName.isSilverBullet ? 0.4 : 0.3;
            weightedScore += results.displayName.score * displayNameWeight;
            totalWeight += displayNameWeight;
            highestConfidence = Math.max(highestConfidence, results.displayName.confidence);
            debugLog('[AIAnalyzer] Display name analysis result:', results.displayName);
        }

        // Analyze bio (increased base weight: 0.4)
        if (components.bio) {
            debugLog('[AIAnalyzer] Analyzing bio component');
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
                const bioResult = await this.analyze(components.bio);
                results.bio = {
                    score: this.getLabelScore(bioResult),
                    confidence: bioResult.confidence,
                    commissionStatus: bioResult.commissionStatus
                };
            }
            
            const bioWeight = results.bio.isSilverBullet ? 0.5 : 0.4;
            weightedScore += results.bio.score * bioWeight;
            totalWeight += bioWeight;
            highestConfidence = Math.max(highestConfidence, results.bio.confidence);
            debugLog('[AIAnalyzer] Bio analysis result:', results.bio);
        }

        // Analyze commission status (base weight: 0.2)
        if (components.commissionStatus) {
            console.log('[AIAnalyzer] Analyzing commission status component');
            const statusResult = await this.analyze(components.commissionStatus);
            results.commissionStatus = {
                score: this.getLabelScore(statusResult),
                confidence: statusResult.confidence,
                commissionStatus: statusResult.commissionStatus
            };
            
            const statusWeight = 0.2;
            weightedScore += results.commissionStatus.score * statusWeight;
            totalWeight += statusWeight;
            highestConfidence = Math.max(highestConfidence, results.commissionStatus.confidence);
            debugLog('[AIAnalyzer] Commission status analysis result:', results.commissionStatus);
        }

        // Analyze journal (weight: 0.2 if recent, 0.1 if old)
        if (components.journal?.text) {
            console.log('[AIAnalyzer] Analyzing journal component');
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
                const journalResult = await this.analyze(components.journal.text);
                results.journal = {
                    score: this.getLabelScore(journalResult),
                    confidence: journalResult.confidence,
                    commissionStatus: journalResult.commissionStatus,
                    isPinned: components.journal.isPinned || false
                };
            }
            
            const journalWeight = (results.journal.isSilverBullet ? 0.3 : 0.2) * timeWeight;
            weightedScore += results.journal.score * journalWeight;
            totalWeight += journalWeight;
            highestConfidence = Math.max(highestConfidence, results.journal.confidence);
            debugLog('[AIAnalyzer] Journal analysis result:', results.journal);
        }

        // Analyze gallery items (reduced weight for FurAffinity)
        if (components.galleryItems?.length > 0) {
            console.log('[AIAnalyzer] Analyzing gallery items:', components.galleryItems);
            const galleryResults = [];
            let galleryScore = 0;
            let galleryConfidence = 0;
            let recentItemCount = 0;
            let galleryStatus = 'unclear';

            // Analyze each gallery item
            for (const item of components.galleryItems) {
                const itemResult = await this.analyzeGalleryItem(item);
                debugLog('[AIAnalyzer] Gallery item analysis result:', itemResult);
                if (itemResult) {
                    const timeWeight = this.calculateTimeWeight(new Date(item.date).getTime());
                    galleryResults.push({
                        title: item.title || '',
                        url: item.url || '',
                        date: item.date || '',
                        ...itemResult,
                        timeWeight
                    });
                    
                    // Weight more recent items higher
                    galleryScore += itemResult.score * timeWeight;
                    galleryConfidence = Math.max(galleryConfidence, itemResult.confidence);
                    if (timeWeight > 0.5) recentItemCount++;
                }
            }

            if (galleryResults.length > 0) {
                // Normalize gallery score
                galleryScore /= galleryResults.length;
                
                // Determine overall gallery status
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

                // Gallery weight depends on recency of items
                const galleryWeight = recentItemCount > 0 ? 0.15 : 0.1;
                weightedScore += galleryScore * galleryWeight;
                totalWeight += galleryWeight;
                highestConfidence = Math.max(highestConfidence, galleryConfidence);
                debugLog('[AIAnalyzer] Gallery analysis complete:', results.gallery);
            }
        }

        // Analyze posts (reduced weight for Bluesky)
        if (components.posts?.length > 0) {
            debugLog('[AIAnalyzer] Analyzing posts:', components.posts);
            const postResults = [];
            let postsScore = 0;
            let postsConfidence = 0;
            let recentPostCount = 0;
            let postsStatus = 'unclear';
            let totalPostWeight = 0; // Track total weight for proper normalization
            let hasPinnedPost = false;

            // Analyze each post
            for (const post of components.posts) {
                const postResult = await this.analyzePost(post);
                // console.log('[AIAnalyzer] Post analysis result:', postResult);
                if (postResult) {
                    const timeWeight = this.calculateTimeWeight(new Date(post.date).getTime());
                    
                    // Apply 3x weight for pinned posts (but only for open/closed, not unclear)
                    let postWeight = timeWeight;
                    if (post.isPinned && postResult.commissionStatus !== 'unclear') {
                        postWeight *= 3;
                        hasPinnedPost = true;
                        debugLog('[AIAnalyzer] Applying 3x weight to pinned post with status:', postResult.commissionStatus);
                    }
                    
                    postResults.push({
                        text: post.text || '',
                        url: post.url || '',
                        date: post.date || '',
                        engagement: post.engagement || {},
                        isPinned: post.isPinned || false,
                        ...postResult,
                        timeWeight,
                        effectiveWeight: postWeight
                    });
                    
                    // Weight posts based on their effective weight
                    postsScore += postResult.score * postWeight;
                    totalPostWeight += postWeight;
                    postsConfidence = Math.max(postsConfidence, postResult.confidence);
                    if (timeWeight > 0.5) recentPostCount++;
                }
            }

            if (postResults.length > 0) {
                // Normalize posts score based on total weight
                postsScore = totalPostWeight > 0 ? postsScore / totalPostWeight : 0;
                
                // Determine overall posts status
                if (postsScore > 0.2) {
                    postsStatus = 'open';
                } else if (postsScore < -0.2) {
                    postsStatus = 'closed';
                }

                results.posts = {
                    items: postResults,
                    score: postsScore,
                    confidence: postsConfidence,
                    commissionStatus: postsStatus
                };

                // Posts weight depends on recency and whether there's a pinned post
                const basePostsWeight = recentPostCount > 0 ? 0.15 : 0.1;
                const postsWeight = hasPinnedPost ? basePostsWeight * 1.5 : basePostsWeight; // Increase overall posts weight if there's a pinned post
                weightedScore += postsScore * postsWeight;
                totalWeight += postsWeight;
                highestConfidence = Math.max(highestConfidence, postsConfidence);
                // console.log('[AIAnalyzer] Posts analysis complete:', results.posts);
            }
        } else {
            debugLog('[AIAnalyzer] No posts to analyze');
        }

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