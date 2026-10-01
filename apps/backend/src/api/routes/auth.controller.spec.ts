jest.mock('@gitroom/backend/services/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@gitroom/nestjs-libraries/services/email.service', () => ({ EmailService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/social/farcaster.provider', () => ({ FarcasterProvider: class {} }));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import { INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from '@gitroom/backend/api/routes/auth.controller';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';

const auth = { resendActivationEmail: jest.fn(async () => true) };

@Module({
  // as app.module (in-memory storage here)
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 3600000, limit: 90 }] })],
  controllers: [AuthController],
  providers: [
    { provide: AuthService, useValue: auth },
    { provide: EmailService, useValue: {} },
  ],
})
class TestModule {}

let app: INestApplication;
let base: string;

beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/auth`.replace('[::1]', '127.0.0.1');
});

afterAll(async () => {
  await app.close();
});

const resend = (ip: string, email = 'a@b.com') =>
  fetch(`${base}/resend-activation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email }),
  });

describe('POST /auth/resend-activation', () => {
  it('mails anyone\'s address on request, so one client address gets 20 an hour', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await resend('10.0.0.1', `u${i}@b.com`)).status).toBe(201);
    }
    expect((await resend('10.0.0.1')).status).toBe(429);
    expect(auth.resendActivationEmail).toHaveBeenCalledTimes(20);
    // another address is not held up
    expect((await resend('10.0.0.2')).status).toBe(201);
  });
});
