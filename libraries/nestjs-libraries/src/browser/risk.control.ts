// A platform that pushes back (risk control, "looks automated") stops a channel's automated
// browser work - automations and monitor reads - for BRAKE_HOURS.
export const BRAKE_HOURS = 6;
export const CHALLENGE_RE = /风控|CHALLENGE|automated|not be allowed/i;
// A platform that says the account is going too fast ("发送太频繁", "操作频繁，请稍后再试").
export const TOO_FREQUENT_RE = /频繁|太快|too (?:many|frequent)/i;
// okchat DMs of an account that hit either stop for this long (reads and sends; okchat contract §7).
export const DM_PAUSE_MINUTES = 30;

/** Whether a failure message is the platform pushing back rather than a plain error. Pure. */
export const isPushback = (message: string) => CHALLENGE_RE.test(message) || TOO_FREQUENT_RE.test(message);
