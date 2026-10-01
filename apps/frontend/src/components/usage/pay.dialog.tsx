'use client';

import React, { FC, ReactNode, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  CreatedOrder,
  OrderBody,
  PayType,
  useOrderStatus,
  usePost,
} from '@gitroom/frontend/components/usage/usage.hooks';
import { count, payLabel, yuan } from '@gitroom/frontend/components/usage/usage.format';

/**
 * 扫码支付: pick WeChat or Alipay, create the XorPay order, show its QR code and poll until it is
 * paid. What the order buys is decided by the server when the payment arrives; `details` is what
 * the page showed (period, accounts, gifted credits).
 */
export const PayDialog: FC<{
  title: string;
  priceYuan: string;
  payTypes: PayType[];
  body: OrderBody;
  details?: ReactNode;
  giftCredits?: number;
  /** What the success screen says, e.g. "套餐已生效". */
  doneText: string;
  onPaid: () => void;
  close: () => void;
}> = (props) => {
  const t = useT();
  const post = usePost();
  // what the dialog was opened with: the page refreshes its quotes once the payment arrives
  const [{ title, priceYuan, payTypes, body, details, giftCredits, doneText }] = useState(props);
  const { onPaid, close } = props;
  const [payType, setPayType] = useState<PayType>(payTypes[0]);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // the QR code stops working after expireIn (the order itself only shows as expired a day later)
  const [qrExpired, setQrExpired] = useState(false);
  const [settled, setSettled] = useState(false);
  const { data: polled } = useOrderStatus(order?.orderNo ?? null, !!order && !qrExpired && !settled);
  const remote = polled?.status;
  const state = !order ? null : remote && remote !== 'PENDING' ? remote : qrExpired ? 'EXPIRED' : 'PENDING';

  useEffect(() => {
    setQrExpired(false);
    setSettled(false);
    if (!order) {
      return;
    }
    const timer = setTimeout(() => setQrExpired(true), order.expireIn * 1000);
    return () => clearTimeout(timer);
  }, [order?.orderNo]);

  useEffect(() => {
    if (!remote || remote === 'PENDING') {
      return;
    }
    setSettled(true);
    if (remote === 'PAID') {
      onPaid();
    }
  }, [remote]);

  const createOrder = useCallback(async () => {
    setCreating(true);
    setError('');
    const res = await post<CreatedOrder>('/usage/orders', { ...body, payType });
    setCreating(false);
    if (!res.ok) {
      setError(res.message || t('pay_order_failed', '下单失败，请稍后再试'));
      return;
    }
    setOrder(res.data);
  }, [body, payType, post, t]);

  if (!payTypes.length) {
    return (
      <div className="flex flex-col gap-[14px] p-[8px] w-[400px] max-w-full text-[14px]">
        <p>{t('pay_over_limit', '这笔金额超过了扫码支付的单笔上限，请联系我们对公转账开通。')}</p>
        <Button secondary={true} onClick={close}>
          {t('got_it', '知道了')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] p-[8px] w-[400px] max-w-full">
      <div className="flex items-baseline justify-between gap-[12px]">
        <span className="text-[15px] font-[600] leading-[1.4]">{title}</span>
        <span className="text-[24px] font-[700] tabular-nums whitespace-nowrap">{yuan(priceYuan)}</span>
      </div>
      {details && <div className="text-[13px] text-textItemBlur leading-[1.6]">{details}</div>}
      {!!giftCredits && (
        <p className="text-[13px] rounded-[8px] bg-newTableHeader px-[12px] py-[8px]">
          {t('pay_gift_note', '付款后赠送 {{n}} 积分，长期有效', { n: count(giftCredits) })}
        </p>
      )}

      {!order && (
        <>
          <div className="flex gap-[8px]" role="radiogroup" aria-label={t('pay_method', '支付方式')}>
            {payTypes.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={payType === type}
                onClick={() => setPayType(type)}
                className={clsx(
                  'flex-1 h-[40px] rounded-full text-[14px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary',
                  payType === type
                    ? 'bg-btnSimple text-textColor font-[600] ring-1 ring-newBorder'
                    : 'text-textItemBlur hover:text-textColor hover:bg-boxHover ring-1 ring-newBorder'
                )}
              >
                {payLabel(t, type)}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-red-500">
              {error}
            </p>
          )}
          <Button loading={creating} onClick={createOrder}>
            {t('pay_create_qr', '生成付款二维码')}
          </Button>
        </>
      )}

      {order && state === 'PENDING' && (
        <div className="flex flex-col items-center gap-[10px]">
          <img
            src={order.qrImage}
            alt={t('pay_qr_alt', '{{method}}付款二维码', { method: payLabel(t, order.payType) })}
            width={220}
            height={220}
            className="rounded-[10px] border border-newBorder bg-white p-[8px]"
          />
          <p className="text-[14px]">
            {t('pay_scan', '请用{{app}}扫码支付 {{amount}}', {
              app: order.payType === 'alipay' ? t('pay_alipay', '支付宝') : t('pay_wechat_app', '微信'),
              amount: yuan(order.priceYuan),
            })}
          </p>
          <p className="text-[12px] text-textItemBlur text-center">
            {t('pay_scan_hint', '付款后几秒内自动开通，二维码 {{minutes}} 分钟内有效 · 订单号 {{orderNo}}', {
              minutes: Math.round(order.expireIn / 60),
              orderNo: order.orderNo,
            })}
          </p>
        </div>
      )}

      {state === 'PAID' && (
        <div className="flex flex-col gap-[12px] items-center py-[12px]" role="status">
          <span className="text-[18px] font-[700] text-green-600">{t('pay_done', '支付成功')}</span>
          <p className="text-[13px] text-textItemBlur text-center">{doneText}</p>
          <Button onClick={close}>{t('done', '完成')}</Button>
        </div>
      )}

      {(state === 'CLOSED' || state === 'EXPIRED') && (
        <div className="flex flex-col gap-[12px]">
          <p className="text-[13px] text-textItemBlur">
            {t('pay_expired', '二维码已失效。如果刚刚已经付款，几分钟内会自动到账，可在订单记录里查看；否则请重新下单。')}
          </p>
          <Button secondary={true} onClick={() => setOrder(null)}>
            {t('pay_again', '重新下单')}
          </Button>
        </div>
      )}
    </div>
  );
};
