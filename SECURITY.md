# Security policy

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security → Report a
vulnerability** on
[this repository](https://github.com/Alexandr-Paleev/CloudStorageApp-Ionic/security/advisories/new).
It opens a private thread — please do not file a public issue for anything that
affects the deployed demo or a fork's data.

Useful in a report: what you did, what happened, and what you expected. A `curl`
that reproduces it is worth more than a description of what it might allow.

This is a portfolio project maintained by one person. Expect an acknowledgement
within a few days rather than within hours, and a fix in a public commit that
says what was wrong — the same way the ones below are documented.

## Supported versions

The `main` branch and the current release. Older tags are kept for history and
receive no fixes; the deployment at
[cloud-storage-app-ionic-v0.vercel.app](https://cloud-storage-app-ionic-v0.vercel.app)
tracks `main`.

## Scope

In scope: this repository, the deployed demo, and anything a fork inherits by
following the README.

Out of scope, and known:

- **The demo runs Stripe in test mode.** Real cards are declined by design, and
  card numbers such as `4242 4242 4242 4242` are meant to work.
- **Demo accounts are real accounts.** Anyone can create one from the login page;
  they are swept after 24 hours. Data you put in one is not private.
- **Rate limits are per instance.** They are held in module scope and reset on a
  cold start, which stops a loop and not a distributed attempt
  ([ADR 0007](docs/decisions/0007-rate-limits-are-per-instance.md)).
- **`script-src` carries `'unsafe-inline'`.** The build emits no inline script;
  gtag.js and Hotjar need it. Removing it requires per-request nonces, which
  need a server rendering the HTML rather than a static bundle.
- **The quota trusts the size declared on the file row.** Uploads never pass
  through a server, so nothing server-side can weigh them
  ([ADR 0004](docs/decisions/0004-quota-lives-in-the-database.md)).
- **Revoking a share link stops `/s/:token` from opening.** It cannot withdraw a
  file someone already downloaded, and on providers that serve permanent public
  URLs — Cloudinary, Dropbox, Google Drive — a direct address that was already
  obtained keeps working. The UI says so rather than promising a clean revoke.

## What has already been found

Fixed, documented, and kept in the open rather than quietly patched:

| Issue                                                                   | Where it is written up                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| An anon key deployed under the name `SUPABASE_SERVICE_ROLE_KEY`, for 221 days | [README postmortem](README.md#-postmortem-the-anon-key-that-was-named-supabase_service_role_key) |
| Any user could set their own `tier = 'pro'` through an RLS policy       | [ADR 0002](docs/decisions/0002-billing-is-server-write-only.md), migration `002` |
| `shared_links` readable in full by `public` — every share token in one request | [ADR 0003](docs/decisions/0003-share-tokens-are-stored-hashed.md), migration `004` |
| A policy on `files` that made link revocation meaningless at the database level | migration `006`                                                              |
| The storage quota enforced on one provider out of three, with a check-then-act race | [ADR 0004](docs/decisions/0004-quota-lives-in-the-database.md), migration `007` |
| Cloudinary uploads accepted through an unsigned preset                  | [ADR 0008](docs/decisions/0008-two-actions-one-function.md)                   |
| R2 credentials inlined into the public bundle by Vite                   | [ADR 0001](docs/decisions/0001-presigned-uploads-not-a-proxy.md)              |
| High-severity `undici` advisories that the dependency policy hid        | [ADR 0006](docs/decisions/0006-dependabot-skips-majors.md), and the second README postmortem |

## What runs on every pull request

`npm audit --omit=dev --audit-level=high` fails the build on a high-severity
advisory in production dependencies. Lint, both type-checks, a bundle-size
budget, Lighthouse, 466 unit tests and 28 Playwright tests run alongside it, and
`main` requires them to pass.
