// okchat bridge configuration. The bridge is on only when both the okchat address and the partner
// secret are set; otherwise its endpoints answer 404 and the UI shows no okchat entry.

/** okchat's base address (OKCHAT_URL, e.g. https://okchat.online), without a trailing slash. */
export const okchatUrl = () => (process.env.OKCHAT_URL || '').trim().replace(/\/+$/, '');

/** The partner secret both sides sign with (OKCHAT_PARTNER_SECRET). Never logged or returned. */
export const okchatSecret = () => (process.env.OKCHAT_PARTNER_SECRET || '').trim();

export const okchatEnabled = () => !!okchatUrl() && !!okchatSecret();
