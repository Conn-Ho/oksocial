import { Metadata } from 'next';
import { LegalPage } from '@gitroom/frontend/components/legal/legal.page';

export const metadata: Metadata = { title: '隐私政策 - oksocial', description: 'oksocial 如何收集、使用和保护你的数据' };

export default function Privacy() {
  return (
    <LegalPage
      title="隐私政策"
      updated="2026 年 9 月 30 日"
      intro="oksocial 是帮助团队管理社交媒体账号的在线工具。本政策说明我们会处理哪些数据、为什么处理、交给了谁，以及你可以怎样查看和删除它们。"
      sections={[
        {
          heading: '我们处理哪些数据',
          body: (
            <ul className="list-disc ps-[20px] flex flex-col gap-[6px]">
              <li>账户信息：注册邮箱、团队名称、团队成员和角色；登录密码只保存不可逆的散列值。</li>
              <li>社交账号的登录状态：你扫码登录的每个社交账号都在我们服务器上一个独立的浏览器里保持登录，登录凭据只保存在这个浏览器里。我们不会看到、也不会保存你的社交账号密码。</li>
              <li>你在 oksocial 里创建的内容：帖子与草稿、媒体文件、品牌档案、话术、监控对象、自动化设置与执行记录、线索。</li>
              <li>从你连接的社交账号读取的数据：评论、私信、@提及、帖子和账号的公开数据，用于收件箱、数据分析和监控。</li>
              <li>使用记录：登录时间、IP 地址和浏览器信息，用于安全和排查问题。</li>
            </ul>
          ),
        },
        {
          heading: '为什么处理这些数据',
          body: <p>只用于向你提供 oksocial 的功能：发布和定时帖子、同步和回复互动、生成报告、运行你开启的自动化、发送你需要的通知邮件，以及保障账户安全。我们不出售你的数据，也不用它投放广告。</p>,
        },
        {
          heading: '交给第三方的数据',
          body: (
            <ul className="list-disc ps-[20px] flex flex-col gap-[6px]">
              <li>社交平台：你让 oksocial 发布、回复或操作时，相应内容会发送到对应平台（小红书、抖音、微博、X 等）。</li>
              <li>AI 模型服务：使用 AI 回复、改写、创作、打标签等功能时，相关文字（以及你上传用于处理的图片）会发送给大模型服务商处理。</li>
              <li>邮件服务（Resend）：用于发送激活、找回密码、邀请和通知邮件。</li>
              <li>支付服务（XorPay、Stripe）：仅在你付费时处理订单，我们不保存你的银行卡信息。</li>
              <li>你自己配置的 Webhook 和群机器人：按你的设置把通知发送到你指定的地址。</li>
            </ul>
          ),
        },
        {
          heading: '数据存放与保护',
          body: <p>数据存放在我们租用的云服务器上（Google Cloud 香港区域）。账号出口代理等敏感配置加密保存，传输全程使用 HTTPS。每个社交账号使用独立的浏览器，账号之间互不共享登录状态。</p>,
        },
        {
          heading: '保留与删除',
          body: <p>你可以随时在 oksocial 里删除帖子、媒体、监控和自动化，也可以断开社交账号，断开时会删除该账号的浏览器登录状态。注销账户后，你的团队、社交账号和内容会被删除；为安全和财务合规需要保留的少量记录（如付款订单）会按法律要求的期限保存。</p>,
        },
        {
          heading: '你的权利',
          body: <p>你可以查看、更正、导出或删除你的个人信息，也可以撤回对某项功能的授权（例如关闭自动化或断开账号）。需要协助时请联系我们。</p>,
        },
        {
          heading: '政策变更',
          body: <p>政策有重要变化时，我们会在网站上公布并通过邮件通知你。</p>,
        },
      ]}
    />
  );
}
