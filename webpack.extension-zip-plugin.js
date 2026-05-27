const path = require('path');
const fs = require('fs');
const archiver = require('archiver');

/**
 * After webpack emits, zip the output directory to dist/{chrome|firefox}.zip
 * (extension root files at zip root, not wrapped in a subfolder).
 */
class ExtensionZipPlugin {
  constructor({ zipPath }) {
    this.zipPath = path.resolve(zipPath);
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapPromise('ExtensionZipPlugin', async (compilation) => {
      const sourceDir = compilation.compiler.options.output.path;
      await this.createZip(sourceDir, this.zipPath);
    });
  }

  createZip(sourceDir, zipPath) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(zipPath), { recursive: true });
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }

      const output = fs.createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);

      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }
}

module.exports = ExtensionZipPlugin;
