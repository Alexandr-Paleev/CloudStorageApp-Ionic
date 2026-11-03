# 0004 — The storage quota is enforced by a trigger, not by the API

Accepted · shipped in v4.0.0 · migration [`007`](../../migrations/007_enforce_storage_quota.sql)

## Context

The README claimed the quota was enforced server-side. One handler did it:
`api/r2/presign-upload.ts` — one provider out of three, and not the one
production uses. Images go to Cloudinary and most files here are images; those
uploads went from the browser to Cloudinary directly (see
[0001](0001-presigned-uploads-not-a-proxy.md)), as did Supabase Storage uploads
through `supabase-js`. On both paths the limit rested on `canUploadToLocal()` in
the client — that is, on the client's good manners.

Even on the R2 path the check was check-then-act: two parallel requests read the
same total, both passed, both got a URL.

## Decision

Enforce it where every path has to arrive. A file exists in this app only once
its row lands in `public.files`, whichever bucket holds the bytes, so the row is
the chokepoint. A trigger on that table:

- keeps `profiles.bytes_used` as a counter rather than re-summing every row;
- refuses an `INSERT` that would cross `storage_limit`;
- takes a row lock on the profile first, so two concurrent uploads serialise and
  the second sees the first one's bytes.

The API check stays, as a pre-flight that refuses before the bytes travel.

## Consequences

- The limit is unskippable and the race is gone, for providers this project has
  not integrated yet as much as for the ones it has.
- `getStorageUsed()` no longer pages through every row on each upload — the API
  and the client were each doing that separately, on every single upload.
- **The trigger trusts `size` on the row.** Nothing server-side sees the bytes,
  so nothing can weigh them; a client that lies about the size stores more than
  it should. That is the honest boundary of what this buys, and the README says
  so rather than implying otherwise.
- A rejected `INSERT` leaves the object in the bucket for a moment. The
  compensating delete in `storage.service.uploadFile()` already covered that.
- The function is `SECURITY DEFINER`, because `UPDATE` on `profiles` is revoked
  ([0002](0002-billing-is-server-write-only.md)). It writes one column of one
  row, derived from the file being inserted rather than from anything the caller
  supplies.

## Update — 2026-11-01

**A row could be rewritten after the check, and the check let it.** The
consequence above says a client that lies about a size at upload stores more
than it should. A lie told later did more. `authenticated` held `UPDATE` on
every column of its own rows, so the counter could be taken back down without
a byte leaving the bucket. Measured on production in a transaction that rolled
back: a row of 300 MB made `bytes_used` 300 MB; setting its `size` to 0 made it
0, and so did moving the row to `googledrive`. A row of −5 GB was accepted,
and a row could be filed under another account's folder.

[`018`](../../migrations/018_constrain_file_rows.sql) closes what a written row
can turn into:
- a signed-in account may change a row's name and nothing else, by column
  grants: RLS has no column granularity, but `GRANT` does;
- a size is not negative, and a provider is one the app has;
- a folder's parent, and a file's folder, belong to the row's own account;
- a Storage upload lands directly in the owner's folder, and the bucket
  refuses a file over 50 MB.

The size stated at upload is still the browser's. The step that closes it is
the server confirming an upload with the provider before the row is written.
