import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { MEDIA_KIND_EXTENSIONS, MediaKind } from '@gitroom/helpers/utils/media.kind';

export const TRASH_PAGE_SIZE = 30;

/**
 * The 网盘 library: live media out of the trash, ready (a file being normalized shows up once
 * released), optionally by original name and by kind (file extension). Pure.
 */
export const libraryWhere = (org: string, f: { kind?: MediaKind; search?: string } = {}) => {
  const search = f.search?.trim();
  return {
    organizationId: org,
    deletedAt: null,
    trashedAt: null,
    status: { not: 'processing' },
    ...(search ? { originalName: { contains: search, mode: 'insensitive' as const } } : {}),
    ...(f.kind
      ? {
          OR: MEDIA_KIND_EXTENSIONS[f.kind].map((ext) => ({
            path: { endsWith: `.${ext}`, mode: 'insensitive' as const },
          })),
        }
      : {}),
  } satisfies Prisma.MediaWhereInput;
};

@Injectable()
export class MediaRepository {
  constructor(private _media: PrismaRepository<'media'>) {}

  saveFile(org: string, fileName: string, filePath: string, originalName?: string, fileSize?: number) {
    return this._media.model.media.create({
      data: {
        organization: {
          connect: {
            id: org,
          },
        },
        name: fileName,
        path: filePath,
        originalName: originalName || null,
        ...(fileSize ? { fileSize } : {}),
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        status: true,
      },
    });
  }

  startProcessing(org: string, id: string) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: { status: 'processing', processingError: null },
      select: { id: true, status: true },
    });
  }

  finishProcessing(
    org: string,
    id: string,
    data: { name?: string; path?: string; fileSize?: number; error?: string }
  ) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.path ? { path: data.path } : {}),
        ...(data.fileSize ? { fileSize: data.fileSize } : {}),
        status: data.error ? 'failed' : 'ready',
        processingError: data.error || null,
      },
      select: { id: true, status: true },
    });
  }

  getMediaStatus(org: string, id: string) {
    return this._media.model.media.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
        trashedAt: null,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        status: true,
        processingError: true,
      },
    });
  }

  getMediaById(id: string) {
    return this._media.model.media.findUnique({
      where: {
        id,
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._media.model.media.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getMedia(org: string, page: number, search?: string, kind?: MediaKind) {
    const pageNum = (page || 1) - 1;
    // still being normalized: it shows up once the workflow releases it; trashed: only in 回收站
    const where = libraryWhere(org, { search, kind });
    const pages = Math.ceil((await this._media.model.media.count({ where })) / 18);
    const results = await this._media.model.media.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        fileSize: true,
        createdAt: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return {
      pages,
      results,
    };
  }

  countLibrary(org: string, kind?: MediaKind) {
    return this._media.model.media.count({ where: libraryWhere(org, { kind }) });
  }

  countTrash(org: string) {
    return this._media.model.media.count({
      where: { organizationId: org, deletedAt: null, trashedAt: { not: null } },
    });
  }

  /** Moves files to the 回收站 (the ones already there keep their date). */
  trash(org: string, ids: string[]) {
    return this._media.model.media.updateMany({
      where: { organizationId: org, id: { in: ids }, deletedAt: null, trashedAt: null },
      data: { trashedAt: new Date() },
    });
  }

  restore(org: string, ids: string[]) {
    return this._media.model.media.updateMany({
      where: { organizationId: org, id: { in: ids }, deletedAt: null, trashedAt: { not: null } },
      data: { trashedAt: null },
    });
  }

  async trashList(org: string, page: number) {
    const where = { organizationId: org, deletedAt: null, trashedAt: { not: null } };
    const [total, rows] = await Promise.all([
      this._media.model.media.count({ where }),
      this._media.model.media.findMany({
        where,
        orderBy: { trashedAt: 'desc' },
        skip: (Math.max(1, page) - 1) * TRASH_PAGE_SIZE,
        take: TRASH_PAGE_SIZE,
        select: {
          id: true,
          name: true,
          originalName: true,
          path: true,
          thumbnail: true,
          fileSize: true,
          trashedAt: true,
        },
      }),
    ]);
    return { total, rows };
  }

  /** 彻底删除: trashed files of the organization (all of them without ids) are deleted. */
  purgeTrashed(org: string, ids?: string[]) {
    return this._media.model.media.updateMany({
      where: {
        organizationId: org,
        deletedAt: null,
        trashedAt: { not: null },
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { deletedAt: new Date() },
    });
  }

  /** Files of every organization trashed before the cutoff, oldest first. */
  dueForPurge(cutoff: Date, take: number) {
    return this._media.model.media.findMany({
      where: { deletedAt: null, trashedAt: { lt: cutoff } },
      orderBy: { trashedAt: 'asc' },
      take,
      select: { id: true },
    });
  }

  markPurged(ids: string[]) {
    return this._media.model.media.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }
}
