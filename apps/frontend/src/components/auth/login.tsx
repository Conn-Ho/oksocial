'use client';

import { useForm, SubmitHandler, FormProvider } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import Link from 'next/link';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useMemo, useState } from 'react';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { GithubProvider } from '@gitroom/frontend/components/auth/providers/github.provider';
import { OauthProvider } from '@gitroom/frontend/components/auth/providers/oauth.provider';
import { GoogleProvider } from '@gitroom/frontend/components/auth/providers/google.provider';
import { AppleProvider } from '@gitroom/frontend/components/auth/providers/apple.provider';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { FarcasterProvider } from '@gitroom/frontend/components/auth/providers/farcaster.provider';
import WalletProvider from '@gitroom/frontend/components/auth/providers/wallet.provider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
type Inputs = {
  email: string;
  password: string;
  providerToken: '';
  provider: 'LOCAL';
};
export function Login() {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [notActivated, setNotActivated] = useState(false);
  const {
    isGeneral,
    neynarClientId,
    appleClientId,
    billingEnabled,
    genericOauth,
  } = useVariables();
  const resolver = useMemo(() => {
    return classValidatorResolver(LoginUserDto);
  }, []);
  const form = useForm<Inputs>({
    resolver,
    defaultValues: {
      providerToken: '',
      provider: 'LOCAL',
    },
  });
  const fetchData = useFetch();
  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    setLoading(true);
    setNotActivated(false);
    const login = await fetchData('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        provider: 'LOCAL',
      }),
    });
    if (login.status === 400) {
      const errorMessage = await login.text();
      if (errorMessage === 'User is not activated') {
        setNotActivated(true);
      } else {
        form.setError('email', {
          message: errorMessage,
        });
      }
      setLoading(false);
    }
  };
  return (
    <FormProvider {...form}>
      <form className="flex-1 flex" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col flex-1">
          <h1 className="text-[32px] font-[800] tracking-[-0.01em] text-start">
            {t('login_title', '登录 oksocial')}
          </h1>
          <p className="text-[14px] text-textItemBlur mt-[8px] mb-[28px]">
            {t('don_t_have_an_account', '还没有账号？')}&nbsp;
            <Link href="/auth" className="text-btnPrimary font-[600] hover:underline">
              {t('sign_up_free', '免费注册')}
            </Link>
          </p>
          <div className="flex flex-col">
            {isGeneral && genericOauth ? (
              <OauthProvider />
            ) : !isGeneral ? (
              <GithubProvider />
            ) : (
              <div className="gap-[8px] flex">
                <GoogleProvider />
                {!!appleClientId && <AppleProvider />}
                {!!neynarClientId && <FarcasterProvider />}
                {billingEnabled && <WalletProvider />}
              </div>
            )}
            <div className="flex items-center gap-[12px] my-[22px] text-[12px] text-textItemBlur">
              <div className="flex-1 h-[1px] bg-newBorder" />
              {t('or_with_email', '或用邮箱登录')}
              <div className="flex-1 h-[1px] bg-newBorder" />
            </div>
            <div className="flex flex-col gap-[12px]">
              <div className="text-textColor">
                <Input
                  label="Email"
                  translationKey="label_email"
                  {...form.register('email')}
                  type="email"
                  placeholder={t('email_address', 'Email Address')}
                />
                <Input
                  label="Password"
                  translationKey="label_password"
                  {...form.register('password')}
                  autoComplete="off"
                  type="password"
                  placeholder={t('label_password', 'Password')}
                />
              </div>
              {notActivated && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-[10px] p-4 mb-4">
                  <p className="text-amber-400 text-sm mb-2">
                    {t(
                      'account_not_activated',
                      'Your account is not activated yet. Please check your email for the activation link.'
                    )}
                  </p>
                  <Link
                    href="/auth/activate"
                    className="text-amber-400 underline hover:font-bold text-sm"
                  >
                    {t('resend_activation_email', 'Resend Activation Email')}
                  </Link>
                </div>
              )}
              <div className="flex justify-end -mt-[14px]">
                <Link href="/auth/forgot" className="text-[13px] text-textItemBlur hover:text-textColor">
                  {t('forgot_password_q', '忘记密码？')}
                </Link>
              </div>
              <Button type="submit" className="w-full !h-[48px] mt-[8px]" loading={loading}>
                {t('sign_in_1', '登录')}
              </Button>
              <p className="text-[12px] text-textItemBlur mt-[4px]">
                {t('login_terms_prefix', '登录即表示同意')}
                <Link href="/terms" className="hover:text-textColor">{t('terms_quoted', '《服务条款》')}</Link>
                {t('and', '和')}
                <Link href="/privacy" className="hover:text-textColor">{t('privacy_quoted', '《隐私政策》')}</Link>
              </p>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
