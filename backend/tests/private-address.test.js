'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateAddress } = require('../src/private-address');

test('拒绝私网、回环和链路本地地址', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.0.0.1'), true);
  assert.equal(isPrivateAddress('169.254.169.254'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
});

test('覆盖各类私网、保留与组播网段', () => {
  for (const address of [
    '0.0.0.0',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.1',
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} 应判为不安全`);
  }
  for (const address of ['172.15.0.1', '172.32.0.1', '11.0.0.1', '1.1.1.1']) {
    assert.equal(isPrivateAddress(address), false, `${address} 应判为公网`);
  }
});

test('IPv6 回环、私有段与 IPv4 映射地址', () => {
  for (const address of [
    '::1',
    '::',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:172.16.0.1',
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} 应判为不安全`);
  }
  assert.equal(isPrivateAddress('2001:4860:4860::8888'), false);
});

test('非法地址保守判为不安全', () => {
  for (const address of ['', 'not-an-ip', '999.1.1.1', '1.2.3']) {
    assert.equal(isPrivateAddress(address), true, `${address} 应判为不安全`);
  }
});
