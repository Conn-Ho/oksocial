'use client';

import React, { FC, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PayDialog } from '@gitroom/frontend/components/usage/pay.dialog';
import { CurrentTerm, useAddonQuote } from '@gitroom/frontend/components/usage/usage.hooks';
import { count, planName, yuan } from '@gitroom/frontend/components/usage/usage.format';

/** 加购账号: accounts added to the running paid period, charged until its end. */
export const AddonDialog: FC<{ term: CurrentTerm; onPaid: () => void; close: () => void }> = ({ term, onPaid, close }) => {
  const t = useT();
  const [add, setAdd] = useState(1);
  // ask the server once the number settles
  const [asked, setAsked] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(add), 300);
    return () => clearTimeout(timer);
  }, [add]);
  const { data: quote, error, isLoading } = useAddonQuote(asked);
  const [paying, setPaying] = useState(false);

  if (paying && quote) {
    return (
      <PayDialog
        title={t('addon_title', '{{plan}} · 加购 {{n}} 个账号', { plan: planName(t, quote.tier), n: quote.addAccounts })}
        priceYuan={quote.totalYuan}
        payTypes={quote.payTypes}
        body={{ kind: 'addon', accounts: quote.addAccounts }}
        giftCredits={quote.giftCredits}
        details={t('addon_details', '加购后共 {{total}} 个账号，按剩余 {{days}} 天计费，到期日 {{end}} 不变。', {
          total: quote.totalAccounts,
          days: quote.remainingDays,
          end: dayjs(quote.periodEnd).format('YYYY-MM-DD'),
        })}
        doneText={t('addon_done', '账号数已增加，现在可以连接新账号了。')}
        onPaid={onPaid}
        close={close}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[16px] p-[8px] w-[400px] max-w-full">
      <p className="text-[13px] text-textItemBlur">
        {t('addon_intro', '当前 {{plan}} {{n}} 个账号，{{end}} 到期。加购的账号只收剩余天数的费用。', {
          plan: planName(t, term.tier),
          n: term.accounts,
          end: dayjs(term.periodEnd).format('YYYY-MM-DD'),
        })}
      </p>
      <div className="flex items-center justify-between gap-[12px]">
        <label htmlFor="addon-count" className="text-[14px] font-[600]">
          {t('addon_count', '加购账号数')}
        </label>
        <div className="flex items-center rounded-full ring-1 ring-newBorder h-[40px]">
          <button
            type="button"
            aria-label={t('calc_fewer', '少一个账号')}
            disabled={add <= 1}
            onClick={() => setAdd(Math.max(1, add - 1))}
            className="w-[40px] h-[40px] rounded-full text-[18px] hover:bg-boxHover disabled:opacity-40"
          >
            −
          </button>
          <input
            id="addon-count"
            inputMode="numeric"
            value={add}
            onChange={(e) => setAdd(Math.max(1, Math.min(9999, Number.parseInt(e.target.value.replace(/\D/g, ''), 10) || 1)))}
            className="w-[56px] h-[34px] rounded-[8px] bg-transparent text-center text-[16px] font-[700] tabular-nums outline-none"
          />
          <button
            type="button"
            aria-label={t('calc_more', '多一个账号')}
            onClick={() => setAdd(add + 1)}
            className="w-[40px] h-[40px] rounded-full text-[18px] hover:bg-boxHover"
          >
            +
          </button>
        </div>
      </div>

      <div className="rounded-[10px] bg-newTableHeader p-[14px] flex flex-col gap-[8px] text-[13px]" aria-live="polite">
        {error ? (
          <p role="alert" className="text-red-500">{(error as Error).message}</p>
        ) : !quote || isLoading ? (
          <p className="text-textItemBlur">{t('loading', '加载中…')}</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-textItemBlur">{t('addon_rate', '单价')}</span>
              <span className="tabular-nums">{t('addon_rate_value', '{{price}} / 账号 / 月', { price: yuan(quote.perAccountMonthYuan) })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-textItemBlur">{t('addon_remaining', '剩余天数')}</span>
              <span className="tabular-nums">{t('addon_days', '{{n}} 天', { n: quote.remainingDays })}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-textItemBlur">{t('addon_total_accounts', '加购后账号数')}</span>
              <span className="tabular-nums">{count(quote.totalAccounts)}</span>
            </div>
            <div className="flex items-end justify-between border-t border-newBorder pt-[10px]">
              <span className="font-[600]">{t('calc_total', '合计')}</span>
              <span className="text-[24px] font-[800] tabular-nums leading-none">{yuan(quote.totalYuan)}</span>
            </div>
          </>
        )}
      </div>
      <Button disabled={!quote || !!error || asked !== add} onClick={() => setPaying(true)}>
        {t('addon_pay', '去支付')}
      </Button>
    </div>
  );
};
