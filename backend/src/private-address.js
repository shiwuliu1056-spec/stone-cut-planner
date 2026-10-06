'use strict';

/**
 * private-address.js — 私网 / 回环 / 链路本地地址判定
 *
 * 用于 SSRF 防护：服务端根据外部链接解析出目标地址后，若落在私网段就不能发起
 * 请求，否则调用方可以用一个外部链接让服务端去探测内网（例如云厂商的元数据
 * 服务 169.254.169.254）。tikhub.js 用它校验视频下载地址。
 *
 * 判定偏保守：格式不合法的地址一律视为不安全（返回 true）。
 */

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase();
  if (value.includes(':')) {
    return value === '::1'
      || value === '::'
      || value.startsWith('fc')
      || value.startsWith('fd')
      || value.startsWith('fe80:')
      || value.startsWith('::ffff:127.')
      || value.startsWith('::ffff:10.')
      || value.startsWith('::ffff:192.168.')
      || value.startsWith('::ffff:172.');
  }
  const octets = value.split('.').map(Number);
  if (octets.length !== 4 || octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return true;
  }
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

module.exports = { isPrivateAddress };
