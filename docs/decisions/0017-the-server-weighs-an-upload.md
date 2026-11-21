# 0017 — The server weighs an upload before it counts

Accepted · not released yet ·
[`migrations/020`](../../migrations/020_server_records_hosted_uploads.sql),
[`libs/server/src/record-upload.ts`](../../libs/server/src/record-upload.ts),
[`api/cloudinary/[action].ts`](../../api/cloudinary/[action].ts),
[`api/r2/[action].ts`](../../api/r2/[action].ts)

## Context

The quota lives in the database ([0004](0004-quota-lives-in-the-database.md)):
a trigger on `files` counts each row's `size` against the plan, under a lock,
on every path. The row was written by the browser, and so was its size. 018
closed what a written row can turn into, and said what it left: "an INSERT
can still state a size smaller than the object it records". An account could
upload 40 MB and record a kilobyte, and the trigger counted the kilobyte.

Two providers on production can be talked past this way, and a third in the
code:

- **Cloudinary.** `/api/cloudinary/sign` checks the quota against the size in
  its body, and the signature binds the folder, the name and the time, not
  the size. Nothing before the row knows what arrived.
- **Supabase Storage.** The upload goes from the browser into the bucket, and
  nothing compared the row's size with the object's.
- **R2**, off on production. A single PUT binds its `ContentLength`, and
  `multipart-complete` weighs the assembled object, but neither wrote the row.

The README said closing it "needs the server to see the bytes, which is the
4.5 MB request limit these direct uploads exist to avoid". It does not: the
server can ask whoever holds the bytes.

## Decision

**The size of a hosted file is read from where the file is, not from the
browser.**

- **Supabase Storage: the database reads it.** This bucket is a table the
  database can see. `020` adds a trigger, `on_file_weighed`, that runs before
  the quota's (`on_file_written`: Postgres fires one event's triggers in the
  order of their names) and sets a Storage row's size from
  `storage.objects.metadata.size`. A row with no object at its path is
  refused, and so is one whose path is not in the owner's own folder. The
  folder, not the object's `owner_id`: the demo seed stores with the service
  role, and its objects have no owner (14 of the 20 on production). The
  browser keeps writing these rows, and nothing in the app changes for them.
- **Cloudinary and R2: a function writes the row.** After an upload the
  browser asks `/api/cloudinary/confirm` or `/api/r2/confirm`, with the
  object's id, the file's name and type and the folder, never its size. The
  function checks the object is in the caller's folder, asks the provider for
  it (Cloudinary's Admin API, R2's `HeadObject`), and writes the row with the
  service role. The same trigger counts it. Over the quota, in a folder that is
  not the account's, or impossible to weigh, the object is deleted and the
  answer says why: 413, 400, 503. `020` adds a restrictive policy, so that a
  signed-in browser may insert only Storage, Drive and Dropbox rows.
- Both are actions of functions that exist. The plan's twelve functions are
  all used ([0008](0008-two-actions-one-function.md)).

`SERVER_RECORDED` in `libs/core/src/file-rules.ts` names the two providers,
and its test holds the policy in `020` to it.

## Consequences

- The quota counts bytes that exist. A browser can still lie about a file's
  name and type, which cost nothing.
- **An upload to Cloudinary or R2 is one request longer.** A function call and
  one provider request, after the bytes have gone up.
- **Cloudinary's Admin API allows 500 requests an hour on the free plan**, and
  confirming spends one per upload. The Upload API, which signing and deleting
  use, is not limited. Past the 500, an upload is refused with 503 and its
  asset deleted, rather than recorded unweighed.
- **The order of the rollout matters.** The functions ship first; `020` is
  applied after, or the app's own uploads are refused. The deploy alone
  already moves every Cloudinary upload to `confirm`, before `020` asks for
  it, so a real upload is tried on production right after the deploy: the
  migration is what keeps a browser from going around `confirm`, not what
  keeps `confirm` working. A tab opened before the
  deploy writes its Cloudinary rows itself until it takes the update the app
  offers, and after `020` those inserts are refused. Few people use the app;
  the update asks once, and a refusal leaves no bytes behind (the browser
  deletes what it could not record).
- **e2e put real objects behind their Storage rows** (`storeObject` in
  `e2e/fixtures.ts`): a row with nothing at its path is refused now. The R2
  stand-in records its row as the server would.

## What it leaves

- **Bytes with no row.** An upload that is signed and never confirmed, or an
  object put into Storage and never recorded, is counted by nothing. The
  bucket's 50 MB per object (018) and the signing limits bound how fast; a
  nightly reconciliation, next, deletes what has no row after a day and
  recounts `bytes_used`.
- **A Storage object replaced after its row.** Storage has no update policy,
  so an object cannot be overwritten, but its owner may delete it, and a new
  object may then be put at the same path: the row keeps the first size. The
  reconciliation weighs the Storage rows against their objects as well, which
  the database can do for all of them in one query.
- **Google Drive and Dropbox** rows are still the browser's: those bytes are in
  the person's own cloud and count against nothing of ours.

## Alternatives

- **Cloudinary's notification URL.** Cloudinary can call a webhook with the
  upload's details, signed. It saves the Admin API request, but the row would
  arrive after the browser is told the upload finished, and the webhook is one
  more public route to keep. A request the browser waits for is simpler while
  500 an hour is far above what the app uploads.
- **Trust the upload's own response.** Cloudinary signs its answer, but the
  signature covers the id and the version, not `bytes`.
- **Weigh everything in the nightly reconciliation alone.** It would correct a
  size a day late, after the space was used. It is the backstop, not the line.
