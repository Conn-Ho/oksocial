'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useClickAway } from '@uidotdev/usehooks';
import ReactLoading from '@gitroom/frontend/components/layout/loading';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import Link from 'next/link';
import {
  CATEGORY_LABELS,
  NotificationCategory,
  NotificationText,
} from '@gitroom/frontend/components/notifications/notification.center';
export const ShowNotification: FC<{
  notification: {
    createdAt: string;
    content: string;
    category?: NotificationCategory | null;
  };
  lastReadNotification: string;
}> = (props) => {
  const { notification } = props;
  const t = useT();
  const category = notification.category || 'SYSTEM';
  const [newNotification] = useState(
    new Date(notification.createdAt) > new Date(props.lastReadNotification)
  );
  const createdAt = dayjs(notification.createdAt);
  const isWithin24h = dayjs().diff(createdAt, 'hour') < 24;
  const fullDate = createdAt.format('YYYY-MM-DD HH:mm');
  return (
    <div
      className={clsx(
        `text-textColor px-[16px] py-[10px] border-b border-tableBorder last:border-b-0 transition-colors`,
        newNotification && 'font-bold bg-seventh animate-newMessages'
      )}
    >
      {/* text from other people (mentions, competitor posts) is shown as text, never as markup */}
      <div className="break-words">
        <NotificationText content={notification.content} />
      </div>
      <div
        className="text-[11px] mt-[4px] opacity-60 font-normal"
        title={isWithin24h ? fullDate : undefined}
      >
        {t(`notification_category_${category.toLowerCase()}`, CATEGORY_LABELS[category])} ·{' '}
        {isWithin24h ? createdAt.fromNow() : fullDate}
      </div>
    </div>
  );
};
export const NotificationOpenComponent: FC<{ onClose?: () => void }> = ({ onClose }) => {
  const fetch = useFetch();
  const loadNotifications = useCallback(async () => {
    return await (await fetch('/notifications/list')).json();
  }, []);
  const t = useT();

  const { data, isLoading } = useSWR('notifications', loadNotifications);
  return (
    <div
      id="notification-popup"
      className="opacity-0 animate-normalFadeDown mt-[10px] absolute w-[420px] max-w-[calc(100vw-40px)] min-h-[200px] top-[100%] end-0 bg-third text-textColor rounded-[16px] flex flex-col border border-tableBorder z-[600]"
    >
      <div className="p-[16px] border-b border-tableBorder font-bold flex items-center gap-[12px]">
        <span className="flex-1">{t('notification_popup_title', '通知')}</span>
        <Link href="/notifications" onClick={onClose} className="text-[13px] font-[500] text-textItemBlur hover:text-textColor">
          {t('notification_view_all', '查看全部')}
        </Link>
      </div>

      <div className="flex flex-col max-h-[400px] overflow-y-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
        {isLoading && (
          <div className="flex-1 flex justify-center pt-12">
            <ReactLoading type="spin" color="#fff" width={36} height={36} />
          </div>
        )}
        {!isLoading && !data.notifications.length && (
          <div className="text-center p-[16px] text-textColor flex-1 flex justify-center items-center mt-[20px]">
            {t('notification_popup_empty', '暂无通知')}
          </div>
        )}
        {!isLoading &&
          data.notifications.map(
            (
              notification: {
                createdAt: string;
                content: string;
              },
              index: number
            ) => (
              <ShowNotification
                notification={notification}
                lastReadNotification={data.lastReadNotifications}
                key={`notifications_${index}`}
              />
            )
          )}
      </div>
    </div>
  );
};
const NotificationComponent = () => {
  const fetch = useFetch();
  const [show, setShow] = useState(false);
  const loadNotifications = useCallback(async () => {
    return await (await fetch('/notifications')).json();
  }, []);
  const { data, mutate } = useSWR('notifications-list', loadNotifications);
  const changeShow = useCallback(() => {
    mutate(
      {
        ...data,
        total: 0,
      },
      {
        revalidate: false,
      }
    );
    setShow(!show);
  }, [show, data]);
  const ref = useClickAway<HTMLDivElement>(() => setShow(false));
  return (
    <div className="relative cursor-pointer select-none" ref={ref}>
      <div onClick={changeShow}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          className="hover:text-newTextColor"
        >
          <path
            d="M14 21H10M18 8C18 6.4087 17.3679 4.88258 16.2427 3.75736C15.1174 2.63214 13.5913 2 12 2C10.4087 2 8.8826 2.63214 7.75738 3.75736C6.63216 4.88258 6.00002 6.4087 6.00002 8C6.00002 11.0902 5.22049 13.206 4.34968 14.6054C3.61515 15.7859 3.24788 16.3761 3.26134 16.5408C3.27626 16.7231 3.31488 16.7926 3.46179 16.9016C3.59448 17 4.19261 17 5.38887 17H18.6112C19.8074 17 20.4056 17 20.5382 16.9016C20.6852 16.7926 20.7238 16.7231 20.7387 16.5408C20.7522 16.3761 20.3849 15.7859 19.6504 14.6054C18.7795 13.206 18 11.0902 18 8Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {data && data.total > 0 && (
            <circle
              cx="17.0625"
              cy="5"
              r="4"
              fill="#FF3EA2"
              stroke="#1A1919"
              strokeWidth="2"
            />
          )}
        </svg>
      </div>
      {show && <NotificationOpenComponent onClose={() => setShow(false)} />}
    </div>
  );
};
export default NotificationComponent;
