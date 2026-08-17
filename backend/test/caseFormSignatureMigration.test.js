import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("client-signed IMM 5476 copies can persist their Generated version source", async () => {
  const [schema, migration, service] = await Promise.all([
    readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260818013000_repair_generated_case_form_version_source/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/services/imm5476SignatureService.js", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /enum CaseFormVersionSource \{[\s\S]*Generated/);
  assert.match(migration, /ALTER TYPE "CaseFormVersionSource" ADD VALUE IF NOT EXISTS 'Generated'/);
  assert.match(service, /source: "Generated"/);
  assert.match(service, /copyType: "ClientSigned"/);
});
