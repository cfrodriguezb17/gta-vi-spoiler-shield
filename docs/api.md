# Public catalog API

Anonymous HTTPS GET requests. The release embeds its catalog origin. Responses contain narrative spoilers.

| Route | Response |
| --- | --- |
| `/api/spoilers` | Full snapshot. All published events appear in `added`. |
| `/api/spoilers?since=N` | Net changes since a nonnegative integer version. |
| `/api/world` | Officially disclosed characters, locations, plot summaries and source references. |
| `/health/live` | 204 while the process serves HTTP. |
| `/health/ready` | 204 with the release revision when the catalog is readable and model-compatible, otherwise 503. |

Every batch includes `version`, `modelVersion`, `added`, `updated` and `deleted`. A future or expired cursor returns 410 and triggers a full download. Unexpected query parameters, negative and duplicate cursors return 400. The browser validates a batch before applying it. A change of origin or model also triggers a snapshot.

One public replica allows 60 API reads per minute per IP, including up to 10 full snapshots. Excess reads return 429. At 32 simultaneous reads the API returns 503. Both limits include a `Retry-After` header. A bounded 16 MiB cache can serve a successful response for up to 60 seconds. A client can retry a failed sync while keeping its last valid catalog.
