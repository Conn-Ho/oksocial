import { Injectable } from '@nestjs/common';
import { BrowserFleetError, browserFleet } from '@gitroom/nestjs-libraries/browser/browser.fleet.client';
import type { BrowserFleetClient, DmWatcherStatus } from '@gitroom/nestjs-libraries/browser/browser.fleet.client';
import { OkchatRepository } from '@gitroom/nestjs-libraries/database/prisma/okchat/okchat.repository';
import { okchatDmWatchScope } from '@gitroom/nestjs-libraries/okchat/okchat.config';

// the platforms the browser worker can watch in real time (its watcher knows www.xiaohongshu.com/chat)
export const DM_WATCH_PROVIDERS = ['xiaohongshu'];
// a healthy watcher stretches the account's poll to DM_WATCHED_READ_EVERY_MS until then: a watch
// that stops reporting (workflow, worker or tab down) lapses back to the 1-minute poll by itself
export const DM_WATCH_HEALTH_TTL_MS = 3 * 60_000;
// how long one long poll of the worker waits for a change (the worker allows 55 s)
export const DM_WATCH_WAIT_MS = 50_000;

const unsupported = (err: unknown) => err instanceof BrowserFleetError && err.status === 404;

/**
 * okchat 私信通道, in real time: the browser worker keeps a tab on each linked account's web IM and
 * reports when its conversation list changes (deploy/browser-fleet, "Real-time DM watch").
 * okchatDmWatchWorkflow keeps the watched accounts in step, long-polls the changes and reads each
 * changed account right away through OkchatDmService.readOne.
 */
@Injectable()
export class OkchatDmWatchService {
  protected fleet: Pick<BrowserFleetClient, 'configured' | 'dmWatch' | 'dmWatchChanges'> = browserFleet;

  constructor(private _repository: OkchatRepository) {}

  /**
   * Tells the worker every account to watch (the others' tabs close) and records their health. The
   * accounts left out by OKCHAT_DM_WATCH are read every minute.
   */
  async sync(now = new Date()) {
    if (!this.fleet.configured) {
      return { watching: false, accounts: 0, healthy: 0 };
    }
    const scope = okchatDmWatchScope();
    const all = await this._repository.watchableBindings(DM_WATCH_PROVIDERS, now);
    const bindings = scope === 'all' ? all : scope === 'off' ? [] : all.filter((b) => scope.has(b.integrationId));
    const left = all.filter((b) => !bindings.includes(b)).map((b) => b.integrationId);
    let watchers: DmWatcherStatus[];
    try {
      watchers = (await this.fleet.dmWatch(bindings.map((b) => ({ slot: b.integration.token, key: b.integrationId })))).watchers;
    } catch (err) {
      // a worker from before the watch: the poll goes on every minute
      if (unsupported(err)) {
        return { watching: false, accounts: bindings.length, healthy: 0, unsupported: true };
      }
      throw err;
    }
    const ids = bindings.map((b) => b.integrationId);
    const healthy = new Set(watchers.filter((w) => w.healthy).map((w) => w.key));
    await this._repository.setWatchHealth(
      ids.filter((id) => healthy.has(id)),
      [...ids.filter((id) => !healthy.has(id)), ...left],
      new Date(now.getTime() + DM_WATCH_HEALTH_TTL_MS)
    );
    return { watching: ids.length > 0, accounts: ids.length, healthy: ids.filter((id) => healthy.has(id)).length };
  }

  /** The accounts whose list changed after `cursor` (waiting up to DM_WATCH_WAIT_MS), each once. */
  async changes(cursor: string | null) {
    try {
      const res = await this.fleet.dmWatchChanges(cursor, DM_WATCH_WAIT_MS);
      return { cursor: res.cursor, integrationIds: [...new Set(res.changes.map((c) => c.key))] };
    } catch (err) {
      if (unsupported(err)) {
        return { cursor, integrationIds: [] as string[], unsupported: true };
      }
      throw err;
    }
  }
}
