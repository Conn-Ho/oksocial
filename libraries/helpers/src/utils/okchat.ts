// okchat (customer service) handles the team's DMs. Shared by the backend and the frontend.

/** Where 「在 okchat 处理私信」 / 「切换到 okchat」 go: okchat signs the member in with oksocial (OAuth). Pure. */
export const okchatEntryUrl = (okchatUrl: string, orgId: string) =>
  `${okchatUrl.replace(/\/+$/, '')}/auth/oksocial?${new URLSearchParams({ team: orgId, intent: 'dm' })}`;
