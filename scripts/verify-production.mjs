// Native WeChat -> HTTPS -> production service. Synthetic data only; no paid APIs.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const state = structuredClone(require('../miniprogram/shared/claim/schema.js').sample);
state.includeRefundAccount = true;
state.refundAccountName = '虚构部署测试'; state.refundBankName = '测试银行'; state.refundBankAccount = '0000000000'; state.refundPhone = state.plaintiffPhone;
async function nativeSmoke(state) {
  const base = 'https://cacci.cn/bstools';
  const request = (path, method, data, token) => new Promise((resolve, reject) => wx.request({ url: base + path, method, data, timeout: 120000, header: { 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, success: res => res.statusCode >= 200 && res.statusCode < 300 ? resolve(res.data) : reject(new Error('HTTP ' + res.statusCode + ': ' + (res.data.error || 'request failed'))), fail: error => reject(new Error(error.errMsg)) }));
  const login = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }));
  const session = await request('/api/session', 'POST', { code: login.code });
  const fs = wx.getFileSystemManager();
  const filePath = wx.env.USER_DATA_PATH + '/bstools-deploy-smoke-' + Date.now() + '.txt';
  let taskId, downloadPath;
  try {
    const solve = await request('/api/solve', 'POST', { settings: { slabs: [{ id: '部署测试', w: 1200, h: 500, limit: null }] }, parts: [{ id: 'A', w: 200, h: 100, qty: 5, rotatable: false }] }, session.token);
    if (!solve.result.plans.A) throw new Error('solve result missing');
    fs.writeFileSync(filePath, '虚构测试证据，仅用于验证部署上传。', 'utf8');
    const files = [{ id: 'deploy-evidence', group: 'evidence', name: '部署测试.txt', size: fs.statSync(filePath).size, evidenceId: state.evidence[0].id }];
    const check = await request('/api/claim/check', 'POST', { state, files }, session.token);
    const created = await request('/api/claim/tasks', 'POST', { state, files }, session.token); taskId = created.id;
    await new Promise((resolve, reject) => wx.uploadFile({ url: base + '/api/claim/tasks/' + taskId + '/files/deploy-evidence', filePath, name: 'file', timeout: 120000, header: { Authorization: 'Bearer ' + session.token }, success: res => res.statusCode === 200 ? resolve() : reject(new Error('upload HTTP ' + res.statusCode)), fail: reject }));
    await request('/api/claim/tasks/' + taskId + '/generate', 'POST', {}, session.token);
    let task;
    const until = Date.now() + 120000;
    do {
      task = await request('/api/claim/tasks/' + taskId, 'GET', null, session.token);
      if (['ready', 'failed'].includes(task.status)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (Date.now() < until);
    if (task.status !== 'ready') throw new Error(task.error || 'generation timeout');
    const downloaded = await new Promise((resolve, reject) => wx.downloadFile({ url: base + '/api/claim/tasks/' + taskId + '/download/package', header: { Authorization: 'Bearer ' + session.token }, timeout: 120000, success: resolve, fail: reject }));
    downloadPath = downloaded.tempFilePath;
    if (downloaded.statusCode !== 200) throw new Error('download HTTP ' + downloaded.statusCode);
    const bytes = new Uint8Array(fs.readFileSync(downloadPath));
    if (bytes[0] !== 80 || bytes[1] !== 75 || bytes.length < 1000) throw new Error('invalid ZIP');
    return { login: true, stoneSolve: true, claimCheck: Array.isArray(check.issues), uploaded: true, wordFiles: task.outputs.length, pages: task.outputs.map(o => o.pageCount), nativeZipDownload: true, zipBytes: bytes.length, paidApiCalls: 0 };
  } finally {
    if (taskId) await request('/api/claim/tasks/' + taskId, 'DELETE', null, session.token);
    for (const path of [filePath, downloadPath].filter(Boolean)) { try { fs.unlinkSync(path); } catch (_) {} }
  }
}
function evaluate(source) {
  let output;
  try { output = execFileSync('/Applications/wechatwebdevtools.app/Contents/MacOS/wechatide', ['-c', 'Codex', 'automation_evaluate', '--project', project, '--fn-source', source], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024 }); }
  catch (error) { output = String(error.stdout || ''); if (!output.includes('{')) throw Error('开发者工具没有返回测试状态'); }
  const response = JSON.parse(output.slice(output.indexOf('{')));
  if (!response.ok) throw Error(response.message || '自动化调用失败');
  return response.result.result.result;
}
// 长流程不阻塞单次automator调用，结果保留到独立的临时字段，不改用户草稿。
const key = '__bstoolsDeploySmoke' + process.pid;
const collectorOnly = process.argv.includes('--collector-selftest');
const action = collectorOnly
  ? "function(){return new Promise(function(resolve,reject){wx.request({url:'https://cacci.cn/bstools/api/health',success:function(r){resolve({ok:r.data.ok,healthStatus:r.statusCode});},fail:reject});});}"
  : nativeSmoke.toString();
evaluate('function(){var app=getApp();app[' + JSON.stringify(key) + ']={status:"running"};Promise.resolve().then(function(){return (' + action + ')(' + JSON.stringify(state) + ');}).then(function(result){app[' + JSON.stringify(key) + ']={status:"done",result:result};}).catch(function(error){app[' + JSON.stringify(key) + ']={status:"failed",error:error.message||error.errMsg};});return {started:true};}');
const until = Date.now() + 180000;
let progress;
do {
  progress = evaluate('function(){return getApp()[' + JSON.stringify(key) + ']||{status:"missing"};}');
  if (progress.status !== 'running') break;
  await new Promise(resolve => setTimeout(resolve, 1000));
} while (Date.now() < until);
assert.equal(progress.status, 'done', progress.error || progress.status);
const result = progress.result;
if (collectorOnly) { assert.equal(result.ok, true); assert.equal(result.healthStatus, 200); }
else { assert.equal(result.wordFiles, 6); assert.equal(result.nativeZipDownload, true); }
evaluate('function(){delete getApp()[' + JSON.stringify(key) + '];return true;}');
console.log(JSON.stringify(result));
