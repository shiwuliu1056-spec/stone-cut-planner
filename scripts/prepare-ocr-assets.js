#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OCR_ROOT = path.join(ROOT, 'frontend', 'public', 'ocr');
const CORE_ROOT = path.join(OCR_ROOT, 'core');
const LANG_ROOT = path.join(OCR_ROOT, 'lang');
const ENGLISH_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz';

function copy(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function download(url, target) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        download(response.headers.location, target).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`OCR 语言包下载失败：HTTP ${response.statusCode}`));
        return;
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const output = fs.createWriteStream(target);
      response.pipe(output);
      output.on('finish', () => output.close(resolve));
      output.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function main() {
  const tesseractRoot = path.join(ROOT, 'frontend', 'node_modules', 'tesseract.js');
  const coreRoot = path.join(ROOT, 'frontend', 'node_modules', 'tesseract.js-core');
  copy(path.join(tesseractRoot, 'dist', 'worker.min.js'), path.join(OCR_ROOT, 'worker.min.js'));
  [
    'tesseract-core.wasm.js', 'tesseract-core.wasm',
    'tesseract-core-simd.wasm.js', 'tesseract-core-simd.wasm',
    'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm',
    'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm',
  ]
    .forEach((file) => copy(path.join(coreRoot, file), path.join(CORE_ROOT, file)));

  const languageFile = path.join(LANG_ROOT, 'eng.traineddata.gz');
  if (!fs.existsSync(languageFile)) {
    process.stdout.write('首次准备 OCR 英文语言包（约 10 MB）...\n');
    await download(ENGLISH_URL, languageFile);
  }
  process.stdout.write('OCR 本地资源已准备完成。\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
