import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ok, simChannels, sql } from './lib.mjs';

let ch;
let brand;
before(async () => {
  ch = await simChannels(['xiaohongshu', 'xweb']);
  brand = await ok('/brands', {
    method: 'POST',
    body: { name: 'E2E 品牌', tagline: '帮开发者更快写代码的 AI 工具', tone: '直接、实在', keywords: ['AI 编程'], bannedWords: ['最强', '第一'], products: 'AI 编程助手' },
  });
});
after(async () => {
  if (brand?.id) await ok(`/brands/${brand.id}`, { method: 'DELETE' });
});

test('创作台: titles, video script and 爆款复刻 in the brand voice, without banned words', async () => {
  const titles = await ok('/creation/titles', { method: 'POST', body: { brandId: brand.id, text: '我们上线了一个帮开发者写代码的 AI 工具，支持 20 种语言', platform: 'xiaohongshu', count: 5 } });
  const tText = JSON.stringify(titles);
  assert.ok(tText.length > 50, tText.slice(0, 200));
  assert.ok(!/最强|第一/.test(tText), 'banned words removed');
  const script = await ok('/creation/script', { method: 'POST', body: { brandId: brand.id, brief: '30 秒介绍 AI 编程助手怎么帮新手少踩坑', seconds: 30, platform: 'douyin' } });
  assert.ok(JSON.stringify(script).length > 100);
  const remake = await ok('/creation/remake', { method: 'POST', body: { brandId: brand.id, text: '3 个让新手少走弯路的编程习惯：先写测试、小步提交、让 AI 解释每一行。', platform: 'xiaohongshu', tone: 'casual', length: 'keep' } });
  assert.ok(JSON.stringify(remake).length > 50);
});

test('存为草稿: the desk output lands in the calendar as drafts of the chosen accounts', async () => {
  const marker = `E2E 创作台 ${Date.now().toString(36)}`;
  await ok('/creation/drafts', { method: 'POST', body: { posts: [{ integrationId: ch.xiaohongshu.id, texts: [`${marker} 小红书版`] }, { integrationId: ch.xweb.id, texts: [`${marker} 1/2`, `${marker} 2/2`] }] } });
  const rows = sql(`SELECT state FROM "Post" WHERE content LIKE '%${marker}%' AND "deletedAt" IS NULL`);
  assert.ok(rows.length >= 3 && rows.every((r) => r.state === 'DRAFT'), JSON.stringify(rows));
});

test('历史记录 keeps every generation', async () => {
  const history = await ok('/creation/history?page=1');
  const templates = new Set((history.items || []).map((i) => i.template));
  for (const t of ['titles', 'script', 'remake']) assert.ok(templates.has(t), `history has ${t}: ${[...templates]}`);
});
