import { RelayImageService, imageFromReply } from '@gitroom/nestjs-libraries/openai/relay.image.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const withReply = (content: string) => {
  const service = new RelayImageService();
  const create = jest.fn(async () => ({ choices: [{ message: { content } }] }));
  (service as any)._client = { chat: { completions: { create } } };
  return { service, create };
};

describe('imageFromReply', () => {
  it('reads the markdown data URL the relay answers image models with', () => {
    expect(imageFromReply(`![image](data:image/jpeg;base64,${PNG})`)).toEqual({ mime: 'image/jpeg', base64: PNG });
  });

  it('finds the image among text and returns null without one', () => {
    expect(imageFromReply(`好的，这是图片：\n![x](data:image/png;base64,${PNG})\n`)).toEqual({ mime: 'image/png', base64: PNG });
    expect(imageFromReply('抱歉，我不能生成这张图片')).toBeNull();
    expect(imageFromReply('')).toBeNull();
  });
});

describe('RelayImageService', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('asks the configured image model on chat completions with the aspect ratio in image_config', async () => {
    process.env.OKSOCIAL_IMAGE_MODEL = 'gemini-3-pro-image';
    const { service, create } = withReply(`![image](data:image/jpeg;base64,${PNG})`);
    expect(await service.generate('一杯拿铁', { aspect: '3:4' })).toEqual({ mime: 'image/jpeg', base64: PNG });
    const [body, options] = create.mock.calls[0] as unknown as [any, any];
    expect(body).toEqual({
      model: 'gemini-3-pro-image',
      messages: [{ role: 'user', content: '一杯拿铁' }],
      extra_body: { google: { image_config: { aspect_ratio: '3:4' } } },
    });
    expect(options.timeout).toBeGreaterThanOrEqual(60_000);
  });

  it('defaults to the verified model and sends a source image for image-to-image', async () => {
    delete process.env.OKSOCIAL_IMAGE_MODEL;
    const { service, create } = withReply(`![image](data:image/png;base64,${PNG})`);
    await service.generate('把图里的文字翻译成英文', { image: `data:image/png;base64,${PNG}` });
    const [body] = create.mock.calls[0] as unknown as [any];
    expect(body.model).toBe('gemini-3.1-flash-image');
    expect(body.extra_body).toBeUndefined();
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: '把图里的文字翻译成英文' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);
  });

  it('fails clearly when the model answers without an image', async () => {
    const { service } = withReply('我无法生成');
    await expect(service.generate('x')).rejects.toThrow('图片模型没有返回图片');
  });

  it('is enabled only with a relay key', () => {
    delete process.env.OPENAI_API_KEY;
    expect(new RelayImageService().enabled).toBe(false);
    process.env.OPENAI_API_KEY = 'k';
    expect(new RelayImageService().enabled).toBe(true);
  });
});

describe('OpenaiService.generateImage (Postiz editor button)', () => {
  it('goes through the relay image path and still returns bare base64', async () => {
    const relay = { generate: jest.fn(async () => ({ mime: 'image/jpeg', base64: PNG })) };
    const openai = new OpenaiService(relay as any);
    expect(await openai.generateImage('a cat')).toBe(PNG);
    expect(relay.generate).toHaveBeenCalledWith('a cat', { aspect: '1:1' });
    await openai.generateImage('a cat', true);
    expect(relay.generate).toHaveBeenLastCalledWith('a cat', { aspect: '2:3' });
  });
});
