// 宝松工具箱唯一部署入口：一个Node进程、一个HTTP端口，共用微信身份校验。
import http from 'node:http';
import { isIP } from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createClaimServer } from '../claim-backend/server.mjs';
const require = createRequire(import.meta.url);
const { createServer: createToolsServer } = require('../backend/server.js');
const loopback = address => ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(address);
const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };

export async function createToolboxServer({ host = '127.0.0.1', port = 3100, devAuth = process.env.NODE_ENV !== 'production' && loopback(host), claimFactory = createClaimServer, toolsOptions = {} } = {}) {
  if (devAuth && (process.env.NODE_ENV === 'production' || !loopback(host))) throw Error('开发身份仅限本机非生产环境');
  const tools = createToolsServer({ ...toolsOptions, allowLocalVideoRequests: devAuth });
  let claim, closePromise;
  let closing = false;
  const server = http.createServer(async (req, res) => {
    // 公网客户端不能通过伪造云托管头冒充微信身份。
    delete req.headers['x-wx-appid']; delete req.headers['x-wx-openid'];
    const realIp = String(req.headers['x-real-ip'] || '');
    req.toolboxClientIp = loopback(req.socket.remoteAddress) && isIP(realIp) ? realIp : req.socket.remoteAddress;
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (closing && !path.startsWith('/engine/')) return json(res, 503, { error: '服务正在维护，请稍后再试' });
      if (path === '/api/health' && req.method === 'GET') return json(res, claim ? 200 : 503, { ok: !!claim, service: 'bstools' });
      if (!claim) return json(res, 503, { error: '服务正在启动，请稍后再试' });
      if (path === '/api/session') { req.url = req.url.replace('/api/session', '/api/claim/session'); return claim.handle(req, res); }
      if (path.startsWith('/api/claim/') || path.startsWith('/engine/')) return claim.handle(req, res);
      if (req.method === 'OPTIONS') return tools.emit('request', req, res);
      const signedVideoDownload = req.method === 'GET' && path === '/api/video/download.mp4';
      if (!signedVideoDownload && !devAuth) {
        const session = claim.authenticate(req);
        req.headers['x-wx-appid'] = process.env.MINIPROGRAM_APP_ID || 'wxe4560e02e4b75800';
        req.headers['x-wx-openid'] = session.owner;
      }
      tools.emit('request', req, res);
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : '服务暂时不可用，请稍后重试' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  try { claim = await claimFactory({ host, port: server.address().port, httpServer: server, devAuth }); }
  catch (error) { await new Promise(resolve => server.close(resolve)); await tools.solveTasks.close(); throw error; }
  return { server, claim, origin: `http://127.0.0.1:${server.address().port}`, close() {
    if (!closePromise) {
      closing = true;
      closePromise = (async () => {
        // 在已接收的文书任务结束前保留引擎的内部HTTP入口。
        await claim.close();
        await tools.solveTasks.close();
        await new Promise(resolve => server.close(resolve));
      })();
    }
    return closePromise;
  } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createToolboxServer({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3100) });
  console.log('宝松工具箱已启动：' + app.origin);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
