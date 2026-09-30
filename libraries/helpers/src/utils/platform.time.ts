// X and Weibo hand over "Thu Oct 01 04:58:57 +0800 2026"; others ISO or unix times.
const CREATED_AT = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{2}:\d{2}:\d{2} [+-]\d{4} \d{4}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UNIX = /^\d{10}(\d{3})?$/;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A platform time for people, in the viewer's time zone (MM-DD HH:mm). Times the platform already
 * wrote for people (7月31日 06:55, 昨天 14:05, 3小时前) are kept as they are.
 */
export const platformTimeLabel = (value?: string | null): string => {
  const text = value?.trim() ?? '';
  const date = UNIX.test(text)
    ? new Date(Number(text) * (text.length === 10 ? 1000 : 1))
    : CREATED_AT.test(text) || ISO.test(text)
      ? new Date(text)
      : null;
  if (!date || Number.isNaN(date.getTime())) {
    return text;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
