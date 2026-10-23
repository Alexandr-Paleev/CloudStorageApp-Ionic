import { captureMessage } from './sentry';

/**
 * Tells Sentry what the content policy refused in this page, once for each
 * kind of refusal.
 *
 * The policy is in vercel.json and holds in production only: neither the dev
 * server nor the end-to-end suite sends it. From 4.0.0 to 4.7.2 it refused
 * every PDF preview, and that was found a month later, by looking. A refusal
 * is an event in the page, and the page already has a collector that is told
 * its errors, under each deployment's own DSN. A `report-uri` would have put
 * an address into the checked-in vercel.json, and every fork's reports would
 * have come here.
 *
 * What is sent is the directive and the origin it refused, or the word a
 * browser gives instead of an address (`inline`, `eval`, `data`), never the
 * rest of the address: a refused request can carry a signature or a token.
 */

/* What a browser extension does in a page is refused as well, and it is not
   the app's doing. */
const EXTENSION = /^(?:chrome|moz|safari(?:-web)?|ms-browser)-extension:/;

/** The origin of an address, or the word reported in place of one. */
function refused(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return uri;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1);
  return url.origin === 'null' ? url.protocol.slice(0, -1) : url.origin;
}

export function reportPolicyViolations(
  target: Pick<EventTarget, 'addEventListener'> = document
): void {
  const reported = new Set<string>();

  target.addEventListener('securitypolicyviolation', (event) => {
    const { effectiveDirective, blockedURI, sourceFile, lineNumber, disposition } =
      event as SecurityPolicyViolationEvent;
    if (EXTENSION.test(blockedURI) || EXTENSION.test(sourceFile)) return;

    const kind = `${effectiveDirective} ${refused(blockedURI)}`;
    if (reported.has(kind)) return;
    reported.add(kind);

    captureMessage(`Content Security Policy refused ${kind}`, {
      level: 'warning',
      tags: { 'csp.directive': effectiveDirective, 'csp.disposition': disposition },
      extra: { source: sourceFile, line: lineNumber },
      fingerprint: ['csp', kind],
    });
  });
}
