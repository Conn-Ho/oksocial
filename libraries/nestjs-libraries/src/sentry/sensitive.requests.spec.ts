import { hasSensitiveBody, scrubSensitiveRequest } from '@gitroom/nestjs-libraries/sentry/sensitive.requests';

describe('sensitive request bodies', () => {
  it('are the login form submits, by path or full URL, and nothing else', () => {
    expect(hasSensitiveBody('/browser-sessions/abc123/form')).toBe(true);
    expect(hasSensitiveBody('https://oksocial.online/api/browser-sessions/abc123/form?x=1')).toBe(true);
    expect(hasSensitiveBody('/browser-sessions/abc123')).toBe(false);
    expect(hasSensitiveBody('/browser-sessions/abc123/formats')).toBe(false);
    expect(hasSensitiveBody('/posts')).toBe(false);
    expect(hasSensitiveBody(undefined)).toBe(false);
  });

  it('are dropped from an event, which is otherwise left as it was', () => {
    const event = {
      event_id: 'e1',
      request: { url: 'http://localhost:3000/browser-sessions/abc/form', method: 'POST', data: { step: 'password', value: 'hunter2' } },
    };
    const scrubbed = scrubSensitiveRequest(event);
    expect(scrubbed).toEqual({ event_id: 'e1', request: { url: 'http://localhost:3000/browser-sessions/abc/form', method: 'POST' } });
    expect(JSON.stringify(scrubbed)).not.toContain('hunter2');
    // a copy: the event passed in is not changed
    expect(event.request.data.value).toBe('hunter2');
    const other = { request: { url: '/posts', data: { content: 'hello' } } };
    expect(scrubSensitiveRequest(other)).toBe(other);
    expect(scrubSensitiveRequest({ message: 'no request' } as any)).toEqual({ message: 'no request' });
  });
});
