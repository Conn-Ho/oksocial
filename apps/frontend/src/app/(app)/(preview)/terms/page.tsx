import { Metadata } from 'next';
import { LegalPage } from '@gitroom/frontend/components/legal/legal.page';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_terms', '服务条款 - oksocial'),
    description: t('page_desc_terms', '使用 oksocial 的规则'),
  };
}

export default async function Terms() {
  const t = await getT();
  return (
    <LegalPage
      title={t('terms_of_service', '服务条款')}
      updated={t('terms_updated', '2026 年 9 月 30 日')}
      intro={t('terms_intro', '注册或使用 oksocial 即表示你同意以下条款。请在使用前仔细阅读。')}
      sections={[
        {
          heading: t('terms_service_heading', '服务内容'),
          body: <p>{t('terms_service_body', 'oksocial 提供社交媒体账号管理工具，包括发布与定时、互动收件箱、数据分析、监控、自动化和 AI 创作。具体功能以网站实际提供为准，我们可能调整或下线部分功能。')}</p>,
        },
        {
          heading: t('terms_account_heading', '账户与安全'),
          body: <p>{t('terms_account_body', '你需要提供真实可用的邮箱，并妥善保管登录密码。团队管理员负责邀请成员和分配权限，团队内的操作视为该团队所为。发现账户被盗用请立即联系我们。')}</p>,
        },
        {
          heading: t('terms_rules_heading', '遵守平台规则与法律'),
          body: (
            <>
              <p>{t('terms_rules_body', '你连接的社交账号归你所有，你需要遵守各社交平台的用户协议和社区规范，以及适用的法律法规。')}</p>
              <p>{t('terms_rules_automation', '自动化功能（自动回复、点赞、关注、评论等）可能被平台视为异常行为，存在限流、风控或封号的风险。是否开启以及开启的范围由你决定，相应风险由你承担。建议先使用审核模式并为账号绑定独立出口代理。')}</p>
            </>
          ),
        },
        {
          heading: t('terms_prohibited_heading', '禁止的使用方式'),
          body: (
            <ul className="list-disc ps-[20px] flex flex-col gap-[6px]">
              <li>{t('terms_prohibited_content', '发布违法、侵权、色情、暴力、诈骗或骚扰内容；')}</li>
              <li>{t('terms_prohibited_spam', '批量发送垃圾信息、刷量、操纵舆论；')}</li>
              <li>{t('terms_prohibited_accounts', '未经授权使用他人账号，或借助本服务攻击、干扰他人系统；')}</li>
              <li>{t('terms_prohibited_api', '破解、反向工程或滥用本服务的接口。')}</li>
            </ul>
          ),
        },
        {
          heading: t('terms_payment_heading', '付费与退款'),
          body: <p>{t('terms_payment_body', '付费套餐、积分的价格和权益以购买页面展示为准。积分用于 AI 和自动化等按量计费的功能，按页面公布的价格扣除。退款请联系我们，按实际使用情况处理。')}</p>,
        },
        {
          heading: t('terms_content_heading', '内容与知识产权'),
          body: <p>{t('terms_content_body', '你在 oksocial 中创建或上传的内容归你所有。你授权我们为提供服务而存储、处理和发送这些内容。AI 生成的内容请自行核实后再发布。')}</p>,
        },
        {
          heading: t('terms_liability_heading', '服务中断与责任限制'),
          body: <p>{t('terms_liability_body', '我们会尽力保持服务稳定，但社交平台的改版、风控或第三方服务故障可能导致功能暂时不可用。在法律允许的范围内，我们不对因平台处罚、账号受限或间接损失承担责任。')}</p>,
        },
        {
          heading: t('terms_termination_heading', '终止'),
          body: <p>{t('terms_termination_body', '你可以随时注销账户。如果你严重违反本条款，我们可以暂停或终止你的使用。')}</p>,
        },
        {
          heading: t('terms_changes_heading', '条款变更'),
          body: <p>{t('terms_changes_body', '条款有重要变化时，我们会在网站上公布并通过邮件通知你。变更后继续使用即视为同意新的条款。')}</p>,
        },
      ]}
    />
  );
}
