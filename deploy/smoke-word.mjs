// Synthetic local-only verification. Never call paid AI or media APIs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolboxServer } from '../scripts/server.mjs';
const require = createRequire(new URL('../claim-backend/package.json', import.meta.url));
const JSZip = require('jszip');
const schema = require('../miniprogram/shared/claim/schema.js');
assert.notEqual(process.env.NODE_ENV, 'production', 'Smoke identity must never run in production mode');
process.chdir(dirname(dirname(fileURLToPath(import.meta.url))));
const app = await createToolboxServer({ port: 0, devAuth: true, toolsOptions: { solveTaskOptions: { storageFile: null } } });
try {
  const req = async (path, data, token, method = 'POST') => {
    const r = await fetch(app.origin + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(data) } : {}) });
    const body = await r.json(); assert.ok(r.ok, JSON.stringify({ status: r.status, error: body.error })); return body;
  };
  const { token } = await req('/api/session', { devId: 'deployment-synthetic' });
  const state = structuredClone(schema.sample);
  state.includeRefundAccount = true;
  state.refundAccountName = '虚构测试原告';
  state.refundBankName = '测试银行';
  state.refundBankAccount = '0000000000';
  state.refundPhone = state.plaintiffPhone;
  const check = await req('/api/claim/check', { state, files: [] }, token);
  assert.ok(Array.isArray(check.issues));
  const task = await req('/api/claim/tasks', { state, files: [] }, token);
  await req('/api/claim/tasks/' + task.id + '/generate', {}, token);
  let result;
  const until = Date.now() + 120000;
  do {
    result = await req('/api/claim/tasks/' + task.id, null, token, 'GET');
    if (['ready', 'failed'].includes(result.status)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < until);
  assert.equal(result.status, 'ready', result.error || 'generation timeout');
  assert.equal(result.outputs.length, 6);
  for (const output of result.outputs) {
    assert.ok(output.pageCount >= 1);
    const r = await fetch(app.origin + '/api/claim/tasks/' + task.id + '/download/' + output.id, { headers: { authorization: 'Bearer ' + token } });
    assert.equal(r.status, 200);
    const zip = await JSZip.loadAsync(await r.arrayBuffer());
    assert.ok((await zip.file('word/document.xml').async('string')).includes('<w:t'));
  }
  const archive = await fetch(app.origin + '/api/claim/tasks/' + task.id + '/download/package', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(archive.status, 200);
  const zip = await JSZip.loadAsync(await archive.arrayBuffer());
  assert.equal(Object.keys(zip.files).filter(name => name.endsWith('.docx')).length, 6);
  console.log(JSON.stringify({ ok: true, unifiedPort: true, wordFiles: 6, pages: result.outputs.map(o => o.pageCount), zipVerified: true, paidApiCalls: 0 }));
} finally { await app.close(); }
