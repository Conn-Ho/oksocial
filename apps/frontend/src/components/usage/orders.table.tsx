'use client';

import React, { FC } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { OrderRow } from '@gitroom/frontend/components/usage/usage.hooks';
import {
  count,
  orderKindLabel,
  orderStatusLabel,
  orderTitle,
  payLabel,
  yuan,
} from '@gitroom/frontend/components/usage/usage.format';

/** 套餐订单: purchases, add-ons, credit packs, the trial and coupon days, newest first. */
export const OrdersTable: FC<{ orders: OrderRow[] | undefined }> = ({ orders }) => {
  const t = useT();
  if (!orders) {
    return <p className="text-[13px] text-textItemBlur">{t('loading', '加载中…')}</p>;
  }
  if (!orders.length) {
    return <p className="text-[13px] text-textItemBlur py-[24px] text-center">{t('orders_empty', '还没有订单。')}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] min-w-[720px]">
        <thead className="text-textItemBlur">
          <tr>
            <th className="py-[8px] text-start font-normal">{t('orders_time', '下单时间')}</th>
            <th className="py-[8px] text-start font-normal">{t('orders_kind', '类型')}</th>
            <th className="py-[8px] text-start font-normal">{t('orders_item', '内容')}</th>
            <th className="py-[8px] text-start font-normal">{t('orders_period', '服务周期')}</th>
            <th className="py-[8px] text-start font-normal">{t('orders_method', '支付方式')}</th>
            <th className="py-[8px] text-end font-normal">{t('orders_amount', '金额')}</th>
            <th className="py-[8px] text-end font-normal">{t('orders_status', '状态')}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.orderNo} className="border-t border-newBorder align-top">
              <td className="py-[9px] tabular-nums text-textItemBlur whitespace-nowrap">{dayjs(o.createdAt).format('YYYY-MM-DD HH:mm')}</td>
              <td className="py-[9px] whitespace-nowrap">{orderKindLabel(t, o.kind)}</td>
              <td className="py-[9px]">
                {o.kind === 'pack' && o.credits ? t('pack_credits', '{{n}} 积分', { n: count(o.credits) }) : orderTitle(t, o)}
                {!!o.giftCredits && o.status === 'PAID' && (
                  <span className="block text-[12px] text-textItemBlur">{t('orders_gift', '赠送 {{n}} 积分', { n: count(o.giftCredits) })}</span>
                )}
              </td>
              <td className="py-[9px] tabular-nums text-textItemBlur whitespace-nowrap">
                {o.periodStart && o.periodEnd ? `${dayjs(o.periodStart).format('YYYY-MM-DD')} – ${dayjs(o.periodEnd).format('YYYY-MM-DD')}` : '—'}
              </td>
              <td className="py-[9px] whitespace-nowrap">{payLabel(t, o.payType)}</td>
              <td className="py-[9px] text-end tabular-nums whitespace-nowrap">{yuan(o.priceYuan)}</td>
              <td className={clsx('py-[9px] text-end whitespace-nowrap', o.status === 'PAID' ? 'text-green-600' : 'text-textItemBlur')}>
                {orderStatusLabel(t, o.status)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
