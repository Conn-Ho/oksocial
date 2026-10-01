import {
  planLinkKind,
  usageRatio,
  userDisplayName,
  userInitials,
} from './sidebar.account';

describe('userDisplayName', () => {
  it('uses the profile name when there is one', () => {
    expect(userDisplayName({ name: '  贺永贤 ', email: 'a@b.c' })).toBe('贺永贤');
  });

  it('joins a first and last name', () => {
    expect(userDisplayName({ name: 'Conn', lastName: 'Ho', email: 'a@b.c' })).toBe('Conn Ho');
  });

  it('falls back to the part of the email before the @', () => {
    expect(userDisplayName({ name: '', email: 'qa-admin@oksocial.online' })).toBe('qa-admin');
  });

  it('returns an empty string when nothing is known', () => {
    expect(userDisplayName({})).toBe('');
  });
});

describe('userInitials', () => {
  it('takes the first letters of two Latin words', () => {
    expect(userInitials('conn ho')).toBe('CH');
  });

  it('takes one letter of a single Latin word', () => {
    expect(userInitials('shishi')).toBe('S');
  });

  it('takes the first character of a CJK name', () => {
    expect(userInitials('贺永贤')).toBe('贺');
  });

  it('keeps an emoji whole', () => {
    expect(userInitials('😀 team')).toBe('😀');
  });

  it('shows a dot when the name is empty', () => {
    expect(userInitials('  ')).toBe('·');
  });
});

describe('planLinkKind', () => {
  const paid = { isTrial: false, isLifetime: false };

  it('asks a free team to upgrade', () => {
    expect(planLinkKind('FREE', null)).toBe('upgrade');
  });

  it('asks a team on trial to upgrade', () => {
    expect(planLinkKind('TEAM', { ...paid, isTrial: true })).toBe('upgrade');
  });

  it('asks a prepaid team to renew', () => {
    expect(planLinkKind('TEAM', paid)).toBe('renew');
  });

  it('only shows the details of a lifetime plan', () => {
    expect(planLinkKind('TEAM', { ...paid, isLifetime: true })).toBe('details');
  });
});

describe('usageRatio', () => {
  it('is the share used', () => {
    expect(usageRatio(6, 200)).toBeCloseTo(0.03);
  });

  it('stops at full', () => {
    expect(usageRatio(12, 10)).toBe(1);
  });

  it('is full when the plan includes none', () => {
    expect(usageRatio(0, 0)).toBe(1);
  });

  it('has no bar for an unlimited or unknown count', () => {
    expect(usageRatio(6, -1)).toBeNull();
    expect(usageRatio(null, 200)).toBeNull();
  });
});
