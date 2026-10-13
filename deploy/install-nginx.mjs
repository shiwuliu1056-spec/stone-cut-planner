// Apply only the toolbox include and new HTTPS listener; preserve the HTTP app.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const target = '/etc/nginx/sites-available/default';
const enabled = '/etc/nginx/sites-enabled/bstools-https';
const https = '/etc/nginx/sites-available/bstools-https';
const backup = '/opt/bstools/shared/backups/default.before-bstools-20261012.conf';
const include = '/etc/nginx/bstools-http.inc';
const expected = process.argv[2];
if (!/^[a-f0-9]{64}$/.test(expected || '')) throw Error('Expected original nginx SHA256 is required');
const original = fs.readFileSync(target);
if (createHash('sha256').update(original).digest('hex') !== expected) throw Error('Original HTTP config changed; refusing to overwrite');
if (fs.existsSync(enabled) || fs.existsSync(https) || fs.existsSync(include)) throw Error('Toolbox nginx files already exist; inspect before updating');
const anchor = '    server_name _;';
if (original.toString().split(anchor).length !== 2) throw Error('Unexpected HTTP config layout');
fs.mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
fs.copyFileSync(target, backup, fs.constants.COPYFILE_EXCL);
fs.chmodSync(backup, 0o600);
fs.copyFileSync(join(source, 'nginx-bstools-http.inc'), include);
fs.copyFileSync(join(source, 'nginx-bstools-https.conf'), https);
fs.chmodSync(include, 0o644); fs.chmodSync(https, 0o644);
try {
  fs.symlinkSync(https, enabled);
  fs.writeFileSync(target, original.toString().replace(anchor, anchor + '\n    include /etc/nginx/bstools-http.inc;'));
  execFileSync('/usr/sbin/nginx', ['-t'], { stdio: 'inherit' });
  execFileSync('/usr/bin/systemctl', ['reload', 'nginx'], { stdio: 'inherit' });
  console.log('Toolbox routes enabled; original HTTP config backed up.');
} catch (error) {
  fs.writeFileSync(target, original);
  if (fs.existsSync(enabled)) fs.unlinkSync(enabled);
  throw error;
}
