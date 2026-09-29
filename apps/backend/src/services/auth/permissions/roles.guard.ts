import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { OrgRole, roleAllowsRequest } from '@gitroom/helpers/auth/org.roles';
import {
  ALLOW_VIEWER_KEY,
  REQUIRE_ROLES_KEY,
} from '@gitroom/backend/services/auth/permissions/roles.decorator';

// Role checks that hold regardless of billing (the subscription policies in PermissionsService are
// skipped entirely when Stripe is not configured).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private _reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // @ts-ignore set by AuthMiddleware: users[0] is the caller's membership
    const role: string | undefined = request.org?.users?.[0]?.role;
    const targets = [context.getHandler(), context.getClass()];
    const required = this._reflector.getAllAndOverride<OrgRole[]>(REQUIRE_ROLES_KEY, targets);
    const allowViewer = !!this._reflector.getAllAndOverride<boolean>(ALLOW_VIEWER_KEY, targets);
    if (!roleAllowsRequest(role, request.method, required, allowViewer)) {
      throw new ForbiddenException('你的角色没有这个操作的权限');
    }
    return true;
  }
}
