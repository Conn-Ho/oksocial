import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../src/errors.ts';
import { fillLoginForm, keystrokes, pageExpression, probeLoginForm, toFormState } from '../src/login-form.ts';
import type { LoginFormState } from '../src/login-form.ts';
import { LOGIN_FORM_PAGE } from '../src/login-form-page.ts';
import { fail, withDevtools } from './devtools.ts';
import type { Call, Target } from './devtools.ts';

const tabs: Target[] = [
  { id: 'BLANK', type: 'page', url: 'about:blank' },
  { id: 'LOGIN', type: 'page', url: 'https://x.com/i/flow/login' },
];
const noSleep = async () => {};
const deps = { sleep: noSleep, random: () => 0.5 };
const SECRET = 'Pässwörd 1!';

const state = (step: LoginFormState['step'], extra: Partial<LoginFormState> = {}): LoginFormState => ({
  step,
  prompt: null,
  detail: null,
  error: null,
  field:
    step === 'identifier' || step === 'password' || step === 'code'
      ? { kind: step, label: null, inputType: step === 'password' ? 'password' : 'text', inputMode: null, autocomplete: step === 'password' ? 'current-password' : step === 'code' ? 'one-time-code' : 'username', maxLength: null }
      : null,
  ...extra,
});

/** The page script's action and kind from a Runtime.evaluate expression. */
const actionOf = (params: Record<string, unknown>) => {
  const expr = String(params.expression);
  assert.ok(expr.startsWith(`(${LOGIN_FORM_PAGE})(`), 'only the login form script is evaluated');
  return JSON.parse(expr.slice(LOGIN_FORM_PAGE.length + 3, -1)) as { action: string; kind?: string };
};

/** A login page: `probes` answers successive probes (the last repeats), the other actions answer `actions`. */
const page = (probes: unknown[], actions: Record<string, unknown> = {}) => {
  const queue = [...probes];
  return (method: string, params: Record<string, unknown>) => {
    if (method !== 'Runtime.evaluate') return {};
    const { action } = actionOf(params);
    if (action === 'probe') {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return next && typeof next === 'object' && 'fail' in next ? fail(String((next as { fail: string }).fail)) : { result: { value: next } };
    }
    return { result: { value: actions[action] ?? null } };
  };
};

const typed = (calls: Call[]) =>
  calls
    .filter((c) => (c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyDown' && c.params.text) || c.method === 'Input.insertText')
    .map((c) => String(c.params.text))
    .join('');
const steps = (calls: Call[]) =>
  calls.map((c) => (c.method === 'Runtime.evaluate' ? `eval ${actionOf(c.params).action}` : c.method === 'Input.dispatchMouseEvent' ? `mouse ${c.params.type} ${c.params.x},${c.params.y}` : c.method === 'Input.dispatchKeyEvent' ? `key ${c.params.type} ${c.params.key}` : c.method));

describe('toFormState', () => {
  it('keeps a well-formed state as it is', () => {
    assert.deepEqual(toFormState(state('password', { prompt: 'Enter your password', error: 'Wrong password!' })), state('password', { prompt: 'Enter your password', error: 'Wrong password!' }));
  });

  it('trusts nothing from the page: unknown steps, a step without its field, odd field values, long text', () => {
    assert.equal(toFormState({ step: 'rm -rf' }).step, 'unknown');
    assert.equal(toFormState(null).step, 'unknown');
    assert.equal(toFormState({ step: 'password', field: { kind: 'identifier' } }).step, 'unknown');
    const odd = toFormState({ step: 'code', field: { kind: 'code', inputType: 'file', inputMode: 'javascript', autocomplete: 'off', maxLength: 99999, label: 7 } });
    assert.deepEqual(odd.field, { kind: 'code', label: null, inputType: 'text', inputMode: null, autocomplete: 'one-time-code', maxLength: 512 });
    assert.equal(toFormState({ step: 'done', prompt: 'x'.repeat(1000) }).prompt?.length, 301);
    assert.equal(toFormState({ ...state('password'), next: 'password' }).next, undefined);
  });
});

describe('keystrokes', () => {
  it('types printable ASCII as key presses and anything else as inserted text, one group per character', () => {
    assert.deepEqual(keystrokes('a1 中'), [
      [
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a', unmodifiedText: 'a' } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 } },
      ],
      [
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, text: '1', unmodifiedText: '1' } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: '1', code: 'Digit1', windowsVirtualKeyCode: 49 } },
      ],
      [
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ', unmodifiedText: ' ' } },
        { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 } },
      ],
      [{ method: 'Input.insertText', params: { text: '中' } }],
    ]);
    // a character outside the BMP is one character, not two halves
    assert.deepEqual(keystrokes('😀'), [[{ method: 'Input.insertText', params: { text: '😀' } }]]);
  });
});

describe('probeLoginForm', () => {
  it('runs the page script in the screen tab and answers the cleaned state', async () => {
    await withDevtools(tabs, page([state('identifier', { prompt: 'Sign in to X' })]), async (port, log, calls) => {
      assert.deepEqual(await probeLoginForm(port, 'LOGIN', { loginUrls: ['x.com/i/flow/login'] }), state('identifier', { prompt: 'Sign in to X' }));
      assert.deepEqual(log, ['GET /json/list', 'LOGIN Runtime.evaluate']);
      assert.equal(calls[0]?.params.expression, pageExpression('probe', { loginUrls: ['x.com/i/flow/login'] }));
    });
  });

  it('409s when the slot shows no web page', async () => {
    await withDevtools(tabs.slice(0, 1), page([null]), async (port) => {
      await assert.rejects(probeLoginForm(port, undefined, {}), (err: HttpError) => err.statusCode === 409 && err.code === 'NO_LOGIN_PAGE');
    });
  });
});

describe('fillLoginForm', () => {
  it('clicks into the field, types the value key by key, clicks the submit button and answers the next step', async () => {
    const answer = page([state('identifier'), state('identifier'), state('password', { prompt: 'Enter your password' })], {
      focus: { x: 250, y: 220 },
      prepare: { hadText: false },
      submit: { x: 250, y: 425 },
    });
    await withDevtools(tabs, answer, async (port, _log, calls) => {
      const res = await fillLoginForm(port, 'LOGIN', { step: 'identifier', value: SECRET, hints: {} }, deps);
      assert.deepEqual(res, state('password', { prompt: 'Enter your password' }));
      assert.equal(typed(calls), SECRET);
      const order = steps(calls);
      assert.deepEqual(order.slice(0, 6), ['eval probe', 'eval focus', 'mouse mouseMoved 250,220', 'mouse mousePressed 250,220', 'mouse mouseReleased 250,220', 'eval prepare']);
      assert.deepEqual(order.slice(-6), ['eval submit', 'mouse mouseMoved 250,425', 'mouse mousePressed 250,425', 'mouse mouseReleased 250,425', 'eval probe', 'eval probe']);
    });
  });

  it('puts the value only into input events: never into an expression', async () => {
    const answer = page([state('password'), state('password', { error: 'Wrong password!' })], { focus: { x: 1, y: 2 }, prepare: { hadText: false }, submit: { x: 3, y: 4 } });
    await withDevtools(tabs, answer, async (port, _log, calls) => {
      await fillLoginForm(port, 'LOGIN', { step: 'password', value: SECRET, hints: { submit: 'button' } }, deps);
      const outside = calls.filter((c) => !c.method.startsWith('Input.'));
      assert.ok(outside.length > 0);
      for (const c of outside) assert.ok(!JSON.stringify(c.params).includes('Pässwörd'), c.method);
    });
  });

  it('clears what the field still holds before typing', async () => {
    const answer = page([state('password'), state('code')], { focus: { x: 1, y: 2 }, prepare: { hadText: true }, submit: { x: 3, y: 4 } });
    await withDevtools(tabs, answer, async (port, _log, calls) => {
      await fillLoginForm(port, 'LOGIN', { step: 'password', value: 'ab', hints: {} }, deps);
      const order = steps(calls);
      const at = order.indexOf('eval prepare');
      assert.deepEqual(order.slice(at + 1, at + 4), ['key rawKeyDown Backspace', 'key keyUp Backspace', 'key keyDown a']);
    });
  });

  it('only types the account on a page that asks for the password too, and answers the password step', async () => {
    const answer = page([state('identifier', { next: 'password' }), state('password')], { focus: { x: 1, y: 2 }, prepare: { hadText: false }, submit: { x: 3, y: 4 } });
    await withDevtools(tabs, answer, async (port, _log, calls) => {
      assert.equal((await fillLoginForm(port, 'LOGIN', { step: 'identifier', value: 'someone', hints: {} }, deps)).step, 'password');
      assert.ok(!steps(calls).includes('eval submit'));
    });
  });

  it('presses Enter when nothing on the page submits, and nothing when the page moved on by itself', async () => {
    const enter = page([state('code'), state('done')], { focus: { x: 1, y: 2 }, prepare: { hadText: false }, submit: { enter: true } });
    await withDevtools(tabs, enter, async (port, _log, calls) => {
      assert.equal((await fillLoginForm(port, 'LOGIN', { step: 'code', value: '123456', hints: {} }, deps)).step, 'done');
      assert.deepEqual(steps(calls).filter((s) => s.includes('Enter')), ['key keyDown Enter', 'key keyUp Enter']);
    });
    const moved = page([state('code'), state('done')], { focus: { x: 1, y: 2 }, prepare: { hadText: false }, submit: { moved: true } });
    await withDevtools(tabs, moved, async (port, _log, calls) => {
      assert.equal((await fillLoginForm(port, 'LOGIN', { step: 'code', value: '123456', hints: {} }, deps)).step, 'done');
      assert.ok(!steps(calls).some((s) => s.includes('Enter') || s.includes('mousePressed 3,4')));
    });
  });

  it('types nothing when the page is on another step, and answers that step as stale', async () => {
    await withDevtools(tabs, page([state('password')]), async (port, _log, calls) => {
      assert.deepEqual(await fillLoginForm(port, 'LOGIN', { step: 'identifier', value: SECRET, hints: {} }, deps), { ...state('password'), stale: true });
      assert.ok(!calls.some((c) => c.method.startsWith('Input.')));
    });
    // the field is gone by the time it is focused
    await withDevtools(tabs, page([state('identifier'), state('captcha')], { focus: null }), async (port, _log, calls) => {
      assert.deepEqual(await fillLoginForm(port, 'LOGIN', { step: 'identifier', value: SECRET, hints: {} }, deps), { ...state('captcha'), stale: true });
      assert.ok(!calls.some((c) => c.method.startsWith('Input.')));
    });
  });

  it('waits out a navigating page and a loading screen for the next real step', async () => {
    const answer = page([state('identifier'), { fail: 'Execution context was destroyed.' }, state('unknown'), state('identifier', { error: 'Sorry, we could not find your account.' })], {
      focus: { x: 1, y: 2 },
      prepare: { hadText: false },
      submit: { x: 3, y: 4 },
    });
    await withDevtools(tabs, answer, async (port) => {
      const res = await fillLoginForm(port, 'LOGIN', { step: 'identifier', value: 'nobody', hints: {} }, deps);
      assert.deepEqual(res, state('identifier', { error: 'Sorry, we could not find your account.' }));
    });
  });

  it('answers the last state read when the page shows nothing new in time', async () => {
    const answer = page([state('password')], { focus: { x: 1, y: 2 }, prepare: { hadText: false }, submit: { x: 3, y: 4 } });
    await withDevtools(tabs, answer, async (port, _log, calls) => {
      assert.deepEqual(await fillLoginForm(port, 'LOGIN', { step: 'password', value: 'x', hints: {} }, deps), state('password'));
      // one probe before, then the first look and nine more polls
      assert.equal(steps(calls).filter((s) => s === 'eval probe').length, 11);
    });
  });

  it('replaces any typing failure with a fixed message that cannot carry the value', async () => {
    const answer = (method: string, params: Record<string, unknown>) => {
      if (method === 'Input.dispatchKeyEvent' || method === 'Input.insertText') return fail(`Invalid parameters: ${JSON.stringify(params)}`);
      return page([state('password')], { focus: { x: 1, y: 2 }, prepare: { hadText: false } })(method, params);
    };
    await withDevtools(tabs, answer, async (port) => {
      await assert.rejects(fillLoginForm(port, 'LOGIN', { step: 'password', value: SECRET, hints: {} }, deps), (err: HttpError) => {
        assert.equal(err.code, 'TYPING_FAILED');
        assert.ok(!JSON.stringify({ message: err.message, extra: err.extra }).includes('Pässwörd'));
        return true;
      });
    });
  });
});
