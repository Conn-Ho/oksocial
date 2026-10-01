export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AdminCouponsComponent } from '@gitroom/frontend/components/admin/admin-coupons.component';

export const metadata: Metadata = {
  title: 'oksocial 兑换券管理',
  description: '',
};

export default async function Page() {
  return (
    <div className="bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] gap-[12px] overflow-y-auto">
      <AdminCouponsComponent />
    </div>
  );
}
