import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
export const dynamic = 'force-dynamic';
import { Register } from '@gitroom/frontend/components/auth/register';
import { Metadata } from 'next';
import Link from 'next/link';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { LoginWithOidc } from '@gitroom/frontend/components/auth/login.with.oidc';
import { cookies } from 'next/headers';
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('page_title_register', '注册 oksocial'),
    description: '',
  };
}
export default async function Auth(params: {searchParams: Promise<{provider: string}>}) {
  const t = await getT();
  if (process.env.DISABLE_REGISTRATION === 'true') {
    const canRegister = (
      await (await internalFetch('/auth/can-register')).json()
    ).register;
    if (!canRegister && !(await params?.searchParams)?.provider) {
      return (
        <>
          <LoginWithOidc />
          <div className="text-center">
            {t('registration_is_disabled', 'Registration is disabled')}
            <br />
            <Link className="underline hover:font-bold" href="/auth/login">
              {t('login_instead', 'Login instead')}
            </Link>
          </div>
        </>
      );
    }
  }
  // an invitation link left an org cookie: the new user joins that team
  return <Register invited={(await cookies()).has('org')} />;
}
