# Private Cloudflare R2 storage

Live2D packages can sync to a dedicated private R2 Standard bucket. Supabase
continues to provide verified Auth and the metadata/quota ledger. Model binaries
never enter Git, the deployment bundle, or an AI provider request.

## Limits

| Category | Project-wide reservation limit |
| --- | ---: |
| Live2D packages | 8,000,000,000 bytes (8 decimal GB) |
| Other files, including scene images and thumbnails | 2,000,000,000 bytes (2 decimal GB) |
| One model archive and its expanded package | 536,870,912 bytes (512 MiB) each |

These limits cover all authorized accounts together. They are fixed in SQL and
cannot be raised by a client parameter or environment variable. New imports
validate the complete Cubism package locally before uploading. ZIP archives
over the limit are rejected; folder imports also count ZIP container overhead.
32K texture dimensions are accepted. Rendering still obeys device GPU and RGBA
memory limits using temporary resized copies; original files remain unchanged.

Pending multipart uploads, ready objects, and objects awaiting deletion all
consume quota. A conditional update to a locked quota row reserves space inside
the same transaction as the object insert. Both scene images are reserved in one
transaction, so an image cannot consume space without reserving its thumbnail.
Quota is released only after remote objects/multipart sessions are deleted.
Database/network errors fail closed. Replacing a scene reserves the replacement
while the previous image is still stored.

## Configure before enabling cloud storage

1. Create a **dedicated private Standard bucket** in Cloudflare R2, for example
   `vivian-private-assets`. Disable public `r2.dev` access and public custom
   domains. Keep this bucket exclusively for this application's writes.
2. Create S3 API credentials scoped to this bucket with Object Read & Write
   access. Set the server-only variables from `.env.example` in the deployment:
   `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`.
   Keep credentials out of Git, client bundles, and chat messages.
3. Apply `supabase/migrations/20261005131311_private_r2_storage.sql`, then
   `supabase/migrations/20261005133532_storage_status.sql`, then
   `supabase/migrations/20261005135133_observed_r2_usage.sql`, after the existing
   scene migration. These add the quota ledger, provider-aware cleanup, and
   service-only Supabase usage aggregate, and observed bucket accounting. Ensure the Supabase project is active and the existing server
   credentials/Auth configuration are valid.
4. Set the bucket CORS policy from `config/r2-cors.json`. Replace the example
   production origin with the exact deployed origin; add native/web preview
   origins only as needed. No wildcard is required.
5. Set `SCENE_STORAGE_PROVIDER=r2` to send new scene images to R2. Existing scenes
   keep their recorded Supabase provider and remain readable. Quota/storage
   failures never fall back to another provider. A deployment without this flag
   preserves the existing Supabase scene write path.
6. Add an R2 lifecycle rule to abort incomplete multipart uploads after one day
   as secondary cleanup. Avoid deleting completed objects outside the app:
   external deletions leave conservative ledger reservations behind.
7. Test a small licensed model and a scene in production, then check the Models
   storage readout against the bucket. Test a second device and denied account
   before treating live integration as verified.

The browser sends 16 MiB multipart parts directly to R2, avoiding serverless API
body limits. The server authorizes each upload batch and signs exact
`Content-Length` values for five minutes. The browser supplies that forbidden
request header automatically from the Blob size. Completion uses R2's actual
part sizes and ETags, then checks the completed object size before exposing it.
Download links are issued only for the authenticated owner and expire after five
minutes. They are bearer links during that time: do not log or share them.

Scene downloads remain behind the existing authenticated API. Models are loaded
on demand and validated again before rendering. IndexedDB caches cloud originals
by owner; cached models remain usable when cloud access is temporarily down.
Other accounts' cloud caches are not included in the model picker. Older
local-only imports can be explicitly saved using **Save this model to cloud**.

## Frontend Status panel

The config menu's former Gallery item is now **Status**. It displays used bytes,
capacity and percentage for Supabase file storage, R2 total, Live2D and other
files. `GET /api/storage/status` checks the existing verified account allowlist.
The panel polls every five seconds while mounted and visible, refreshes after
model/scene mutations, and aborts requests when closed. This is polling rather
than a Supabase Realtime subscription. Failed checks display Unavailable or a
last-update notice instead of fabricating zero usage.

Supabase usage is the sum of `storage.objects.metadata.size` across this project's
buckets. Its displayed capacity defaults to the current Free plan's decimal
1 GB; set server-only `SUPABASE_STORAGE_LIMIT_BYTES` if the plan changes. This
metric excludes the Postgres database size and other Supabase projects. R2 usage
is fetched directly from the configured bucket on every check using paginated
`ListObjectsV2`, `ListMultipartUploads`, and `ListParts`. It counts provider-returned
object/part sizes, including files added outside the app. Keys under `live2d/`
count as models; all other keys count as other files. No demo numbers or cached
inventory are used by the production endpoint. Missing credentials, incomplete
inventory, and network failures show Unavailable, never an assumed empty bucket.

The additional **Quota committed** figures combine the live bucket inventory
with app reservations: each key counts the larger of reserved and actual bytes.
Thus a model still occupies its full reservation before all parts are uploaded.
Every new model and R2 scene upload repeats the live check before writing.
Additional observed bytes are recorded in a service-only SQL operation and
participate in the same locked quota check as concurrent app reservations.
Live checks failing block new uploads. Bucket listing is a snapshot, not an
atomic lock across Cloudflare and Postgres; keep outside writers disabled in
the dedicated bucket to preserve the application quota guarantee.

## Recovery and billing

Failed/abandoned model uploads older than one hour and objects awaiting deletion
are retried on an authenticated model-library refresh. Failed scene uploads use
the existing durable scene cleanup queue. No quota is silently released during
a storage outage. If all space is reserved by failed uploads, refresh after the
expiry period to retry cleanup. Auth account removal keeps orphaned ledger rows
and their quota reserved; an operator must delete the associated remote objects
before deleting those ledger rows.

Use a dedicated bucket and keep all application uploads through this ledger.
Files uploaded manually are measured on the next live check and reduce available
app quota, but this app cannot prevent another tool from writing into the bucket.
R2's free allowance applies across the Cloudflare account, including any other
buckets. The 8+2 GB storage cap does not cap billable request counts, Workers,
Vercel traffic, or other services. Enable billing alerts and monitor the account;
this is not a guarantee that the entire deployment will always cost zero.

R2 provides encryption at rest and HTTPS transport. This feature does not add
end-to-end encryption; bucket administrators with credentials can read objects.
Use only models whose licenses permit your intended private cloud storage.

## Validation

- `npm run test:storage`: byte limits, ownership, reservations, failed deletion,
  scene accounting, exact signed lengths, verified multipart completion.
- `npm run test:storage:postgres`: actual migrations and parallel quota writes in
  a disposable local Postgres 17 container named `vivian-r2-postgres` (override
  with `STORAGE_TEST_CONTAINER`). The test creates/drops its own database and
  never connects to a live Supabase project.
- Existing model/scene suites, Auth integration, TypeScript, production build.

References: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).
