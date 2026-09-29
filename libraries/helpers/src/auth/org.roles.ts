// oksocial organization roles (Prisma enum Role). Shared by the backend guard and the frontend so the
// UI hides what the API would refuse.
export type OrgRole = 'SUPERADMIN' | 'ADMIN' | 'MANAGER' | 'USER' | 'VIEWER';

export const ASSIGNABLE_ROLES: Exclude<OrgRole, 'SUPERADMIN'>[] = ['ADMIN', 'MANAGER', 'USER', 'VIEWER'];

export const ROLE_LABELS: Record<OrgRole, string> = {
  SUPERADMIN: '超级管理员',
  ADMIN: '管理员',
  MANAGER: '运营主管',
  USER: '内容运营',
  VIEWER: '只读成员',
};

const RANK: Record<OrgRole, number> = { VIEWER: 0, USER: 1, MANAGER: 2, ADMIN: 3, SUPERADMIN: 4 };

const atLeast = (role: string | undefined, min: OrgRole) =>
  !!role && role in RANK && RANK[role as OrgRole] >= RANK[min];

/** Connect / disconnect channels, bind proxies, run automations. */
export const canManageChannels = (role?: string) => atLeast(role, 'MANAGER');
/** Approve or reject posts waiting for review. */
export const canReviewPosts = (role?: string) => atLeast(role, 'MANAGER');
/** Team members, billing, organization settings. */
export const canManageOrg = (role?: string) => atLeast(role, 'ADMIN');
/** Create and edit posts, upload media. */
export const canWritePosts = (role?: string) => atLeast(role, 'USER');
/** A 内容运营's scheduled posts wait for review when the organization turned approval on. */
export const needsApproval = (role: string | undefined, orgRequiresApproval: boolean) =>
  orgRequiresApproval && role === 'USER';

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Whether a request passes the role checks. `required` lists the roles an endpoint accepts
 * (SUPERADMIN counts as ADMIN); VIEWER may only read unless the endpoint opts in with allowViewer.
 * Requests without an organization role (public or auth routes) are not role-checked.
 */
export const roleAllowsRequest = (
  role: string | undefined,
  method: string,
  required?: OrgRole[],
  allowViewer = false
) => {
  if (!role) {
    return true;
  }
  const effective = (role === 'SUPERADMIN' ? 'ADMIN' : role) as OrgRole;
  if (required?.length && !required.includes(effective)) {
    return false;
  }
  if (effective === 'VIEWER' && !allowViewer && !READ_METHODS.includes(method.toUpperCase())) {
    return false;
  }
  return true;
};
