jest.mock('@gitroom/nestjs-libraries/database/prisma/okchat/okchat.link.service', () => ({ OkchatLinkService: class {} }));

import { OkchatController } from '@gitroom/backend/api/routes/okchat.controller';

describe('GET /okchat/status', () => {
  it('asks for the caller\'s current team, or the team they picked', async () => {
    const link = { status: jest.fn(async () => ({ linked: false, platforms: [], accounts: [] })) };
    const controller = new OkchatController(link as any);
    await controller.status({ id: 'u1' } as any, { id: 'o1' } as any);
    expect(link.status).toHaveBeenCalledWith('u1', 'o1', undefined);
    await controller.status({ id: 'u1' } as any, { id: 'o1' } as any, 'o2');
    expect(link.status).toHaveBeenLastCalledWith('u1', 'o1', 'o2');
  });
});
