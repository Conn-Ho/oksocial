import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listChanged } from '../src/dm-watch/diff.ts';
import type { ConvSnapshot } from '../src/dm-watch/page.ts';

const c = (id: string, unread: number, preview = 'p0'): ConvSnapshot => [id, unread, preview];

describe('listChanged: whether the conversation list calls for a read', () => {
  it('a new message: more unread, or a new preview (a conversation already open elsewhere stays at 0)', () => {
    assert.equal(listChanged([c('a', 0), c('b', 1)], [c('a', 0), c('b', 2)]), true);
    assert.equal(listChanged([c('a', 0, 'x')], [c('a', 0, 'y')]), true);
  });

  it('a new conversation with unread messages', () => {
    assert.equal(listChanged([c('a', 0)], [c('n', 1), c('a', 0)]), true);
    // one that only scrolled into the top of the list, already read
    assert.equal(listChanged([c('a', 0)], [c('a', 0), c('old', 0)]), false);
  });

  it('not our own read: unread going down, or the list reordered', () => {
    assert.equal(listChanged([c('a', 2), c('b', 1)], [c('a', 0), c('b', 1)]), false);
    assert.equal(listChanged([c('a', 0), c('b', 0)], [c('b', 0), c('a', 0)]), false);
    assert.equal(listChanged([c('a', 0), c('b', 0)], [c('a', 0)]), false);
  });

  it('the first list a watcher sees: a read only when something is unread', () => {
    assert.equal(listChanged(undefined, [c('a', 0), c('b', 0)]), false);
    assert.equal(listChanged(undefined, [c('a', 0), c('b', 3)]), true);
    assert.equal(listChanged(undefined, []), false);
  });
});
