'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MAX_WORKERS = Math.max(1, Math.min(2, (os.cpus() || []).length || 1));
const DEFAULT_MAX_TASKS = 100;
const DEFAULT_MAX_QUEUE = 50;
const DEFAULT_MAX_RESULT_BYTES = 50 * 1024 * 1024;

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

class SolveTaskManager {
  constructor({ ttlMs = DEFAULT_TTL_MS, timeoutMs = DEFAULT_TIMEOUT_MS, maxWorkers = DEFAULT_MAX_WORKERS,
    maxTasks = DEFAULT_MAX_TASKS, maxQueue = DEFAULT_MAX_QUEUE, maxResultBytes = DEFAULT_MAX_RESULT_BYTES,
    storageFile = process.env.SOLVE_TASK_STORE_FILE || path.join(os.tmpdir(), 'stone-cut-planner', 'solve-tasks.json') } = {}) {
    this.ttlMs = ttlMs;
    this.timeoutMs = timeoutMs;
    this.maxWorkers = Math.max(1, Number(maxWorkers) || 1);
    this.maxTasks = Math.max(1, Number(maxTasks) || DEFAULT_MAX_TASKS);
    this.maxQueue = Math.max(0, Number(maxQueue) || 0);
    this.maxResultBytes = Math.max(1024, Number(maxResultBytes) || DEFAULT_MAX_RESULT_BYTES);
    this.storageFile = storageFile;
    this.tasks = new Map();
    this.idempotency = new Map();
    this.active = 0;
    this.queue = [];
    this.workers = new Set();
    this.timeouts = new Set();
    this.closed = false;
    this.load();
    this.timer = setInterval(() => this.cleanup(), Math.min(this.ttlMs, 60 * 1000));
    this.timer.unref?.();
  }

  submit(payload, idempotencyKey = '') {
    if (this.closed) { const error = new Error('排版服务已关闭'); error.statusCode = 503; throw error; }
    const key = String(idempotencyKey || '').trim();
    this.cleanup();
    const hash = fingerprint(payload);
    if (key && this.idempotency.has(key)) {
      const existingId = this.idempotency.get(key);
      const existing = this.tasks.get(existingId);
      if (existing && existing.inputHash === hash) return { task: existing, reused: true };
      const error = new Error('幂等键已用于另一组排版参数');
      error.statusCode = 409;
      throw error;
    }
    if (this.tasks.size >= this.maxTasks) { const error = new Error('排版任务过多，请稍后重试'); error.statusCode = 429; throw error; }
    if (this.queue.length >= this.maxQueue) { const error = new Error('排版队列已满，请稍后重试'); error.statusCode = 429; throw error; }
    const now = Date.now();
    const task = {
      taskId: crypto.randomUUID(), status: 'queued', progress: 0,
      createdAt: now, updatedAt: now, expiresAt: now + this.ttlMs,
      inputHash: hash, idempotencyKey: key || null,
    };
    this.tasks.set(task.taskId, task);
    if (key) this.idempotency.set(key, task.taskId);
    this.queue.push({ task, payload });
    this.persist();
    this.pump();
    return { task, reused: false };
  }

  get(taskId) {
    const task = this.tasks.get(String(taskId));
    if (!task) return null;
    if (task.expiresAt <= Date.now()) {
      this.remove(task.taskId);
      return null;
    }
    return task;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, task] of this.tasks) if (task.expiresAt <= now && task.status !== 'running') this.remove(id);
    this.persist();
  }

  remove(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.idempotencyKey && this.idempotency.get(task.idempotencyKey) === taskId) this.idempotency.delete(task.idempotencyKey);
    this.tasks.delete(taskId);
    this.queue = this.queue.filter((item) => item.task.taskId !== taskId);
    this.persist();
  }

  pump() {
    while (this.active < this.maxWorkers && this.queue.length) this.start(this.queue.shift());
  }

  start(item) {
    const { task, payload } = item;
    this.active += 1;
    task.status = 'running'; task.progress = 10; task.updatedAt = Date.now();
    task.expiresAt = Math.max(task.expiresAt, Date.now() + this.ttlMs);
    this.persist();
    const worker = new Worker(path.join(__dirname, 'solve-worker.js'), { workerData: payload });
    this.workers.add(worker);
    let settled = false;
    const finish = (status, fields = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      this.timeouts.delete(timeout);
      if (!this.closed) this.active -= 1;
      this.workers.delete(worker);
      if (!this.closed && this.tasks.has(task.taskId)) {
        Object.assign(task, fields, { status, updatedAt: Date.now() });
        if (status === 'succeeded') task.progress = 100;
        if (status === 'succeeded' && Buffer.byteLength(JSON.stringify(task.result)) > this.maxResultBytes) {
          delete task.result; task.status = 'failed'; task.progress = 100; task.error = '排版结果过大，请减少数据量后重试';
        }
      }
      this.persist();
      worker.terminate().catch(() => {});
      this.pump();
    };
    const timeout = setTimeout(() => finish('failed', { progress: 100, error: '排版计算超时，请减少数据量后重试' }), this.timeoutMs);
    this.timeouts.add(timeout);
    worker.once('message', (message) => {
      if (message.type === 'done') finish('succeeded', { result: message.result });
      else finish('failed', { progress: 100, error: message.message || '排版计算失败' });
    });
    worker.once('error', (error) => finish('failed', { progress: 100, error: error.message || '排版计算失败' }));
    worker.once('exit', (code) => { if (code !== 0) finish('failed', { progress: 100, error: '排版计算进程异常退出' }); });
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const item of this.queue) this.remove(item.task.taskId);
    this.queue = [];
    for (const task of this.tasks.values()) {
      if (task.status === 'running' || task.status === 'queued') {
        task.status = 'failed'; task.progress = 100; task.error = '服务关闭导致排版任务中断'; task.updatedAt = Date.now();
      }
    }
    for (const timeout of this.timeouts) clearTimeout(timeout);
    this.timeouts.clear();
    for (const worker of this.workers) worker.terminate().catch(() => {});
    this.workers.clear();
    this.active = 0;
    this.persistSync();
  }

  load() {
    if (!this.storageFile) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
      for (const task of Array.isArray(parsed) ? parsed : []) {
        if (!task || !task.taskId || task.expiresAt <= Date.now()) continue;
        if (task.status === 'queued' || task.status === 'running') {
          task.status = 'failed'; task.progress = 100; task.error = '服务重启导致排版任务中断';
        }
        if (task.result !== undefined && Buffer.byteLength(JSON.stringify(task.result)) > this.maxResultBytes) {
          delete task.result; task.status = 'failed'; task.progress = 100; task.error = '排版结果过大，请减少数据量后重试';
        }
        this.tasks.set(task.taskId, task);
        if (task.idempotencyKey) this.idempotency.set(task.idempotencyKey, task.taskId);
      }
    } catch (error) { if (error.code !== 'ENOENT') process.stderr.write(`排版任务存储读取失败：${error.message}\n`); }
  }

  persist() {
    if (!this.storageFile) return;
    if (this.persistPending) { this.persistDirty = true; return; }
    this.persistPending = true; this.persistDirty = false;
    const snapshot = [...this.tasks.values()].map(({ taskId, status, progress, createdAt, updatedAt, expiresAt, inputHash, idempotencyKey, result, error }) => ({ taskId, status, progress, createdAt, updatedAt, expiresAt, inputHash, idempotencyKey, result, error }));
    fsp.mkdir(path.dirname(this.storageFile), { recursive: true }).then(() => fsp.writeFile(`${this.storageFile}.tmp`, JSON.stringify(snapshot), 'utf8')).then(() => fsp.rename(`${this.storageFile}.tmp`, this.storageFile)).catch((error) => process.stderr.write(`排版任务存储写入失败：${error.message}\n`)).finally(() => { this.persistPending = false; if (this.persistDirty) this.persist(); });
  }

  persistSync() {
    if (!this.storageFile) return;
    const snapshot = [...this.tasks.values()].map(({ taskId, status, progress, createdAt, updatedAt, expiresAt, inputHash, idempotencyKey, result, error }) => ({ taskId, status, progress, createdAt, updatedAt, expiresAt, inputHash, idempotencyKey, result, error }));
    try {
      fs.mkdirSync(path.dirname(this.storageFile), { recursive: true });
      fs.writeFileSync(`${this.storageFile}.tmp`, JSON.stringify(snapshot), 'utf8');
      fs.renameSync(`${this.storageFile}.tmp`, this.storageFile);
    } catch (error) { process.stderr.write(`排版任务存储写入失败：${error.message}\n`); }
  }
}

module.exports = { SolveTaskManager };
