const path = require('path');

function resolveOnnxRuntimeWebDist() {
  return path.join(
    path.dirname(require.resolve('@xenova/transformers/node_modules/onnxruntime-web/package.json')),
    'dist'
  );
}

module.exports = {
  resolveOnnxRuntimeWebDist,
};
