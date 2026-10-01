import { CreationCapabilities } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export type CreationRegion = 'cn' | 'global';

/** A platform AI 创作 writes for even before oksocial can connect an account on it. */
export type CatalogPlatform = CreationCapabilities & {
  identifier: string;
  name: string;
  maxLength: number;
  region: CreationRegion;
};

// Overseas audiences: written in English unless the user asks for another language.
const GLOBAL = '面向海外用户：额外要求里没有指定语言时用英文写。';

/**
 * How to write for every platform. Identifiers are those of the channel provider the platform has or
 * will have (dashless: Temporal derives worker queues from them), so a draft can go to that channel
 * once it exists. A provider that writes for a platform itself replaces its entry here.
 */
export const CREATION_CATALOG: CatalogPlatform[] = [
  // 国内
  {
    identifier: 'shipinhao', name: '视频号', region: 'cn', maxLength: 1000, format: 'video', titleMax: 16, coverAspect: '3:4',
    hashtag: '#{tag}',
    guide: '视频号：微信生态，熟人转发多，口吻真诚、像朋友推荐；描述 1-3 句话点明看点，配 2-3 个话题；短标题 6-16 字。',
  },
  {
    identifier: 'bilibili', name: 'B站', region: 'cn', maxLength: 2000, format: 'video', titleMax: 80, coverAspect: '16:9',
    guide: 'B站：年轻、重内容质量和真诚，忌硬广；标题信息量足、可以带梗；简介写清视频讲什么、时间轴要点；口播可以更长、更有梗和个人风格。',
  },
  {
    identifier: 'kuaishou', name: '快手', region: 'cn', maxLength: 500, format: 'video', titleMax: 30, coverAspect: '9:16',
    hashtag: '#{tag}',
    guide: '快手：接地气、真实、有烟火气，老铁式口吻；开头三秒直接给结果或冲突；描述短，配 2-4 个话题。',
  },
  {
    identifier: 'zhihu', name: '知乎', region: 'cn', maxLength: 20000, format: 'post', titleMax: 50, imagesMax: 9, coverAspect: '16:9',
    guide: '知乎：专业、讲逻辑、有论据，先给结论再展开，分小标题和要点，像回答一个具体问题；标题写成一个读者会搜的问题或观点；不要营销腔。',
  },
  {
    identifier: 'gongzhonghao', name: '公众号', region: 'cn', maxLength: 20000, format: 'post', titleMax: 32, imagesMax: 20, coverAspect: '16:9',
    guide: '公众号：长文阅读，标题决定打开率（具体、有利益点或悬念，不夸大）；开头一段抓人，正文分小标题、段落短，结尾引导关注、在看或留言。',
  },
  {
    identifier: 'toutiao', name: '头条号', region: 'cn', maxLength: 5000, format: 'post', titleMax: 30, imagesMax: 9, coverAspect: '16:9',
    guide: '头条号：大众读者，标题直接说清事情和看点（不要标题党），正文开门见山、信息密度高、段落短，适合配图。',
  },
  {
    identifier: 'jike', name: '即刻', region: 'cn', maxLength: 2000, format: 'post', imagesMax: 9, coverAspect: '1:1',
    guide: '即刻：互联网、科技和生活方式圈子，口吻像朋友聊天、真诚有观点，可以有一点自嘲；不需要标题和话题标签。',
  },
  // 海外
  {
    identifier: 'instagram', name: 'Instagram', region: 'global', maxLength: 2200, format: 'post', imagesMax: 10, coverAspect: '3:4',
    hashtag: '#{tag}',
    guide: `Instagram：视觉优先，文案第一行就是钩子（折叠前只露出一行），短段落加少量 emoji，结尾行动引导，5-15 个相关标签放在最后。${GLOBAL}`,
  },
  {
    identifier: 'tiktok', name: 'TikTok', region: 'global', maxLength: 2200, format: 'video', coverAspect: '9:16', hashtag: '#{tag}',
    guide: `TikTok：竖屏短视频，前 2 秒给钩子，口播口语化、节奏快；描述一句话加 3-5 个标签。${GLOBAL}`,
  },
  {
    identifier: 'youtube', name: 'YouTube', region: 'global', maxLength: 5000, format: 'video', titleMax: 100, coverAspect: '16:9',
    hashtag: '#{tag}',
    guide: `YouTube：标题包含搜索关键词、具体有好奇心；描述前两行写清看点，下面分段写要点和时间戳，结尾放链接和 3 个以内标签。${GLOBAL}`,
  },
  {
    identifier: 'facebook', name: 'Facebook', region: 'global', maxLength: 5000, format: 'post', imagesMax: 10, coverAspect: '1:1',
    guide: `Facebook：社区和亲友氛围，口吻亲切，开头一句引发共鸣或提问，正文短、易于评论和分享；标签很少用。${GLOBAL}`,
  },
  {
    identifier: 'threads', name: 'Threads', region: 'global', maxLength: 500, format: 'thread', imagesMax: 10, coverAspect: '3:4',
    guide: `Threads：对话感强、轻松有观点，适合连发几条展开一个想法；每条独立能读，少用标签。${GLOBAL}`,
  },
  {
    identifier: 'linkedin', name: 'LinkedIn', region: 'global', maxLength: 3000, format: 'post', imagesMax: 9, coverAspect: '1:1',
    hashtag: '#{tag}',
    guide: `LinkedIn：职场和行业视角，专业但有个人经历和观点，开头一两行要让人想点「展开」，短段落，结尾提问引导讨论，3-5 个标签。${GLOBAL}`,
  },
  {
    identifier: 'pinterest', name: 'Pinterest', region: 'global', maxLength: 500, format: 'post', titleMax: 100, imagesMax: 1, coverAspect: '3:4',
    guide: `Pinterest：一张竖图配标题和描述，像搜索结果一样写：标题和描述里自然放进别人会搜的关键词，说清用途和灵感。${GLOBAL}`,
  },
  {
    identifier: 'reddit', name: 'Reddit', region: 'global', maxLength: 10000, format: 'post', titleMax: 300, imagesMax: 1, coverAspect: '16:9',
    guide: `Reddit：社区反感营销，像社区成员一样分享经验或提问，真诚、具体、有干货，标题直白；不要标签和 emoji。${GLOBAL}`,
  },
  {
    identifier: 'bluesky', name: 'Bluesky', region: 'global', maxLength: 300, format: 'thread', imagesMax: 4, coverAspect: '16:9',
    guide: `Bluesky：和早期 Twitter 类似，简短有观点，可以连发；少用标签。${GLOBAL}`,
  },
  {
    identifier: 'medium', name: 'Medium', region: 'global', maxLength: 30000, format: 'post', titleMax: 100, coverAspect: '16:9',
    guide: `Medium：长文，标题清楚说出读者能得到什么，开头讲问题，正文分小标题、有例子和结论。${GLOBAL}`,
  },
  {
    identifier: 'wordpress', name: 'WordPress', region: 'global', maxLength: 30000, format: 'post', titleMax: 100, coverAspect: '16:9',
    guide: '博客文章：标题含关键词、利于搜索，开头概括全文，正文分小标题和列表，结尾总结和行动引导；用原文的语言写。',
  },
];
