'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { compareVersions, checkForUpdate, _internals } = require('../src/updater');

test('compareVersions 能比较任意层级版本号', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
  assert.equal(compareVersions('2.0', '10.0'), -1);
  assert.equal(compareVersions('1.0.0.1', '1.0.0'), 1);
});

async function withManifestServer(manifest, callback) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifest));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/update-manifest.json`;
  try {
    await callback(url);
  } finally {
    server.close();
  }
}

test('checkForUpdate 发现服务器上的新版本', async () => {
  await withManifestServer(
    { version: '9.9.9', url: 'http://127.0.0.1/x.exe', sha256: '', notes: '新功能' },
    async (url) => {
      process.env.STONE_UPDATER_URL = url;
      try {
        const info = await checkForUpdate();
        assert.equal(info.configured, true);
        assert.equal(info.update.version, '9.9.9');
        assert.equal(info.update.notes, '新功能');
      } finally {
        delete process.env.STONE_UPDATER_URL;
      }
    },
  );
});

test('checkForUpdate 版本不高于当前时不提示更新', async () => {
  await withManifestServer({ version: '1.0.0', url: 'http://127.0.0.1/x.exe' }, async (url) => {
    process.env.STONE_UPDATER_URL = url;
    try {
      const info = await checkForUpdate();
      assert.equal(info.update, null);
    } finally {
      delete process.env.STONE_UPDATER_URL;
    }
  });
});

test('checkForUpdate 清单格式错误时给出错误信息', async () => {
  await withManifestServer({ hello: 'world' }, async (url) => {
    process.env.STONE_UPDATER_URL = url;
    try {
      const info = await checkForUpdate();
      assert.equal(info.update, null);
      assert.match(info.error, /格式不正确/);
    } finally {
      delete process.env.STONE_UPDATER_URL;
    }
  });
});

test('未配置更新地址时返回 configured:false', async () => {
  delete process.env.STONE_UPDATER_URL;
  const info = await checkForUpdate();
  assert.equal(info.configured, false);
  assert.match(info.error, /未配置/);
});
