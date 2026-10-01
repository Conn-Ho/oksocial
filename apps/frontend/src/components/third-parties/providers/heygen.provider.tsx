import { thirdPartyWrapper } from '@gitroom/frontend/components/third-parties/third-party.wrapper';
import {
  useThirdPartyFunction,
  useThirdPartyFunctionSWR,
  useThirdPartySubmit,
} from '@gitroom/frontend/components/third-parties/third-party.function';
import { useThirdParty } from '@gitroom/frontend/components/third-parties/third-party.media';
import { useForm, FormProvider, SubmitHandler } from 'react-hook-form';
import { Textarea } from '@gitroom/react/form/textarea';
import { Button } from '@gitroom/react/form/button';
import { FC, useCallback, useState } from 'react';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import clsx from 'clsx';
import { zodResolver } from '@hookform/resolvers/zod';
import { object, string } from 'zod';
import { Select } from '@gitroom/react/form/select';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const aspectRatio = [
  { key: 'portrait', value: '竖版' },
  { key: 'story', value: '快拍（Story）' },
];

const generateCaptions = [
  { key: 'yes', value: '是' },
  { key: 'no', value: '否' },
];

const SelectAvatarComponent: FC<{
  avatarList: any[];
  onChange: (id: string) => void;
}> = (props) => {
  const [current, setCurrent] = useState<any>({});
  const { avatarList, onChange } = props;

  return (
    <div className="grid grid-cols-4 gap-[10px] justify-items-center justify-center">
      {avatarList?.map((p) => (
        <div
          onClick={() => {
            setCurrent(p.avatar_id === current?.avatar_id ? undefined : p);
            onChange(p.avatar_id === current?.avatar_id ? {} : p.avatar_id);
          }}
          key={p.avatar_id}
          className={clsx(
            'w-full h-full p-[20px] min-h-[100px] text-[14px] hover:bg-input transition-all text-textColor relative flex flex-col gap-[15px] cursor-pointer',
            current?.avatar_id === p.avatar_id
              ? 'bg-input border border-red-500'
              : 'bg-third'
          )}
        >
          <div>
            <img
              src={p.preview_image_url}
              className="w-full h-full object-cover"
            />
          </div>
          <div>{p.avatar_name}</div>
        </div>
      ))}
    </div>
  );
};

const SelectVoiceComponent: FC<{
  voiceList: any[];
  onChange: (id: string) => void;
}> = (props) => {
  const [current, setCurrent] = useState<any>({});
  const { voiceList, onChange } = props;

  return (
    <div className="grid grid-cols-6 gap-[10px] justify-items-center justify-center">
      {voiceList?.map((p) => (
        <div
          onClick={() => {
            setCurrent(p.voice_id === current?.voice_id ? undefined : p);
            onChange(p.voice_id === current?.voice_id ? {} : p.voice_id);
          }}
          key={p.avatar_id}
          className={clsx(
            'w-full h-full p-[20px] min-h-[100px] text-[14px] hover:bg-input transition-all text-textColor relative flex flex-col gap-[15px] cursor-pointer',
            current?.voice_id === p.voice_id
              ? 'bg-input border border-red-500'
              : 'bg-third'
          )}
        >
          <div className="text-[14px] text-balance whitespace-pre-line">
            {p.name}
          </div>
          <div className="text-[12px]">{p.language}</div>
        </div>
      ))}
    </div>
  );
};

const HeygenProviderComponent = () => {
  const thirdParty = useThirdParty();
  const load = useThirdPartyFunction('EVERYTIME');
  const { data } = useThirdPartyFunctionSWR('LOAD_ONCE', 'avatars');
  const { data: voices } = useThirdPartyFunctionSWR('LOAD_ONCE', 'voices');
  const send = useThirdPartySubmit();
  const [hideVoiceGenerator, setHideVoiceGenerator] = useState(false);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const t = useT();

  const form = useForm({
    values: {
      voice: '',
      avatar: '',
      aspect_ratio: '',
      captions: '',
      selectedVoice: '',
      type: '',
    },
    mode: 'all',
    resolver: zodResolver(
      object({
        voice: string().min(
          20,
          t('heygen_voice_min_length', '配音文案至少需要 20 个字符')
        ),
        avatar: string().min(1, t('heygen_avatar_required', '请选择数字人形象')),
        selectedVoice: string().min(1, t('heygen_voice_required', '请选择声音')),
        aspect_ratio: string().min(
          1,
          t('heygen_aspect_ratio_required', '请选择画面比例')
        ),
        captions: string().min(
          1,
          t('heygen_captions_required', '请选择是否生成字幕')
        ),
      })
    ),
  });

  const generateVoice = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('confirm_replace_voice_text', '确定吗？当前文本将被替换。')
      ))
    ) {
      return;
    }

    setVoiceLoading(true);

    form.setValue(
      'voice',
      (
        await load('generateVoice', {
          text: thirdParty.data.map((p) => p.content).join('\n'),
        })
      ).voice
    );

    setVoiceLoading(false);
    setHideVoiceGenerator(true);
  }, [thirdParty]);

  const submit: SubmitHandler<{ voice: string; avatar: string }> = useCallback(
    async (params) => {
      thirdParty.onChange(await send(params));
      thirdParty.close();
    },
    []
  );

  return (
    <div>
      {form.formState.isSubmitting && (
        <div className="fixed left-0 top-0 w-full leading-[50px] pt-[200px] h-screen bg-black/90 z-50 flex flex-col justify-center items-center text-center text-3xl">
          {t('heygen_take_a_while', '喝杯咖啡休息一下，这可能需要一些时间…')}
          <br />
          {t('heygen_track_progress', '你也可以直接在 HeyGen 控制台查看进度。')}
          <br />
          {t('do_not_close_window', '请勿关闭此窗口！')}
          <br />
          <LoadingComponent width={200} height={200} />
        </div>
      )}

      <FormProvider {...form}>
        <form
          onSubmit={form.handleSubmit(submit)}
          className="w-full flex flex-col"
        >
          <Select
            label={t('aspect_ratio', '画面比例')}
            {...form.register('aspect_ratio')}
          >
            <option value="">{t('select_1', '--请选择--')}</option>
            {aspectRatio.map((p) => (
              <option key={p.key} value={p.key}>
                {t(`heygen_aspect_${p.key}`, p.value)}
              </option>
            ))}
          </Select>

          <Select
            label={t('generate_captions', '生成字幕')}
            {...form.register('captions')}
          >
            <option value="">{t('select_1', '--请选择--')}</option>
            {generateCaptions.map((p) => (
              <option key={p.key} value={p.key}>
                {t(`heygen_captions_${p.key}`, p.value)}
              </option>
            ))}
          </Select>

          <div className="text-lg mb-3">
            {t('voice_to_generate', '配音文案')}
          </div>
          {!hideVoiceGenerator && (
            <Button onClick={generateVoice} loading={voiceLoading}>
              {t('generate_voice_from_post', '根据帖子内容生成配音文案')}
            </Button>
          )}
          <Textarea label="" {...form.register('voice')} />
          {!!data?.length && (
            <>
              <div className="text-lg my-3">
                {t('select_avatar', '选择数字人形象')}
              </div>
              <SelectAvatarComponent
                avatarList={data.map((p: any) => ({
                  avatar_id: p.avatar_id || p.id,
                  avatar_name: p.avatar_name || p.name,
                  preview_image_url: p.preview_image_url || p.image_url,
                }))}
                onChange={(id: string) => {
                  form.setValue('avatar', id);
                  form.setValue(
                    'type',
                    data?.find((p: any) => p.id === id || p.avatar_id === id)?.id
                      ? 'talking_photo'
                      : 'avatar'
                  );
                }}
              />
              <div className="text-red-400 text-[12px] mb-3">
                {form?.formState?.errors?.avatar?.message || ''}
              </div>
            </>
          )}

          {!!voices?.length && (
            <>
              <div className="text-lg my-3">
                {t('select_voice', '选择声音')}
              </div>
              <SelectVoiceComponent
                voiceList={voices}
                onChange={(id: string) => form.setValue('selectedVoice', id)}
              />
              <div className="text-red-400 text-[12px] mb-3">
                {form?.formState?.errors?.selectedVoice?.message || ''}
              </div>
            </>
          )}

          <Button type="submit">{t('generate_video', '生成视频')}</Button>
        </form>
      </FormProvider>
    </div>
  );
};

export default thirdPartyWrapper('heygen', HeygenProviderComponent);
