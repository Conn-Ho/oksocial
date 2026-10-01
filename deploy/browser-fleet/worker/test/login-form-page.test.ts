/**
 * LOGIN_FORM_PAGE against real DOMs (jsdom): login pages modelled on X, Instagram, Google, Reddit
 * (shadow DOM) and TikTok. jsdom does no layout, so `layout` gives every element a box: its
 * `data-rect="x,y,w,h"`, else a 300x18 row in document order (so document order is top to bottom),
 * and none at all under `hidden` / display:none.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { pageExpression } from '../src/login-form.ts';
import type { FillStep, LoginFormHints } from '../src/login-form.ts';

type Action = 'probe' | 'focus' | 'prepare' | 'submit';
type Win = JSDOM['window'];

function layout(window: Win) {
  const order = new Map<Element, number>();
  let n = 0;
  const walk = (root: ParentNode) => {
    for (const el of root.querySelectorAll('*')) {
      order.set(el, n++);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(window.document);
  const hidden = (el: Element) => {
    for (let e: Element | null = el; e; e = e.parentElement ?? ((e.getRootNode() as ShadowRoot).host || null)) {
      if (e.hasAttribute('hidden') || window.getComputedStyle(e).display === 'none') return true;
    }
    return false;
  };
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height });
  window.Element.prototype.getBoundingClientRect = function (this: Element) {
    if (hidden(this)) return box(0, 0, 0, 0) as DOMRect;
    const fixed = this.getAttribute('data-rect');
    if (fixed) {
      const [x = 0, y = 0, w = 0, h = 0] = fixed.split(',').map(Number);
      return box(x, y, w, h) as DOMRect;
    }
    return box(100, (order.get(this) ?? 0) * 20, 300, 18) as DOMRect;
  };
  window.Element.prototype.scrollIntoView = function () {};
}

interface PageOptions {
  url?: string;
  hints?: LoginFormHints;
  // runs before layout: shadow roots, typed values
  setup?: (window: Win) => void;
}

const open = (html: string, { url = 'https://x.com/i/flow/login', setup }: PageOptions = {}) => {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  setup?.(dom.window);
  layout(dom.window);
  return dom.window;
};

/** Runs one action in the page; the answer as it arrives over CDP (returnByValue: plain JSON). */
const act = (window: Win, action: Action, hints: LoginFormHints = {}, kind?: FillStep) =>
  JSON.parse(JSON.stringify(window.eval(pageExpression(action, hints, kind)) ?? null));

const probe = (html: string, options: PageOptions = {}) => act(open(html, options), 'probe', options.hints);

const X_LOGIN = ['x.com/i/flow/login'];

describe('LOGIN_FORM_PAGE probe', () => {
  it("reads X's first step: the account field, the dialog heading and the field's label", () => {
    const page = `
      <div role="dialog">
        <h1 id="modal-header">Sign in to X</h1>
        <iframe src="https://accounts.google.com/gsi/button?theme=light" data-rect="100,80,300,40"></iframe>
        <div><span>or</span></div>
        <label><div><span>Phone, email, or username</span></div><div><input autocomplete="username" name="text" type="text"></div></label>
        <button type="button"><span>Next</span></button>
        <button type="button"><span>Forgot password?</span></button>
      </div>`;
    assert.deepEqual(probe(page, { hints: { loginUrls: X_LOGIN } }), {
      step: 'identifier',
      prompt: 'Sign in to X',
      detail: null,
      error: null,
      field: { kind: 'identifier', label: 'Phone, email, or username', inputType: 'text', inputMode: null, autocomplete: 'username', maxLength: null },
    });
  });

  it("reads X's new login (no heading element, no <button> to continue): the largest text and the 继续 block", () => {
    const page = `
      <div class="jf-element">
        <p style="font-size: 31px; font-weight: 700">看看正在发生什么</p>
        <p style="font-size: 15px">请从下方选择一项</p>
        <button><p style="cursor: pointer">使用手机继续</p></button>
        <div style="cursor: pointer"><p style="cursor: pointer">使用 Apple 继续</p></div>
        <p>或</p>
        <label><span class="jf-float-label">电子邮箱或用户名</span><input id="jf-input-username_or_email" name="username_or_email" autocomplete="username webauthn" inputmode="text"></label>
        <input name="password" type="password" hidden>
        <div class="jf-next" data-rect="520,600,370,50"><p data-rect="690,615,30,20" style="font-size: 17px">继续</p></div>
      </div>`;
    const window = open(page, { url: 'https://x.com/i/jf/onboarding/web?mode=login' });
    const state = act(window, 'probe', { loginUrls: ['x.com/i/jf/'] });
    assert.deepEqual([state.step, state.prompt, state.detail, state.field.label, state.next], ['identifier', '看看正在发生什么', '请从下方选择一项', '电子邮箱或用户名', undefined]);
    assert.deepEqual(act(window, 'submit', {}, 'identifier'), { x: 705, y: 625 });
  });

  it("labels a field in a web component by the component's text when its own label is only a required mark (Reddit)", () => {
    const page = '<faceplate-text-input id="login-username"><span slot="label">电子邮件地址或用户名</span></faceplate-text-input>';
    const setup = (w: Win) => {
      w.document.getElementById('login-username')!.attachShadow({ mode: 'open' }).innerHTML = '<label for="u"><slot name="label"></slot><span>*</span></label><input id="u" name="username">';
    };
    assert.equal(probe(page, { url: 'https://www.reddit.com/login/', setup }).field.label, '电子邮件地址或用户名');
  });

  it("reads X's extra identity check as an account step, with the page's explanation", () => {
    const page = `
      <div role="dialog">
        <h1>Enter your phone number or username</h1>
        <div><span>There was unusual login activity on your account. To help keep your account safe, please enter your phone number or username to verify it’s you.</span></div>
        <label><span>Phone or username</span><input data-testid="ocfEnterTextTextInput" name="text" type="text"></label>
        <button data-testid="ocfEnterTextNextButton">Next</button>
      </div>`;
    const state = probe(page);
    assert.equal(state.step, 'identifier');
    assert.equal(state.prompt, 'Enter your phone number or username');
    assert.match(state.detail, /^There was unusual login activity/);
  });

  it("reads X's password step and its error toast, skipping the disabled account field", () => {
    const page = `
      <div role="dialog">
        <h1>Enter your password</h1>
        <label><span>Username</span><input name="username" disabled value="someone"></label>
        <label><span>Password</span><input name="password" type="password"></label>
        <button data-testid="LoginForm_Login_Button">Log in</button>
      </div>
      <div data-testid="toast" role="alert"><span>Wrong password!</span></div>`;
    const state = probe(page);
    assert.equal(state.step, 'password');
    assert.equal(state.error, 'Wrong password!');
    assert.deepEqual(state.field, { kind: 'password', label: 'Password', inputType: 'password', inputMode: null, autocomplete: 'current-password', maxLength: null });
  });

  it("reads an unlabelled text field as a code when the page asks for one (X's 2FA)", () => {
    const page = `
      <div role="dialog">
        <h1>Enter your verification code</h1>
        <span>Use your code generator app to generate a code and enter it below.</span>
        <input data-testid="ocfEnterTextTextInput" name="text" inputmode="numeric">
        <button>Next</button>
      </div>`;
    const state = probe(page);
    assert.equal(state.step, 'code');
    assert.equal(state.detail, 'Use your code generator app to generate a code and enter it below.');
    assert.deepEqual(state.field, { kind: 'code', label: null, inputType: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: null });
  });

  it('reads split code boxes as one code of their length', () => {
    const boxes = Array.from({ length: 6 }, () => '<input maxlength="1" type="text">').join('');
    const state = probe(`<h2>Enter the 6-digit code</h2><div>${boxes}</div>`, { url: 'https://www.tiktok.com/login/phone-or-email/email' });
    assert.equal(state.step, 'code');
    assert.deepEqual(state.field, { kind: 'code', label: null, inputType: 'text', inputMode: 'numeric', autocomplete: 'one-time-code', maxLength: 6 });
  });

  it('asks for the account first on a page with both fields, then for the password once it is typed', () => {
    const page = `
      <form id="loginForm">
        <input aria-label="Phone number, username, or email" name="username" type="text">
        <input aria-label="Password" name="password" type="password">
        <button type="submit">Log in</button>
      </form>`;
    const url = 'https://www.instagram.com/accounts/login/';
    assert.deepEqual(probe(page, { url }), {
      step: 'identifier',
      prompt: null,
      detail: null,
      error: null,
      field: { kind: 'identifier', label: 'Phone number, username, or email', inputType: 'text', inputMode: null, autocomplete: 'username', maxLength: null },
      next: 'password',
    });
    const typed = probe(page, { url, setup: (w) => { (w.document.querySelector('[name=username]') as HTMLInputElement).value = 'someone'; } });
    assert.equal(typed.step, 'password');
    assert.equal(typed.next, undefined);
  });

  it("shows the page's red error text next to the form (Instagram has no alert role)", () => {
    const page = `
      <form>
        <input name="username" value="someone">
        <input name="password" type="password">
        <button type="submit">Log in</button>
        <div><span style="color: rgb(237, 73, 86)">Sorry, your password was incorrect. Please double-check your password.</span></div>
        <a href="/accounts/password/reset/" style="color: rgb(237, 73, 86)">Forgot password?</a>
      </form>`;
    const state = probe(page, { url: 'https://www.instagram.com/accounts/login/' });
    assert.equal(state.step, 'password');
    assert.equal(state.error, 'Sorry, your password was incorrect. Please double-check your password.');
  });

  it("finds fields inside open shadow roots (Reddit's web components)", () => {
    const page = `<faceplate-text-input id="login-username"></faceplate-text-input><faceplate-text-input id="login-password"></faceplate-text-input><button class="login">Log In</button>`;
    const setup = (w: Win) => {
      w.document.getElementById('login-username')!.attachShadow({ mode: 'open' }).innerHTML = '<label for="u">Email or username</label><input id="u" name="username" autocomplete="username">';
      w.document.getElementById('login-password')!.attachShadow({ mode: 'open' }).innerHTML = '<label for="p">Password</label><input id="p" name="password" type="password">';
    };
    const state = probe(page, { url: 'https://www.reddit.com/login/', setup });
    assert.equal(state.step, 'identifier');
    assert.equal(state.next, 'password');
    assert.equal(state.field.label, 'Email or username');
  });

  it('takes no offer as the explanation: a block with a link (LinkedIn\'s "New to LinkedIn? Join now"), or one you click', () => {
    const page = `
      <h1 data-rect="100,20,300,30">Sign in</h1>
      <div><p data-rect="100,60,120,20">New to LinkedIn?</p><a href="/signup" data-rect="225,60,60,20">Join now</a></div>
      <p>By continuing, you agree to the <a href="/legal">User Agreement</a></p>
      <auth-flow-link style="cursor: pointer"><span style="cursor: pointer">Continue with phone number</span></auth-flow-link>
      <label for="username">Email or phone</label><input id="username" type="email">
      <label for="password">Password</label><input id="password" type="password">`;
    const state = probe(page, { url: 'https://www.linkedin.com/login' });
    assert.deepEqual([state.step, state.prompt, state.detail, state.field.label], ['identifier', 'Sign in', null, 'Email or phone']);
  });

  it("uses per-platform hints: Google's heading, sub-heading and error region", () => {
    const page = `
      <h1 id="headingText"><span>Sign in</span></h1>
      <div id="headingSubtext"><span>to continue to YouTube</span></div>
      <input type="email" id="identifierId" aria-label="Email or phone" autocomplete="username webauthn">
      <div aria-live="assertive"><div>Couldn’t find your Google Account</div></div>
      <div id="identifierNext"><button>Next</button></div>`;
    const state = probe(page, { url: 'https://accounts.google.com/v3/signin/identifier', hints: { loginUrls: ['accounts.google.com/'], identifier: '#identifierId', prompt: '#headingText' } });
    assert.equal(state.step, 'identifier');
    assert.equal(state.prompt, 'Sign in');
    assert.equal(state.detail, 'to continue to YouTube');
    assert.equal(state.error, 'Couldn’t find your Google Account');
    assert.equal(state.field.inputType, 'email');
  });

  it('is a captcha when a challenge frame shows (Arkose on X), even over a field', () => {
    const page = `
      <h1>Enter your password</h1><input type="password">
      <iframe id="arkose_iframe" src="https://client-api.arkoselabs.com/v2/1.2.3/enforcement.html" data-rect="400,100,400,450"></iframe>`;
    assert.equal(probe(page).step, 'captcha');
  });

  it("is a captcha for a slider box or a captcha text field (TikTok's slider, Google's 'type the text')", () => {
    assert.equal(probe('<input name="username"><div id="captcha_container" data-rect="300,100,340,300"></div>').step, 'captcha');
    assert.equal(probe('<input type="email" id="identifierId"><input name="ca" aria-label="Type the text you hear or see">').step, 'captcha');
  });

  it('is no captcha for invisible reCAPTCHA (its badge) or a frame parked off screen', () => {
    const page = `
      <input name="username"><input name="password" type="password">
      <div class="grecaptcha-badge" data-rect="1000,700,256,60"><iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?k=x&size=invisible" data-rect="1000,700,256,60"></iframe></div>
      <iframe title="recaptcha challenge expires in two minutes" src="https://www.google.com/recaptcha/api2/bframe?k=x" data-rect="0,-10000,400,580"></iframe>`;
    assert.equal(probe(page, { url: 'https://www.pinterest.com/login/' }).step, 'identifier');
  });

  it('types nothing on a page off the login pages, even with a password field (an off-site redirect)', () => {
    const page = '<h1>Third-party sign-in</h1><input name="username"><input name="password" type="password"><button type="submit">Go</button>';
    // on a login page it would ask for the account; off it (loginUrls set, URL not under them) it does not
    assert.equal(probe(page, { url: 'https://evil.example.com/login', hints: { loginUrls: X_LOGIN } }).step, 'unknown');
    const window = open(page, { url: 'https://evil.example.com/login' });
    assert.equal(act(window, 'focus', { loginUrls: X_LOGIN }, 'password'), null);
    assert.deepEqual(act(window, 'submit', { loginUrls: X_LOGIN }, 'password'), { moved: true });
    // and it is still "done" when such a page has no fields (the login finished and navigated away)
    assert.equal(probe('<h1>Welcome</h1>', { url: 'https://evil.example.com/x', hints: { loginUrls: X_LOGIN } }).step, 'done');
  });

  it('skips hidden fields and site search boxes', () => {
    const page = `
      <input type="text" name="q" placeholder="Search">
      <div hidden><input name="username"></div>
      <input type="text" role="combobox" aria-label="Search X">`;
    assert.equal(probe(page, { hints: { loginUrls: X_LOGIN } }).step, 'unknown');
  });

  it('is done once the page left the login pages and asks for nothing; unknown while still on them', () => {
    const home = '<h1>Home</h1><input role="combobox" placeholder="Search" data-testid="SearchBox_Search_Input">';
    assert.equal(probe(home, { url: 'https://x.com/home', hints: { loginUrls: X_LOGIN } }).step, 'done');
    assert.equal(probe(home, { url: 'https://x.com/i/flow/login', hints: { loginUrls: X_LOGIN } }).step, 'unknown');
    // without the login pages it never claims the login is done, nor on Chrome's error page (HTTP 429)
    assert.equal(probe(home, { url: 'https://x.com/home' }).step, 'unknown');
    const blocked = probe('<h1>This page isn’t working</h1><div>HTTP ERROR 429</div>', { url: 'chrome-error://chromewebdata/', hints: { loginUrls: X_LOGIN } });
    assert.equal(blocked.step, 'unknown');
    assert.equal(blocked.prompt, 'This page isn’t working');
  });

  it('never reads out what a field holds', () => {
    const secret = 'hunter2-SECRET';
    const page = '<label>Password <input type="password" name="password"></label><label>Account <input name="username"></label>';
    const window = open(page, {
      setup: (w) => {
        for (const input of w.document.querySelectorAll('input')) (input as HTMLInputElement).value = secret;
      },
    });
    for (const action of ['probe', 'focus', 'prepare', 'submit'] as const) {
      assert.ok(!JSON.stringify(act(window, action, {}, 'password')).includes(secret), action);
    }
  });
});

describe('LOGIN_FORM_PAGE actions', () => {
  const xPassword = `
    <h1>Enter your password</h1>
    <input name="password" type="password" data-rect="100,200,300,40">
    <a href="#" role="button" data-rect="100,260,120,20">Forgot password?</a>
    <button data-testid="LoginForm_Login_Button" data-rect="100,400,300,50">Log in</button>`;

  it("focus scrolls the step's field into view and answers its centre; null on another step", () => {
    const window = open(xPassword);
    assert.deepEqual(act(window, 'focus', {}, 'password'), { x: 250, y: 220 });
    assert.equal(act(window, 'focus', {}, 'identifier'), null);
  });

  it('prepare focuses the field and selects any text left in it, so typing replaces it', () => {
    const window = open(xPassword);
    const input = window.document.querySelector('input') as HTMLInputElement;
    assert.deepEqual(act(window, 'prepare', {}, 'password'), { hadText: false });
    assert.equal(window.document.activeElement, input);
    input.value = 'old';
    assert.deepEqual(act(window, 'prepare', {}, 'password'), { hadText: true });
    assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 3]);
  });

  it('submit picks the hinted button, else the form submit, else a Next / Log in button near the field', () => {
    assert.deepEqual(act(open(xPassword), 'submit', { submit: '[data-testid="LoginForm_Login_Button"]' }, 'password'), { x: 250, y: 425 });
    // no hint: the button whose text says it submits, never "Forgot password?"
    assert.deepEqual(act(open(xPassword), 'submit', {}, 'password'), { x: 250, y: 425 });
    // a disabled Log in button, its label included, is never clicked (TikTok's until both fields are filled)
    const disabled = '<input name="username" data-rect="0,0,200,40"><button disabled data-rect="0,100,200,40"><div data-rect="50,110,100,20">Log in</div></button>';
    assert.deepEqual(act(open(disabled), 'submit', {}, 'identifier'), { enter: true });
    const form = '<form><input name="username" data-rect="0,0,200,40"><button type="submit" data-rect="0,300,200,40">Weiter</button></form>';
    assert.deepEqual(act(open(form), 'submit', {}, 'identifier'), { x: 100, y: 320 });
  });

  it('submit asks for Enter when nothing submits, and reports a page that already moved on', () => {
    const window = open('<input name="username" data-rect="0,0,200,40"><button>Sign up</button>');
    assert.deepEqual(act(window, 'submit', {}, 'identifier'), { enter: true });
    assert.equal(window.document.activeElement, window.document.querySelector('input'));
    assert.deepEqual(act(window, 'submit', {}, 'code'), { moved: true });
  });
});
