import { Integration } from '@prisma/client';
import type { CreditAction } from '@gitroom/nestjs-libraries/database/prisma/billing/billing.plans';

export interface ClientInformation {
  client_id: string;
  client_secret: string;
  instanceUrl: string;
}
export interface IAuthenticator {
  authenticate(
    params: {
      code: string;
      codeVerifier: string;
      refresh?: string;
    },
    clientInformation?: ClientInformation
  ): Promise<AuthTokenDetails | string>;
  refreshToken(refreshToken: string): Promise<AuthTokenDetails>;
  reConnect?(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>>;
  generateAuthUrl(
    clientInformation?: ClientInformation
  ): Promise<GenerateAuthUrlResponse>;
  analytics?(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]>;
  postAnalytics?(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number,
  ): Promise<AnalyticsData[]>;
  changeNickname?(
    id: string,
    accessToken: string,
    name: string
  ): Promise<{ name: string }>;
  changeProfilePicture?(
    id: string,
    accessToken: string,
    url: string
  ): Promise<{ url: string }>;
  missing?(
    id: string,
    accessToken: string
  ): Promise<{ id: string; url: string }[]>;
}

export interface AnalyticsData {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
}


export type BrowserSessionIdentity = {
  id: string;
  name: string;
  username: string;
  picture?: string;
};

// oksocial's own login form: per-platform additions to the worker's generic detection (CSS selectors
// unless noted). Nothing here is secret.
export type BrowserLoginFormHints = {
  // host + path prefixes of the login pages (no scheme): a page outside them that asks for nothing means
  // the login is done. Default: the login page (and form page) itself.
  loginUrls?: string[];
  identifier?: string;
  password?: string;
  code?: string;
  // the button that submits the current step (Next / Log in / Verify)
  submit?: string;
  error?: string;
  prompt?: string;
  captcha?: string;
};

export type BrowserSession = {
  // Page opened in the account's browser for the user to log in (QR code or password).
  loginUrl: string;
  // opencli command (without -f json) whose output identifies the logged-in account.
  whoami: string[];
  // Maps the whoami rows to an identity, or null when the browser is not logged in.
  identity(rows: unknown): BrowserSessionIdentity | null;
  // Cookies that only exist after a real login. While someone scans the QR code the check only
  // reads these (whoami would navigate the very page they are looking at).
  loginCookies?: { domain: string; names: string[] };
  // CSS selector clicked when the login page shows no QR code yet (it opens on SMS login), so the
  // login dialog can show the code large.
  qrReveal?: string;
  // A second site of the platform with its own login, needed by some features (小红书网页版 for
  // DMs and notifications). Logged in after the main login, in the same browser: `cookies` appear
  // with the login, `verify` (an opencli command) succeeds only while it is logged in.
  web?: { url: string; label: string; cookies: { domain: string; names: string[] }; verify: string[] };
  // Password platforms (no QR code to scan): the login dialog shows oksocial's own form for the step the
  // login page is on (account, password, verification code) and the worker types what the user enters
  // into that page; it is never stored or logged. Captchas and unknown steps fall back to the live
  // screen. `url`: the page with the password form when loginUrl opens on another method (TikTok opens
  // on its QR code).
  form?: { url?: string; hints?: BrowserLoginFormHints };
};

export type InboxKind = 'COMMENT' | 'DM' | 'MENTION';

// One comment / message / mention read from a platform for the oksocial inbox.
export type InboxFetched = {
  kind: InboxKind;
  // platform id, or a stable content hash when the platform exposes none
  externalId: string;
  threadId?: string;
  threadTitle?: string;
  threadUrl?: string;
  // what reply() needs to answer this item (tweet URL, conversation id, ...)
  replyTarget?: string;
  authorName: string;
  authorId?: string;
  authorUrl?: string;
  authorAvatar?: string;
  content: string;
  platformTime?: string;
};

// Items plus what the account could not read and why (e.g. a second site of the platform is not
// logged in), shown to the team instead of an inbox that silently stays empty.
export type InboxFetchResult = { items: InboxFetched[]; warnings?: string[] };

// What a reply needs of the item it answers (as fetch stored it).
export type InboxReplyItem = { replyTarget: string | null; threadId: string | null };

export type InboxCapabilities = {
  // Latest items; the inbox de-duplicates by (kind, externalId).
  fetch(token: string, integration: Integration): Promise<InboxFetched[] | InboxFetchResult>;
  // Kinds this channel can answer, and how.
  reply?: Partial<
    Record<
      InboxKind,
      (token: string, integration: Integration, item: InboxReplyItem, text: string) => Promise<void>
    >
  >;
  // Kinds whose reply goes out as a new comment on the post, not under the item: the platform
  // has no reply to a comment (the UI says so before sending).
  topLevelReplies?: InboxKind[];
};

// okchat 私信通道: a platform's direct messages, read and answered in the account's browser for
// okchat (customer service). Messages carry no platform id; the conversation id is the thread.
export type DmConversation = {
  id: string;
  // the other side's name
  name: string;
  unread: number;
  // the list's preview of the last message: when it changes, the conversation has moved
  summary: string;
};
export type DmMessage = {
  from: string;
  mine: boolean;
  // what the agent reads (a message the site cannot show is described instead)
  text: string;
  // as the site prints it, often relative (14:05, 昨天 14:05, 09-28 14:05)
  time: string;
};
export type DmCapabilities = {
  // the longest reply the platform takes, in characters
  maxLength: number;
  // random pause between two page reads of the same account (risk control)
  readGapMs: [number, number];
  // what the agent is told while the site the DMs live on is logged out
  loggedOutReason: string;
  conversations(token: string): Promise<DmConversation[]>;
  // the last `limit` messages of a conversation, oldest first
  read(token: string, conversationId: string, limit: number): Promise<DmMessage[]>;
  send(token: string, conversationId: string, text: string): Promise<void>;
};

export const CHANNEL_STAT_KEYS = [
  'followers',
  'following',
  'posts',
  'views',
  'likes',
  'comments',
  'shares',
  'collects',
] as const;
export type ChannelStatKey = (typeof CHANNEL_STAT_KEYS)[number];
// Current account totals; a platform fills what it exposes.
export type ChannelStats = Partial<Record<ChannelStatKey, number>>;
// oksocial 受众分析: one slice of an audience (性别、年龄段、地区…), share in percent.
export type AudienceShare = { label: string; share: number };
export type ChannelAudienceData = {
  // FOLLOWERS: the account's followers; VIEWERS: the viewers of its recent posts
  basis: 'FOLLOWERS' | 'VIEWERS';
  gender?: AudienceShare[];
  age?: AudienceShare[];
  regions?: AudienceShare[];
  interests?: AudienceShare[];
  // 活跃时段: 24 shares in percent, index = hour of the day (China time)
  activeHours?: number[];
  // how many posts the numbers come from (VIEWERS)
  sample?: number;
};
// oksocial 监控: what a platform shows about a post. null / undefined = the platform does not expose it.
export type MonitorMetrics = {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  collects?: number | null;
};

export type MonitorPostRef = {
  // platform id of the post
  externalId: string;
  // link that opens it again (keeps what the platform needs, e.g. Xiaohongshu's xsec_token)
  url: string;
};

export type MonitorPost = MonitorPostRef &
  MonitorMetrics & {
    title?: string;
    content?: string;
    authorName?: string;
    authorUrl?: string;
    publishedAt?: Date;
    // time as the platform printed it, when it cannot be parsed
    platformTime?: string;
  };

export type MonitorComment = {
  // platform id, or a stable content hash when the platform exposes none
  externalId: string;
  authorName: string;
  content: string;
  likes?: number | null;
  platformTime?: string;
  // link to the comment (or its post) when replying needs more than the comment id
  url?: string;
};

export type MonitorAccountRef = {
  // what the platform's read command takes (user id, sec_uid, screen name)
  handle: string;
  url: string;
};

// An account a search found: what the result list shows before it is added as a competitor.
export type MonitorAccountCandidate = MonitorAccountRef & {
  name: string;
  bio?: string;
  avatar?: string;
  followers?: number | null;
};

// oksocial 帖文操作助手 / 帖文拓客助手: acting on other people's posts and comments.
export type InteractPost = { externalId: string; url?: string | null; authorName?: string | null };
// url: the profile link, for platforms that follow by it rather than by name
export type InteractAccount = { name: string; displayName?: string; bio?: string; url?: string };
export type InteractAuthor = { name: string; url?: string | null };
export type InteractCapabilities = {
  like?: (slot: string, post: InteractPost) => Promise<void>;
  bookmark?: (slot: string, post: InteractPost) => Promise<void>;
  follow?: (slot: string, author: InteractAuthor) => Promise<void>;
  // whether follow can find this author (default: it has a name); a keyword hit may only carry
  // a display name where the platform follows by profile link
  canFollow?: (author: InteractAuthor) => boolean;
  // a comment under someone's post (抢前排)
  comment?: (slot: string, post: InteractPost, text: string) => Promise<void>;
  // an account's newest followers / whom it follows (回关助手)
  followers?: (slot: string, handle: string, limit: number) => Promise<InteractAccount[]>;
  following?: (slot: string, handle: string, limit: number) => Promise<InteractAccount[]>;
  // a reply under someone's comment on a post
  replyToComment?: (slot: string, comment: InteractPost, text: string) => Promise<void>;
};

export type MonitorCapabilities = {
  // This platform's post link as a ref, or null when the link belongs to another platform (or the
  // platform cannot read single posts).
  parsePostUrl(url: string): MonitorPostRef | null;
  // A profile link, or a bare id / handle of this platform (null when it cannot read accounts).
  parseAccount(input: string): MonitorAccountRef | null;
  // One post with its metrics, plus up to `comments` of its comments. Unset: posts cannot be monitored.
  readPost?(
    token: string,
    ref: MonitorPostRef,
    comments: number
  ): Promise<{ post: MonitorPost; comments: MonitorComment[] }>;
  // false when readPost returns no comments (帖文评论, 竞品评论同步 and 帖文拓客 need them)
  comments?: boolean;
  // Latest posts of an account, newest first. Unset: no competitor monitoring.
  readAccount?(
    token: string,
    account: MonitorAccountRef,
    limit: number
  ): Promise<{ name?: string; posts: MonitorPost[] }>;
  // Latest posts of the logged-in account itself (竞品 VS).
  ownPosts?(token: string, integration: Integration, limit: number): Promise<MonitorPost[]>;
  // Posts matching a keyword, newest first when the platform can sort.
  search?(token: string, keyword: string, limit: number): Promise<MonitorPost[]>;
  // Accounts whose name or handle matches, to add as competitors (竞品 › 搜索).
  searchAccounts?(token: string, query: string, limit: number): Promise<MonitorAccountCandidate[]>;
  // Random pause between two reads on this platform, in ms (risk control).
  readGapMs?: [number, number];
};

// oksocial AI 创作: how a post for this platform is written (跨平台适配, titles, covers).
export type CreationCapabilities = {
  // what one post is: a text; a thread of parts (each within maxLength) replying to each other;
  // or a video, written as a spoken script to film plus the caption it is posted with
  format: 'post' | 'thread' | 'video';
  // a title shown apart from the text, taken from its first line: at most this many characters
  titleMax?: number;
  imagesMax?: number;
  // length counted the way X does (CJK characters count twice)
  weighted?: boolean;
  // how a topic is written, {tag} is replaced (default #{tag})
  hashtag?: string;
  // the platform's feed shape for a cover image
  coverAspect: '1:1' | '3:4' | '9:16' | '16:9';
  // how posts read on this platform, for the writer
  guide: string;
  // domestic (default) or overseas, for grouping
  region?: 'cn' | 'global';
};

export type GenerateAuthUrlResponse = {
  url: string;
  codeVerifier: string;
  state: string;
};

export type AuthTokenDetails = {
  id: string;
  name: string;
  error?: string;
  accessToken: string; // The obtained access token
  refreshToken?: string; // The refresh token, if applicable
  expiresIn?: number; // The duration in seconds for which the access token is valid
  picture?: string;
  username: string;
  additionalSettings?: {
    title: string;
    description: string;
    type: 'checkbox' | 'text' | 'textarea';
    value: any;
    regex?: string;
  }[];
};

export interface ISocialMediaIntegration {
  post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post

  postPending?(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Like `post`, but may return a `pending` response the workflow resolves via checkPostStatus / finalizePost

  comment?(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]>; // Schedules a new post
}

export type PostResponse = {
  id: string; // The db internal id of the post
  postId: string; // The ID of the scheduled post returned by the platform
  releaseURL: string; // The URL of the post on the platform
  status: string; // Status of the operation or initial post status, 'pending' means the workflow must poll checkPostStatus
  pendingData?: any; // Opaque provider state used by checkPostStatus / finalizePost, never inspected by generic code
};

// Returned by checkPostStatus / finalizePost:
// 'pending' - the platform is still processing, poll again later
// 'ready' - processing is done, the workflow must call finalizePost to run the remaining mutations
// 'completed' - the post is fully published
//
// Contract: once finalizePost's mutations have actually gone through on the
// platform, checkPostStatus must return 'completed' - never 'ready' again -
// otherwise a finalizePost retry after an unknown-outcome failure would re-run
// the mutations and duplicate the post. The only exception: when finalizePost's
// mutation is idempotent (like setting a thumbnail), returning 'ready' again is
// allowed, since re-running it cannot duplicate anything.
export type PendingCheckResponse =
  | { status: 'pending'; pendingData: any }
  | { status: 'ready'; pendingData: any }
  | { status: 'completed'; postId: string; releaseURL: string };

export type PostDetails<T = any> = {
  id: string;
  message: string;
  settings: T;
  media?: MediaContent[];
  poll?: PollDetails;
};

export type PollDetails = {
  options: string[]; // Array of poll options
  duration: number; // Duration in hours for which the poll will be active
};

export type MediaContent = {
  type: 'image' | 'video'; // Type of the media content
  path: string;
  alt?: string;
  thumbnail?: string;
  thumbnailTimestamp?: number;
};

export type FetchPageInformationResult = {
  id: string;
  name: string;
  access_token: string;
  picture: string;
  username: string;
};

export interface SocialProvider
  extends IAuthenticator,
    ISocialMediaIntegration {
  identifier: string;
  refreshWait?: boolean;
  convertToJPEG?: boolean;
  stripLinks?: () => boolean;
  refreshCron?: boolean;
  dto?: any;
  maxLength: (additionalSettings?: any, settings?: any) => number;
  checkValidity(
    posts: Array<{ path: string; thumbnail?: string }[]>,
    settings: any,
    additionalSettings: any[]
  ): Promise<string | true>;
  checkPostStatus(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  migrationMatch(
    auth: Pick<AuthTokenDetails, 'id' | 'username'>,
    integration: Integration
  ): boolean;
  finalizePost(
    accessToken: string,
    pendingData: any,
    integration: Integration
  ): Promise<PendingCheckResponse>;
  isWeb3?: boolean;
  isChromeExtension?: boolean;
  // oksocial browser channel: the account logs in by scanning the platform's QR code inside its own
  // Chrome on the browser fleet, and every action runs as an opencli command in that browser.
  browserSession?: BrowserSession;
  // oksocial inbox: read comments / DMs / mentions and reply to them.
  inbox?: InboxCapabilities;
  // okchat 私信通道: the account's DMs, read and answered for okchat.
  dm?: DmCapabilities;
  // oksocial analytics: current account totals, sampled into a time series (ChannelSnapshot).
  // `posts` is what postStats just read, so totals summed over posts need no second read.
  stats?: (token: string, integration: Integration, posts?: MonitorPost[]) => Promise<ChannelStats>;
  // oksocial 帖文报告: the account's own recent posts with their current numbers, read with stats
  // (PostMetricSnapshot).
  postStats?: (token: string, integration: Integration) => Promise<MonitorPost[]>;
  // oksocial 受众分析: gender / age / regions / active hours of the account's audience, read at
  // most daily; `posts` as for stats. null when the platform has nothing to show yet.
  audience?: (
    token: string,
    integration: Integration,
    posts?: MonitorPost[]
  ) => Promise<ChannelAudienceData | null>;
  // oksocial 监控: read posts, accounts and keyword searches of this platform.
  monitor?: MonitorCapabilities;
  // oksocial automations: like / bookmark / follow / reply to comments of other accounts
  interact?: InteractCapabilities;
  // oksocial billing: credit price-table action charged for every write through this channel
  // (post, comment, reply); unset = writes are free.
  writeCreditAction?: CreditAction;
  // oksocial AI 创作: how to write for this platform.
  creation?: CreationCapabilities;
  // the AI 创作 catalog platform a channel writes for when its identifier differs (instagramweb → instagram)
  platform?: string;
  // oksocial browser channel: false while posts cannot go out through it yet (login, data and interactions only)
  publishable?: boolean;
  extensionCookies?: { name: string; domain: string }[];
  editor: 'none' | 'normal' | 'markdown' | 'html';
  customFields?: () => Promise<
    {
      key: string;
      label: string;
      defaultValue?: string;
      validation: string;
      type: 'text' | 'password';
      hint?: string;
    }[]
  >;
  name: string;
  toolTip?: string;
  oneTimeToken?: boolean;
  isBetweenSteps: boolean;
  scopes: string[];
  externalUrl?: (
    url: string
  ) => Promise<{ client_id: string; client_secret: string }>;
  mention?: (
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) => Promise<
    | { id: string; label: string; image: string; doNotCache?: boolean }[]
    | { none: true }
  >;
  mentionFormat?(idOrHandle: string, name: string): string;
  fetchPageInformation?(
    accessToken: string,
    data: any
  ): Promise<FetchPageInformationResult>;
}
