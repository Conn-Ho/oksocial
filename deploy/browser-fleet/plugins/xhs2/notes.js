/**
 * opencli xhs2 notes [--limit 200]
 * Note list from the creator center's note manager (current .note-card DOM): id, title, time,
 * visibility, views, comments, likes, collects, shares, plus `total` (the count on the active tab, e.g. 全部 77).
 * Scrolls until that total is reached or --timeout runs out; without a total, until no new cards appear.
 * A slow link used to stop the scroll early (10 or 60 of 77), so the caller compares rows against `total`.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

const COLLECT = `(() => Array.from(document.querySelectorAll('.note-card')).map((c) => {
  let id = '';
  try { id = JSON.parse(c.getAttribute('data-impression') || '{}')?.noteTarget?.value?.noteId || ''; } catch {}
  const n = Array.from(c.querySelectorAll('.note-card__stat span')).map((s) => Number((s.textContent || '0').replace(/[^\\d.]/g, '')) || 0);
  return { id, title: (c.querySelector('.note-card__title')?.textContent || '').trim(), time: (c.querySelector('.note-card__time')?.textContent || '').trim(),
    visibility: (c.querySelector('.permission_msg')?.textContent || '公开').trim(), cover: c.querySelector('img.content')?.getAttribute('src') || '',
    views: n[0] ?? 0, comments: n[1] ?? 0, likes: n[2] ?? 0, collects: n[3] ?? 0, shares: n[4] ?? 0 };
}))()`;
const TOTAL = `(() => Number((document.querySelector('.tab-item--active')?.textContent || '').replace(/\\D/g, '')) || 0)()`;
// Consecutive scrolls without a new card before giving up: generous when the page told us how many to expect.
const PATIENCE_WITH_TOTAL = 12;
const PATIENCE_WITHOUT_TOTAL = 3;
const MAX_SCROLLS = 200;

cli({
  site: 'xhs2', access: 'read', domain: 'creator.xiaohongshu.com', strategy: Strategy.UI, browser: true,
  name: 'notes', description: 'Creator-center note list with per-note stats (current note-card DOM)',
  args: [{ name: 'limit', required: false, help: 'max notes (default 200)' }, { name: 'timeout', type: 'int', required: false, help: 'seconds allowed for the scroll (default 120)' }],
  columns: ['id', 'title', 'time', 'visibility', 'views', 'comments', 'likes', 'collects', 'shares', 'cover', 'total'],
  func: async (page, kwargs) => {
    const limit = Number(kwargs.limit) || 200;
    const deadline = Date.now() + (Number(kwargs.timeout) || 120) * 1000;
    await page.goto('https://creator.xiaohongshu.com/new/note-manager', { waitUntil: 'load', settleMs: 4000 });
    // the tab count renders with or without notes; an account without notes shows 全部 0 and no card
    await page.wait({ selector: '.note-card, .tab-item--active', timeout: 20 });
    const total = Number(await page.evaluate(TOTAL)) || 0;
    if (!total && !(await page.evaluate(`document.querySelectorAll('.note-card').length`))) {
      return [];
    }
    const target = total ? Math.min(total, limit) : limit;
    const patience = total ? PATIENCE_WITH_TOTAL : PATIENCE_WITHOUT_TOTAL;
    const seen = new Map();
    let stale = 0;
    for (let i = 0; i < MAX_SCROLLS && seen.size < target && Date.now() < deadline; i += 1) {
      const rows = await page.evaluate(COLLECT);
      const before = seen.size;
      for (const r of rows) if (r.id && !seen.has(r.id)) seen.set(r.id, r);
      if (seen.size === before) { stale += 1; if (stale >= patience) break; } else stale = 0;
      await page.evaluate(`(() => { const s = document.scrollingElement || document.documentElement; s.scrollTop = s.scrollHeight; const inner = Array.from(document.querySelectorAll('div')).filter((d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY !== 'visible'); for (const d of inner) d.scrollTop = d.scrollHeight; })()`);
      await page.wait(2);
    }
    return Array.from(seen.values()).slice(0, limit).map((r) => ({ ...r, total }));
  },
});
