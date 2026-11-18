-- Compare the JSON result on the source and restored database before enabling the worker.
SELECT jsonb_build_object(
  'model', (SELECT model FROM catalog_model WHERE id = 1),
  'version', (SELECT coalesce(max(version), 0) FROM changes),
  'published', (SELECT md5(coalesce(string_agg(md5(published::text), '' ORDER BY id), '')) FROM events WHERE published IS NOT NULL),
  'evidence', (SELECT count(*) FROM evidence),
  'evidenceDigest', (SELECT md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' ORDER BY document,event), '')) FROM evidence e),
  'cursors', (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM sources s),
  'campaign', (SELECT to_jsonb(c) FROM campaign c WHERE id = 1),
  'reviews', (SELECT jsonb_agg(to_jsonb(r) ORDER BY slot) FROM reviews r),
  'runs', (SELECT count(*) FROM runs)
);
