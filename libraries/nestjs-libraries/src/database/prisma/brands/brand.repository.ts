import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/** The editable fields of a 品牌档案. */
export type BrandFields = {
  name: string;
  tagline?: string | null;
  products?: string | null;
  audience?: string | null;
  tone?: string | null;
  keywords: string[];
  bannedWords: string[];
  cta?: string | null;
  examples?: string | null;
};

@Injectable()
export class BrandRepository {
  constructor(
    private _brands: PrismaRepository<'brandProfile'>,
    private _transaction: PrismaTransaction
  ) {}

  list(orgId: string) {
    return this._brands.model.brandProfile.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  count(orgId: string) {
    return this._brands.model.brandProfile.count({ where: { organizationId: orgId, deletedAt: null } });
  }

  get(orgId: string, id: string) {
    return this._brands.model.brandProfile.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  getDefault(orgId: string) {
    return this._brands.model.brandProfile.findFirst({
      where: { organizationId: orgId, deletedAt: null, isDefault: true },
    });
  }

  /** The oldest remaining profile, to become the default when the default one is deleted. */
  oldest(orgId: string) {
    return this._brands.model.brandProfile.findFirst({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(orgId: string, data: BrandFields & { source?: string | null; isDefault: boolean }) {
    return this._brands.model.brandProfile.create({ data: { ...data, organizationId: orgId } });
  }

  update(orgId: string, id: string, data: Partial<BrandFields>) {
    return this._brands.model.brandProfile.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    });
  }

  delete(orgId: string, id: string) {
    return this._brands.model.brandProfile.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date(), isDefault: false },
    });
  }

  /** Exactly one default per organization. */
  setDefault(orgId: string, id: string) {
    return this._transaction.model.$transaction([
      this._brands.model.brandProfile.updateMany({
        where: { organizationId: orgId, isDefault: true, NOT: { id } },
        data: { isDefault: false },
      }),
      this._brands.model.brandProfile.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: { isDefault: true },
      }),
    ]);
  }
}
