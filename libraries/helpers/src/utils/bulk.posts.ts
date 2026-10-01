import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import utc from 'dayjs/plugin/utc';
import { Translate, zhDefault } from '@gitroom/helpers/utils/translate';
dayjs.extend(customParseFormat);
dayjs.extend(utc);

// Spreadsheet import of posts (one row = one post). Pure planning: parsing and validation only;
// the UI resolves media and sends the create-post requests.

export const BULK_HEADERS = ['账号', '发布时间', '正文', '首评', '图片', '保存为'] as const;

export const BULK_TIME_FORMATS = [
  'YYYY-MM-DD HH:mm',
  'YYYY-MM-DD HH:mm:ss',
  'YYYY/MM/DD HH:mm',
  'YYYY/M/D H:mm',
  'YYYY-M-D H:mm',
];

export type BulkRowInput = {
  account?: unknown;
  time?: unknown;
  content?: unknown;
  firstComment?: unknown;
  media?: unknown;
  mode?: unknown;
};

export type BulkIntegration = {
  id: string;
  name: string;
  identifier: string;
  internalId?: string;
  display?: string | null;
  disabled?: boolean;
};

export type BulkPlanRow = {
  row: number;
  integration?: BulkIntegration;
  date?: Date;
  content: string;
  firstComment: string;
  mediaRefs: string[];
  draft: boolean;
  errors: string[];
};

export type BulkOptions = {
  // first slot for rows without a time
  start: Date;
  intervalMinutes: number;
  now?: Date;
};

const text = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();

const norm = (v: string) => v.trim().replace(/^@/, '').toLowerCase();

/** Finds the channel a row refers to by name, handle or platform id; must be unambiguous. */
export const matchIntegration = (
  account: string,
  integrations: BulkIntegration[],
  t: Translate = zhDefault
): { integration?: BulkIntegration; error?: string } => {
  const key = norm(account);
  if (!key) {
    return { error: t('bulk_error_no_account', '缺少账号') };
  }
  const hits = integrations.filter((i) =>
    [i.name, i.display, i.internalId].some((v) => v && norm(String(v)) === key)
  );
  if (!hits.length) {
    return {
      error: t('bulk_error_account_not_found', '找不到账号「{{account}}」', {
        account,
        interpolation: { escapeValue: false },
      }),
    };
  }
  if (hits.length > 1) {
    return {
      error: t('bulk_error_account_ambiguous', '有多个账号叫「{{account}}」，请改写成账号 ID', {
        account,
        interpolation: { escapeValue: false },
      }),
    };
  }
  if (hits[0].disabled) {
    return {
      error: t('bulk_error_account_disabled', '账号「{{account}}」已停用', {
        account,
        interpolation: { escapeValue: false },
      }),
    };
  }
  return { integration: hits[0] };
};

/** Excel dates arrive as Date objects; typed cells as text in one of BULK_TIME_FORMATS (local time). */
export const parseBulkTime = (value: unknown): Date | undefined | null => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  const parsed = dayjs(text(value), BULK_TIME_FORMATS, true);
  return parsed.isValid() ? parsed.toDate() : null;
};

export const splitMediaRefs = (value: unknown) =>
  text(value)
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

export const planBulkPosts = (
  rows: BulkRowInput[],
  integrations: BulkIntegration[],
  options: BulkOptions,
  t: Translate = zhDefault
): BulkPlanRow[] => {
  const now = options.now ?? new Date();
  let untimed = 0;
  return rows.map((input, index) => {
    const errors: string[] = [];
    const { integration, error } = matchIntegration(text(input.account), integrations, t);
    if (error) {
      errors.push(error);
    }
    const content = text(input.content);
    if (!content) {
      errors.push(t('bulk_error_empty_content', '正文为空'));
    }
    const draft = /草稿|draft/i.test(text(input.mode));
    const parsed = parseBulkTime(input.time);
    let date: Date | undefined;
    if (parsed === null) {
      errors.push(
        t('bulk_error_bad_time', '发布时间「{{time}}」看不懂，请用 2026-10-01 20:30 这种格式', {
          time: text(input.time),
          interpolation: { escapeValue: false },
        })
      );
    } else if (parsed) {
      date = parsed;
    } else {
      date = new Date(options.start.getTime() + untimed * options.intervalMinutes * 60_000);
      untimed += 1;
    }
    if (date && !draft && date.getTime() <= now.getTime()) {
      errors.push(t('bulk_error_time_passed', '发布时间已过去'));
    }
    return {
      row: index + 2, // row 1 is the header in the sheet
      integration,
      date,
      content,
      firstComment: text(input.firstComment),
      mediaRefs: splitMediaRefs(input.media),
      draft,
      errors,
    };
  });
};

/** Create-post request for one planned row (the same shape the editor sends). */
export const toCreatePostBody = (
  plan: BulkPlanRow,
  media: Array<{ id: string; path: string }>
) => {
  if (!plan.integration || !plan.date) {
    throw new Error(`row ${plan.row} is not valid`);
  }
  const value = [
    { content: plan.content, image: media },
    ...(plan.firstComment ? [{ content: plan.firstComment, image: [] }] : []),
  ];
  return {
    type: plan.draft ? 'draft' : 'schedule',
    shortLink: false,
    date: dayjs(plan.date).utc().format('YYYY-MM-DDTHH:mm:ss'),
    tags: [] as Array<{ value: string; label: string }>,
    posts: [
      {
        integration: { id: plan.integration.id },
        value,
        settings: { __type: plan.integration.identifier },
      },
    ],
  };
};
