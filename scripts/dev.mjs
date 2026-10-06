import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const claimEnv = { ...process.env };
delete claimEnv.HOST;
delete claimEnv.PORT;
if (process.env.CLAIM_HOST) claimEnv.HOST = process.env.CLAIM_HOST;
if (process.env.CLAIM_PORT) claimEnv.PORT = process.env.CLAIM_PORT;
const services = [
  { file: 'backend/server.js', envFile: '.env.local', env: process.env },
  { file: 'claim-backend/server.mjs', envFile: 'claim-backend/.env', env: claimEnv },
];
const children = services.map(service => spawn(process.execPath, ['--env-file-if-exists=' + resolve(root, service.envFile), resolve(root, service.file)], { cwd: root, env: service.env, stdio: 'inherit' }));
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
children.forEach(child => {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', (code, signal) => { if (!stopping) stop(code || (signal ? 1 : 0)); });
});
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
