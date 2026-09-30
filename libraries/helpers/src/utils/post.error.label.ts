// The workflow records some failures in fixed English words; the calendar says them in Chinese.
const KNOWN: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^Could not publish after several attempts$/, () => '试了几次都没发出去。请先到账号里确认没有发布，再重新发布'],
  [/^Could not confirm the post status$/, () => '已经提交给平台，但没能确认发布成功。请先到账号里看一眼，避免重复发布'],
  [/^Not logged in to (\S+)$/, (m) => `账号掉线了（${m[1]} 没有登录），请重新扫码登录后再发布`],
  [/^Already posted$/, () => '这条已经发布过了'],
];

/** What the calendar shows for a failed post's stored error. */
export const postErrorLabel = (error?: string | null): string => {
  const text = error?.trim();
  if (!text) {
    return '发布失败';
  }
  for (const [pattern, label] of KNOWN) {
    const match = text.match(pattern);
    if (match) {
      return label(match);
    }
  }
  return `发布失败：${text}`;
};
