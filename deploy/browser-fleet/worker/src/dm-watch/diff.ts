/** When a change of the conversation list calls for a DM read. */
import type { ConvSnapshot } from './page.ts';

/**
 * True when the list shows something a read would pick up: a conversation with more unread
 * messages than before, a new last-message preview (a conversation open in another tab gets read
 * at once and keeps 0 unread), or a new conversation with unread messages. Our own reads only lower
 * unread counts and reorder nothing new: they do not count. The first list a watcher sees counts
 * when anything in it is unread. Pure.
 */
export function listChanged(prev: readonly ConvSnapshot[] | undefined, next: readonly ConvSnapshot[]): boolean {
  if (!prev) return next.some(([, unread]) => unread > 0);
  const before = new Map(prev.map(([id, unread, preview]) => [id, { unread, preview }]));
  return next.some(([id, unread, preview]) => {
    const was = before.get(id);
    if (!was) return unread > 0;
    return unread > was.unread || preview !== was.preview;
  });
}
