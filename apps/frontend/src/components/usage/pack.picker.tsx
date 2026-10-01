'use client';

import React, { FC, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PayDialog } from '@gitroom/frontend/components/usage/pay.dialog';
import { PackProduct } from '@gitroom/frontend/components/usage/usage.hooks';
import { count, yuan } from '@gitroom/frontend/components/usage/usage.format';

/** 购买积分: credit packs, then the QR payment. */
export const PackPicker: FC<{ packs: PackProduct[]; onPaid: () => void; close: () => void }> = ({ packs, onPaid, close }) => {
  const t = useT();
  const [chosen, setChosen] = useState<PackProduct | null>(null);
  if (chosen) {
    return (
      <PayDialog
        title={t('pack_title', '{{n}} 积分', { n: count(chosen.credits) })}
        priceYuan={chosen.priceYuan}
        payTypes={chosen.payTypes}
        body={{ kind: 'pack', productId: chosen.id }}
        details={t('pack_details', '购买的积分长期有效；每月套餐赠送的积分会先用。')}
        doneText={t('pack_done', '积分已到账。')}
        onPaid={onPaid}
        close={close}
      />
    );
  }
  return (
    <div className="flex flex-col gap-[10px] w-[380px] max-w-full p-[8px]">
      {packs.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setChosen(p)}
          className="flex items-center justify-between rounded-[10px] border border-newBorder px-[16px] h-[54px] hover:bg-boxHover transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-btnPrimary"
        >
          <span className="text-[14px] font-[600] tabular-nums">{t('pack_credits', '{{n}} 积分', { n: count(p.credits) })}</span>
          <span className="text-[16px] font-[700] tabular-nums">{yuan(p.priceYuan)}</span>
        </button>
      ))}
      <p className="text-[12px] text-textItemBlur">
        {t('pack_hint', '购买的积分长期有效；每月套餐赠送的积分先用，月底未用完的赠送积分清零。')}
      </p>
    </div>
  );
};
