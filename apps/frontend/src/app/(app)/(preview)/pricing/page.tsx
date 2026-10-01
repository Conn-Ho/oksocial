import { Metadata } from 'next';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { PricingPage, PublicPricing } from '@gitroom/frontend/components/pricing/pricing.page';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_pricing', '价格 - oksocial'),
    description: t('page_desc_pricing', '按社媒账号计费：基础版和团队版 5 个账号起购，可单个加购；季付、半年、年付和多账号享折扣，7 天免费试用。'),
  };
}

// read at request time: the price list can be overridden per deployment (OKSOCIAL_PRICING)
const load = async (): Promise<PublicPricing | null> => {
  try {
    const res = await internalFetch('/public/pricing');
    return res.ok ? ((await res.json()) as PublicPricing) : null;
  } catch (err) {
    console.log('pricing page', (err as Error)?.message);
    return null;
  }
};

export default async function Pricing() {
  return <PricingPage data={await load()} />;
}
