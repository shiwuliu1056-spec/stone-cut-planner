const test = require('node:test');
const assert = require('node:assert/strict');

function fakeClaimFactory(seen) {
  return async ({ httpServer }) => ({
    server: httpServer,
    authenticate(req) { if (req.headers.authorization !== 'Bearer verified-test-token') throw Object.assign(new Error('会话已过期'), { status: 401 }); return { owner: 'verified-owner' }; },
    handle(req, res) { seen.push(req.url); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })); },
    async close() {},
  });
}

test('三个工具共用一个监听端口；伪造云托管头不能绕过微信会话', async () => {
  const { createToolboxServer } = await import('../../scripts/server.mjs');
  const paths = [];
  const app = await createToolboxServer({ port: 0, devAuth: false, claimFactory: fakeClaimFactory(paths) });
  try {
    assert.equal(app.server, app.claim.server);
    const health = await fetch(app.origin + '/api/health'); assert.equal(health.status, 200); assert.equal((await health.json()).service, 'bstools');
    const forged = await fetch(app.origin + '/api/solve', { method: 'POST', headers: { 'content-type': 'application/json', 'x-wx-appid': 'wxe4560e02e4b75800', 'x-wx-openid': 'forged' }, body: '{}' });
    assert.equal(forged.status, 401);
    const verified = await fetch(app.origin + '/api/solve', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer verified-test-token' }, body: '{}' });
    assert.equal(verified.status, 400, '验证通过后才进入真实业务参数检查');
    await fetch(app.origin + '/api/session', { method: 'POST', body: '{}' });
    assert.ok(paths.includes('/api/claim/session'), '统一登录端点使用同一身份模块');
    await fetch(app.origin + '/api/claim/health'); assert.ok(paths.includes('/api/claim/health'));
  } finally { await app.close(); }
});

test('停机排空时保留内部引擎入口，并拒绝新的业务请求', async () => {
  const { createToolboxServer } = await import('../../scripts/server.mjs');
  const app = await createToolboxServer({ port: 0, devAuth: false, claimFactory: async ({httpServer}) => ({
    server: httpServer,
    handle(_req,res) { res.end('engine-ready'); },
    authenticate() { return { owner: 'test' }; },
    async close() {
      assert.equal(await (await fetch(app.origin + '/engine/test/app.js')).text(), 'engine-ready');
      assert.equal((await fetch(app.origin + '/api/health')).status, 503);
    },
  }) });
  const closing = app.close(); assert.equal(app.close(), closing); await closing;
  assert.equal(app.server.listening, false);
});

test('统一端口下起诉引擎可以真实检查案件，开发身份不暴露到公网', async () => {
  const { createToolboxServer } = await import('../../scripts/server.mjs');
  await assert.rejects(createToolboxServer({ host: '0.0.0.0', port: 0, devAuth: true }), /开发身份仅限/);
  const app = await createToolboxServer({ port: 0, devAuth: true });
  try {
    const session = await fetch(app.origin + '/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ devId: 'unified-integration' }) });
    const token = (await session.json()).token; assert.ok(token);
    const schema = require('../../miniprogram/shared/claim/schema.js');
    const response = await fetch(app.origin + '/api/claim/check', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ state: schema.sample, files: [] }) });
    assert.equal(response.status, 200); assert.ok(Array.isArray((await response.json()).issues));
    assert.equal(app.claim.origin, app.origin);
  } finally { await app.close(); }
});
