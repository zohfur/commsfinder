const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const fs = require('fs');

// Clean dist folder before building
const distPath = path.resolve(__dirname, 'dist');
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
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/', // Changed from /dist/ to / for correct dynamic imports
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
        { from: 'popup', to: 'popup' },
        { from: 'manifest.firefox.json', to: 'manifest.json' },
        { from: 'node_modules/onnxruntime-web/dist', to: 'onnxruntime-web',
          globOptions: {
            ignore: ['**/ort.all.js', '**/ort.all.js.map','**/ort.all.mjs','**/ort.all.mjs.map']
          }
         },
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