// Custom tokenizer for DistilBERT using tokenizer.json from HuggingFace
// This replaces the transformers.js tokenizer functionality

import { debugLog } from './shared.js';

export class DistilBertTokenizer {
    constructor() {
        this.tokenizer = null;
        this.vocab = null;
        this.merges = null;
        this.specialTokens = null;
        this.maxLength = 512; // DistilBERT max sequence length
    }

    async initialize(modelName = 'zohfur/distilbert-commissions-ONNX') {
        try {
            debugLog('[Tokenizer] Initializing DistilBERT tokenizer...');
            
            // Download tokenizer files
            const tokenizerUrl = `https://huggingface.co/${modelName}/raw/main/tokenizer.json`;
            const tokenizerConfigUrl = `https://huggingface.co/${modelName}/raw/main/tokenizer_config.json`;
            const specialTokensUrl = `https://huggingface.co/${modelName}/raw/main/special_tokens_map.json`;

            const [tokenizerResponse, configResponse, specialTokensResponse] = await Promise.all([
                fetch(tokenizerUrl),
                fetch(tokenizerConfigUrl),
                fetch(specialTokensUrl)
            ]);

            if (!tokenizerResponse.ok) {
                throw new Error(`Failed to fetch tokenizer.json: ${tokenizerResponse.status}`);
            }

            const tokenizerData = await tokenizerResponse.json();
            const configData = configResponse.ok ? await configResponse.json() : {};
            const specialTokensData = specialTokensResponse.ok ? await specialTokensResponse.json() : {};

            this.tokenizer = tokenizerData;
            this.vocab = tokenizerData.model.vocab;
            this.merges = tokenizerData.model.merges || [];
            this.specialTokens = {
                cls: '[CLS]',
                sep: '[SEP]',
                pad: '[PAD]',
                unk: '[UNK]',
                mask: '[MASK]',
                ...specialTokensData
            };

            // Get special token IDs
            this.specialTokenIds = {
                cls: this.vocab[this.specialTokens.cls] || 101,
                sep: this.vocab[this.specialTokens.sep] || 102,
                pad: this.vocab[this.specialTokens.pad] || 0,
                unk: this.vocab[this.specialTokens.unk] || 100,
                mask: this.vocab[this.specialTokens.mask] || 103
            };

            debugLog('[Tokenizer] Tokenizer initialized successfully');
            debugLog('[Tokenizer] Vocab size:', Object.keys(this.vocab).length);
        } catch (error) {
            console.error('[Tokenizer] Failed to initialize:', error);
            throw error;
        }
    }

    // Basic text preprocessing
    preprocessText(text) {
        // Basic cleaning similar to BERT preprocessing
        return text
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Tokenize text into subword tokens
    tokenize(text) {
        const preprocessed = this.preprocessText(text);
        const tokens = [];
        
        // Split by whitespace first
        const words = preprocessed.split(/\s+/);
        
        for (const word of words) {
            if (word.length === 0) continue;
            
            // Check if the word is in vocab as-is
            if (Object.prototype.hasOwnProperty.call(this.vocab, word)) {
                tokens.push(word);
                continue;
            }
            
            // Try wordpiece tokenization
            const wordTokens = this.tokenizeWord(word);
            tokens.push(...wordTokens);
        }
        
        return tokens;
    }

    // Tokenize a single word using WordPiece algorithm
    tokenizeWord(word) {
        if (Object.prototype.hasOwnProperty.call(this.vocab, word)) {
            return [word];
        }

        const tokens = [];
        let start = 0;
        
        while (start < word.length) {
            let end = word.length;
            let foundToken = null;
            
            // Find the longest subword that exists in vocab
            while (start < end) {
                let substr = word.slice(start, end);
                if (start > 0) {
                    substr = '##' + substr; // WordPiece continuation marker
                }
                
                if (Object.prototype.hasOwnProperty.call(this.vocab, substr)) {
                    foundToken = substr;
                    break;
                }
                end--;
            }
            
            if (foundToken) {
                tokens.push(foundToken);
                start = end;
            } else {
                // Can't tokenize this character, use UNK
                tokens.push(this.specialTokens.unk);
                start++;
            }
        }
        
        return tokens;
    }

    // Convert tokens to IDs
    convertTokensToIds(tokens) {
        return tokens.map(token => this.vocab[token] || this.specialTokenIds.unk);
    }

    // Encode text to input format expected by DistilBERT
    encode(text, options = {}) {
        const {
            maxLength = this.maxLength,
            padding = true,
            truncation = true,
            addSpecialTokens = true
        } = options;

        let tokens = this.tokenize(text);
        
        // Add special tokens
        if (addSpecialTokens) {
            tokens = [this.specialTokens.cls, ...tokens, this.specialTokens.sep];
        }

        // Truncate if necessary
        if (truncation && tokens.length > maxLength) {
            if (addSpecialTokens) {
                // Keep [CLS] and [SEP], truncate middle
                tokens = [
                    tokens[0], // [CLS]
                    ...tokens.slice(1, maxLength - 1), // middle tokens
                    this.specialTokens.sep // [SEP]
                ];
            } else {
                tokens = tokens.slice(0, maxLength);
            }
        }

        // Convert to IDs
        let inputIds = this.convertTokensToIds(tokens);
        
        // Create attention mask (1 for real tokens, 0 for padding)
        let attentionMask = new Array(inputIds.length).fill(1);

        // Pad if necessary
        if (padding && inputIds.length < maxLength) {
            const padLength = maxLength - inputIds.length;
            inputIds = [...inputIds, ...new Array(padLength).fill(this.specialTokenIds.pad)];
            attentionMask = [...attentionMask, ...new Array(padLength).fill(0)];
        }

        return {
            input_ids: inputIds,
            attention_mask: attentionMask,
            token_type_ids: new Array(inputIds.length).fill(0) // All zeros for single sentence
        };
    }

    // Batch encode multiple texts
    batchEncode(texts, options = {}) {
        const encoded = texts.map(text => this.encode(text, options));
        
        // Convert to format expected by ONNX Runtime
        const batchSize = encoded.length;
        const seqLength = encoded[0].input_ids.length;
        
        const inputIds = new Array(batchSize);
        const attentionMask = new Array(batchSize);
        const tokenTypeIds = new Array(batchSize);
        
        for (let i = 0; i < batchSize; i++) {
            inputIds[i] = encoded[i].input_ids;
            attentionMask[i] = encoded[i].attention_mask;
            tokenTypeIds[i] = encoded[i].token_type_ids;
        }
        
        return {
            input_ids: inputIds,
            attention_mask: attentionMask,
            token_type_ids: tokenTypeIds
        };
    }

    // Decode token IDs back to text (for debugging)
    decode(tokenIds, skipSpecialTokens = true) {
        // Create reverse vocab lookup
        const idToToken = {};
        for (const [token, id] of Object.entries(this.vocab)) {
            idToToken[id] = token;
        }
        
        const tokens = tokenIds.map(id => idToToken[id] || this.specialTokens.unk);
        
        if (skipSpecialTokens) {
            const specialTokensList = Object.values(this.specialTokens);
            return tokens
                .filter(token => !specialTokensList.includes(token))
                .join(' ')
                .replace(/##/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }
        
        return tokens.join(' ');
    }
}