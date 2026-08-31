/**
 * Reading the Content-Security-Policy that vercel.json ships.
 *
 * The policy is a single string inside a JSON file: TypeScript cannot see it,
 * ESLint cannot see it, and a wrong one fails only in production, silently, in
 * whichever browser the visitor happened to bring. Parsing it makes the policy
 * something tests can hold an opinion about — see csp.test.ts, which checks it
 * against the origins the app actually loads scripts from.
 */

export type CspDirectives = Record<string, string[]>;

export function parseCsp(policy: string): CspDirectives {
  const directives: CspDirectives = {};

  for (const part of policy.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (!name) continue;
    directives[name.toLowerCase()] = values;
  }

  return directives;
}

/**
 * Whether `origin` is permitted by a directive, honouring the single wildcard
 * form CSP allows in a host source (`https://*.hotjar.com`).
 *
 * Falls back to default-src the way a browser does, so a policy that omits a
 * fetch directive is judged by what it actually does rather than by what it
 * lists.
 */
export function allows(directives: CspDirectives, directive: string, origin: string): boolean {
  const sources = directives[directive] ?? directives['default-src'] ?? [];

  return sources.some((source) => {
    if (source === origin) return true;
    if (source === 'https:' && origin.startsWith('https://')) return true;
    if (!source.includes('*')) return false;

    const pattern = new RegExp(
      `^${source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`
    );
    return pattern.test(origin);
  });
}
