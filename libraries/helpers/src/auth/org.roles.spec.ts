import {
  canManageChannels,
  canManageOrg,
  canReviewPosts,
  canWritePosts,
  needsApproval,
  roleAllowsRequest,
} from '@gitroom/helpers/auth/org.roles';

describe('org roles', () => {
  it('ranks the four roles', () => {
    expect(['ADMIN', 'MANAGER', 'USER', 'VIEWER'].map(canManageChannels)).toEqual([true, true, false, false]);
    expect(['ADMIN', 'MANAGER', 'USER', 'VIEWER'].map(canReviewPosts)).toEqual([true, true, false, false]);
    expect(['ADMIN', 'MANAGER', 'USER', 'VIEWER'].map(canManageOrg)).toEqual([true, false, false, false]);
    expect(['ADMIN', 'MANAGER', 'USER', 'VIEWER'].map(canWritePosts)).toEqual([true, true, true, false]);
    expect(canManageOrg('SUPERADMIN')).toBe(true);
    expect(canWritePosts(undefined)).toBe(false);
    expect(canWritePosts('NOPE')).toBe(false);
  });

  it('only holds content editors, and only when the org asks for approval', () => {
    expect(needsApproval('USER', true)).toBe(true);
    expect(needsApproval('USER', false)).toBe(false);
    expect(needsApproval('MANAGER', true)).toBe(false);
    expect(needsApproval('ADMIN', true)).toBe(false);
  });

  it('lets viewers read but not write, unless the endpoint allows it', () => {
    expect(roleAllowsRequest('VIEWER', 'GET')).toBe(true);
    expect(roleAllowsRequest('VIEWER', 'POST')).toBe(false);
    expect(roleAllowsRequest('VIEWER', 'delete')).toBe(false);
    expect(roleAllowsRequest('VIEWER', 'PUT', undefined, true)).toBe(true);
    expect(roleAllowsRequest('USER', 'POST')).toBe(true);
  });

  it('enforces the roles an endpoint requires, with SUPERADMIN as ADMIN', () => {
    expect(roleAllowsRequest('USER', 'POST', ['ADMIN', 'MANAGER'])).toBe(false);
    expect(roleAllowsRequest('MANAGER', 'POST', ['ADMIN', 'MANAGER'])).toBe(true);
    expect(roleAllowsRequest('SUPERADMIN', 'POST', ['ADMIN'])).toBe(true);
    expect(roleAllowsRequest('VIEWER', 'GET', ['ADMIN', 'MANAGER'])).toBe(false);
  });

  it('does not role-check requests without an organization role', () => {
    expect(roleAllowsRequest(undefined, 'POST', ['ADMIN'])).toBe(true);
  });
});
