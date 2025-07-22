# Split ONNX Files Support

This document explains how the CommsFinder extension handles ONNX models with split files (`.onnx` + `.onnx_data`).

## Background

According to the [Microsoft ONNX.js documentation](https://github.com/microsoft/onnxjs), larger ONNX models often use a split file format to improve loading performance and reduce memory usage:

- **`.onnx` file**: Contains the model structure, graph definition, and metadata
- **`.onnx_data` file**: Contains the actual model weights/parameters

This split is especially common with quantized models (like `model_q4f16.onnx`) where the weights are compressed.

## Supported Models

The extension now supports both single-file and split-file models:

### Single File Models:
- `Xenova/distilbert-base-uncased-finetuned-sst-2-english` - Uses `model_quantized.onnx`

### Split File Models:
- `onnx-community/TinyMistral-248M-Chat-v4-ONNX` - Uses `model_q4f16.onnx` + `model_q4f16.onnx_data`
- `onnx-community/Qwen3-0.6B-ONNX` - Uses `model_q4f16.onnx` + `model_q4f16.onnx_data`
- `onnx-community/gemma-3-1b-it-ONNX-GQA` - Uses `model_q4f16.onnx` + `model_q4f16.onnx_data`
- `onnx-community/Llama-3.2-1B-Instruct` - Uses `model_q4f16.onnx` + `model_q4f16.onnx_data`
- `onnx-community/Phi-3.5-mini-instruct-onnx-web` - Uses `model_q4f16.onnx` + `model_q4f16.onnx_data`

## Implementation Details

### Model Manager
- `modelUsesSplitFiles()` - Detects if a model uses split files
- `getMainOnnxFile()` - Gets the path to the main ONNX file
- `validateModelFiles()` - Validates all files are accessible on Hugging Face

### Download Process
- Both files are downloaded and cached separately
- Progress reporting distinguishes between "model file" and "model weights"
- File sizes are logged for debugging (especially useful for large `.onnx_data` files)

### Caching
- Each file is cached independently using the full Hugging Face URL as the cache key
- Cache validation checks for both files before considering a model "cached"

## Benefits

1. **Improved Loading**: Model structure loads first, then weights stream in
2. **Memory Efficiency**: Reduces peak memory usage during model initialization
3. **Better UX**: Users see progress for large model weight downloads
4. **Debugging**: Clear distinction between model structure and weight files

## Usage

The split file handling is transparent to the user. When they select a model in the popup:

1. Extension checks if both files are cached
2. If not cached, downloads both files with appropriate progress messages
3. Transformers.js automatically handles the split format when loading the model

## File Size Examples

Based on typical Hugging Face models:
- TinyMistral 248M: ~350MB total (~50MB .onnx + ~300MB .onnx_data)
- Qwen 3 0.6B: ~700MB total (~100MB .onnx + ~600MB .onnx_data)
- Gemma 3 1B: ~1.2GB total (~150MB .onnx + ~1GB .onnx_data)
- Llama 3.2 1B: ~1.2GB total (~150MB .onnx + ~1GB .onnx_data)
- Phi-3.5-mini 3.8B: ~4.2GB total (~200MB .onnx + ~4GB .onnx_data) 