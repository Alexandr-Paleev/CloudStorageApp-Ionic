# 0009 — A resumable upload keeps its state in the browser

Accepted · unreleased · [`src/services/multipart.upload.ts`](../../src/services/multipart.upload.ts), [`src/services/upload-store.ts`](../../src/services/upload-store.ts)

## Context

A single `PUT` of a large file is all-or-nothing. A dropped connection at 90%
costs the whole upload, and on a phone that is not an edge case — it is what
happens when the train enters a tunnel. S3-style multipart uploads solve the
transport half: the file goes up in parts, each part is retried on its own, and
the object is assembled at the end.

The half that is not solved by the protocol is knowing, after the page has been
reloaded, which parts already made it. Something has to remember three things:
the upload id, the ETag of every finished part, and the file itself.

Where that something lives is the decision. The server is the obvious home — a
row per upload, keyed by user — and it is what a larger product would do. It
also means a table, a migration, a cleanup job for rows whose uploads were
abandoned, and an endpoint per state transition.

## Decision

The browser remembers, in IndexedDB. One record per unfinished upload holding
the key, the upload id, the part plan, the ETags collected so far, **and the
`File` object itself**. The server stays stateless: it opens uploads, signs
batches of part URLs, assembles, aborts.

The record is written before the first part is sent and updated after every
part that lands, so an upload interrupted at 1% is as resumable as one
interrupted at 99%.

## Consequences

- Resuming works across a reload, a crash and a closed laptop, with no server
  state and no schema change. The demo is twenty seconds long: start a large
  file, kill the network in DevTools, bring it back.
- Storing the `File` is what makes this real. A browser cannot re-open a path
  the user picked in an earlier session, so without it "resume" would mean
  "find that file again", which is not resuming.
- **It is per browser, and per profile.** An upload started on a laptop cannot
  be resumed on a phone. The alternative — server-side state — buys that, and
  it is the reason to revisit this if uploads ever need to survive the device.
- Private browsing, cleared site data and browsers that refuse IndexedDB cost
  the resume, not the upload: every store call swallows its failure and the
  parts still go up.
- An upload nobody resumes leaves its parts in R2, billable, until a lifecycle
  rule sweeps them. The README says to add one; `multipart-abort` is what the
  Discard button calls so the usual case does not wait for it.
- The ETags travel through the browser, which means a client that lies about
  them gets a failed assembly rather than a corrupted object: R2 verifies each
  one. The quota is checked when the upload is opened and enforced, as ever, by
  the trigger on `public.files`
  ([0004](0004-quota-lives-in-the-database.md)) — nothing about parts changes
  where the limit lives.
- Part URLs are signed in batches of a hundred rather than all at once, because
  an upload paused overnight comes back to expired signatures. Asking again is
  one round trip; signing five hundred URLs nobody will use is not free.
