import { HttpException, Injectable } from '@nestjs/common';
import { DmReplyPolicy, InboxKind, SyncSettings } from '@prisma/client';
import { SyncSettingsRepository } from '@gitroom/nestjs-libraries/database/prisma/sync-settings/sync.settings.repository';
import { CreditsService } from '@gitroom/nestjs-libraries/database/prisma/billing/credits.service';

export type SyncSettingsValues = Omit<SyncSettings, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>;
type SwitchKey = Exclude<keyof SyncSettingsValues, 'dmReplyPolicy'>;

// What oksocial did before the 同步与 AI panel existed: an organization without a row keeps it.
export const DEFAULT_SYNC_SETTINGS: SyncSettingsValues = {
  commentSync: true,
  dmSync: true,
  mentionSync: true,
  commentAiTag: true,
  dmAiTag: true,
  commentTranslateIn: false,
  commentTranslateOut: false,
  dmTranslateIn: false,
  dmTranslateOut: false,
  dmReplyPolicy: null,
  monitorCommentSync: true,
  monitorAiTag: false,
  competitorCommentSync: false,
  competitorAiTag: false,
};

const SWITCHES = Object.keys(DEFAULT_SYNC_SETTINGS).filter((k) => k !== 'dmReplyPolicy') as SwitchKey[];
const POLICIES: DmReplyPolicy[] = ['ONCE', 'CONTINUOUS'];
// the price-table actions the panel shows next to its rows
const PRICED = ['ai_tag', 'ai_translate', 'monitor_sync'] as const;

/** The switches of a stored row, or the defaults when the organization has none. Pure. */
export const settingsOf = (row: SyncSettings | null): SyncSettingsValues =>
  row
    ? {
        ...Object.fromEntries(SWITCHES.map((k) => [k, row[k]])),
        dmReplyPolicy: row.dmReplyPolicy,
      } as SyncSettingsValues
    : { ...DEFAULT_SYNC_SETTINGS };

// @mentions are someone's post or comment about us: they follow the comment switches for AI work
const commentLike = (kind: InboxKind) => kind !== 'DM';

/** Whether the inbox keeps items of this kind. Pure. */
export const inboxKindSynced = (s: SyncSettingsValues, kind: InboxKind) =>
  kind === 'DM' ? s.dmSync : kind === 'MENTION' ? s.mentionSync : s.commentSync;

/** Whether new items of this kind get AI tags. Pure. */
export const inboxKindTagged = (s: SyncSettingsValues, kind: InboxKind) =>
  commentLike(kind) ? s.commentAiTag : s.dmAiTag;

/** Whether new items of this kind are translated to Chinese when they arrive. Pure. */
export const inboxKindTranslatedIn = (s: SyncSettingsValues, kind: InboxKind) =>
  commentLike(kind) ? s.commentTranslateIn : s.dmTranslateIn;

/** Whether replies to this kind go out in the customer's language. Pure. */
export const inboxKindTranslatedOut = (s: SyncSettingsValues, kind: InboxKind) =>
  commentLike(kind) ? s.commentTranslateOut : s.dmTranslateOut;

/** How an AI 私信助手 answers: the team policy when it set one, else the automation's own. Pure. */
export const dmStrategyFor = (policy: DmReplyPolicy | null, own: 'once' | 'continuous'): 'once' | 'continuous' =>
  policy === 'ONCE' ? 'once' : policy === 'CONTINUOUS' ? 'continuous' : own;

/**
 * 团队设置 › 同步与 AI: what the background sync reads and which AI work runs on it. Read by the
 * inbox sync and replies, the monitor reads and the DM assistant; edited in the settings page.
 */
@Injectable()
export class SyncSettingsService {
  constructor(
    private _repository: SyncSettingsRepository,
    private _credits: CreditsService
  ) {}

  async get(orgId: string) {
    return settingsOf(await this._repository.get(orgId));
  }

  /** Changes some switches; anything that is not a known switch with the right type is refused. */
  async update(orgId: string, changes: Partial<SyncSettingsValues>) {
    const data: Partial<SyncSettingsValues> = {};
    for (const [key, value] of Object.entries(changes || {})) {
      // a DTO instance carries the switches that were not sent as undefined
      if (value === undefined) {
        continue;
      }
      if (key === 'dmReplyPolicy') {
        if (value !== null && !POLICIES.includes(value as DmReplyPolicy)) {
          throw new HttpException('私信自动回复策略不正确', 400);
        }
        data.dmReplyPolicy = value as DmReplyPolicy | null;
        continue;
      }
      if (!SWITCHES.includes(key as SwitchKey)) {
        continue;
      }
      if (typeof value !== 'boolean') {
        throw new HttpException(`「${key}」只能是开或关`, 400);
      }
      data[key as SwitchKey] = value;
    }
    return settingsOf(await this._repository.upsert(orgId, data));
  }

  /** The switches and, when billing is on, what each priced row costs per item / read. */
  async panel(orgId: string) {
    const prices = Object.fromEntries(
      this._credits
        .prices()
        .filter((p) => (PRICED as readonly string[]).includes(p.action))
        .map((p) => [p.action, p.credits])
    ) as Record<(typeof PRICED)[number], number>;
    return { settings: await this.get(orgId), billing: this._credits.enabled, prices };
  }
}
