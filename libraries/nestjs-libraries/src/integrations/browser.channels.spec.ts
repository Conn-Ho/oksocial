import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { BROWSER_CHANNELS } from '@gitroom/nestjs-libraries/integrations/social/browser.channels';
import { CREATION_CATALOG } from '@gitroom/nestjs-libraries/creation/creation.platforms';

type Run = { ok: boolean; data?: any; code?: string };

const fakeFleet = (runs: Run[] = []) => {
  const calls: string[][] = [];
  return {
    calls,
    configured: true,
    run: jest.fn(async (_slot: string, args: string[]) => {
      calls.push(args);
      const next = runs.shift() ?? { ok: true, data: [] };
      return { durationMs: 1, exitCode: null, message: '', ...next };
    }),
    fetchMedia: jest.fn(async (urls: string[]) => ({
      paths: urls.map((u, i) => `/tmp/m${i}${u.slice(u.lastIndexOf('.'))}`),
    })),
  };
};
const withFleet = <T>(provider: T, fleet: any) => {
  (provider as any).fleet = fleet;
  return provider;
};
const post = (message: string, media: string[] = [], settings: any = {}) => [
  { id: 'db1', message, settings, media: media.map((path) => ({ type: 'image' as const, path })) },
];
const channel = (identifier: string) => {
  const found = BROWSER_CHANNELS.find((c) => c.identifier === identifier);
  if (!found) throw new Error(`no channel ${identifier}`);
  return found;
};

// What each platform's `opencli <site> whoami` prints for a logged-in account.
const WHOAMI: Record<string, [Record<string, unknown>, { id: string; name: string; username: string }]> = {
  shipinhao: [{ user_id: 'v2_abc', name: '小鹿咖啡' }, { id: 'v2_abc', name: '小鹿咖啡', username: '小鹿咖啡' }],
  bilibili: [{ id: 1234, username: '小鹿咖啡', level: 4 }, { id: '1234', name: '小鹿咖啡', username: '小鹿咖啡' }],
  zhihu: [{ url_token: 'xiaolu', name: '小鹿', uid: 'u9' }, { id: 'u9', name: '小鹿', username: 'xiaolu' }],
  jike: [{ user_id: 'j1', screen_name: '小鹿', username: 'xiaolu' }, { id: 'j1', name: '小鹿', username: 'xiaolu' }],
  toutiao: [{ user_id: 't1', nickname: '小鹿说' }, { id: 't1', name: '小鹿说', username: '小鹿说' }],
  instagramweb: [{ user_id: '55', username: 'xiaolu.coffee', full_name: 'Xiaolu Coffee' }, { id: '55', name: 'Xiaolu Coffee', username: 'xiaolu.coffee' }],
  facebookweb: [{ user_id: '100', vanity: 'xiaolu', profile_url: 'https://www.facebook.com/xiaolu' }, { id: '100', name: 'xiaolu', username: 'xiaolu' }],
  tiktokweb: [{ sec_uid: 'MS4w', username: 'xiaolu', nickname: '小鹿' }, { id: 'MS4w', name: '小鹿', username: 'xiaolu' }],
  youtubeweb: [{ name: 'Xiaolu Coffee' }, { id: 'Xiaolu Coffee', name: 'Xiaolu Coffee', username: 'Xiaolu Coffee' }],
  linkedinweb: [{ public_id: 'xiaolu', plain_id: '777', name: 'Xiao Lu' }, { id: '777', name: 'Xiao Lu', username: 'xiaolu' }],
  redditweb: [{ username: 'xiaolu', id: 't2_1' }, { id: 't2_1', name: 'xiaolu', username: 'xiaolu' }],
};

describe('browser channels for every platform opencli can log in to', () => {
  it('each has a dashless identifier, a login page, a whoami command and how to write for it', () => {
    expect(BROWSER_CHANNELS.map((c) => c.identifier).sort()).toEqual(Object.keys(WHOAMI).sort());
    for (const c of BROWSER_CHANNELS) {
      expect(c.identifier).toMatch(/^[a-z]+$/);
      expect(c.browserSession.loginUrl).toMatch(/^https:\/\//);
      expect(c.browserSession.whoami[1]).toBe('whoami');
      expect(c.creation?.guide.length).toBeGreaterThan(10);
      expect(CREATION_CATALOG.some((p) => p.identifier === (c.platform ?? c.identifier))).toBe(true);
    }
  });

  it('reads the logged-in account from whoami, and nothing from an empty answer', () => {
    for (const [identifier, [row, identity]] of Object.entries(WHOAMI)) {
      const c = channel(identifier);
      expect(c.browserSession.identity([row])).toEqual(identity);
      expect(c.browserSession.identity([])).toBeNull();
      expect(c.browserSession.identity([{}])).toBeNull();
    }
  });

  it('视频号 publishes one video with its short title and caption, as a draft when asked', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ status: 'success', title: '今天的咖啡' }] }]);
    const c = withFleet(channel('shipinhao'), fleet);
    expect(await c.checkValidity([[]])).toMatch(/视频/);
    expect(await c.checkValidity([[{ path: 'a.jpg' }]])).toMatch(/视频/);
    expect(await c.checkValidity([[{ path: 'a.mp4' }]])).toBe(true);
    const [res] = await c.post('u1', 's1', post('今天的咖啡\n手冲日常 #咖啡', ['https://x/a.mp4'], { draft: true }), {} as any);
    expect(fleet.calls[0]).toEqual(['wechat-channels', 'publish', '/tmp/m0.mp4', '--title', '今天的咖啡', '--caption', '今天的咖啡\n手冲日常 #咖啡', '--draft', 'true']);
    expect(res).toMatchObject({ id: 'db1', status: 'success' });
  });

  it('即刻 publishes text and says images are not supported yet', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ status: 'success' }] }]);
    const c = withFleet(channel('jike'), fleet);
    expect(await c.checkValidity([[{ path: 'a.jpg' }]])).toMatch(/图片/);
    expect(await c.checkValidity([[]])).toBe(true);
    await c.post('u1', 's1', post('今天发布了新功能'), {} as any);
    expect(fleet.calls[0]).toEqual(['jike', 'create', '今天发布了新功能']);
  });

  it('Instagram publishes 1-10 photos or videos with the caption', async () => {
    const fleet = fakeFleet([{ ok: true, data: [{ status: 'success', url: 'https://www.instagram.com/p/AbC/' }] }]);
    const c = withFleet(channel('instagramweb'), fleet);
    expect(await c.checkValidity([[]])).toMatch(/至少/);
    expect(await c.checkValidity([Array.from({ length: 11 }, () => ({ path: 'a.jpg' }))])).toMatch(/最多/);
    const [res] = await c.post('u1', 's1', post('New beans today', ['https://x/a.jpg', 'https://x/b.mp4']), {} as any);
    expect(fleet.calls[0]).toEqual(['instagram', 'post', 'New beans today', '--media', '/tmp/m0.jpg,/tmp/m1.mp4']);
    expect(res).toMatchObject({ postId: 'AbC', releaseURL: 'https://www.instagram.com/p/AbC/' });
  });

  it('a platform whose publishing is not built yet refuses clearly instead of failing on the platform', async () => {
    const c = withFleet(channel('bilibili'), fakeFleet());
    expect(c.publishable).toBe(false);
    await expect(c.post('u1', 's1', post('hi'), {} as any)).rejects.toBeInstanceOf(BadBody);
    expect(channel('shipinhao').publishable).toBe(true);
  });
});
