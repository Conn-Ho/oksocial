import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const PAGE_SIZE = 20;

@Injectable()
export class CreationRepository {
  constructor(private _generations: PrismaRepository<'aiGeneration'>) {}

  /** A generation as it starts: who, which template, what went in. */
  start(data: {
    organizationId: string;
    userId: string | null;
    brandId?: string | null;
    template: string;
    input: Prisma.InputJsonValue;
  }) {
    return this._generations.model.aiGeneration.create({ data, select: { id: true } });
  }

  async history(orgId: string, page: number, templates: string[]) {
    const where = { organizationId: orgId, template: { in: templates } };
    const [total, items] = await Promise.all([
      this._generations.model.aiGeneration.count({ where }),
      this._generations.model.aiGeneration.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (Math.max(1, page) - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          template: true,
          brandId: true,
          input: true,
          output: true,
          error: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);
    return { total, page, pages: Math.ceil(total / PAGE_SIZE), items };
  }

  get(orgId: string, id: string) {
    return this._generations.model.aiGeneration.findFirst({
      where: { id, organizationId: orgId },
      include: { user: { select: { name: true, email: true } } },
    });
  }

  /** What came out, or why nothing did. */
  finish(orgId: string, id: string, data: { output?: Prisma.InputJsonValue; error?: string }) {
    return this._generations.model.aiGeneration.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
  }
}
