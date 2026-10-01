/**
 * The script the worker runs inside a platform's login page (Runtime.evaluate, like QR_FINDER): which
 * login step the page is on, the page's own prompt and error text, and where the field and its submit
 * button are. It never reads out what a field holds (only whether it is empty) and is never given what
 * the user types: typing goes through CDP input events, so the value is in no expression.
 *
 * Detection is generic (visible password inputs, autocomplete/inputmode/name hints, captcha frames,
 * the URL leaving the login pages, open shadow roots included); `hints` adds per-platform selectors.
 *
 * Called as `(LOGIN_FORM_PAGE)({ action, hints, kind })`:
 *   probe   -> { step, prompt, detail, error, field, next? }
 *   focus   -> the centre of the field of `kind`, scrolled into view, or null
 *   prepare -> { hadText } after focusing that field and selecting its text, or null
 *   submit  -> the centre of the button that submits that field; { enter: true } when there is none
 *              (the caller presses Enter), { moved: true } when the page already left that step
 */
export const LOGIN_FORM_PAGE = `(opts) => {
  const H = (opts && opts.hints) || {};
  const TEXT_MAX = 300;
  const clean = (s) => String(s == null ? '' : s).replace(/\\s+/g, ' ').trim();
  const cap = (s) => {
    const t = clean(s);
    return t ? (t.length > TEXT_MAX ? t.slice(0, TEXT_MAX) + '…' : t) : null;
  };
  const textOf = (el) => clean(el.innerText !== undefined ? el.innerText : el.textContent);

  // the document and every open shadow root (web-component logins such as Reddit's)
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
  const q = (selector) => {
    if (!selector) return [];
    const out = [];
    try {
      for (const r of roots) for (const el of r.querySelectorAll(selector)) out.push(el);
    } catch (e) {
      return [];
    }
    return out;
  };
  const is = (el, selector) => {
    if (!selector) return false;
    try { return el.matches(selector); } catch (e) { return false; }
  };
  const byId = (el, id) => {
    const root = el.getRootNode();
    return (root && root.getElementById && root.getElementById(id)) || document.getElementById(id);
  };
  const rectOf = (el) => el.getBoundingClientRect();
  const visible = (el) => {
    const r = rectOf(el);
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && (s.opacity === '' || Number(s.opacity) >= 0.1);
  };
  const onScreen = (r) => r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const center = (el) => {
    const r = rectOf(el);
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const dist = (a, b) => {
    const p = center(a);
    const o = center(b);
    return Math.hypot(p.x - o.x, p.y - o.y);
  };
  const enabled = (el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true';
  const hasField = (el) => !!el.querySelector('input, textarea, select');

  // a label's required mark and colon are no words ("Email *" -> "Email"; Reddit's own <label> is just "*")
  const LABEL_JUNK = /^[\\s*:：]+|[\\s*:：]+$/g;
  const labelOf = (el) => {
    const labelled = (el.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean)
      .map((id) => byId(el, id)).filter(Boolean).map(textOf).join(' ');
    const root = el.getRootNode();
    const forLabel = el.id && root.querySelectorAll ? Array.from(root.querySelectorAll('label')).find((l) => l.htmlFor === el.id) : null;
    const wrap = el.closest('label');
    // a field inside a web component: the component's own text (its slotted label)
    const host = root.host;
    const candidates = [el.getAttribute('aria-label'), labelled, forLabel && textOf(forLabel), wrap && textOf(wrap), host && textOf(host), el.getAttribute('placeholder')];
    for (const c of candidates) {
      const t = clean(c).replace(LABEL_JUNK, '');
      if (t.length >= 2) return cap(t);
    }
    return null;
  };

  // ---- fields ----
  const SKIP_TYPES = /^(hidden|submit|button|checkbox|radio|file|image|reset|range|color|search|date|datetime-local|month|week|time)$/;
  const CAPTCHA_ATTR = /captcha|hear or see|characters you see|图中字符|验证字符/i;
  const CODE_ATTR = /one-time-code|\\botp\\b|totp|\\bpin\\b|passcode|2fa|mfa|verif|security.?code|approvals_code|\\bcode\\b|验证码|校验码|动态码|安全码/i;
  const ID_ATTR = /user|login|e-?mail|\\bmail\\b|phone|mobile|account|identifier|session_key|手机|邮箱|账号|帐号|帳號|用户名|用戶名/i;
  const CODE_TEXT = /code|验证码|校验码|verif|two-factor|2fa|authenticat|otp|passcode|安全码/i;

  const typeOf = (el) => (el.getAttribute('type') || 'text').toLowerCase();
  const isSearch = (el) => el.name === 'q' || /search|搜索|搜尋/i.test([el.name, el.getAttribute('aria-label'), el.getAttribute('placeholder')].join(' '));
  const inputs = q('input').filter((el) =>
    !SKIP_TYPES.test(typeOf(el)) && !el.disabled && !el.readOnly && visible(el) && !isSearch(el) &&
    el.getAttribute('role') !== 'combobox' && el.getAttribute('aria-autocomplete') !== 'list');

  const kindOf = (el) => {
    if (is(el, H.password)) return 'password';
    if (is(el, H.code)) return 'code';
    if (is(el, H.identifier)) return 'identifier';
    const type = typeOf(el);
    if (type === 'password') return 'password';
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const attrs = [el.name, el.id, ac, el.getAttribute('data-testid'), el.getAttribute('placeholder'), labelOf(el)].join(' ');
    if (CAPTCHA_ATTR.test(attrs)) return 'captcha';
    const numeric = (el.getAttribute('inputmode') || '').toLowerCase() === 'numeric' || type === 'number';
    if (CODE_ATTR.test(attrs) || (numeric && el.maxLength > 0 && el.maxLength <= 8)) return 'code';
    if (/\\b(username|email|tel)\\b/.test(ac) || type === 'email' || type === 'tel' || ID_ATTR.test(attrs)) return 'identifier';
    return 'text';
  };
  const fields = inputs.map((el) => ({ el, kind: kindOf(el) }));
  const top = (list) => list.slice().sort((a, b) => rectOf(a.el).top - rectOf(b.el).top)[0];
  // split code boxes (one character each): one field
  const boxes = fields.filter((f) => f.el.maxLength === 1 && f.kind !== 'password');
  const firstEmpty = (list) => list.find((f) => !f.el.value) || list[0];

  // ---- the page's own words ----
  const headingOf = (anchor) => {
    const hinted = q(H.prompt).filter(visible);
    if (hinted.length) return hinted[0];
    const dialog = anchor && anchor.closest('[role="dialog"], [aria-modal="true"]');
    const all = q('h1, h2, h3, [role="heading"]').filter((h) => visible(h) && !hasField(h) && textOf(h).length >= 2 && textOf(h).length <= 200 && (!dialog || dialog.contains(h)));
    if (!anchor) return all[0] || null;
    const above = all.filter((h) => rectOf(h).top <= rectOf(anchor).top);
    const nearest = above.sort((a, b) => rectOf(b).top - rectOf(a).top)[0];
    if (nearest) return nearest;
    // no heading element (X's new login is all <p>): the largest text above the field
    const size = (el) => parseFloat(getComputedStyle(el).fontSize) || 0;
    const big = q('p, span, div').filter((el) => {
      const t = ownText(el);
      if (t.length < 2 || t.length > 120 || el.closest(NOT_TEXT) || !visible(el)) return false;
      return rectOf(el).top <= rectOf(anchor).top && (!dialog || dialog.contains(el)) && size(el) >= 20;
    });
    return big.sort((a, b) => size(b) - size(a))[0] || all[0] || null;
  };
  const ownText = (el) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
  const NOT_TEXT = 'a, button, label, [role="button"], h1, h2, h3, [role="heading"], select, option';
  // text on something clickable (a button that is no <button>, a link) is not what the page says
  const clickable = (el) => getComputedStyle(el).cursor === 'pointer';
  const LINK = 'a, button, [role="button"]';
  // a link inside it, or one right beside it on the same line
  const withLink = (el) => {
    if (el.querySelector(LINK)) return true;
    const r = rectOf(el);
    return !!el.parentElement && Array.from(el.parentElement.children).some((c) => c !== el && c.matches(LINK) && Math.abs(rectOf(c).top - r.top) < Math.max(r.height, 4));
  };
  const detailOf = (heading, anchor, label) => {
    if (!heading || !anchor) return null;
    const from = rectOf(heading).bottom - 1;
    const to = rectOf(anchor).top;
    const head = textOf(heading);
    const blocks = q('p, span, div').filter((el) => {
      // a block with a link in it or beside it is an offer ("New to LinkedIn? Join now", terms), not the
      // step's explanation
      if (ownText(el).length < 6 || hasField(el) || el.closest(NOT_TEXT) || withLink(el) || !visible(el) || clickable(el)) return false;
      const r = rectOf(el);
      if (r.top < from || r.bottom > to + 1) return false;
      const t = textOf(el);
      return t && t !== head && t !== label && t.length <= TEXT_MAX;
    });
    blocks.sort((a, b) => rectOf(a).top - rectOf(b).top);
    return blocks.length ? cap(textOf(blocks[0])) : null;
  };
  const reddish = (color) => {
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(color || '');
    if (!m) return false;
    const r = +m[1], g = +m[2], b = +m[3];
    return r >= 150 && r > g * 1.8 && r > b * 1.5;
  };
  const errorOf = (anchor) => {
    const found = [];
    const add = (el) => {
      if (!el || !visible(el) || hasField(el)) return;
      const t = textOf(el);
      if (t.length < 2 || t.length > TEXT_MAX || found.some((f) => f.includes(t) || t.includes(f))) return;
      found.push(t);
    };
    q(H.error).forEach(add);
    q('[role="alert"], [aria-live="assertive"]').forEach(add);
    for (const f of fields) {
      if (f.el.getAttribute('aria-invalid') !== 'true') continue;
      [f.el.getAttribute('aria-errormessage'), f.el.getAttribute('aria-describedby')].join(' ').split(/\\s+/).filter(Boolean).forEach((id) => add(byId(f.el, id)));
    }
    q('[class*="error" i], [id*="error" i], [data-testid*="error" i]').filter((el) => !el.closest(NOT_TEXT)).forEach(add);
    if (anchor) {
      const a = rectOf(anchor);
      q('p, span, div').filter((el) => {
        if (ownText(el).length < 3 || el.closest(NOT_TEXT) || clickable(el)) return false;
        const r = rectOf(el);
        return Math.abs(r.top - a.top) < 260 && reddish(getComputedStyle(el).color);
      }).forEach(add);
    }
    return found.length ? cap(found.join(' ')) : null;
  };

  // ---- challenges ----
  const CAPTCHA_FRAME = /arkoselabs|arkose|funcaptcha|hcaptcha|recaptcha|geetest|captcha|challenges\\.cloudflare\\.com|turnstile/i;
  const QUIET_FRAME = /size=invisible|checkbox-invisible/i;
  const CAPTCHA_TEXT = /verify (that )?you('|’)?re (a )?human|are you a robot|not a robot|security check|拖动|滑块|人机验证|安全验证|puzzle/i;
  const loginField = (el) => fields.some((f) => f.kind !== 'captcha' && el.contains(f.el));
  const captchaShown = () => {
    if (fields.some((f) => f.kind === 'captcha')) return true;
    if (q(H.captcha).some((el) => visible(el) && onScreen(rectOf(el)))) return true;
    const frame = q('iframe').some((f) => {
      const src = f.getAttribute('src') || '';
      const r = rectOf(f);
      return CAPTCHA_FRAME.test([src, f.id, f.getAttribute('title')].join(' ')) && !QUIET_FRAME.test(src) && r.width >= 60 && r.height >= 60 && visible(f) && onScreen(r);
    });
    if (frame) return true;
    return q('[id*="captcha" i], [class*="captcha" i], [class*="geetest" i], [id*="arkose" i], #px-captcha').some((el) => {
      if (/badge|terms|notice|disclaimer/i.test([el.id, el.getAttribute('class')].join(' ')) || el.closest('.grecaptcha-badge')) return false;
      const r = rectOf(el);
      return r.width >= 100 && r.height >= 60 && visible(el) && onScreen(r) && !loginField(el);
    });
  };

  // ---- which step ----
  const here = location.host + location.pathname;
  const loginUrls = Array.isArray(H.loginUrls) ? H.loginUrls : [];
  // without hints, never claim the login is done; nor on Chrome's own error page (HTTP 429, offline)
  const web = location.protocol === 'https:' || location.protocol === 'http:';
  const inLogin = !web || !loginUrls.length || loginUrls.some((p) => here.startsWith(p));

  const scan = () => {
    const anchor = top(fields);
    const heading = headingOf(anchor && anchor.el);
    const prompt = heading ? cap(textOf(heading)) : null;
    const withKind = (f) => (f.kind === 'text' ? { el: f.el, kind: CODE_TEXT.test(prompt || '') ? 'code' : 'identifier' } : f);
    const known = fields.map(withKind);
    const password = firstEmpty(known.filter((f) => f.kind === 'password'));
    const ids = known.filter((f) => f.kind === 'identifier' && f.el.maxLength !== 1);
    const codes = boxes.length >= 4 ? boxes : known.filter((f) => f.kind === 'code');
    let step = 'unknown';
    let target = null;
    let next;
    if (captchaShown()) {
      step = 'captcha';
    } else if (password) {
      // a page with both fields (Instagram, LinkedIn, Reddit): the account first, without submitting
      const before = ids.find((f) => !f.el.value && rectOf(f.el).top <= rectOf(password.el).top);
      if (before) {
        step = 'identifier';
        target = before;
        next = 'password';
      } else {
        step = 'password';
        target = password;
      }
    } else if (codes.length) {
      step = 'code';
      target = firstEmpty(codes);
    } else if (ids.length) {
      step = 'identifier';
      target = firstEmpty(ids);
    } else if (!inLogin && !fields.length) {
      step = 'done';
    } else if (CAPTCHA_TEXT.test(prompt || '')) {
      step = 'captcha';
    }
    return { step, target, next, heading, prompt, codes };
  };

  const describe = (target, step, codes) => {
    if (!target) return null;
    const el = target.el;
    const type = typeOf(el);
    const mode = (el.getAttribute('inputmode') || '').toLowerCase();
    const split = step === 'code' && codes.length >= 4 && codes[0].el.maxLength === 1;
    return {
      kind: step,
      label: split ? null : labelOf(el),
      inputType: step === 'password' ? 'password' : type === 'email' || type === 'tel' ? type : 'text',
      inputMode: mode || (step === 'code' && (type === 'tel' || type === 'number' || split) ? 'numeric' : null),
      autocomplete: step === 'password' ? 'current-password' : step === 'code' ? 'one-time-code' : 'username',
      maxLength: split ? codes.length : el.maxLength > 0 ? el.maxLength : null,
    };
  };

  const s = scan();
  const action = opts && opts.action;
  if (action === 'probe') {
    const anchor = s.target ? s.target.el : null;
    const field = describe(s.target, s.step, s.codes);
    const out = {
      step: s.step,
      prompt: s.prompt,
      detail: detailOf(s.heading, anchor, field && field.label),
      error: errorOf(anchor),
      field: field,
    };
    if (s.next) out.next = s.next;
    return out;
  }
  // focus / prepare / submit act on the field of the step the caller is filling; the page moved on
  // (it submitted by itself, or navigated) when that step is gone
  if (!s.target || s.step !== opts.kind) return action === 'submit' ? { moved: true } : null;
  const el = s.target.el;
  if (action === 'focus') {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return center(el);
  }
  if (action === 'prepare') {
    let active = document.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
    if (active !== el) el.focus();
    const hadText = !!el.value;
    if (hadText && el.select) el.select();
    return { hadText };
  }
  if (action === 'submit') {
    const SUBMIT_TEXT = /^(next|log ?in|sign ?in|continue|submit|verify|confirm|done|send|下一步|登录|登入|登錄|继续|繼續|确定|確認|确认|提交|验证|驗證|完成)$/i;
    const usable = (b) => visible(b) && enabled(b) && b !== el;
    const nearest = (list) => list.filter(usable).sort((a, b) => dist(a, el) - dist(b, el))[0];
    const form = el.closest('form');
    const button =
      nearest(q(H.submit)) ||
      (form && nearest(Array.from(form.querySelectorAll('button[type="submit"], input[type="submit"]')))) ||
      nearest(q('button, [role="button"], input[type="submit"]').filter((b) => SUBMIT_TEXT.test(clean(b.value || textOf(b) || b.getAttribute('aria-label'))))) ||
      // a clickable block that is no <button> (X's new login): its label, the click reaches the block
      nearest(q('p, span, div').filter((b) => SUBMIT_TEXT.test(clean(ownText(b))) && !b.closest('a, button:disabled, [aria-disabled="true"]')));
    if (!button) {
      // no button: Enter in the field, so it must hold the focus
      el.focus();
      return { enter: true };
    }
    button.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    return center(button);
  }
  return null;
}`;
