'use client';

import React, { FC, ReactNode, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { object, string } from 'yup';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { Textarea } from '@gitroom/react/form/textarea';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { showMediaBox } from '@gitroom/frontend/components/media/media.component';
import { TeamAvatar } from '@gitroom/frontend/components/teams/team.avatar';
import { errorMessage, TeamInfo, useTeamInfo } from '@gitroom/frontend/components/teams/teams.hooks';
import { teamNameRule, useCreateTeam } from '@gitroom/frontend/components/teams/create.team.modal';
import { useDeleteTeam } from '@gitroom/frontend/components/teams/delete.team.modal';

const DESCRIPTION_MAX = 200;
const CODE_PATTERN = /^[A-Za-z0-9_-]{0,16}$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

// the zones agencies in China work with, east to west; any other saved zone is listed as is
const TIMEZONES: Array<[string, string]> = [
  ['Pacific/Auckland', '奥克兰'],
  ['Australia/Sydney', '悉尼'],
  ['Asia/Tokyo', '东京'],
  ['Asia/Seoul', '首尔'],
  ['Asia/Shanghai', '北京，上海'],
  ['Asia/Hong_Kong', '香港'],
  ['Asia/Taipei', '台北'],
  ['Asia/Singapore', '新加坡，吉隆坡'],
  ['Asia/Bangkok', '曼谷，河内'],
  ['Asia/Jakarta', '雅加达'],
  ['Asia/Kolkata', '新德里'],
  ['Asia/Dubai', '迪拜'],
  ['Europe/Moscow', '莫斯科'],
  ['Europe/Berlin', '柏林，巴黎'],
  ['Europe/London', '伦敦'],
  ['UTC', '协调世界时'],
  ['America/Sao_Paulo', '圣保罗'],
  ['America/New_York', '纽约'],
  ['America/Chicago', '芝加哥'],
  ['America/Denver', '丹佛'],
  ['America/Los_Angeles', '洛杉矶'],
];

/** "UTC+08:00" for a zone right now (summer time included). */
const offsetOf = (zone: string) => {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    return !name || name === 'GMT' ? 'UTC+00:00' : name.replace('GMT', 'UTC');
  } catch {
    return '';
  }
};

const zoneKey = (zone: string) => `team_tz_${zone.toLowerCase().replace(/[^a-z]/g, '_')}`;

// as yup infers it (the repo compiles without strictNullChecks, so every key reads optional)
type FormValues = { name?: string; code?: string; timezone?: string; description?: string };

const Card: FC<{ title: string; intro: string; tone?: 'danger'; children: ReactNode }> = ({ title, intro, tone, children }) => (
  <section className="rounded-[10px] border border-newBorder bg-newBgColorInner">
    <header className="px-[16px] pt-[14px] pb-[10px] border-b border-newBorder">
      <h4 className={clsx('text-[15px] font-[600]', tone === 'danger' && 'text-red-500')}>{title}</h4>
      <p className="text-[12px] text-textItemBlur mt-[2px] leading-[1.5]">{intro}</p>
    </header>
    <div className="p-[16px]">{children}</div>
  </section>
);

const pillClass =
  'h-[32px] px-[12px] rounded-full text-[13px] font-[600] text-textColor bg-btnSimple ring-1 ring-newBorder hover:bg-boxHover transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btnPrimary disabled:opacity-50 disabled:cursor-not-allowed';

/** The avatar: from the media library, a pasted image link, or none (the name's first letter). */
const AvatarField: FC<{
  name: string;
  avatar: string | null;
  disabled: boolean;
  onChange: (avatar: string | null) => void;
}> = ({ name, avatar, disabled, onChange }) => {
  const t = useT();
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const linkValid = URL_PATTERN.test(link.trim());

  const upload = useCallback(() => {
    showMediaBox((media) => {
      if (media?.path) {
        onChange(media.path);
      }
    });
  }, [onChange]);

  const applyLink = useCallback(() => {
    if (!linkValid) {
      return;
    }
    onChange(link.trim());
    setLink('');
    setLinkOpen(false);
  }, [link, linkValid, onChange]);

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex items-center gap-[16px]">
        <TeamAvatar name={name || '·'} avatar={avatar} size="lg" />
        <div className="flex flex-col gap-[8px] min-w-0">
          <span className="text-[13px] font-[600] text-textColor">{t('team_avatar', '团队头像')}</span>
          <div className="flex flex-wrap gap-[8px]">
            <button type="button" className={pillClass} disabled={disabled} onClick={upload}>
              {t('team_avatar_upload', '上传图片')}
            </button>
            <button
              type="button"
              className={pillClass}
              disabled={disabled}
              aria-expanded={linkOpen}
              onClick={() => setLinkOpen((value) => !value)}
            >
              {t('team_avatar_link', '使用图片链接')}
            </button>
            {!!avatar && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(null)}
                className="h-[32px] px-[8px] rounded-full text-[13px] text-textItemBlur hover:text-textColor transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('team_avatar_remove', '移除')}
              </button>
            )}
          </div>
        </div>
      </div>
      {linkOpen && (
        <div className="flex flex-col gap-[6px]">
          <div className="flex gap-[8px]">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyLink();
                }
              }}
              autoFocus={true}
              inputMode="url"
              aria-label={t('team_avatar_link', '使用图片链接')}
              aria-invalid={!!link && !linkValid}
              placeholder="https://"
              className="flex-1 min-w-0 h-[40px] px-[14px] rounded-[8px] bg-newBgColorInner border border-newTableBorder text-[14px] text-textColor placeholder:text-textItemBlur outline-none transition-[border-color,box-shadow] duration-150 focus:border-btnPrimary focus:ring-[3px] focus:ring-btnPrimary/15"
            />
            <Button secondary={true} disabled={!linkValid} onClick={applyLink}>
              {t('team_avatar_link_apply', '使用')}
            </Button>
          </div>
          {!!link && !linkValid && (
            <span className="text-[12px] text-red-400">{t('team_avatar_link_invalid', '请输入 http:// 或 https:// 开头的图片链接')}</span>
          )}
        </div>
      )}
    </div>
  );
};

const TeamInfoForm: FC<{ team: TeamInfo }> = ({ team }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const { mutate } = useSWRConfig();
  const [avatar, setAvatar] = useState<string | null>(team.avatar);
  const [saving, setSaving] = useState(false);
  const disabled = !team.canEdit;

  const schema = useMemo(
    () =>
      object({
        name: teamNameRule(t),
        code: string().matches(CODE_PATTERN, t('team_code_invalid', '最多 16 位，只能用字母、数字、- 和 _')),
        timezone: string().required(),
        description: string().max(DESCRIPTION_MAX, t('team_description_too_long', '团队介绍最多 200 个字')),
      }),
    [t]
  );
  const form = useForm<FormValues>({
    resolver: yupResolver(schema),
    defaultValues: {
      name: team.name,
      code: team.code || '',
      timezone: team.timezone,
      description: team.description || '',
    },
  });
  const [name, description] = useWatch({ control: form.control, name: ['name', 'description'] });
  const dirty = form.formState.isDirty || avatar !== team.avatar;

  const zones = useMemo(
    () => (TIMEZONES.some(([zone]) => zone === team.timezone) ? TIMEZONES : [...TIMEZONES, [team.timezone, team.timezone] as [string, string]]),
    [team.timezone]
  );

  const submit = useCallback(
    async (values: FormValues) => {
      setSaving(true);
      const res = await fetch('/user/organizations/current', {
        method: 'PUT',
        body: JSON.stringify({ ...values, avatar }),
      });
      setSaving(false);
      if (!res.ok) {
        toaster.show(await errorMessage(res, t('team_save_failed', '保存失败，请重试')), 'warning');
        return;
      }
      form.reset(values);
      await Promise.all([mutate('/user/organizations/current'), mutate('organizations')]);
      toaster.show(t('team_saved', '团队信息已保存'), 'success');
    },
    [avatar]
  );

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-[4px]">
        <fieldset disabled={disabled} className="contents">
          <AvatarField name={name} avatar={avatar} disabled={disabled} onChange={setAvatar} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-[16px] mt-[16px]">
            <Input label={t('team_name', '团队名称')} name="name" maxLength={60} autoComplete="off" />
            <Input
              label={t('team_code', '团队编码')}
              name="code"
              maxLength={16}
              autoComplete="off"
              placeholder={t('team_code_placeholder', '例如 NK-01')}
            />
          </div>
          <Select label={t('team_timezone', '时区')} name="timezone">
            {zones.map(([zone, city]) => (
              <option key={zone} value={zone}>
                {`(${offsetOf(zone)}) ${t(zoneKey(zone), city)}`}
              </option>
            ))}
          </Select>
          <div className="relative">
            <Textarea
              label={t('team_description', '团队介绍')}
              name="description"
              maxLength={DESCRIPTION_MAX}
              className="!min-h-[96px] resize-y"
              placeholder={t('team_description_placeholder', '这个团队服务的客户、品牌或业务')}
            />
            <span className="absolute end-0 bottom-0 text-[12px] text-textItemBlur tabular-nums">
              {(description || '').length}/{DESCRIPTION_MAX}
            </span>
          </div>
        </fieldset>
        <div className="flex items-center justify-between gap-[12px] pt-[4px]">
          <span className="text-[12px] text-textItemBlur">
            {disabled ? t('team_read_only', '只有团队管理员可以修改团队信息。') : ''}
          </span>
          {!disabled && (
            <Button type="submit" loading={saving} disabled={!dirty}>
              {t('team_save', '保存修改')}
            </Button>
          )}
        </div>
      </form>
    </FormProvider>
  );
};

/** Settings › 团队: the team's own information, 创建团队 and 删除团队 (SocialEcho 团队信息). */
export const TeamSettings: FC = () => {
  const t = useT();
  const { data: team, isLoading } = useTeamInfo();
  const createTeam = useCreateTeam();
  const deleteTeam = useDeleteTeam();

  if (isLoading || !team?.id) {
    return <div className="text-[14px] text-textItemBlur py-[20px]">{t('loading', '加载中…')}</div>;
  }

  return (
    <div className="flex flex-col gap-[16px] min-w-0 max-w-[760px]">
      <header className="flex flex-wrap items-start gap-[12px]">
        <div className="flex-1 min-w-[220px] flex flex-col gap-[4px]">
          <h3 className="text-[20px] font-[600]">{t('settings_team', '团队')}</h3>
          <p className="text-[13px] text-textItemBlur leading-[1.6]">
            {t(
              'team_settings_intro',
              '每个团队有自己的社媒账号、品牌资料、成员和套餐，互不影响。代理商可以给每个客户建一个团队，在顶部切换。'
            )}
          </p>
        </div>
        <Button secondary={true} onClick={createTeam}>
          {t('team_create', '创建团队')}
        </Button>
      </header>

      <Card
        title={t('team_info', '基本信息')}
        intro={t('team_info_intro', '更新团队头像、名称、时区和介绍。{{count}} 位成员。', { count: team.members })}
      >
        {/* keyed by the saved team so a save or a switch starts the form from what the server holds */}
        <TeamInfoForm key={`${team.id}:${team.avatar}:${team.name}`} team={team} />
      </Card>

      {team.canEdit && (
        <Card
          tone="danger"
          title={t('team_delete', '删除团队')}
          intro={t(
            'team_delete_intro',
            '删除后，团队的社媒账号、定时帖子、自动化和监控都会停止并移除，账号浏览器里的登录会被清除，剩余的套餐时长和积分不退还。'
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-[12px]">
            <span className="text-[13px] text-textItemBlur">
              {team.lastTeam
                ? t('team_delete_last', '这是你唯一的团队，不能删除。可以先创建或加入另一个团队。')
                : !team.canDelete
                ? t('team_delete_owner_only', '只有团队所有者可以删除团队。')
                : t('team_delete_switch', '删除后会切换到你的另一个团队。')}
            </span>
            <Button
              disabled={!team.canDelete}
              onClick={() => deleteTeam(team)}
              className="!bg-red-600 hover:!bg-red-700"
            >
              {t('team_delete', '删除团队')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
};
