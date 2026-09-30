import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE, ok, simChannels, slotOf, simWrites, sql, waitFor } from './lib.mjs';

let ch;
const stamp = Date.now().toString(36);

/** Uploads a file to the media library the way the editor does. */
async function upload(file, type) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(file)], { type }), file.split('/').pop());
  const org = process.env.E2E_ORG ? `; showorg=${process.env.E2E_ORG}` : '';
  const res = await fetch(`${BASE}/api/media/upload-server`, { method: 'POST', headers: { cookie: `auth=${process.env.E2E_AUTH}${org}` }, body: form });
  assert.equal(res.status, 201, `upload ${res.status}`);
  return res.json();
}

const body = (integration, values, type = 'now', date = new Date()) => ({
  type,
  shortLink: false,
  date: date.toISOString().slice(0, 19),
  tags: [],
  posts: [
    {
      group: `e2e${stamp}${Math.random().toString(36).slice(2, 7)}`,
      integration: { id: integration.id },
      value: values.map((v) => ({ id: '', delay: 0, content: `<p>${v.text}</p>`, image: v.image ? [v.image] : [] })),
      settings: { __type: integration.identifier },
    },
  ],
});

// the server assigns the group; posts are found by the unique text they carry
const postRows = (marker) =>
  sql(`SELECT id, "group", state, "releaseURL", error, "parentPostId" FROM "Post" WHERE content LIKE '%${marker}%' AND "deletedAt" IS NULL ORDER BY "createdAt"`);

async function publishAndWait(b) {
  const marker = b.posts[0].value[0].content.replace(/<[^>]+>/g, '').split('\n')[0].slice(0, 30);
  const created = await ok('/posts', { method: 'POST', body: b });
  const rows = await waitFor(() => {
    const r = postRows(marker);
    return r.length && r.every((x) => x.state !== 'QUEUE') ? r : null;
  }, { timeoutMs: 240_000, everyMs: 5_000, what: `post "${marker}" leaves the queue` });
  return { created, rows };
}

before(async () => {
  ch = await simChannels();
});

test('小红书: an image note publishes through the worker and gets its note link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
  const img = join(dir, 'cover.jpg');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=900x1200', '-frames:v', '1', img]);
  const media = await upload(img, 'image/jpeg');
  const title = `E2E 小红书 ${stamp} 🎉 标题带表情也不超长的一行字`;
  const { rows } = await publishAndWait(body(ch.xiaohongshu, [{ text: `${title}\n正文第二行`, image: { id: media.id, path: media.path } }]));
  assert.equal(rows[0].state, 'PUBLISHED', `error: ${rows[0].error}`);
  assert.match(rows[0].releaseURL, /xiaohongshu\.com\/explore\/[0-9a-f]{24}/);
  const w = simWrites(slotOf(ch.xiaohongshu.id)).filter((x) => x.args[0] === 'xiaohongshu' && x.args[1] === 'publish').at(-1);
  const t = w.args[w.args.indexOf('--title') + 1];
  assert.ok(t.length <= 20, `title "${t}" is ${t.length} UTF-16 units`);
});

test('微博: a text post publishes', async () => {
  const { rows } = await publishAndWait(body(ch.weibo, [{ text: `E2E 微博 ${stamp}：今天测试一条纯文字微博 #测试#` }]));
  assert.equal(rows[0].state, 'PUBLISHED', `error: ${rows[0].error}`);
  assert.ok(rows[0].releaseURL, 'has a link');
});

test('X: a thread publishes as a post and a reply under it', async () => {
  const before = simWrites(slotOf(ch.xweb.id)).length;
  const { rows } = await publishAndWait(body(ch.xweb, [{ text: `E2E thread ${stamp} 1/2` }, { text: `E2E thread ${stamp} 2/2` }]));
  assert.equal(rows[0].state, 'PUBLISHED', `error: ${rows[0].error}`);
  const writes = simWrites(slotOf(ch.xweb.id)).slice(before).map((w) => w.args.slice(0, 2).join(' '));
  assert.deepEqual(writes.filter((w) => w.startsWith('xq')), ['xq post', 'xq reply']);
});

test('抖音: a video is sent with the platform-side schedule', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-'));
  const vid = join(dir, 'clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=720x1280:rate=25', '-t', '3', '-pix_fmt', 'yuv420p', vid]);
  const media = await upload(vid, 'video/mp4');
  const { rows } = await publishAndWait(body(ch.douyin, [{ text: `E2E 抖音 ${stamp} 测试视频`, image: { id: media.id, path: media.path } }]));
  assert.equal(rows[0].state, 'PUBLISHED', `error: ${rows[0].error}`);
  const w = simWrites(slotOf(ch.douyin.id)).filter((x) => x.args[1] === 'publish').at(-1);
  assert.ok(w, 'douyin publish was run');
});

test('a draft is saved without touching the platform; a future post waits in the queue', async () => {
  const before = simWrites(slotOf(ch.weibo.id)).length;
  const draft = body(ch.weibo, [{ text: `E2E 草稿 ${stamp}` }], 'draft');
  await ok('/posts', { method: 'POST', body: draft });
  const later = body(ch.weibo, [{ text: `E2E 定时 ${stamp}` }], 'schedule', new Date(Date.now() + 2 * 86400_000));
  await ok('/posts', { method: 'POST', body: later });
  await new Promise((r) => setTimeout(r, 15_000));
  assert.equal(postRows(`E2E 草稿 ${stamp}`)[0].state, 'DRAFT');
  const queued = postRows(`E2E 定时 ${stamp}`)[0];
  assert.equal(queued.state, 'QUEUE');
  assert.equal(simWrites(slotOf(ch.weibo.id)).length, before, 'nothing written to the platform');
  // the calendar shows the scheduled one
  const week = await ok(`/posts?startDate=${new Date(Date.now() - 86400_000).toISOString()}&endDate=${new Date(Date.now() + 5 * 86400_000).toISOString()}&customer=`);
  assert.ok(JSON.stringify(week).includes(`E2E 定时 ${stamp}`), 'calendar lists the scheduled post');
  await ok(`/posts/${queued.group}`, { method: 'DELETE' });
});
