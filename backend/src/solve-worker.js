'use strict';

// Deliberately tiny worker entrypoint: the solver runs off the HTTP event loop.
const { parentPort, workerData } = require('node:worker_threads');
const { solve } = require('./solver');

async function run() {
  // Only used by deterministic tests; normal API payloads never include this field.
  if (Number(workerData && workerData.__delayMs) > 0) await new Promise((resolve) => setTimeout(resolve, Number(workerData.__delayMs)));
  const result = solve(workerData);
  parentPort.postMessage({ type: 'done', result });
}

run().catch((error) => parentPort.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) }));
