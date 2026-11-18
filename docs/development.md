# Local development

Install Bun 1.4.2, Docker Compose and the .NET SDK selected by `global.json`. Linux packaging also requires `zip`. From the repository root:

```sh
cp .env.example .env
bun install --frozen-lockfile
bun run build
bun run test
bun x tsc
```

Set `CATALOG_PASSWORD` in your private `.env`, then run:

```sh
docker compose up --build -d
docker compose exec api dotnet Shield.dll import-official-world
```

The default build targets the local API at `http://127.0.0.1:5071`. Load the Chrome directory unpacked or temporarily load the Firefox manifest via `about:debugging`. The official reference can be imported without Gemini. Configure authorized upstreams and a Gemini budget before starting a five-day campaign.

```sh
docker compose exec api dotnet Shield.dll start-campaign
docker compose exec api dotnet Shield.dll status
```

The [Spanish development guide](development.es.md) details ingestion, detection and testing. CI runs the .NET integration suite against native pgvector, then installs both packages in isolated browser profiles. The browser suite requires its own loopback port. Build the test packages and run `bun tests/browser.ts` with the same `CATALOG_URL` and `EXTENSION_OUT_DIR`. Production builds require `RELEASE_BUILD=1` and a Railway HTTPS origin.
