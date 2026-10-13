-- Data migration: legacy SUPERVISOR-signer `signature` fields -> the `supervisorSignature`
-- SYSTEM role (ADR-0012). No schema change.
--
-- For every Template whose stored definition still has a `signature` field with
-- signer = 'SUPERVISOR':
--   * the FIRST such field becomes the role field (type 'text', role 'supervisorSignature',
--     signer dropped) and its export entry becomes { token, computed: 'supervisorSignature' }
--     — same cell, same picture;
--   * any further legacy field (or every one, when the role is already bound) is dropped
--     from "fields" and its export entry re-pointed at the role's picture
--     ({ token, signature: 'supervisorSignature' });
--   * the prior definition is appended to "TemplateDefinitionRevision" (the same history a
--     wizard edit writes; the token set is unchanged, so tokensChanged = false);
--   * the report signatures already frozen under 'field:<key>' are COPIED to the
--     'supervisorSignature' slot (same revision / storage object / hash / time) for the
--     reports pinned to that template version, so past revisions export unchanged.
--     Originals are never deleted.
--
-- Idempotent: once a template has no legacy field left it is skipped, and a signature copy
-- is skipped when the role slot already has a row for that report + revision.

DO $$
DECLARE
  t              RECORD;
  def            jsonb;
  legacy_keys    text[];
  promote_key    text;
  new_fields     jsonb;
  new_global     jsonb;
  token_json     text;
  token_hash     text;
  next_revision  integer;
BEGIN
  FOR t IN
    SELECT "id", "tenantId", "templateKey", "templateVersion", "createdById", "definitionJson"
    FROM "Template"
    WHERE "definitionJson" IS NOT NULL
      AND jsonb_typeof("definitionJson" -> 'fields') = 'array'
      AND jsonb_typeof("definitionJson" #> '{export,global}') = 'array'
  LOOP
    def := t."definitionJson";

    SELECT coalesce(array_agg(f ->> 'key' ORDER BY ord), ARRAY[]::text[])
      INTO legacy_keys
      FROM jsonb_array_elements(def -> 'fields') WITH ORDINALITY AS x(f, ord)
     WHERE f ->> 'type' = 'signature'
       AND f ->> 'signer' = 'SUPERVISOR'
       AND coalesce(f ->> 'key', '') <> '';

    CONTINUE WHEN coalesce(array_length(legacy_keys, 1), 0) = 0;

    -- The first legacy field is promoted to the role unless the definition already binds it.
    IF EXISTS (
         SELECT 1 FROM jsonb_array_elements(def #> '{export,global}') e
          WHERE e ->> 'computed' = 'supervisorSignature'
       )
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(def -> 'fields') f
          WHERE f ->> 'role' = 'supervisorSignature'
       )
    THEN
      promote_key := NULL;
    ELSE
      promote_key := legacy_keys[1];
    END IF;

    SELECT coalesce(jsonb_agg(
             CASE
               WHEN f ->> 'type' = 'signature' AND f ->> 'signer' = 'SUPERVISOR'
                    AND f ->> 'key' = promote_key
               THEN (f - 'signer') || jsonb_build_object('type', 'text', 'role', 'supervisorSignature')
               ELSE f
             END
             ORDER BY ord
           ), '[]'::jsonb)
      INTO new_fields
      FROM jsonb_array_elements(def -> 'fields') WITH ORDINALITY AS x(f, ord)
     WHERE NOT (
             f ->> 'type' = 'signature' AND f ->> 'signer' = 'SUPERVISOR'
             AND coalesce(f ->> 'key', '') <> ''
             AND f ->> 'key' IS DISTINCT FROM promote_key
           );

    SELECT coalesce(jsonb_agg(
             CASE
               WHEN (e ->> 'signature') LIKE 'field:%'
                    AND substr(e ->> 'signature', 7) = ANY (legacy_keys)
               THEN
                 CASE WHEN substr(e ->> 'signature', 7) = promote_key
                      THEN (e - 'signature') || jsonb_build_object('computed', 'supervisorSignature')
                      ELSE (e - 'signature') || jsonb_build_object('signature', 'supervisorSignature')
                 END
               ELSE e
             END
             ORDER BY ord
           ), '[]'::jsonb)
      INTO new_global
      FROM jsonb_array_elements(def #> '{export,global}') WITH ORDINALITY AS x(e, ord);

    -- Token-set signature, as the definition service records it: sha256 of the JSON array of
    -- the sorted, de-duplicated token literals of export.global + every export.regions entry.
    SELECT '[' || coalesce(string_agg(to_json(tok)::text, ',' ORDER BY tok COLLATE "C"), '') || ']'
      INTO token_json
      FROM (
        SELECT DISTINCT e ->> 'token' AS tok
          FROM jsonb_array_elements(def #> '{export,global}') e
         WHERE e ->> 'token' IS NOT NULL
        UNION
        SELECT DISTINCT r ->> 'token'
          FROM jsonb_each(coalesce(def #> '{export,regions}', '{}'::jsonb)) AS reg(k, entries),
               LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(entries) = 'array' THEN entries ELSE '[]'::jsonb END
               ) r
         WHERE r ->> 'token' IS NOT NULL
      ) tokens;
    token_hash := encode(sha256(convert_to(token_json, 'UTF8')), 'hex');

    SELECT coalesce(max("revisionNumber"), 0) + 1
      INTO next_revision
      FROM "TemplateDefinitionRevision"
     WHERE "templateId" = t."id";

    INSERT INTO "TemplateDefinitionRevision"
      ("id", "templateId", "revisionNumber", "definitionJson", "tokenSetHash",
       "tokensChanged", "revisedById", "revisedAt", "revisionReason", "tenantId")
    VALUES
      (md5(random()::text || clock_timestamp()::text || t."id")::uuid::text,
       t."id", next_revision, def, token_hash, false, t."createdById", now(),
       'Migrate legacy SUPERVISOR signature field to the supervisorSignature system role',
       t."tenantId");

    UPDATE "Template"
       SET "definitionJson" = jsonb_set(
             jsonb_set(def, '{fields}', new_fields),
             '{export,global}', new_global)
     WHERE "id" = t."id";

    -- Copy the frozen signatures (newest per report + revision) to the role slot.
    INSERT INTO "ReportSignature"
      ("id", "tenantId", "inspectionReportId", "slot", "signedById", "storageKey",
       "hash", "signedAt", "revisionNumber")
    SELECT md5(random()::text || clock_timestamp()::text || src."id")::uuid::text,
           src."tenantId", src."inspectionReportId", 'supervisorSignature',
           src."signedById", src."storageKey", src."hash", src."signedAt",
           src."revisionNumber"
      FROM (
        SELECT DISTINCT ON (rs."inspectionReportId", rs."revisionNumber") rs.*
          FROM "ReportSignature" rs
          JOIN "InspectionReport" ir ON ir."id" = rs."inspectionReportId"
         WHERE ir."tenantId" = t."tenantId"
           AND ir."templateKey" = t."templateKey"
           AND ir."templateVersion" = t."templateVersion"
           AND rs."slot" = ANY (SELECT 'field:' || k FROM unnest(legacy_keys) k)
         ORDER BY rs."inspectionReportId", rs."revisionNumber", rs."signedAt" DESC
      ) src
     WHERE NOT EXISTS (
       SELECT 1 FROM "ReportSignature" x
        WHERE x."inspectionReportId" = src."inspectionReportId"
          AND x."slot" = 'supervisorSignature'
          AND x."revisionNumber" = src."revisionNumber"
     );
  END LOOP;
END
$$;
