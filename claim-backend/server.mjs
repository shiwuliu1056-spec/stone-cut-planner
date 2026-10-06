import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, join, extname, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';
import { ClaimRenderer, engineBridge,FORMAT_VERSION } from './renderer.mjs';
import { reviewCase, optimizeCase } from './review.mjs';
import {ensureOwnedWorkspace,cleanupAbandonedWorkspaces} from './workspaces.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const TTL = 30 * 60 * 1000;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) fail(413, '填写内容过大'); chunks.push(chunk); }
  let parsed;try { parsed=JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, '请求内容不是有效JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, '请求内容须为对象');
  return parsed;
}
const idPattern = /^[a-zA-Z0-9_-]{1,100}$/;
const allowed = { plaintiff: ['pdf','docx','jpg','jpeg','png'], agent: ['pdf','docx','jpg','jpeg','png'], defendant: ['pdf','docx','jpg','jpeg','png'], evidence: ['pdf','docx','jpg','jpeg','png','webp','xls','xlsx','csv','txt'] };
export function validateManifest(state, files) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail(400, '案件字段无效');
  if (!Array.isArray(state.identityMaterials) || !state.identityMaterials.length || !Array.isArray(state.evidence) || !state.evidence.length) fail(400, '请保留至少一项身份材料和证据');
  for (const rows of [state.identityMaterials, state.evidence]) {
    if (rows.length > 100 || rows.some(x => !x || typeof x !== 'object' || !idPattern.test(x.id)) || new Set(rows.map(x => x.id)).size !== rows.length) fail(400, '材料编号无效或重复');
  }
  if(state.defendantMaterials!==undefined&&(!Array.isArray(state.defendantMaterials)||!state.defendantMaterials.length||state.defendantMaterials.length>100||state.defendantMaterials.some(item=>!item||typeof item!=='object'||!idPattern.test(item.id)||typeof item.name!=='string'||item.name.length>100)||new Set(state.defendantMaterials.map(item=>item.id)).size!==state.defendantMaterials.length))fail(400,'被告材料编号或名称无效');
  if (state.evidence.some(item => item.kind === 'media' && (!['录音','视频'].includes(item.mediaType) || !Number.isInteger(Number(item.fileCount)) || Number(item.fileCount) <= 0))) fail(400, '影音类型和数量无效，数量必须为正整数');
  if (!Array.isArray(files) || files.length > 100) fail(400, '文件最多100个');
  const ids = new Set();
  let total = 0;
  for (const f of files) {
    if (!f || typeof f !== 'object' || !idPattern.test(f.id) || ids.has(f.id)) fail(400, '文件编号无效或重复'); ids.add(f.id);
    if (!allowed[f.group] || typeof f.name !== 'string' || f.name.length > 200 || /[/\\\x00]/.test(f.name) || !allowed[f.group].includes(extname(f.name).slice(1).toLowerCase())) fail(400, '文件格式不支持，请转换后重新选择');
    if (!Number.isInteger(f.size) || f.size < 1 || f.size > 20 * 1024 * 1024) fail(400, '每个文件需小于20MB'); total += f.size;
    if (f.group === 'plaintiff' && !state.identityMaterials.some(x => x.id === f.materialId)) fail(400, '身份文件未关联材料编号');
    if (f.group === 'evidence' && !state.evidence.some(x => x.id === f.evidenceId && x.kind === 'document')) fail(400, '证据文件未关联图文编号');
    if(f.group==='defendant'&&state.defendantMaterials&&!state.defendantMaterials.some(item=>item.id===f.materialId&&item.name.trim()))fail(400,'被告线索文件需关联已填写名称的材料编号');
  }
  if (total > 100 * 1024 * 1024) fail(400, '总文件大小不能超过100MB');
}
async function receiveFile(req, target, expectedSize) {
  return new Promise((resolveUpload, reject) => {
    let found = false, bytes = 0, truncated = false; const chunks = [];
    const parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 20 * 1024 * 1024, fields: 0 } });
    parser.on('file', (_name, stream) => { found = true; stream.on('limit', () => { truncated = true; }); stream.on('data', chunk => { bytes += chunk.length; chunks.push(chunk); }); });
    parser.on('error', reject); req.on('aborted', () => reject(new Error('上传中断')));
    parser.on('close', async () => {
      if (!found || truncated || bytes !== expectedSize) return reject(Object.assign(new Error('文件上传不完整或超过限制，请重试'), { status: 400 }));
      try { await writeFile(target, Buffer.concat(chunks)); resolveUpload(); } catch (error) { reject(error); }
    });
    req.pipe(parser);
  });
}

export async function createClaimServer({ host = '127.0.0.1', port = 3101, devAuth = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH !== '0' && ['127.0.0.1','::1','localhost'].includes(host) } = {}) {
  if (devAuth && (process.env.NODE_ENV === 'production' || !['127.0.0.1','::1','localhost'].includes(host))) throw new Error('开发身份仅限本机非生产环境');
  const sessions = new Map(), tasks = new Map(), throttle = new Map();
  const secret = randomBytes(24).toString('hex');
  // 每次进程有独立目录，所有任务删除都只作用于本进程生成的具体目录。
  const serviceRoot = join(tmpdir(), 'jiujiang-claim-service'); await mkdir(serviceRoot, { recursive: true });
  const workRoot = join(serviceRoot, randomUUID()); await ensureOwnedWorkspace(workRoot);
  const cleanupOldProcesses=()=>cleanupAbandonedWorkspaces(serviceRoot,{exclude:workRoot,ttl:TTL});
  await cleanupOldProcesses();
  let renderer, closing = false; let queue = Promise.resolve(); let pending = 0;
  const authenticate = req => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, ''); const session = sessions.get(token);
    if (!session || session.expiresAt < Date.now()) fail(401, '会话已过期，请重新进入'); return session;
  };
  const taskFor = (id, session) => { const task = tasks.get(id); if (!task || task.owner !== session.owner || task.expiresAt < Date.now()) fail(404, '任务不存在或已过期，请重新生成'); return task; };
  const publicTask = task => ({ id: task.id, formatVersion:FORMAT_VERSION,status: task.status, progress: task.progress, error: task.error || '', uploadedIds: task.files.filter(f => f.uploaded).map(f => f.id), expiresAt: task.expiresAt, outputs: task.outputs || [] });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
      if (req.method === 'GET' && path === '/api/claim/health') return json(res, 200, { ok: !!(renderer && renderer.ready), service: 'claim' });
      if (req.method === 'GET' && path.startsWith(`/engine/${secret}/`)) {
        const relative = decodeURIComponent(path.slice(`/engine/${secret}/`.length));
        const file = resolve(root, 'engine', relative); if (!file.startsWith(resolve(root, 'engine') + '/')) fail(403, 'Forbidden');
        let content = await readFile(file);
        if (relative === 'app.js') content = Buffer.from(content.toString().split('\npopulateCourts();')[0] + engineBridge);
        const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html' };
        res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); return res.end(content);
      }
      if (req.method === 'POST' && path === '/api/claim/session') {
        const input = await body(req); let owner;
        const ip = req.socket.remoteAddress; const count = throttle.get(ip) || { n: 0, until: Date.now() + 60000 };
        if (count.until < Date.now()) { count.n = 0; count.until = Date.now() + 60000; } if (++count.n > 30) fail(429, '请求过于频繁'); throttle.set(ip, count);
        if (devAuth && input.devId && idPattern.test(input.devId)) owner = 'dev-' + input.devId;
        else {
          if (!process.env.MINIPROGRAM_APP_SECRET || !input.code) fail(503, '服务尚未配置微信身份校验');
          const query = new URLSearchParams({ appid: process.env.MINIPROGRAM_APP_ID, secret: process.env.MINIPROGRAM_APP_SECRET, js_code: input.code, grant_type: 'authorization_code' });
          const upstream = await fetch('https://api.weixin.qq.com/sns/jscode2session?' + query, { signal: AbortSignal.timeout(10000) });
          const result = await upstream.json(); if (!result.openid) fail(401, '微信会话验证失败，请重试'); owner = result.openid;
        }
        const token = randomBytes(32).toString('hex'); sessions.set(token, { owner, expiresAt: Date.now() + 3600000 });
        return json(res, 200, { token, expiresAt: Date.now() + 3600000 });
      }
      const session = authenticate(req);
      if (!renderer || !renderer.ready) fail(503,'服务正在启动，请稍后再试');
      if (req.method === 'POST' && path === '/api/claim/check') {
        const input = await body(req); validateManifest(input.state, input.files || []);
        const check = await renderer.inspect(input.state, input.files || []); return json(res, 200, check);
      }
      if (req.method === 'POST' && ['/api/claim/review','/api/claim/optimize'].includes(path)) {
        const key = 'ai-' + session.owner; const rate = throttle.get(key) || { n: 0, until: Date.now() + 60000 };
        if (rate.until < Date.now()) { rate.n = 0; rate.until = Date.now() + 60000; }
        if (++rate.n > 6) fail(429, 'AI检查过于频繁，请稍后重试'); throttle.set(key, rate);
        const input = await body(req); validateManifest(input.state, input.files || []);
        if (!process.env.DEEPSEEK_API_KEY) fail(503, '尚未配置AI服务密钥');
        const check = await renderer.inspect(input.state, input.files || []);
        const result = path.endsWith('/optimize')?await optimizeCase(check.review,input.issue,{state:input.state}):await reviewCase(check.review);
        return json(res, 200, result);
      }
      if (req.method === 'POST' && path === '/api/claim/tasks') {
        const input = await body(req); validateManifest(input.state, input.files);
        if ([...tasks.values()].filter(t => t.owner === session.owner).length >= 3 || tasks.size >= 30) fail(429, '已有生成任务，请删除旧任务后再试');
        await ensureOwnedWorkspace(workRoot);
        const id = randomUUID(), dir = join(workRoot, id); await mkdir(dir);
        const task = { id, dir, owner: session.owner, state: input.state, files: input.files.map(f => ({ id: f.id, group: f.group, materialId: f.materialId, evidenceId: f.evidenceId, name: f.name, size: f.size, path: join(dir, 'input-' + f.id), uploaded: false })), status: 'uploading', progress: 0, expiresAt: Date.now() + TTL };
        tasks.set(id, task); return json(res, 201, publicTask(task));
      }
      const match = path.match(/^\/api\/claim\/tasks\/([\w-]+)(?:\/(.*))?$/); if (!match) fail(404, '接口不存在');
      const task = taskFor(match[1], session); const action = match[2] || '';
      if (req.method === 'GET' && !action) return json(res, 200, publicTask(task));
      if (req.method === 'DELETE' && !action) {
        if (['queued','generating'].includes(task.status)) fail(409, '正在生成，请完成后删除');
        tasks.delete(task.id); await rm(task.dir, { recursive: true, force: true }); return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && action.startsWith('files/')) {
        if (!['uploading','failed'].includes(task.status)) fail(409, '任务已开始生成');
        const file = task.files.find(f => f.id === action.slice(6)); if (!file) fail(404, '文件编号不存在');
        await receiveFile(req, file.path, file.size); file.uploaded = true; task.status = 'uploading';
        return json(res, 200, { id: file.id, uploaded: true });
      }
      if (req.method === 'POST' && action === 'generate') {
        if (task.files.some(f => !f.uploaded)) fail(409, '尚有文件未上传');
        if (['queued','generating','ready'].includes(task.status)) return json(res, 200, publicTask(task));
        if (pending >= 10) fail(429, '生成队列繁忙，请稍后重试');
        pending++; task.status = 'queued'; task.progress = 10; task.error = '';
        queue = queue.then(async () => {
          if (closing || task.expiresAt < Date.now()) { pending--; task.status = 'failed'; task.error = '任务已过期'; return; }
          task.status = 'generating';
          try { task.outputs = await renderer.generate(task); task.status = 'ready'; task.progress = 100; }
          catch (error) { console.error('Claim generation failed:', error.message); task.status = 'failed'; task.error = '生成失败：' + error.message.slice(0,150); }
          finally { pending--; }
        }).catch(error => console.error(error.message));
        return json(res, 202, publicTask(task));
      }
      if (req.method === 'GET' && action.startsWith('download/')) {
        if (task.status !== 'ready') fail(409, '文件尚未生成');
        const id = action.slice(9); const output = task.outputs.find(o => o.id === id);
        if (id !== 'package' && !output) fail(404, '文件不存在');
        const filename = id === 'package' ? '起诉资料包.zip' : output.name;
        const content = await readFile(join(task.dir, id === 'package' ? 'package.zip' : id + '.docx'));
        res.writeHead(200, { 'content-type': id === 'package' ? 'application/zip' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'content-length': content.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'cache-control': 'no-store' }); return res.end(content);
      }
      fail(404, '接口不存在');
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务发生错误，请重试' }); else res.end(); }
  });
  await new Promise(resolveListen => server.listen(port, host, resolveListen));
  const actualPort = server.address().port;
  renderer = new ClaimRenderer(join(root, 'engine'), `http://127.0.0.1:${actualPort}`, secret);
  try { await renderer.start(); } catch (error) { server.close(); await rm(workRoot, { recursive: true, force: true }); throw error; }
  const timer = setInterval(async () => {
    for (const [id, task] of tasks) if (task.expiresAt < Date.now() && !['queued','generating'].includes(task.status)) { tasks.delete(id); await rm(task.dir, { recursive: true, force: true }); }
    for (const [token, session] of sessions) if (session.expiresAt < Date.now()) sessions.delete(token);
    for (const [ip, entry] of throttle) if (entry.until < Date.now()) throttle.delete(ip);
    await cleanupOldProcesses().catch(error=>console.error('Claim workspace cleanup failed:',error.code||error.name));
  }, 30000); timer.unref();
  return { server, renderer, tasks, origin: `http://127.0.0.1:${actualPort}`, async close() { closing = true; clearInterval(timer); await queue; await renderer.close(); await new Promise(r => server.close(r)); await rm(workRoot, { recursive: true, force: true }); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createClaimServer({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3101) });
  console.log('Claim service ready:', app.origin);
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
