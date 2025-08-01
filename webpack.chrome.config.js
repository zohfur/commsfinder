const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const fs = require('fs');

// Clean dist folder before building
const distPath = path.resolve(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  fs.rmSync(distPath, { recursive: true, force: true });
}

// Base configuration shared between web and worker builds
const baseConfig = {
  mode: 'development',
  devtool: 'source-map',
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
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
  resolve: {
    extensions: ['.js'],
    fallback: {
      fs: false,
      path: false,
      url: false,
    },
  },
  experiments: {
    topLevelAwait: true,
  },
};

// Configuration for service worker scripts (background and ai-worker)
const workerConfig = {
  ...baseConfig,
  entry: {
    background: './background.js',
    'utils/ai-worker': './utils/ai-worker.js',
  },
  target: 'webworker',
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'icons', to: 'icons' },
        { from: 'logos', to: 'logos' },
        { from: 'popup', to: 'popup' },
        { from: 'manifest.chrome.json', to: 'manifest.json' },
        { from: 'offscreen.html', to: 'offscreen.html' },
        { from: 'offscreen.js', to: 'offscreen.js' },
        { from: 'node_modules/onnxruntime-web/dist', to: 'onnxruntime-web' },
        {
          from: 'benchmark.js',
          to: 'benchmark.js',
          noErrorOnMissing: true
        },
      ],
    }),
    new ESLintPlugin({
      files: '**/*.js',
      fix: true,
    }),
  ],
};

// Configuration for web scripts (content scripts and popup)
const webConfig = {
  ...baseConfig,
  entry: {
    'content/twitter': './content/twitter.js',
    'content/bluesky': './content/bluesky.js',
    'content/furaffinity': './content/furaffinity.js',
    'popup/popup': './popup/popup.js',
  },
  target: 'web',
  plugins: [
    new ESLintPlugin({
      files: '**/*.js',
      fix: true,
    }),
  ],
};

module.exports = [workerConfig, webConfig]; 