// Behaviour every simulated account shares: its own posts gain a little engagement on every read,
// a new audience comment arrives every N reads, and ids it has listed are remembered so a later
// read of the same id shows the same title and author.
import { hash32, rng } from './core.mjs';

/** A new incoming comment every this many reads (SIM_NEW_COMMENT_EVERY, default 3). */
export const commentEvery = () => Math.max(1, Math.trunc(Number(process.env.SIM_NEW_COMMENT_EVERY)) || 3);

const REMEMBERED_MAX = 2000;

/** Bump the account's own post metrics once: views always, the rest now and then. */
export function growPosts(acct, isLive = () => true) {
  const r = rng(hash32(acct.seed, 'grow', acct.reads));
  for (const p of acct.posts) {
    if (!isLive(p)) continue;
    p.views += 3 + Math.floor(r() * 20);
    if (r() < 0.6) p.likes += 1 + Math.floor(r() * 2);
    if (r() < 0.3) p.collects += 1;
    if (r() < 0.15) p.shares += 1;
  }
  if (r() < 0.5) acct.followers += 1;
}

/** Called before every read command: count it, grow metrics, and maybe let a new comment arrive. */
export function onRead(acct, spawn, isLive) {
  acct.reads += 1;
  growPosts(acct, isLive);
  if (acct.reads % commentEvery() === 0) {
    spawn(acct, acct.spawned);
    acct.spawned += 1;
  }
}

/** Remember what a listing showed for an id of someone else's post (bounded, oldest dropped first). */
export function remember(acct, id, info) {
  acct.seen ??= {};
  delete acct.seen[id];
  acct.seen[id] = info;
  const keys = Object.keys(acct.seen);
  for (const k of keys.slice(0, Math.max(0, keys.length - REMEMBERED_MAX))) delete acct.seen[k];
  return info;
}
export const recall = (acct, id) => acct.seen?.[id];

/** A fresh id seed for something this account creates (posts, replies, messages). */
export function nextSerial(acct) {
  acct.serial = (acct.serial ?? 0) + 1;
  return acct.serial;
}
