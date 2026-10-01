import { Injectable } from '@nestjs/common';
import { okchatSecret, okchatUrl } from '@gitroom/nestjs-libraries/okchat/okchat.config';
import { signedHeaders } from '@gitroom/nestjs-libraries/okchat/okchat.signature';

// status 0: okchat could not be reached (network error, timeout, unusable address)
export type OkchatResponse = { status: number; body: any };

const TIMEOUT_MS = 15_000;

/**
 * Signed requests from oksocial to okchat (accounts sync, channel-bridge hooks). Answers are
 * returned, never logged: okchat's error texts are shown to people where they belong.
 */
@Injectable()
export class OkchatClient {
  // replaced in tests
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  /** POST /partner/oksocial/accounts: the organization's full account list. */
  accounts(body: { oksocialOrgId: string; accounts: unknown[] }) {
    return this.post(`${okchatUrl()}/partner/oksocial/accounts`, body);
  }

  /** POST to a binding's hook (/hook/platform/:bindingId): messages, receipts, account status. */
  hook(hookUrl: string, body: unknown) {
    return this.post(hookUrl, body);
  }

  private async post(url: string, payload: unknown): Promise<OkchatResponse> {
    if (!/^https?:\/\//i.test(url)) {
      return { status: 0, body: null };
    }
    const body = JSON.stringify(payload);
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: signedHeaders(okchatSecret(), body),
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text().catch(() => '');
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, body: json };
    } catch {
      return { status: 0, body: null };
    }
  }
}
