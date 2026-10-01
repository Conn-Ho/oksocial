import { zhDefault } from './translate';

describe('zhDefault', () => {
  it('returns the Chinese default when there are no values', () => {
    expect(zhDefault('any_key', '发布失败')).toBe('发布失败');
  });

  it('fills {{values}} as they are, without HTML escaping', () => {
    expect(
      zhDefault('k', '找不到账号「{{name}}」，共 {{ n }} 个', {
        name: 'A&B',
        n: 3,
      })
    ).toBe('找不到账号「A&B」，共 3 个');
  });

  it('leaves missing values empty and ignores the interpolation option', () => {
    expect(
      zhDefault('k', '{{a}}-{{b}}', {
        a: 1,
        interpolation: { escapeValue: false },
      })
    ).toBe('1-');
  });
});
