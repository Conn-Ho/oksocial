import { Translate, zhDefault } from '@gitroom/helpers/utils/translate';

// The workflow records some failures in fixed English words; the calendar says them in the UI language.
const KNOWN: Array<[RegExp, (m: RegExpMatchArray, t: Translate) => string]> = [
  [/^Could not publish after several attempts$/, (_m, t) => t('post_error_retries_exhausted', '试了几次都没发出去。请先到账号里确认没有发布，再重新发布')],
  [/^Could not confirm the post status$/, (_m, t) => t('post_error_unconfirmed', '已经提交给平台，但没能确认发布成功。请先到账号里看一眼，避免重复发布')],
  [/^Not logged in to (\S+)$/, (m, t) => t('post_error_not_logged_in', '账号掉线了（{{site}} 没有登录），请重新扫码登录后再发布', { site: m[1], interpolation: { escapeValue: false } })],
  [/^Already posted$/, (_m, t) => t('post_error_already_posted', '这条已经发布过了')],
  [/^Refresh channel needed$/, (_m, t) => t('post_error_refresh_needed', '账号已掉线，请重新连接后再发布')],
  [/^Channel disabled$/, (_m, t) => t('post_error_channel_disabled', '账号已停用，启用后再发布')],
];

/** What the calendar shows for a failed post's stored error. */
export const postErrorLabel = (error?: string | null, t: Translate = zhDefault): string => {
  const text = error?.trim();
  if (!text) {
    return t('post_error_failed', '发布失败');
  }
  for (const [pattern, label] of KNOWN) {
    const match = text.match(pattern);
    if (match) {
      return label(match, t);
    }
  }
  return t('post_error_failed_with', '发布失败：{{error}}', { error: text, interpolation: { escapeValue: false } });
};
