// okchat (customer service) handles the team's DMs. Shared by the backend and the frontend.

/** Where 「在 okchat 处理私信」 / 「切换到 okchat」 go: okchat signs the member in with oksocial (OAuth). Pure. */
export const okchatEntryUrl = (okchatUrl: string, orgId: string) =>
  `${okchatUrl.replace(/\/+$/, '')}/auth/oksocial?${new URLSearchParams({ team: orgId, intent: 'dm' })}`;

/**
 * `value` as a path of this site (path, query and hash) when it stays on `origin`, else null: never
 * another site, a protocol-relative `//host` or a script URL. Tabs, line breaks and backslashes are
 * refused outright: browsers drop or rewrite them, so `/\t/evil.com` would open `//evil.com`. Pure.
 */
export const sameSitePath = (value: string | null | undefined, origin: string) => {
  if (!value || !value.startsWith('/') || /[\t\r\n\\]/.test(value)) {
    return null;
  }
  try {
    const url = new URL(value, origin);
    // dot segments can still resolve to //host (`/.//evil.com`)
    if (url.origin !== new URL(origin).origin || url.pathname.startsWith('//')) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};
