'use client';

import { FC, ReactNode, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import DeleteAccountComponent from '@gitroom/frontend/components/settings/delete-account.component';
const useFaqList = () => {
  const user = useUser();
  const t = useT();
  return [
    ...(user?.allowTrial
      ? [
          {
            title: t(
              'faq_am_i_going_to_be_charged_by_postiz',
              '我会被 oksocial 收费吗？'
            ),
            description: t(
              'faq_to_confirm_credit_card_information_postiz_will_hold',
              '为确认信用卡信息，oksocial 将暂时预授权 2 美元并立即释放。你可以随时在设置中取消订阅，无需联系任何人。'
            ),
          },
        ]
      : []),
    {
      title: t('faq_can_i_trust_postiz_gitroom', '我可以信任 oksocial 吗？'),
      description: t(
        'faq_postiz_gitroom_is_proudly_open_source',
        'oksocial 的源代码是公开的（AGPL-3.0），你可以查看全部代码。要查看源代码，<a href="https://github.com/Conn-Ho/oksocial" target="_blank" style="text-decoration: underline;">请点击这里</a>。'
      ),
    },
    {
      title: t('faq_what_are_channels', '什么是频道？'),
      description: t(
        'faq_postiz_gitroom_allows_you_to_schedule_posts',
        `oksocial 让你在多个账号之间统一发布和排期。
频道就是你的一个社交账号，比如小红书、抖音、微博、X，也可以通过官方授权接入 Facebook、Instagram、TikTok、YouTube、LinkedIn、Threads、Pinterest 等。`
      ),
    },
    {
      title: t('faq_what_are_team_members', '什么是团队成员？'),
      description: t(
        'faq_if_you_have_a_team_with_multiple_members',
        '如果你有一个包含多名成员的团队，你可以邀请他们加入你的工作区，共同协作发布内容，并添加他们的个人频道。'
      ),
    },
    ...(user?.tier?.current === 'FREE'
      ? [
          {
            title: t('faq_how_can_i_delete_my_account', '如何注销我的账户？'),
            description: t(
              'faq_delete_account_description',
              '如果不想继续使用 oksocial，你可以注销账户，你的所有团队、频道和帖子都会一并删除，且无法恢复。'
            ),
            content: <DeleteAccountComponent isLink={true} />,
          },
        ]
      : []),
  ];
};
export const FAQSection: FC<{
  title: string;
  description: string;
  content?: ReactNode;
}> = (props) => {
  const { title, description, content } = props;
  const [show, setShow] = useState(false);
  const changeShow = useCallback(() => {
    setShow(!show);
  }, [show]);
  return (
    <div
      className="bg-sixth p-[24px] border border-tableBorder rounded-[8px] flex flex-col"
      onClick={changeShow}
    >
      <div className={`text-[20px] cursor-pointer flex justify-center`}>
        <div className="flex-1">{title}</div>
        <div className="flex items-center justify-center w-[32px]">
          {!show ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M18 12.75H6C5.59 12.75 5.25 12.41 5.25 12C5.25 11.59 5.59 11.25 6 11.25H18C18.41 11.25 18.75 11.59 18.75 12C18.75 12.41 18.41 12.75 18 12.75Z"
                fill="white"
              />
              <path
                d="M12 18.75C11.59 18.75 11.25 18.41 11.25 18V6C11.25 5.59 11.59 5.25 12 5.25C12.41 5.25 12.75 5.59 12.75 6V18C12.75 18.41 12.41 18.75 12 18.75Z"
                fill="white"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
            >
              <path
                d="M24 17H8C7.45333 17 7 16.5467 7 16C7 15.4533 7.45333 15 8 15H24C24.5467 15 25 15.4533 25 16C25 16.5467 24.5467 17 24 17Z"
                fill="#ECECEC"
              />
            </svg>
          )}
        </div>
      </div>
      <div
        className={clsx(
          'transition-all duration-500 overflow-hidden',
          !show ? 'max-h-[0]' : 'max-h-[500px]'
        )}
      >
        <div
          onClick={(e) => {
            e.stopPropagation();
          }}
          className={`mt-[16px] w-full text-wrap font-[400] text-[16px] text-customColor17 select-text max-w-[450px]`}
          dangerouslySetInnerHTML={{
            __html: description,
          }}
        />
        {content && (
          <div
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="mt-[16px]"
          >
            {content}
          </div>
        )}
      </div>
    </div>
  );
};
export const FAQComponent: FC = () => {
  const t = useT();
  const list = useFaqList();
  return (
    <div>
      {/*<h3 className="text-[24px] mt-[48px] mb-[40px] tablet:mt-[80px]">*/}
      {/*  {t('frequently_asked_questions', 'Frequently Asked Questions')}*/}
      {/*</h3>*/}
      <div className="gap-[24px] flex-col flex select-none  mt-[48px] mb-[40px] tablet:mt-[80px]">
        {list.map((item, index) => (
          <FAQSection key={index} {...item} />
        ))}
      </div>
    </div>
  );
};
