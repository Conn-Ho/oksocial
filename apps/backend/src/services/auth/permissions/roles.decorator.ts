import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@gitroom/helpers/auth/org.roles';

export const REQUIRE_ROLES_KEY = 'oksocial:require-roles';
export const ALLOW_VIEWER_KEY = 'oksocial:allow-viewer';

/** Only these organization roles may call the endpoint (SUPERADMIN counts as ADMIN). */
export const RequireRoles = (...roles: OrgRole[]) => SetMetadata(REQUIRE_ROLES_KEY, roles);

/** A write endpoint read-only members may still call (their own profile, notifications). */
export const AllowViewer = () => SetMetadata(ALLOW_VIEWER_KEY, true);
