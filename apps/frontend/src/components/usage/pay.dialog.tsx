'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import {
  CHANGE_LABELS,
  CreatedOrder,
  PackProduct,
  PAY_LABELS,
  PayType,
  PlanProduct,
  useOrderStatus,
} from '@gitroom/frontend/components/usage/usage.hooks';

const Period: FC<{ product: PlanProduct }> = ({ product }) => (
  <p className="text-[13px] text-textColor/70">
    {CHANGE_LABELS[product.quote.change]} · 服务周期 {dayjs(product.quote.startsAt).format('YYYY-MM-DD')} 至{' '}
    {dayjs(product.quote.expiresAt).format('YYYY-MM-DD')}
  </p>
);

/**
 * 扫码支付: pick WeChat or Alipay, create the XorPay order, show its QR code and poll until it is
 * paid. The period shown is the server's quote (renewals are appended, tier changes convert the
 * unused days), the one that applies is decided when the payment arrives.
 */
export const PayDialog: FC<{
  product: PlanProduct | PackProduct;
  onPaid: () => void;
  close: () => void;
}> = ({ product, onPaid, close }) => {
  const fetch = useFetch();
  const [payType, setPayType] = useState<PayType>(product.payTypes[0]);
  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // the QR code stops working after expireIn (the order itself only shows as expired a day later)
  const [qrExpired, setQrExpired] = useState(false);
  const [settled, setSettled] = useState(false);
  const { data: polled } = useOrderStatus(order?.orderNo ?? null, !!order && !qrExpired && !settled);
  const remote = polled?.status;
  const state = !order
    ? null
    : remote && remote !== 'PENDING'
    ? remote
    : qrExpired
    ? 'EXPIRED'
    : 'PENDING';

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
    try {
      const res = await fetch('/usage/orders', {
        method: 'POST',
        body: JSON.stringify({ productId: product.id, payType }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message || '下单失败，请稍后再试');
        return;
      }
      setOrder(body);
    } finally {
      setCreating(false);
    }
  }, [product.id, payType]);

  if (!product.payTypes.length) {
    return (
      <div className="flex flex-col gap-[12px] p-[8px] text-[14px]">
        <p>这个金额超过了扫码支付的单笔上限，请联系我们对公转账开通。</p>
        <Button secondary={true} onClick={close}>知道了</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px] p-[8px] w-[380px] max-w-full">
      <div className="flex items-baseline justify-between gap-[12px]">
        <span className="text-[16px] font-semibold">{product.name}</span>
        <span className="text-[24px] font-semibold tabular-nums">¥{product.priceYuan}</span>
      </div>
      {product.kind === 'plan' ? (
        <Period product={product} />
      ) : (
        <p className="text-[13px] text-textColor/70">
          到账 {product.credits.toLocaleString('zh-CN')} 积分，长期有效；每月套餐赠送的积分先用。
        </p>
      )}

      {!order && (
        <>
          <div className="flex gap-[8px]" role="radiogroup" aria-label="支付方式">
            {product.payTypes.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={payType === t}
                onClick={() => setPayType(t)}
                className={clsx(
                  'flex-1 h-[40px] rounded-[8px] border text-[14px] transition-colors',
                  payType === t
                    ? 'border-btnPrimary bg-newTableHeader'
                    : 'border-newTableBorder hover:bg-newTableHeader'
                )}
              >
                {PAY_LABELS[t]}
              </button>
            ))}
          </div>
          {error && <p className="text-[13px] text-red-400">{error}</p>}
          <Button loading={creating} onClick={createOrder}>
            生成付款二维码
          </Button>
        </>
      )}

      {order && state === 'PENDING' && (
        <div className="flex flex-col items-center gap-[10px]">
          <img
            src={order.qrImage}
            alt={`${PAY_LABELS[order.payType]}付款二维码`}
            width={220}
            height={220}
            className="rounded-[8px] bg-white p-[8px]"
          />
          <p className="text-[14px]">
            请用{order.payType === 'alipay' ? '支付宝' : '微信'}扫码支付 ¥{order.priceYuan}
          </p>
          <p className="text-[12px] text-textColor/50">
            付款后几秒内自动到账，二维码 {Math.round(order.expireIn / 60)} 分钟内有效 · 订单号 {order.orderNo}
          </p>
        </div>
      )}

      {state === 'PAID' && (
        <div className="flex flex-col gap-[12px] items-center py-[12px]">
          <span className="text-[18px] font-semibold text-green-400">支付成功</span>
          <p className="text-[13px] text-textColor/70">
            {product.kind === 'plan' ? '套餐已生效，本月赠送积分已到账。' : '积分已到账。'}
          </p>
          <Button onClick={close}>完成</Button>
        </div>
      )}

      {(state === 'CLOSED' || state === 'EXPIRED') && (
        <div className="flex flex-col gap-[12px]">
          <p className="text-[13px] text-textColor/70">
            二维码已失效。如果刚刚已经付款，几分钟内会自动到账，可在订单记录里查看；否则请重新下单。
          </p>
          <Button secondary={true} onClick={() => setOrder(null)}>重新下单</Button>
        </div>
      )}
    </div>
  );
};
