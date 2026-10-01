// What the sidebar footer shows about the signed-in member and the team's plan: the name and
// avatar letters of the account card, the plan card's 升级 / 续费 link and its usage bar.

/** The member's name: the profile name, or the part of the email before the @. */
export const userDisplayName = (user: {
  name?: string | null;
  lastName?: string | null;
  email?: string | null;
}) => {
  const full = [user.name, user.lastName]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join(' ');
  return full || (user.email || '').split('@')[0].trim();
};

const LATIN_WORD = /^[A-Za-z]/;

/** The avatar letters when there is no picture: CH for "Conn Ho", 贺 for 贺永贤. */
export const userInitials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return '·';
  }
  if (words.length > 1 && LATIN_WORD.test(words[0]) && LATIN_WORD.test(words[1])) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  // Array.from keeps an emoji or a CJK character whole
  return (Array.from(words[0])[0] || '·').toUpperCase();
};

export type PlanLinkKind = 'upgrade' | 'renew' | 'details';

/**
 * The plan card's link: a free or trial team upgrades, a prepaid plan renews, a lifetime plan has
 * nothing to renew and only links to its details.
 */
export const planLinkKind = (
  tier: string,
  subscription: { isTrial: boolean; isLifetime: boolean } | null
): PlanLinkKind => {
  if (!subscription || tier === 'FREE' || subscription.isTrial) {
    return 'upgrade';
  }
  return subscription.isLifetime ? 'details' : 'renew';
};

/** How full a limit is, 0 to 1; null when it is unlimited (-1) or the count is unknown. */
export const usageRatio = (used: number | null, limit: number) => {
  if (limit === -1 || used === null) {
    return null;
  }
  return limit === 0 ? 1 : Math.min(1, used / limit);
};
