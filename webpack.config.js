const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: {
    background: './background.js',
    'content/twitter': './content/twitter.js',
    'content/bluesky': './content/bluesky.js',
    'content/furaffinity': './content/furaffinity.js',
    'popup/popup': './popup/popup.js',
    'utils/ai-worker': './utils/ai-worker.js',
    demo: './demo.js',
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
        { from: 'demo.html', to: 'demo.html' },
        { from: 'demo.css', to: 'demo.css' },
        { from: 'icons', to: 'icons' },
        { from: 'logos', to: 'logos' },
        { from: 'popup', to: 'popup' },
        { from: 'manifest.json', to: 'manifest.json' },
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