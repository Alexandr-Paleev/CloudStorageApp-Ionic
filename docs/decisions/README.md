# Architecture decisions

Short records of the decisions that are hard to infer from the code — the ones
where the obvious alternative was considered and rejected for a reason worth
keeping.

Each record is context, decision, consequences. Consequences include the ones
that cost something: a decision with no downside listed is usually a decision
nobody examined.

Nothing here is a plan. These describe what the code does now and why, and they
are amended rather than rewritten when a decision is reversed.

| #                                                | Decision                                                        | Shipped  |
| ------------------------------------------------ | --------------------------------------------------------------- | -------- |
| [0001](0001-presigned-uploads-not-a-proxy.md)    | Uploads go straight to the provider, not through a function     | v3.0.0   |
| [0002](0002-billing-is-server-write-only.md)     | Billing columns are written server-side only                    | v3.0.0   |
| [0003](0003-share-tokens-are-stored-hashed.md)   | Share tokens are stored as SHA-256 hashes                       | v3.1.0   |
| [0004](0004-quota-lives-in-the-database.md)      | The storage quota is enforced by a trigger, not by the API      | v4.0.0     |
| [0005](0005-sentry-loads-when-idle.md)           | Sentry loads after first paint; Session Replay stays off        | v4.0.0     |
| [0006](0006-dependabot-skips-majors.md)          | Dependabot skips majors, and `npm audit` backstops that         | v3.1.0   |
| [0007](0007-rate-limits-are-per-instance.md)     | Rate limits live in module scope, not in a shared counter       | v4.0.0     |
| [0008](0008-two-actions-one-function.md)         | Two Cloudinary actions share one serverless function            | v4.0.0     |
| [0009](0009-resumable-uploads-keep-state-in-the-browser.md) | A resumable upload keeps its state in the browser | v4.0.0     |
