#!/usr/bin/env node
// Bridge extension in one slot Chrome, over its CDP port.
//   extension-ctl.mjs reload <cdpPort>          reload the extension from disk
//   extension-ctl.mjs verify <cdpPort> <file>   exit 0 when the running service worker is <file>,
//                                               1 when it is another build, 3 when it can't be read
// A Chrome restart alone keeps running the cached service worker while the manifest version is
// unchanged, so a new build needs `reload` before the restart.
import { readFileSync } from 'node:fs';

const TIMEOUT_MS = 5_000;
const [cmd, port, file] = process.argv.slice(2);

const unreadable = (why) => {
  console.error(`${port}: could not inspect the extension (${why})`);
  process.exit(3);
};

const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  .then((r) => r.json())
  .catch((err) => unreadable(`DevTools: ${err.message}`));
const sw = targets.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
if (!sw) unreadable('no extension service worker yet');

const ws = new WebSocket(sw.webSocketDebuggerUrl);
const opened = new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('socket failed'));
  setTimeout(() => reject(new Error('socket did not open')), TIMEOUT_MS);
});
await opened.catch((err) => unreadable(err.message));

let nextId = 0;
const pending = new Map();
const scripts = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Debugger.scriptParsed' && m.params.url === sw.url) scripts.push(m.params.scriptId);
  if (pending.has(m.id)) pending.get(m.id)(m);
};
ws.onclose = () => unreadable('socket closed');
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => reject(new Error(`${method} timed out`)), TIMEOUT_MS);
  });

if (cmd === 'reload') {
  ws.onclose = null; // the reload itself drops the socket
  ws.send(JSON.stringify({ id: 0, method: 'Runtime.evaluate', params: { expression: 'chrome.runtime.reload()' } }));
  await new Promise((r) => setTimeout(r, 500));
  console.log(`${port}: reloaded`);
  process.exit(0);
}
if (cmd === 'verify') {
  const answer = await send('Debugger.enable').then(() => send('Debugger.getScriptSource', { scriptId: scripts[0] })).catch((err) => unreadable(err.message));
  if (!scripts.length || answer.error || typeof answer.result?.scriptSource !== 'string') {
    unreadable(answer.error?.message || 'service worker source not found');
  }
  const same = answer.result.scriptSource === readFileSync(file, 'utf8');
  console.log(`${port}: ${same ? 'running the installed build' : 'STILL RUNNING AN OLD BUILD'}`);
  process.exit(same ? 0 : 1);
}
console.error('usage: extension-ctl.mjs reload <cdpPort> | verify <cdpPort> <file>');
process.exit(2);
