# 0008 — Two Cloudinary actions share one serverless function

Accepted · unreleased · [`api/cloudinary/[action].ts`](../../api/cloudinary/%5Baction%5D.ts)

## Context

Vercel turns every file under `api/` into its own serverless function, and the
Hobby plan allows twelve. This project already has twelve. Signing Cloudinary
uploads — which replaced an unsigned upload preset that let anyone holding the
cloud name write into the account — needed a route, and there was no thirteenth
slot for it.

## Decision

One file, `api/cloudinary/[action].ts`, serving `/api/cloudinary/sign` and
`/api/cloudinary/delete`. The dynamic segment arrives as `req.query.action` and
the handler dispatches on it.

## Consequences

- The upload path is signed per request, with the quota checked before the
  signature is issued, without upgrading the hosting plan.
- Two unrelated concerns share a module, an error handler and a cold start. The
  shared `catch` is written to name neither action — a mismatch there once turned
  every failure, including an expired session, into "Failed to authorize the
  upload".
- The dev server needs the same routing. `resolveHandler()` in
  `vite-plugin-dev-api.ts` resolves an exact file first and falls back to a
  `[segment].ts` in the same directory, which is Vercel's rule for this case.
- Rate limits are counted per action rather than per file, so an unknown segment
  cannot spend the allowance of the one it was misspelled from
  ([0007](0007-rate-limits-are-per-instance.md)).
- This is a hosting-plan workaround, not an architecture. If the function count
  stops being the constraint, splitting the file back into two routes is a
  mechanical change.
