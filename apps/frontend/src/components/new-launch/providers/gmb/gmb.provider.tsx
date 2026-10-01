'use client';

import { FC, useCallback, useEffect } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { GmbSettingsDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/gmb.settings.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useWatch } from 'react-hook-form';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const topicTypes = [
  {
    label: '最新动态',
    value: 'STANDARD',
  },
  {
    label: '活动',
    value: 'EVENT',
  },
  {
    label: '优惠',
    value: 'OFFER',
  },
];

const callToActionTypes = [
  {
    label: '无',
    value: 'NONE',
  },
  {
    label: '预订',
    value: 'BOOK',
  },
  {
    label: '在线订购',
    value: 'ORDER',
  },
  {
    label: '购买',
    value: 'SHOP',
  },
  {
    label: '了解详情',
    value: 'LEARN_MORE',
  },
  {
    label: '注册',
    value: 'SIGN_UP',
  },
  {
    label: '领取优惠',
    value: 'GET_OFFER',
  },
  {
    label: '立即致电',
    value: 'CALL',
  },
];

const GmbSettings: FC = () => {
  const { register, control } = useSettings();
  const t = useT();
  const topicType = useWatch({ control, name: 'topicType' });
  const callToActionType = useWatch({ control, name: 'callToActionType' });

  return (
    <div className="flex flex-col gap-[10px]">
      <Select
        label={t('label_post_type', '帖子类型')}
        {...register('topicType', {
          value: 'STANDARD',
        })}
      >
        {topicTypes.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>

      <Select
        label={t('call_to_action', '行动号召按钮')}
        {...register('callToActionType', {
          value: 'NONE',
        })}
      >
        {callToActionTypes.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </Select>

      {callToActionType &&
        callToActionType !== 'NONE' &&
        callToActionType !== 'CALL' && (
          <Input
            label={t('call_to_action_url', '按钮链接 URL')}
            placeholder="https://example.com"
            {...register('callToActionUrl')}
          />
        )}

      {topicType === 'EVENT' && (
        <div className="flex flex-col gap-[10px] mt-[10px] p-[15px] border border-input rounded-[8px]">
          <div className="text-[14px] font-medium mb-[5px]">
            {t('event_details', '活动详情')}
          </div>
          <Input
            label={t('event_title', '活动标题')}
            placeholder={t('event_name', '活动名称')}
            {...register('eventTitle')}
          />
          <div className="grid grid-cols-2 gap-[10px]">
            <Input
              label={t('start_date', '开始日期')}
              type="date"
              {...register('eventStartDate')}
            />
            <Input
              label={t('end_date', '结束日期')}
              type="date"
              {...register('eventEndDate')}
            />
          </div>
          <div className="grid grid-cols-2 gap-[10px]">
            <Input
              label={t('start_time_optional', '开始时间（可选）')}
              type="time"
              {...register('eventStartTime')}
            />
            <Input
              label={t('end_time_optional', '结束时间（可选）')}
              type="time"
              {...register('eventEndTime')}
            />
          </div>
        </div>
      )}

      {topicType === 'OFFER' && (
        <div className="flex flex-col gap-[10px] mt-[10px] p-[15px] border border-input rounded-[8px]">
          <div className="text-[14px] font-medium mb-[5px]">
            {t('offer_details', '优惠详情')}
          </div>
          <Input
            label={t('coupon_code_optional', '优惠码（可选）')}
            placeholder="SAVE20"
            {...register('offerCouponCode')}
          />
          <Input
            label={t('redeem_online_url_optional', '在线兑换 URL（可选）')}
            placeholder="https://example.com/redeem"
            {...register('offerRedeemUrl')}
          />
          <Input
            label={t('terms_optional', '条款与条件（可选）')}
            placeholder={t('valid_until_placeholder', '有效期至…')}
            {...register('offerTerms')}
          />
        </div>
      )}
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: GmbSettings,
  CustomPreviewComponent: undefined,
  dto: GmbSettingsDto,
  maximumCharacters: 1500,
});
