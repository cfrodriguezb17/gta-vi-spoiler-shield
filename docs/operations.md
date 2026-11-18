# Railway operations

## Provision one environment

Create a Railway project and environments named `staging` and `production`. Use the same region, an on-demand staging environment and one always-on public API replica in production. Keep the assigned HTTPS hostname stable. Disable GitHub source autodeploys. GitHub Actions is the deployment controller.

| Railway service | Source and settings |
| --- | --- |
| `db` | Pin a reviewed `pgvector/pgvector:pg18-trixie` image digest. Mount a persistent volume at `/var/lib/postgresql`, set `POSTGRES_DB=shield`, set a unique owner password, and keep TCP and HTTP ingress private. |
| `migrate` | One-shot service using the backend Dockerfile. Its pre-deploy command uses the schema owner. It exits after a successful migration. |
| `encoder` | Private service using the shared Dockerfile. Set `EMBED_PORT=5072`. |
| `api` | Service using the backend Dockerfile. Generate the public Railway HTTPS domain. The app listens on Railway's `PORT`. |

With the Railway CLI signed in, run `bun ops/configure-railway.ts PROJECT_ID staging` and repeat for `production`. It sets health checks, the migration command and restart policies through the Railway API. The deploy workflow selects each Dockerfile at the root of its upload. Give the migrator `ConnectionStrings__Catalog` with the database owner and private hostname. Give the API its own connection string using `shield_app`. Use the Railway secret editor or variable references for passwords. Set `EncoderUrl=http://encoder.railway.internal:5072/embed`. Set `CampaignEnabled=false` through rehearsal and restoration. Keep it false in staging.

In each database, run the migration or restore the source schema before granting runtime privileges. In a private `psql` session as owner, run `CREATE ROLE shield_app LOGIN;`, use `\password shield_app` and apply [runtime-role.sql](../ops/runtime-role.sql). Store the runtime credential only in the API service. Provision the vector extension as owner. For future schema changes, grant the runtime role only the additional object permissions it needs.

Set `Gemini__Key`, `Gemini__Model`, `Gemini__MaxRequests`, `SourceUserAgent` and authorized connector credentials on the production API. Inspect each upstream's permissions and quota. An unavailable source can fail while other sources continue. Google and Railway budgets are independent.

To import manually reviewed coverage, pass a private JSON array to `dotnet Shield.dll import-reviewed-story` on standard input. Each article gives `sourceId` from the configured editorial or guide sources, its canonical `url` and `published` date, the reviewed `body` excerpt, and `facts` in the extractor's format. Each fact needs an exact first-hand `passage` and an empty `origin`. An empty `facts` array retracts earlier reviewed evidence for that URL. The catalog applies its usual confidence rules.

## Restore and cut over

1. Take a custom-format dump of the local database using `pg_dump -Fc --no-owner --no-acl`. Store dumps outside Git and use encrypted storage and transport. For Compose, run `docker compose exec -T db pg_dump -Fc -U shield -d shield -f /tmp/catalog.dump` and copy it out with `docker compose cp db:/tmp/catalog.dump ./catalog.dump`.
2. Transfer the dump through an operator-only connection. Restore into a **new, empty** database on the isolated environment, using `pg_restore --exit-on-error --no-owner --no-acl -d shield catalog.dump` with the destination owner. Run the idempotent schema migration, grant the runtime role and deploy the API with its worker disabled. For a staged database that already has a schema, restore into a newly provisioned database and change its service reference after verification.
3. Run [inventory.sql](../ops/inventory.sql) on both databases. Compare the model, version, published payload digest, evidence digest, source cursors, 120 review rows and campaign counters. Compare against the snapshot time if the local campaign advanced during rehearsal. Use the original UTC start and end.
4. At cutover, stop the local writer with `docker compose stop api`, take the final dump and repeat the restore and comparisons in production. Run the smoke check. Enable `CampaignEnabled=true` only on the production API. A campaign past its deadline serves the existing catalog. If validation fails before enabling the cloud worker, restart the local API. If the cloud worker has written new data, stop it, reconcile the newer database first, then switch writers.
5. Configure daily volume backups retaining at least seven days. Verify retention in the active Railway plan and restore a backup to a disposable volume. Record the version and recovery time. Remove temporary dump files after verification. Disable staging compute between releases.

## GitHub configuration and deploys

Create GitHub environments `staging` and `production`, restricted to `main`. Set `RAILWAY_TOKEN` to a separate Railway project token scoped to each environment. Add environment variables `RAILWAY_PROJECT_ID` and `CATALOG_URL`. Production requires the maintainer’s approval. Put Mozilla's unlisted signing credentials in Actions secrets named `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Enable two-factor authentication for maintainer accounts.

Run **Deploy catalog** from `main`. It runs CI, deploys the migrator, encoder and API in order, and checks the running revision, snapshot, delta and invalid cursor. Approve production only after staging passes. Each environment uses the same checked-out SHA. Health readiness tests PostgreSQL and the model independently of Gemini and the encoder.

## Operational checks

- Enable Railway budget alerts at 80% and 100% of the operator's monthly budget. Set independent alerts for health failures, sustained 5xx (over 1% for five minutes with at least 100 requests) and repeated source failures (two consecutive reviews). A low-traffic deployment should also use an external, once-per-minute ready probe with an alert after three failures. Choose the operator's private delivery channel in Railway or the monitoring provider.
- Review the API's one-minute aggregate log records for reads, mean latency, 429s and 5xx. Use the private operator command `dotnet Shield.dll status` to inspect review slots, failed sources, Gemini requests/tokens, and catalog version. Check the platform's HTTP log fields, retention and operator access when enabling hosting. Document the approved retention in the privacy notice before release.
- On staging, verify that Railway replaces a supplied `X-Real-IP` header at its edge before setting `TrustRailwayIngress=true`. Ensure there is only one public path to the service and that private peers are trusted. Keep this setting false on local hosts. Monitor shared networks for false throttling. Settings are `Limits__ReadsPerMinute=60`, `Limits__SnapshotsPerMinute=10` and `Limits__ConcurrentReads=32`. A second public replica requires a shared limiter.
- Rehearse encoder or Gemini failure and quota exhaustion against staging. A read-only catalog should continue to synchronize, and a failed source should be visible privately. Rehearse a rollback to the last known-good API/encoder revision and rerun `bun ops/smoke.ts` with `CATALOG_URL` and `EXPECT_REVISION`. Preserve backward-compatible migrations. Restore a database backup only after assessing writes since the backup.

## Distribute a release

The canonical version is in `package.json`. The release build requires a public `https://*.up.railway.app` origin. After deployment, run **Distribute extension → draft** on the production SHA. It submits the Firefox package and matching source archive privately to Mozilla for unlisted signing and prepares a GitHub draft with the signed XPI, Chrome ZIP and SHA-256 checksums. A pending Mozilla review can outlast the workflow. In that case retrieve the signed XPI of that same version from the developer dashboard, verify the ID/version and finish the matching draft using the original Chrome build. Keep the Git tag and release assets immutable once published.

Install both final packages in clean profiles using a network outside the Railway project. Verify both languages, both modes, keyboard reveal, a screen reader, all five live sites and offline filtering. Record the browser versions, result, commit and restored catalog version in the draft. Check that the encoder and DB have no public endpoints. Then run **Distribute extension → publish** on the same SHA. Update the preparation notice in both READMEs to link the published release. Do not attach database backups to GitHub.

[Railway private networking](https://docs.railway.com/guides/private-networking) · [Ingress headers](https://docs.railway.com/networking/public-networking/specs-and-limits) · [Mozilla signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
