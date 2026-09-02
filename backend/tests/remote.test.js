'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const https = require('node:https');
const { downloadHttps, imageMimeFromBuffer, isPrivateAddress, isTrustedCloudHost } = require('../src/remote');

test('只允许 CloudBase/COS 临时文件域名', () => {
  assert.equal(isTrustedCloudHost('abc.tcb.qcloud.la'), true);
  assert.equal(isTrustedCloudHost('abc.cos.ap-shanghai.myqcloud.com'), true);
  assert.equal(isTrustedCloudHost('example.com'), false);
});

test('拒绝私网、回环和链路本地地址', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.0.0.1'), true);
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('拒绝非 HTTPS 或非可信远程地址', async () => {
  await assert.rejects(() => downloadHttps('http://abc.tcb.qcloud.la/file', 100), /HTTPS/);
  await assert.rejects(() => downloadHttps('https://example.com/file', 100), /CloudBase/);
});

test('根据文件头识别图片格式', () => {
  assert.equal(imageMimeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg');
  assert.equal(imageMimeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(imageMimeFromBuffer(Buffer.from('not-an-image'), 'image/jpeg'), '');
  assert.equal(imageMimeFromBuffer(Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])), '');
  assert.equal(imageMimeFromBuffer(Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0])), 'image/heic');
});

test('总下载超时会阻止 DNS 返回后继续发起请求', async (t) => {
  let getCalls = 0;
  t.mock.method(dns, 'lookup', async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return [{ address: '8.8.8.8', family: 4 }];
  });
  t.mock.method(https, 'get', () => { getCalls += 1; throw new Error('不应发起请求'); });
  await assert.rejects(() => downloadHttps('https://abc.tcb.qcloud.la/file', 100, 10), /超时/);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(getCalls, 0);
});
