import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.ts';
import { MediaFetchBody, parseOrThrow } from '../schemas.ts';

export function registerMediaRoutes(app: FastifyInstance, { media }: AppDeps): void {
  app.post('/media/fetch', async (req) => {
    const { urls } = parseOrThrow(MediaFetchBody, req.body);
    return { paths: await media.fetchAll(urls) };
  });
}
