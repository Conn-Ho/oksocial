'use client';

import { FormProvider, SubmitHandler, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import Link from 'next/link';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { GithubProvider } from '@gitroom/frontend/components/auth/providers/github.provider';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import clsx from 'clsx';
import { GoogleProvider } from '@gitroom/frontend/components/auth/providers/google.provider';
import { AppleProvider } from '@gitroom/frontend/components/auth/providers/apple.provider';
import { OauthProvider } from '@gitroom/frontend/components/auth/providers/oauth.provider';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useTrack } from '@gitroom/react/helpers/use.track';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { FarcasterProvider } from '@gitroom/frontend/components/auth/providers/farcaster.provider';
import dynamic from 'next/dynamic';
import { WalletUiProvider } from '@gitroom/frontend/components/auth/providers/placeholder/wallet.ui.provider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
const WalletProvider = dynamic(
  () => import('@gitroom/frontend/components/auth/providers/wallet.provider'),
  {
    ssr: false,
    loading: () => <WalletUiProvider />,
  }
);
type Inputs = {
  email: string;
  password: string;
  company: string;
  providerToken: string;
  provider: string;
};
export function Register({ invited = false }: { invited?: boolean }) {
  const getQuery = useSearchParams();
  const fetch = useFetch();
  const [provider] = useState(getQuery?.get('provider')?.toUpperCase());
  const [code, setCode] = useState(getQuery?.get('code') || '');
  const [state] = useState(getQuery?.get('state') || '');
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (provider && code) {
      load();
    }
  }, []);
  const load = useCallback(async () => {
    const { token } = await (
      await fetch(`/auth/oauth/${provider?.toUpperCase() || 'LOCAL'}/exists`, {
        method: 'POST',
        body: JSON.stringify({
          code,
          state,
        }),
      })
    ).json();
    if (token) {
      setCode(token);
      setShow(true);
    }
  }, [provider, code]);
  if (!code && !provider) {
    return <RegisterAfter token="" provider="LOCAL" invited={invited} />;
  }
  if (!show) {
    return <LoadingComponent />;
  }
  return (
    <RegisterAfter token={code} provider={provider?.toUpperCase() || 'LOCAL'} invited={invited} />
  );
}
function getHelpfulReasonForRegistrationFailure(httpCode: number) {
  switch (httpCode) {
    case 400:
      return 'Email already exists';
    case 404:
      return 'Your browser got a 404 when trying to contact the API, the most likely reasons for this are the NEXT_PUBLIC_BACKEND_URL is set incorrectly, or the backend is not running.';
  }
  return 'Unhandled error: ' + httpCode;
}
export function RegisterAfter({
  token,
  provider,
  invited = false,
}: {
  token: string;
  provider: string;
  // opened from a team invitation: no team name to ask for, they join that team
  invited?: boolean;
}) {
  const t = useT();
  const {
    isGeneral,
    genericOauth,
    neynarClientId,
    appleClientId,
    billingEnabled,
  } = useVariables();
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const fireEvents = useFireEvents();
  const track = useTrack();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');
  const isAfterProvider = useMemo(() => {
    return !!token && !!provider;
  }, [token, provider]);
  const resolver = useMemo(() => {
    return classValidatorResolver(CreateOrgUserDto);
  }, []);
  const form = useForm<Inputs>({
    resolver,
    defaultValues: {
      providerToken: token,
      provider: provider,
      ...(invited ? { company: t('my_team', '我的团队') } : {}),
    },
  });
  const fetchData = useFetch();
  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    setLoading(true);
    await fetchData('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        datafast_visitor_id,
      }),
    })
      .then(async (response) => {
        setLoading(false);
        if (response.status === 200) {
          fireEvents('register');
          return track(TrackEnum.CompleteRegistration).then(() => {
            if (response.headers.get('activate') === 'true') {
              router.push('/auth/activate');
            } else {
              router.push('/auth/login');
            }
          });
        } else {
          form.setError('email', {
            message: await response.text(),
          });
        }
      })
      .catch((e) => {
        form.setError('email', {
          message: t(
            'register_general_error',
            '注册出错：{{error}}。请查看浏览器控制台了解详情。',
            { error: e.toString() }
          ),
        });
      });
  };
  return (
    <FormProvider {...form}>
      <form className="flex-1 flex" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col flex-1">
          <h1 className="text-[32px] font-[800] tracking-[-0.01em] text-start">
            {t('register_title', '注册 oksocial')}
          </h1>
          <p className="text-[14px] text-textItemBlur mt-[8px] mb-[28px]">
            {t('already_have_an_account', '已经有账号？')}&nbsp;
            <Link href="/auth/login" className="text-btnPrimary font-[600] hover:underline">
              {t('sign_in', '登录')}
            </Link>
          </p>
          <div className="flex flex-col text-[14px]">
            {!isAfterProvider &&
              (!isGeneral ? (
                <GithubProvider />
              ) : (
                <div className="gap-[8px] flex">
                  {genericOauth && isGeneral ? (
                    <OauthProvider />
                  ) : (
                    <GoogleProvider />
                  )}
                  {!!appleClientId && <AppleProvider />}
                  {!!neynarClientId && <FarcasterProvider />}
                  {billingEnabled && <WalletProvider />}
                </div>
              ))}
            {!isAfterProvider && (
              <div className="flex items-center gap-[12px] my-[22px] text-[12px] text-textItemBlur">
                <div className="flex-1 h-[1px] bg-newBorder" />
                {t('or_with_email_register', '或用邮箱注册')}
                <div className="flex-1 h-[1px] bg-newBorder" />
              </div>
            )}
            <div className="flex flex-col gap-[12px]">
              <div className="text-textColor">
                {!isAfterProvider && (
                  <>
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
                  </>
                )}
                {invited ? (
                  <p className="text-[14px] text-white/70">
                    {t('register_invited', '你是受邀加入团队的，注册并激活后会直接进入邀请你的团队。')}
                  </p>
                ) : (
                  <Input
                    label="Company"
                    translationKey="label_company"
                    {...form.register('company')}
                    autoComplete="off"
                    type="text"
                    placeholder={t('label_company', 'Company')}
                  />
                )}
              </div>
              <Button type="submit" className="w-full !h-[48px] mt-[4px]" loading={loading}>
                {t('create_account', '创建账号')}
              </Button>
              <p className="text-[12px] text-textItemBlur">
                {t('by_registering_you_agree_to_our', '注册即表示同意')}
                <a href="/terms" rel="nofollow" className="hover:text-textColor">
                  {t('terms_quoted', '《服务条款》')}
                </a>
                {t('and', '和')}
                <a href="/privacy" rel="nofollow" className="hover:text-textColor">
                  {t('privacy_quoted', '《隐私政策》')}
                </a>
              </p>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
