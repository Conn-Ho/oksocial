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

export type BrowserSession = {
  // Page opened in the account's browser for the user to log in (QR code or password).
  loginUrl: string;
  // opencli command (without -f json) whose output identifies the logged-in account.
  whoami: string[];
  // Maps the whoami rows to an identity, or null when the browser is not logged in.
  identity(rows: unknown): BrowserSessionIdentity | null;
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

export type InboxCapabilities = {
  // Latest items; the inbox de-duplicates by (kind, externalId).
  fetch(token: string, integration: Integration): Promise<InboxFetched[]>;
  // Kinds this channel can answer, and how.
  reply?: Partial<
    Record<
      InboxKind,
      (
        token: string,
        integration: Integration,
        item: { replyTarget: string | null; threadId: string | null },
        text: string
      ) => Promise<void>
    >
  >;
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
};

export type MonitorAccountRef = {
  // what the platform's read command takes (user id, sec_uid, screen name)
  handle: string;
  url: string;
};

export type MonitorCapabilities = {
  // This platform's post link as a ref, or null when the link belongs to another platform.
  parsePostUrl(url: string): MonitorPostRef | null;
  // A profile link, or a bare id / handle of this platform.
  parseAccount(input: string): MonitorAccountRef | null;
  // One post with its metrics, plus up to `comments` of its comments.
  readPost(
    token: string,
    ref: MonitorPostRef,
    comments: number
  ): Promise<{ post: MonitorPost; comments: MonitorComment[] }>;
  // Latest posts of an account, newest first.
  readAccount(
    token: string,
    account: MonitorAccountRef,
    limit: number
  ): Promise<{ name?: string; posts: MonitorPost[] }>;
  // Latest posts of the logged-in account itself (竞品 VS).
  ownPosts?(token: string, integration: Integration, limit: number): Promise<MonitorPost[]>;
  // Posts matching a keyword, newest first when the platform can sort.
  search?(token: string, keyword: string, limit: number): Promise<MonitorPost[]>;
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
  // oksocial analytics: current account totals, sampled into a time series (ChannelSnapshot).
  stats?: (token: string, integration: Integration) => Promise<ChannelStats>;
  // oksocial 监控: read posts, accounts and keyword searches of this platform.
  monitor?: MonitorCapabilities;
  // oksocial billing: credit price-table action charged for every write through this channel
  // (post, comment, reply); unset = writes are free.
  writeCreditAction?: CreditAction;
  // oksocial AI 创作: how to write for this platform.
  creation?: CreationCapabilities;
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
