# 0018 — A nightly reconciliation holds the providers to the rows

Accepted · not released yet ·
[`migrations/021`](../../migrations/021_reconcile_hosted_storage.sql),
[`libs/server/src/reconcile.ts`](../../libs/server/src/reconcile.ts),
[`libs/server/src/reconcile-providers.ts`](../../libs/server/src/reconcile-providers.ts),
[`api/account/[action].ts`](../../api/account/[action].ts)

## Context

[0017](0017-the-server-weighs-an-upload.md) made a new row's size the
provider's. It named what it left:

- **Bytes with no row.** An upload signed and never confirmed, a Storage object
  put and never recorded. Nothing counts them. On production on 2026-11-21 the
  Storage bucket held 8 such objects, all of accounts the e2e suite had deleted.
- **An object replaced after its row.** Neither Storage nor Cloudinary lets an
  object be overwritten, but its owner may delete it and put another at the
  same path: Storage has no update policy and no rule against a second insert,
  and a Cloudinary upload signature stays valid for an hour, so it can be used
  again once the asset it made is gone. The row keeps the first size.
- **`profiles.bytes_used`** is moved by the trigger alone, and nothing checked
  it against the rows it mirrors.

## Decision

**Once a day, the server holds each provider against the rows and acts on what
disagrees.** `/api/account/reconcile`, called by Vercel Cron.

- **An object with no row is removed once it is a day old.** An upload writes
  its object and asks for its row a moment later; a day is far longer than
  that, and than a resumable upload is kept.
- **A row whose size is not its object's is given the object's.** The update
  says which size it read, so a row deleted or corrected meanwhile is left
  alone, and the quota trigger moves the counter with it.
- **A row with no object is reported, not removed.** The file is broken for its
  owner, and deleting the row would hide that.
- **Then `bytes_used` is recounted** from the rows, each profile locked first,
  as the trigger locks it.
- **Storage is compared in the database**, in one query
  (`reconcile_storage_bucket`). **Cloudinary and R2 are listed by the
  function**, under `users/` only, since nothing of an account's lies outside
  it. The rows are read before the objects: a row is written after its object,
  so every row read has its object by the time the list is made.
- **021 stops the quota trigger refusing an UPDATE.** Since 018 the browser
  can change a row's name and nothing else, so the only UPDATE that changes a
  size is this one, and it writes what the provider holds. An account that had
  hidden bytes is then over its limit, and its next upload is refused.

What it found goes to Sentry as a warning, a failure as an error, in counts: a
path holds an owner's id and a file's name.

## What keeps it from deleting what it should not

- **It runs dry until the deployment says otherwise.** Without
  `RECONCILE_APPLY=true` it removes and changes nothing, and says what it
  would have. The first nights are read before that is set.
- **It holds back when the picture looks wrong.** More than 20 objects with no
  row and more than half of a provider's, or rows missing their objects on the
  same night as objects missing their rows, and nothing is removed. Both are
  what a misread looks like, not what uploads leave: rows read with the anon key,
  or paths written in another shape. The second one matters on this
  production, where Cloudinary holds twelve assets, under the first threshold.
- **At most 1000 removals a night per provider**, and nothing outside the
  app's prefix or bucket is ever listed.
- **Without `CRON_SECRET` it answers 503**, and with a wrong one 401. Vercel
  sends the secret as `Authorization: Bearer`.

## Consequences

- The function that erased accounts serves both:
  `api/account/delete.ts` became `api/account/[action].ts`, and
  `/api/account/delete` is the address it was. Twelve functions, as before
  ([0008](0008-two-actions-one-function.md)).
- **Once a day at most**: that is what a Hobby project may schedule, and Vercel
  runs it within the hour it names. A byte with no row is uncounted for up to
  two days.
- **Each night lists Cloudinary**: one Admin API request per 500 assets of each
  of three types, out of 500 an hour.
- **The deployment needs a secret it did not have**, `CRON_SECRET`, and a
  second step to act, `RECONCILE_APPLY`. Turning that on deletes from
  production, and is a decision made after reading a dry night's report.

## Alternatives

- **A GitHub Actions workflow**, as `keepalive.yml`. It needs no function, but
  the Cloudinary and R2 secrets would live in a second place.
- **Cloudinary's and R2's own expiry rules.** Neither can tell an object with a
  row from one without.
- **Correct only, never remove.** The bytes with no row are the point: they are
  stored, paid for and counted by nothing.
