const fs = require('fs');
const path = require('path');

const { resolveOnnxRuntimeWebDist } = require('../webpack.onnx-assets');

describe('ONNX runtime extension assets', () => {
  test('copies the ONNX runtime bundled with transformers.js', () => {
    const distPath = resolveOnnxRuntimeWebDist();
    const packagePath = path.join(path.dirname(distPath), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    expect(packageJson.name).toBe('onnxruntime-web');
    expect(packageJson.version).toBe('1.14.0');
    expect(distPath).toContain(path.join('@xenova', 'transformers', 'node_modules'));
    expect(fs.existsSync(path.join(distPath, 'ort-wasm-simd-threaded.wasm'))).toBe(true);
  });

  test('keeps extension inference on the non-threaded WASM backend', () => {
    const analyzerSource = fs.readFileSync(
      path.join(__dirname, '..', 'utils', 'ai-analyzer.js'),
      'utf8'
    );

    expect(analyzerSource).toContain('numThreads: 1');
    expect(analyzerSource).not.toContain('navigator.hardwareConcurrency ? Math.min');
  });
});
