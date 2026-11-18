import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { embed, kernel } from "../shared/model";

// Optional SQL smoke test when the native PostgreSQL installation lacks pgvector.
const pkg = process.env.PGLITE_DIR;
const lib = (path: string) => pathToFileURL(resolve(pkg!, "dist", path)).href;
const { PGlite } = await import(pkg ? lib("index.js") : "@electric-sql/pglite");
const { vector } = await import(pkg ? lib("vector/index.js") : "@electric-sql/pglite/vector");
const db = new PGlite({ extensions: { vector } });
try {
  const wasm = await kernel(await Bun.file("shared/vector.wasm").arrayBuffer());
  const schema = await Bun.file("backend/schema.sql").text();
  await db.exec("CREATE EXTENSION vector");
  await db.exec(
    schema
      .replace("VECTOR_TYPE", "vector(384)")
      .replace("VECTOR_INDEX", "CREATE INDEX event_hnsw ON events USING hnsw(embedding vector_cosine_ops);"),
  );
  for (const story of ["Rhea betrays Milo", "Iris escapes prison", "Vale destroys the car"]) {
    await db.query(
      "INSERT INTO events(id,signature,fact,embedding) VALUES(gen_random_uuid(),$1,'{}',$2::vector)",
      [story, JSON.stringify(embed(story, wasm))],
    );
  }
  const nearest = "SELECT signature FROM events ORDER BY embedding <=> $1::vector LIMIT 1";
  const query = [JSON.stringify(embed("Rhea traiciona a Milo", wasm))];
  await db.exec("SET enable_seqscan=off");
  const plan = await db.query("EXPLAIN " + nearest, query);
  if (!JSON.stringify(plan.rows).includes("event_hnsw")) throw Error("Missing HNSW scan");
  const result = await db.query(nearest, query);
  if (result.rows[0].signature !== "Rhea betrays Milo") throw Error("Cross-language nearest event mismatch");
  console.log("pgvector HNSW index scan and bilingual 384-dimensional retrieval passed");
} finally {
  await db.close();
}
