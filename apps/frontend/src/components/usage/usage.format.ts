import { discountNumber } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.pricing';
import type { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { OrderRow, OrderStatus, PayType, TermChange } from '@gitroom/frontend/components/usage/usage.hooks';

/** The translate function of useT: t('key', '中文', { values }). */
export type Translate = ReturnType<typeof useT>;

export const planName = (t: Translate, tier: string | null | undefined) =>
  tier === 'STANDARD'
    ? t('plan_standard', '基础版')
    : tier === 'TEAM'
    ? t('plan_team', '团队版')
    : tier === 'ENTERPRISE'
    ? t('plan_enterprise', '企业版')
    : t('plan_free', '免费版');

export const durationLabel = (t: Translate, months: number) =>
  months === 1
    ? t('billing_by_month', '按月')
    : months === 3
    ? t('billing_by_quarter', '按季')
    : months === 6
    ? t('billing_by_half_year', '按半年')
    : months === 12
    ? t('billing_by_year', '按年')
    : t('billing_n_months', '{{n}} 个月', { n: months });

/** 季付优惠 / 半年付优惠 / 年付优惠 */
export const durationDiscountLabel = (t: Translate, months: number) =>
  months === 3
    ? t('billing_quarterly_discount', '季付优惠')
    : months === 6
    ? t('billing_half_year_discount', '半年付优惠')
    : months === 12
    ? t('billing_yearly_discount', '年付优惠')
    : t('billing_n_months_discount', '{{n}} 个月优惠', { n: months });

/** '8折' / '95折' (English: '20% off' / '5% off'); '' when there is no discount. */
export const discountLabel = (t: Translate, percent: number) => {
  const n = discountNumber(percent);
  return n ? t('billing_discount', '{{n}}折', { n, pct: 100 - percent }) : '';
};

/** ¥3,312.00 */
export const yuan = (value: string | number) =>
  `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ¥49 for whole amounts, ¥55.20 otherwise. */
export const shortYuan = (value: string | number) => {
  const n = Number(value);
  return Number.isInteger(n) ? `¥${n.toLocaleString('zh-CN')}` : yuan(n);
};

export const count = (n: number) => n.toLocaleString('zh-CN');

export const limitText = (t: Translate, n: number | undefined, unit = '') =>
  n === undefined ? '—' : n === -1 ? t('billing_unlimited', '不限') : `${count(n)}${unit ? ` ${unit}` : ''}`;

export const LIMIT_TEXT: Record<string, [string, string]> = {
  channels: ['billing_limit_channels', '账号数'],
  team_members: ['billing_limit_members', '团队成员'],
  competitors: ['billing_limit_competitors', '竞品账号'],
  monitored_posts: ['billing_limit_monitored_posts', '监控帖文'],
  keywords: ['billing_limit_keywords', '监控关键词'],
  storage_gb: ['billing_limit_storage', '素材空间'],
  monthly_credits: ['billing_limit_monthly_credits', '每月赠送积分'],
  history_days: ['billing_limit_history', '数据分析'],
};

export const UNIT_TEXT: Record<string, [string, string]> = {
  channels: ['billing_unit_account', '个'],
  team_members: ['billing_unit_person', '人'],
  competitors: ['billing_unit_account', '个'],
  monitored_posts: ['billing_unit_post', '条'],
  keywords: ['billing_unit_keyword', '个'],
  storage_gb: ['billing_unit_gb', 'GB'],
  monthly_credits: ['billing_unit_credits', '积分'],
  history_days: ['billing_unit_days', '天'],
};

export const limitLabel = (t: Translate, key: string, fallback?: string) => {
  const [k, d] = LIMIT_TEXT[key] ?? [`billing_limit_${key}`, fallback ?? key];
  return t(k, d);
};

export const unitLabel = (t: Translate, key: string, fallback = '') => {
  const [k, d] = UNIT_TEXT[key] ?? [`billing_unit_${key}`, fallback];
  return d ? t(k, d) : '';
};

export const featureLabel = (t: Translate, key: string, fallback?: string) =>
  key === 'approval'
    ? t('billing_feature_approval', '发帖审核流程')
    : key === 'share_reports'
    ? t('billing_feature_share_reports', '分享报告链接')
    : key === 'weekly_email'
    ? t('billing_feature_weekly_email', '每周邮件周报')
    : fallback ?? key;

export const payLabel = (t: Translate, payType: PayType | string) =>
  payType === 'native' ? t('pay_wechat', '微信支付') : payType === 'alipay' ? t('pay_alipay', '支付宝') : '—';

export const changeLabel = (t: Translate, change: TermChange) =>
  ({
    new: t('billing_change_new', '新开通，立即生效'),
    renew: t('billing_change_renew', '续费，接在当前到期日之后'),
    upgrade: t('billing_change_upgrade', '变更套餐，立即生效，剩余价值折算成新套餐的天数'),
    downgrade: t('billing_change_downgrade', '变更套餐，立即生效，剩余价值折算成新套餐的天数'),
    addon: t('billing_change_addon', '加购账号，到期日不变'),
  })[change];

export const orderStatusLabel = (t: Translate, status: OrderStatus) =>
  ({
    PENDING: t('order_pending', '待支付'),
    PAID: t('order_paid', '已完成'),
    CLOSED: t('order_closed', '已关闭'),
    EXPIRED: t('order_expired', '已过期'),
  })[status];

export const ledgerKindLabel = (t: Translate, kind: string) =>
  ({
    GRANT: t('ledger_grant', '套餐赠送'),
    EXPIRE: t('ledger_expire', '赠送过期'),
    TOPUP: t('ledger_topup', '充值'),
    SPEND: t('ledger_spend', '消耗'),
    REFUND: t('ledger_refund', '失败退回'),
    BONUS: t('ledger_bonus', '奖励'),
  })[kind] ?? kind;

/** What an order bought, in the reader's language. */
export const orderTitle = (t: Translate, o: Pick<OrderRow, 'kind' | 'tier' | 'accounts' | 'months' | 'days' | 'name'>) => {
  const plan = planName(t, o.tier);
  switch (o.kind) {
    case 'plan':
      return o.months
        ? t('order_title_plan', '{{plan}} · {{accounts}} 个账号 · {{months}} 个月', { plan, accounts: o.accounts, months: o.months })
        : o.name;
    case 'addon':
      return t('order_title_addon', '{{plan}} · 加购 {{accounts}} 个账号', { plan, accounts: o.accounts });
    case 'trial':
      return t('order_title_trial', '{{plan}}试用 · {{accounts}} 个账号 · {{days}} 天', { plan, accounts: o.accounts, days: o.days });
    case 'coupon':
      return t('order_title_coupon', '兑换券 · {{plan}} · {{days}} 天', { plan, days: o.days });
    default:
      return o.name;
  }
};

export const orderKindLabel = (t: Translate, kind: OrderRow['kind']) =>
  kind === 'plan'
    ? t('order_kind_plan', '购买')
    : kind === 'addon'
    ? t('order_kind_addon', '加购')
    : kind === 'pack'
    ? t('order_kind_pack', '积分')
    : kind === 'trial'
    ? t('order_kind_trial', '试用')
    : kind === 'coupon'
    ? t('order_kind_coupon', '兑换')
    : '—';
