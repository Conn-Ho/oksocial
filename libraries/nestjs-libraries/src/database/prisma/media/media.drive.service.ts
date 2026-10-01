import { Injectable } from '@nestjs/common';
import { MediaRepository, TRASH_PAGE_SIZE } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { PlanService } from '@gitroom/nestjs-libraries/database/prisma/billing/plan.service';
import { BillingRepository } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.repository';
import { UNLIMITED } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';
import { MEDIA_KINDS, MediaKind, mediaKindOf } from '@gitroom/helpers/utils/media.kind';

export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;
const GB = 1024 ** 3;
// files the scheduled purge handles per round
const PURGE_BATCH = 200;

/** Days a file trashed at `trashedAt` stays in the 回收站 (0: due for the purge). Pure. */
export const trashDaysLeft = (trashedAt: Date, now = new Date()) =>
  Math.max(0, Math.ceil((trashedAt.getTime() + TRASH_DAYS * DAY_MS - now.getTime()) / DAY_MS));

/** Files trashed before this moment are purged. Pure. */
export const purgeCutoff = (now = new Date()) => new Date(now.getTime() - TRASH_DAYS * DAY_MS);

/**
 * 网盘: the media library's kinds, its 回收站 (files stay 30 days, then a scheduled job purges them)
 * and the storage it takes against the plan.
 */
@Injectable()
export class MediaDriveService {
  constructor(
    private _repository: MediaRepository,
    private _planService: PlanService,
    private _billingRepository: BillingRepository
  ) {}

  /** Counts per tab, and the storage used (as the usage page counts it) against the plan's. */
  async summary(org: string) {
    const [all, kinds, trash, usedBytes, plan] = await Promise.all([
      this._repository.countLibrary(org),
      Promise.all(MEDIA_KINDS.map(async (kind) => [kind, await this._repository.countLibrary(org, kind)] as const)),
      this._repository.countTrash(org),
      this._billingRepository.storageBytes(org),
      this._planService.getPlan(org),
    ]);
    const limitGb = plan.limits.storage_gb;
    return {
      counts: { all, ...(Object.fromEntries(kinds) as Record<MediaKind, number>), trash },
      storage: {
        usedBytes,
        // billing off (self-hosting) or no ceiling: only the usage is shown
        limitBytes: plan.billing && limitGb !== UNLIMITED ? limitGb * GB : null,
      },
    };
  }

  async trashList(org: string, page = 1) {
    const { total, rows } = await this._repository.trashList(org, page);
    const now = new Date();
    return {
      total,
      page,
      pages: Math.max(1, Math.ceil(total / TRASH_PAGE_SIZE)),
      items: rows.map((r) => ({
        ...r,
        kind: mediaKindOf(r.path) ?? mediaKindOf(r.name),
        daysLeft: trashDaysLeft(r.trashedAt!, now),
      })),
    };
  }

  restore(org: string, ids: string[]) {
    return this._repository.restore(org, ids);
  }

  /**
   * 彻底删除 of trashed files (all of them without ids): gone from the 网盘 and from the storage
   * count. The stored file itself is kept, as deleting media always did: a post, a set, a
   * signature or an AI 创作 record may still show it.
   */
  async purge(org: string, ids?: string[]) {
    const { count } = await this._repository.purgeTrashed(org, ids);
    return { purged: count };
  }

  emptyTrash(org: string) {
    return this.purge(org, undefined);
  }

  /** Scheduled: files of every organization that spent 30 days in the 回收站. */
  async purgeExpired(now = new Date()) {
    let purged = 0;
    for (;;) {
      const batch = await this._repository.dueForPurge(purgeCutoff(now), PURGE_BATCH);
      if (batch.length) {
        purged += (await this._repository.markPurged(batch.map((r) => r.id))).count;
      }
      if (batch.length < PURGE_BATCH) {
        return { purged };
      }
    }
  }
}
