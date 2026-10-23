import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('./sentry', () => ({ captureMessage }));

import { reportPolicyViolations } from './csp-violations';

/** A refusal as a browser reports it to the page. */
function refusal(fields: Record<string, unknown> = {}): Event {
  return Object.assign(new Event('securitypolicyviolation'), {
    effectiveDirective: 'connect-src',
    blockedURI: 'https://collector.example/beacon?token=abc',
    sourceFile: 'https://app.example/assets/index-abc123.js',
    lineNumber: 7,
    disposition: 'enforce',
    ...fields,
  });
}

let page: EventTarget;

beforeEach(() => {
  vi.clearAllMocks();
  page = new EventTarget();
  reportPolicyViolations(page);
});

describe('reportPolicyViolations', () => {
  it('reports a refusal by its directive and the origin it refused', () => {
    page.dispatchEvent(refusal());

    expect(captureMessage).toHaveBeenCalledWith(
      'Content Security Policy refused connect-src https://collector.example',
      expect.objectContaining({
        level: 'warning',
        tags: { 'csp.directive': 'connect-src', 'csp.disposition': 'enforce' },
        fingerprint: ['csp', 'connect-src https://collector.example'],
      })
    );
  });

  it('sends nothing of the address after its origin', () => {
    page.dispatchEvent(refusal());

    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain('token');
  });

  it('reports each kind of refusal once in a page', () => {
    page.dispatchEvent(refusal());
    page.dispatchEvent(refusal({ blockedURI: 'https://collector.example/other' }));
    page.dispatchEvent(refusal({ blockedURI: 'https://another.example/' }));

    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("leaves a browser extension's refusals to the extension", () => {
    page.dispatchEvent(refusal({ blockedURI: 'chrome-extension://abcdef/inject.js' }));
    page.dispatchEvent(refusal({ sourceFile: 'moz-extension://abcdef/content.js' }));

    expect(captureMessage).not.toHaveBeenCalled();
  });

  it.each([
    [{ effectiveDirective: 'script-src-elem', blockedURI: 'inline' }, 'script-src-elem inline'],
    [{ effectiveDirective: 'script-src', blockedURI: 'eval' }, 'script-src eval'],
    [{ effectiveDirective: 'img-src', blockedURI: 'data:image/png;base64,AAAA' }, 'img-src data'],
  ])('names a refusal reported without an address by its word', (fields, kind) => {
    page.dispatchEvent(refusal(fields));

    expect(captureMessage).toHaveBeenCalledWith(
      `Content Security Policy refused ${kind}`,
      expect.anything()
    );
  });
});
