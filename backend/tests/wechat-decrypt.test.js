'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createWechatDecryptTransform, generateWechatKeystream, KEYSTREAM_SIZE } = require('../src/wechat-decrypt');

async function transformed(chunks, keystream, offset = 0) {
  const output = [];
  for await (const chunk of Readable.from(chunks).pipe(createWechatDecryptTransform(keystream, offset))) output.push(chunk);
  return Buffer.concat(output);
}

test('视频号解密仅 XOR 前 128KB，并支持 Range 偏移', async () => {
  const key = Buffer.alloc(KEYSTREAM_SIZE, 0xff);
  const source = Buffer.alloc(KEYSTREAM_SIZE + 8, 0x0f);
  const result = await transformed([source.subarray(0, 100), source.subarray(100)], key);
  assert.equal(result[0], 0xf0);
  assert.equal(result[KEYSTREAM_SIZE - 1], 0xf0);
  assert.equal(result[KEYSTREAM_SIZE], 0x0f);

  const range = await transformed([Buffer.from([1, 2, 3])], key, KEYSTREAM_SIZE - 1);
  assert.deepEqual([...range], [0xfe, 2, 3]);
});

test('视频号密钥流校验 decode_key 并可注入 WASM 生成器', async () => {
  const expected = Buffer.alloc(KEYSTREAM_SIZE, 7);
  const generated = await generateWechatKeystream('123456', { module: { generate: () => expected } });
  assert.equal(generated, expected);
  await assert.rejects(() => generateWechatKeystream('not-a-key', { module: { generate: () => expected } }), /无效/);
});
