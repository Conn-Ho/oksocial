// Text the simulated accounts and their audiences write. Picked deterministically by index.
import { pick } from './core.mjs';

export const CN_NICKS = [
  '小鹿爱生活', '阿杰不吃香菜', 'Momo的日常', '一颗柠檬', '橘子汽水', '山山而川', '早睡的猫', '奶油泡芙',
  '阿宁在杭州', '喵小姐的衣橱', '爱喝美式', '周末去露营', '糯米团子', '晚风吹行舟', 'Lily同学', '大橙子',
  '木子李', '咸鱼翻身记', '一只小胖', '秋天的柿子', '城南旧事2019', '科技老张', '北漂的阿雅', '是小周呀',
];
export const WEIBO_NICKS = ['城南旧事2019', '科技老张', '爱吃火锅的阿飞', '数码小刘', '北漂的阿雅', '是小周呀', '深夜食堂老板', '环球旅行家Leo', '财经观察员小陈', '追剧少女', '吃货在广州', '跑步的老王'];
export const DOUYIN_NICKS = ['探店小胖', '健身教练阿伟', '美妆博主Lisa', '家常菜谱', '萌宠日记', '旅行vlog小七', '数码测评君', '手工达人小美', '露营的阿May', '上班族穿搭'];
export const X_HANDLES = ['growthhacker', 'indiemaker', 'devjane', 'coffeecoder', 'nomadlisa', 'productpete', 'aiwatcher', 'saasfounder', 'buildinpublic', 'marketingmo', 'designdan', 'seo_sam'];

/** A pool name for author index `idx`; past the pool size a number keeps names distinct. */
export const nameFor = (pool, idx) => `${pool[idx % pool.length]}${idx >= pool.length ? Math.floor(idx / pool.length) : ''}`;
export const handleFor = (idx) => `${X_HANDLES[idx % X_HANDLES.length]}${idx >= X_HANDLES.length ? Math.floor(idx / X_HANDLES.length) : ''}`.slice(0, 15);

export const OWN_XHS_TITLES = ['秋冬通勤穿搭｜一周不重样', '租房改造｜500块搞定小客厅', '新手也能做的低脂便当', '杭州小众咖啡店合集', '我的平价护肤清单', '周末露营装备分享', '一人食晚餐记录', '读书笔记｜今年最爱的5本书'];
export const OWN_XHS_BODIES = [
  '最近被问了很多次，今天一次说清楚 🌿\n\n1️⃣ 先定基础色，再加一件亮色单品\n2️⃣ 鞋子和包同色系，整体更干净\n\n有问题评论区见～ #穿搭 #通勤',
  '花了一个周末，把出租屋小客厅改了一下 🏠\n\n清单放在最后一张图，都是网上能买到的平价款。\n\n#租房改造 #家居好物',
  '分享一个 20 分钟能做好的便当 🍱\n\n鸡胸肉提前腌好，西兰花焯水，米饭换成杂粮饭。\n\n#减脂餐 #便当',
];
export const XHS_TOPIC_TITLES = ['{kw}真的绝了！亲测一个月分享', '{kw}避坑指南｜新手必看', '平价{kw}推荐，学生党闭眼入', '关于{kw}，我想说…', '{kw}保姆级教程', '{kw}合集｜收藏这一篇就够了'];
export const XHS_OTHER_TITLES = ['一周穿搭不重样', '周末去哪儿｜城市漫步路线', '今日份早餐打卡', '收纳好物分享', '通勤包里都有什么', '最近在用的护肤品', '宝藏小店探店', '居家健身30天'];
export const XHS_OTHER_BODIES = ['真实分享，不是广告～用了一段时间感觉还不错，细节放图里了。', '被朋友安利了好久终于试了，说说我的真实感受 👇', '今天整理了一下，给有需要的姐妹参考 ✨'];

export const WEIBO_OWN_TEXTS = [
  '今天发布了新品，感谢大家一直以来的支持！评论区抽三位送同款 #新品发布#',
  '周末的城市漫步，天气刚刚好。',
  '整理了一份入门清单，有需要的朋友自取，转发让更多人看到 #干货分享#',
  '大家平时都是怎么安排周末的？评论区聊聊。',
  '直播预告：周四晚上 8 点，聊聊最近大家问得最多的问题。',
];
export const WEIBO_OTHER_TEXTS = ['刚看完发布会，说几点个人看法：', '今天的晚霞太好看了，随手拍一张。', '转发抽奖：关注+转发，周五开奖。', '这个问题我想了很久，写下来和大家讨论。', '新店开业，第一天就排了长队。', '分享一个最近很好用的小工具。'];

export const DOUYIN_OWN_TITLES = ['3 分钟学会这道家常菜 #美食教程', '上班族一周通勤穿搭 #穿搭', '周末露营 vlog #露营 #vlog', '小户型收纳技巧 #家居', '新手健身第一周 #健身打卡'];
export const DOUYIN_OTHER_TITLES = ['跟着我做，零失败 #教程', '今天的日常 #vlog', '这个方法太实用了 #生活小技巧', '挑战一周不重样 #挑战', '探店｜人均 50 吃到撑 #探店'];

export const X_OWN_TEXTS = [
  'Shipped a new feature today: scheduled posts now support time zones. Feedback welcome!',
  'Three things I learned growing an account from 0 to 5k followers 🧵',
  '我们的新品今天上线了，欢迎试用并告诉我们你的想法。',
  'What is the one tool you cannot work without? Mine is a good calendar.',
  'Weekly update: revenue up 12%, churn down, still hiring a designer.',
];
export const X_OTHER_TEXTS = ['Hot take: most dashboards are never opened after week one.', 'Just published a deep dive on pricing pages. Link in reply.', 'Building in public, day 42: first paying customer!', '今天分享一个提升效率的小技巧。', 'Reminder: ship small, ship often.', 'Our team is growing. DMs open if you want to chat.'];

/** Comments an audience leaves. A few show purchase intent, a few are negative. */
export const CN_COMMENTS = [
  '请问怎么购买？多少钱',
  '拍得真好看，收藏了',
  '质量太差了，用了两天就坏了，差评',
  '学到了，谢谢分享',
  '求链接！在哪里买的呀',
  '已关注，期待更新',
  '多少钱一套？可以私信我吗',
  '这个颜色好喜欢',
  '广告太多了，取关了',
  '请问是什么牌子的？',
  '码住慢慢看',
  '想买，有优惠吗？',
];
export const X_COMMENTS = [
  'How can I buy this? How much is it?',
  'Great thread, thanks for sharing!',
  'This is a scam, do not waste your money.',
  'Bookmarked. Super useful.',
  'Where can I get one? Link please 🙏',
  'Totally agree with this.',
  '请问在哪里可以买到？价格多少？',
  'What stack are you using?',
];

export const cnComment = (n) => pick(CN_COMMENTS, n);
export const xComment = (n) => pick(X_COMMENTS, n);
export const fill = (template, kw) => template.replaceAll('{kw}', kw);

/** Seeded DM conversations on Xiaohongshu: two with purchase intent, one complaint, one business ask. */
export const XHS_DMS = [
  { name: '小鹿爱生活', unread: 2, messages: [{ mine: false, text: '你好，请问这个怎么购买？多少钱？' }, { mine: false, text: '可以发个链接吗' }] },
  { name: '阿杰不吃香菜', unread: 1, messages: [{ mine: false, text: '上次买的东西一直没发货，怎么回事？太失望了' }] },
  { name: 'Momo的日常', unread: 0, messages: [{ mine: false, text: '博主你好，想约个合作推广，方便聊聊吗？' }, { mine: true, text: '你好，可以的，发下具体需求～' }] },
  { name: '一颗柠檬', unread: 1, messages: [{ mine: false, text: '能便宜点吗？想买两个送朋友' }] },
];
export const XHS_DM_FOLLOWUPS = ['在吗？想问下还有货吗', '请问包邮吗？多少钱', '收到了，质量不错，谢谢！', '怎么下单呀？'];
