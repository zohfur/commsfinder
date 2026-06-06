const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const ExtensionZipPlugin = require('./webpack.extension-zip-plugin');
const fs = require('fs');
const { resolveOnnxRuntimeWebDist } = require('./webpack.onnx-assets');

// Clean dist folder before building
const distPath = path.resolve(__dirname, 'dist/chrome');
if (fs.existsSync(distPath)) {
  fs.rmSync(distPath, { recursive: true, force: true });
}

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: {
    background: './background.js',
    'content/twitter': './content/twitter.js',
    'content/bluesky': './content/bluesky.js',
    'content/furaffinity': './content/furaffinity.js',
    'popup/popup': './popup/popup.js',
    'utils/ai-worker': './utils/ai-worker.js'
    // Don't include benchmark.js in the entry points
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist/chrome'),
    publicPath: '/',
  },
  optimization: {
    minimize: false,
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'icons', to: 'icons' },
        { from: 'logos', to: 'logos' },
        { from: 'fonts', to: 'fonts' },
        { from: 'popup', to: 'popup' },
        { from: 'e621-embeddings', to: 'e621-embeddings' },
        { from: 'manifest.chrome.json', to: 'manifest.json' },
        { from: resolveOnnxRuntimeWebDist(), to: 'onnxruntime-web',
          globOptions: {
            ignore: ['**/ort.all.js', '**/ort.all.js.map','**/ort.all.mjs','**/ort.all.mjs.map']
          }
         },
        {
          from: 'benchmark.js',
          to: 'benchmark.js',
          noErrorOnMissing: true
        },
        { from: 'motd.json', to: 'motd.json' },
      ],
    }),
    new ESLintPlugin({
      files: '**/*.js',
      fix: true,
    }),
    new ExtensionZipPlugin({
      zipPath: path.resolve(__dirname, 'dist/chrome.zip'),
    }),
  ],
  resolve: {
    extensions: ['.js'],
    fallback: {
      fs: false,
      path: false,
      url: false,
    },
  },
  target: 'web',
  experiments: {
    topLevelAwait: true,
  },
}; 
