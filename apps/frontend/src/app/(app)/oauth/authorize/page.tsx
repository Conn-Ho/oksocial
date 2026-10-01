'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useTeams } from '@gitroom/frontend/components/teams/teams.hooks';
import { useOkchatStatus } from '@gitroom/frontend/components/okchat/okchat.hooks';

// the member (this page is outside the app shell, so it asks itself)
const useSelf = () => {
  const fetch = useFetch();
  const load = useCallback(async () => (await fetch('/user/self')).json(), []);
  return useSWR<{ id: string; orgId: string }>('/user/self', load, { revalidateOnFocus: false });
};

const sameHost = (a: string | null, b: string) => {
  try {
    return !!a && !!b && new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
};

export default function OAuthAuthorizePage() {
  const searchParams = useSearchParams();
  const fetch = useFetch();
  const t = useT();
  const { okchatUrl } = useVariables();
  const [appInfo, setAppInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // a first-party app is asked for silently first; the consent screen shows when that says so
  const [consent, setConsent] = useState(false);
  const silentTried = useRef<string | null>(null);

  const clientId = searchParams.get('client_id');
  const responseType = searchParams.get('response_type');
  const state = searchParams.get('state');
  const redirectUri = searchParams.get('redirect_uri');
  const codeChallenge = searchParams.get('code_challenge');
  const codeChallengeMethod = searchParams.get('code_challenge_method');
  const teamParam = searchParams.get('team');

  const { data: self, error: selfError } = useSelf();
  const { data: teamList, error: teamsError } = useTeams();
  const teams = Array.isArray(teamList) ? teamList : [];
  // okchat passes the team it was opened for: preselected when the member belongs to it, else the
  // current team (never an error)
  const [selected, setSelected] = useState<string>('');
  useEffect(() => {
    if (!selected && self?.orgId && (teamList !== undefined || teamsError)) {
      setSelected(teams.some((team) => team.id === teamParam) ? teamParam! : self.orgId);
    }
  }, [self?.orgId, teamList, teamsError, teamParam, selected]);
  const team = teams.find((item) => item.id === selected);

  const firstParty = !!appInfo?.app?.firstParty;
  // okchat handles the team's DMs: it needs at least one account of the team to bring along
  const forOkchat = firstParty && !!okchatUrl && sameHost(redirectUri, okchatUrl);
  const { data: okchat, error: okchatError } = useOkchatStatus(forOkchat && !!selected, 0, selected || undefined);
  const needsAccount = forOkchat && !!okchat && okchat.accounts.length === 0;

  useEffect(() => {
    if (!clientId || !responseType) {
      setError(
        t('oauth_missing_params', '缺少必要参数（client_id、response_type）')
      );
      setLoading(false);
      return;
    }
    if (responseType !== 'code') {
      setError(t('oauth_only_code_supported', '仅支持 response_type=code'));
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: responseType,
      ...(state ? { state } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
      ...(codeChallengeMethod
        ? { code_challenge_method: codeChallengeMethod }
        : {}),
    });

    fetch(`/oauth/authorize?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.statusCode && data.statusCode >= 400) {
          setError(data.message || t('oauth_invalid_request', 'OAuth 请求无效'));
        } else {
          setAppInfo(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setError(t('oauth_validate_failed', 'OAuth 请求校验失败'));
        setLoading(false);
      });
  }, [clientId, responseType, state, redirectUri, codeChallenge, codeChallengeMethod]);

  const handleAction = useCallback(
    async (action: 'approve' | 'deny' | 'silent') => {
      setSubmitting(true);
      try {
        const result = await (
          await fetch('/oauth/authorize', {
            method: 'POST',
            body: JSON.stringify({
              client_id: clientId,
              state,
              action,
              ...(selected ? { organization_id: selected } : {}),
              ...(redirectUri ? { redirect_uri: redirectUri } : {}),
              ...(codeChallenge ? { code_challenge: codeChallenge } : {}),
              ...(codeChallengeMethod
                ? { code_challenge_method: codeChallengeMethod }
                : {}),
            }),
          })
        ).json();

        if (result.redirect) {
          window.location.href = result.redirect;
          return;
        }
        if (result.consent) {
          setConsent(true);
        }
        setSubmitting(false);
      } catch {
        setError(t('oauth_authorize_failed', '授权处理失败'));
        setSubmitting(false);
      }
    },
    [clientId, state, redirectUri, codeChallenge, codeChallengeMethod, selected]
  );

  // a first-party app this member approved for the preselected team before goes on without asking;
  // picking another team on the consent screen waits for 授权
  const ready = !!appInfo && (!!selected || !!selfError) && (!forOkchat || !!okchat || !!okchatError);
  useEffect(() => {
    if (!ready || silentTried.current !== null) {
      return;
    }
    silentTried.current = selected;
    if (!firstParty || needsAccount) {
      setConsent(true);
      return;
    }
    handleAction('silent');
  }, [ready, firstParty, needsAccount, selected]);

  // where the member adds an account for okchat, coming back here (this team preselected)
  const addAccountHref = useMemo(() => {
    if (typeof window === 'undefined' || !selected) {
      return '';
    }
    const here = new URL(window.location.href);
    here.searchParams.set('team', selected);
    return `/okchat/connect?${new URLSearchParams({ team: selected, return: `${here.pathname}${here.search}` })}`;
  }, [selected]);

  if (loading || (!error && !consent)) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#4C90FD] rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="text-[16px] text-gray-400">
            {t('please_wait_loading', '请稍候…')}
          </div>
          <div className="mt-[32px] flex justify-center">
            <div className="w-[48px] h-[48px] border-[3px] border-btnPrimary border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
          <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#4C90FD] rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 text-center">
          <div className="flex justify-center mb-[24px]">
            <Logo />
          </div>
          <div className="w-[80px] h-[80px] mx-auto mb-[24px] rounded-full bg-red-500/20 flex items-center justify-center">
            <svg
              className="w-[40px] h-[40px] text-red-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="text-[28px] font-semibold mb-[12px]">
            {t('oauth_authorization_error', '授权出错')}
          </div>
          <div className="text-[16px] text-gray-400 max-w-[400px]">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!appInfo) {
    return null;
  }

  return (
    <div className="flex flex-1 items-center justify-center text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-[20%] left-[10%] w-[300px] h-[300px] bg-btnPrimary rounded-full blur-[120px]" />
        <div className="absolute bottom-[20%] right-[10%] w-[250px] h-[250px] bg-[#4C90FD] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-[500px] mx-auto px-[20px]">
        <div className="flex justify-center mb-[32px]">
          <Logo />
        </div>

        <div className="bg-[#1A1919] rounded-[16px] p-[32px] flex flex-col gap-[24px]">
          <div className="flex flex-col items-center gap-[16px]">
            {appInfo.app.picture?.path ? (
              <img
                src={appInfo.app.picture.path}
                alt={appInfo.app.name}
                className="w-[64px] h-[64px] rounded-full object-cover"
              />
            ) : (
              <div className="w-[64px] h-[64px] rounded-full bg-[#2A2929] flex items-center justify-center text-[24px] text-gray-400">
                {appInfo.app.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <h2 className="text-[24px] font-semibold text-center">
              {appInfo.app.name}
            </h2>
            {appInfo.app.description && (
              <div className="text-gray-400 text-center text-[14px]">
                {appInfo.app.description}
              </div>
            )}
          </div>

          {teams.length > 1 && (
            <fieldset className="flex flex-col gap-[8px]">
              <legend className="text-[14px] text-gray-400 mb-[8px]">
                {t('oauth_pick_team', '授权给哪个团队')}
              </legend>
              {teams.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-[10px] rounded-[10px] border border-white/10 px-[12px] py-[10px] cursor-pointer has-[:checked]:border-btnPrimary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-btnPrimary"
                >
                  <input
                    type="radio"
                    name="team"
                    value={item.id}
                    checked={selected === item.id}
                    onChange={() => setSelected(item.id)}
                    className="accent-btnPrimary"
                  />
                  <span className="text-[14px] truncate">{item.name}</span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="border-t border-[#2A2929] pt-[16px]">
            <div className="text-[14px] text-gray-400 mb-[12px]">
              {firstParty
                ? t('oauth_first_party_requests', '{{app}} 想用你的 oksocial 账号登录，会用到：', { app: appInfo.app.name })
                : t(
                    'oauth_app_requests_access',
                    '该应用正在请求访问你的 oksocial 账号，授权后它将可以：'
                  )}
            </div>
            {firstParty ? (
              <ul className="text-[14px] list-disc list-inside space-y-[4px]">
                <li>{t('oauth_scope_profile', '基本资料（名字、头像）和邮箱')}</li>
                <li>
                  {team
                    ? t('oauth_scope_team_named', '所选团队「{{team}}」', { team: team.name })
                    : t('oauth_scope_team', '所选团队')}
                </li>
                <li>{t('oauth_scope_team_accounts', '团队里的账号列表（用来建立私信渠道）')}</li>
              </ul>
            ) : (
              <ul className="text-[14px] list-disc list-inside space-y-[4px]">
                <li>{t('oauth_scope_channels', '访问你的频道和集成')}</li>
                <li>{t('oauth_scope_posts', '以你的名义创建和定时发布帖子')}</li>
                <li>{t('oauth_scope_analytics', '读取你的帖子数据分析')}</li>
              </ul>
            )}
            {firstParty && (
              <div className="mt-[12px] text-[12px] text-gray-500">
                {t('oauth_first_party_once', '只需确认一次，之后同一团队会直接登录。')}
              </div>
            )}
          </div>

          {needsAccount && (
            <div className="rounded-[10px] border border-amber-500/40 bg-amber-500/10 px-[14px] py-[12px] flex flex-col gap-[10px]" role="status">
              <div className="text-[14px] leading-[22px]">
                {t('oauth_okchat_no_account', '「{{team}}」还没有可以接到 okchat 的账号。私信要经团队里的账号进入 okchat，先扫码添加一个，加好后会回到这里继续。', {
                  team: team?.name || '',
                })}
              </div>
              {addAccountHref && (
                <a
                  href={addAccountHref}
                  className="self-start inline-flex items-center h-[34px] px-[14px] rounded-full bg-btnPrimary text-white text-[14px] font-semibold hover:bg-btnPrimaryHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary"
                >
                  {t('oauth_okchat_add_account', '去添加账号')}
                </a>
              )}
            </div>
          )}

          <div className="flex gap-[12px]">
            <button
              onClick={() => handleAction('approve')}
              disabled={submitting || !selected}
              className="flex-1 bg-btnPrimary hover:bg-[#4C90FD] disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
            >
              {t('authorize', '授权')}
            </button>
            <button
              onClick={() => handleAction('deny')}
              disabled={submitting}
              className="flex-1 bg-[#2A2929] hover:bg-[#3A3939] disabled:opacity-50 text-white rounded-[8px] py-[10px] px-[16px] text-[14px] font-semibold transition-colors"
            >
              {t('deny', '拒绝')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
