-- Run as the schema owner after migrate/restore. Create shield_app with a unique
-- login password through the private database console before running this file.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO shield_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO shield_app;
GRANT INSERT, UPDATE, DELETE ON campaign,reviews,runs,sources,documents,revisions,
  entities,aliases,missions,events,participants,evidence,changes TO shield_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shield_app;
