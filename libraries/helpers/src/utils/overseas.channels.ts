/**
 * Browser channels of overseas platforms. A new account of one of these logs in behind the team's
 * exit IP (出口代理) from its first page on, without asking: that IP is what the team set up for them.
 */
export const OVERSEAS_BROWSER_CHANNELS: ReadonlySet<string> = new Set([
  'xweb',
  'instagramweb',
  'facebookweb',
  'tiktokweb',
  'youtubeweb',
  'linkedinweb',
  'redditweb',
  'pinterestweb',
]);

export const isOverseasChannel = (identifier: string) => OVERSEAS_BROWSER_CHANNELS.has(identifier);
