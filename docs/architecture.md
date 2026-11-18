# Architecture

## C1 · System context

```mermaid
flowchart LR
  user["Browser user"] -->|Selects settings and reveals cards| shield["GTA VI Spoiler Shield"]
  sites["Reddit, YouTube, X, Facebook, Instagram"] -->|Feed cards in the local browser| shield
  operator["Operator"] -->|Starts campaign and manages releases| shield
  sources["Authorized Reddit and YouTube APIs, feeds and official references"] -->|Source documents| shield
  shield -->|Authorized source document| gemini["Google Gemini API"]
  gemini -->|Structured claims and passages| shield
```

## C2 · Containers and trust boundaries

```mermaid
flowchart TB
  subgraph device["User device"]
    pages["Five social sites"] -->|DOM text and accessible labels| extension["WebExtension · TypeScript + local WASM"]
    extension <-->|Atomic catalog and cursor| local[("IndexedDB")]
  end
  subgraph railway["Railway project"]
    api["Public ASP.NET Core API and hosted campaign worker"]
    encoder["Private Bun encoder · shared WASM"]
    db[("Private PostgreSQL 18 · pgvector")]
    api -->|Source text for embeddings| encoder
    encoder -->|384-dimensional vectors| api
    api <-->|Evidence, reviews and published changes| db
  end
  extension -->|HTTPS GET with optional version cursor| api
  api -->|Snapshot or delta| extension
  sources["Authorized upstreams"] -->|Documents and edits| api
  api <-->|Extract facts from source documents| gemini["Gemini"]
  operator["Operator"] -->|Private CLI and one-shot migrations| db
```

The bundled bilingual lexical encoder uses model version `vi-lex-es-en-384-v1`. PostgreSQL coordinates the campaign and publishes changes transactionally. The extension stores a cursor per active origin and replaces its catalog atomically after a change of origin. The public API and background worker share one process. Only the worker calls Gemini. GitHub Actions deploys the services and packages the browser builds from the same commit.
