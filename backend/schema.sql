CREATE TABLE IF NOT EXISTS catalog_model(id integer PRIMARY KEY CHECK(id=1),model text NOT NULL);
CREATE TABLE IF NOT EXISTS campaign (
 id integer PRIMARY KEY CHECK(id=1), started timestamptz NOT NULL, requests integer NOT NULL DEFAULT 0, tokens bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS reviews (
 slot integer PRIMARY KEY CHECK(slot BETWEEN 0 AND 119), scheduled timestamptz NOT NULL, status text NOT NULL DEFAULT 'pending', finished timestamptz
);
CREATE TABLE IF NOT EXISTS runs (
 slot integer REFERENCES reviews, source text NOT NULL, status text NOT NULL, detail text, PRIMARY KEY(slot,source)
);
CREATE TABLE IF NOT EXISTS sources (
 id text PRIMARY KEY, cursor_at timestamptz, cursor_ref text
);
CREATE TABLE IF NOT EXISTS documents (
 id bigserial PRIMARY KEY, source text REFERENCES sources, reference text NOT NULL, url text NOT NULL, published timestamptz NOT NULL,
 hash text NOT NULL, modified timestamptz NOT NULL, UNIQUE(source,reference)
);
CREATE TABLE IF NOT EXISTS revisions (
 id bigserial PRIMARY KEY, document bigint REFERENCES documents, hash text NOT NULL, observed timestamptz NOT NULL, body text NOT NULL
);
CREATE TABLE IF NOT EXISTS entities(id bigserial PRIMARY KEY,name text NOT NULL);
CREATE TABLE IF NOT EXISTS aliases(alias text PRIMARY KEY,entity bigint REFERENCES entities);
CREATE TABLE IF NOT EXISTS missions(number integer PRIMARY KEY CHECK(number>0));
CREATE TABLE IF NOT EXISTS events (
 id uuid PRIMARY KEY, signature text UNIQUE NOT NULL, fact jsonb NOT NULL, mission integer REFERENCES missions, embedding VECTOR_TYPE NOT NULL,
 status text NOT NULL DEFAULT 'candidate', published jsonb
);
CREATE TABLE IF NOT EXISTS participants(event uuid REFERENCES events,entity bigint REFERENCES entities,role text NOT NULL,PRIMARY KEY(event,entity,role));
CREATE TABLE IF NOT EXISTS evidence (
 document bigint REFERENCES documents,event uuid REFERENCES events,revision bigint REFERENCES revisions,
 origin text NOT NULL, direct boolean NOT NULL, reliable boolean NOT NULL,official boolean NOT NULL, passage text NOT NULL, fact jsonb NOT NULL,
 PRIMARY KEY(document,event)
);
CREATE TABLE IF NOT EXISTS changes(version bigserial PRIMARY KEY,event uuid NOT NULL,was_visible boolean NOT NULL,payload jsonb);
CREATE INDEX IF NOT EXISTS evidence_by_event ON evidence(event);
CREATE INDEX IF NOT EXISTS changes_by_event ON changes(event,version);
VECTOR_INDEX

