# 0001 — Uploads go straight to the provider, not through a function

Accepted · shipped in v3.0.0

## Context

R2 credentials used to be `VITE_`-prefixed, which means Vite inlined them into
the public bundle: anyone could read the access key in DevTools. Moving them
server-side was not optional.

The straightforward fix is to proxy the upload — the browser posts the file to
a serverless function, the function writes it to the bucket with credentials
that never leave the server. Vercel caps a function request body at **4.5 MB**,
so that design would have capped every upload in the product at 4.5 MB.

## Decision

The function signs, and the browser uploads. `/api/r2/presign-upload` checks the
caller, checks the quota, and returns a presigned `PUT` URL with `ContentLength`
inside the signature. The bytes travel from the browser to R2 directly.
Cloudinary works the same way — `/api/cloudinary/sign` returns a signature, not
a destination for the file (see [0008](0008-two-actions-one-function.md)).

## Consequences

- Uploads are limited by the provider, not by our hosting plan.
- Credentials stay on the server. What reaches the browser is a URL that expires
  and is bound to one object of one size.
- **No server ever sees the bytes.** Nothing server-side can weigh a file,
  scan it, or transform it on the way in. Everything that has to be true about
  an upload must therefore be enforced somewhere else — which is why the quota
  lives in the database ([0004](0004-quota-lives-in-the-database.md)) and why
  the size that counts against it is the one declared on the row.
- A rejected metadata write leaves an orphaned object in the bucket for a
  moment. `storage.service.uploadFile()` deletes it — a compensating delete, not
  a transaction, because the bucket and the database cannot share one.
