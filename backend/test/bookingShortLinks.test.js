import assert from "node:assert/strict";
import test from "node:test";
import { bookingSlugBase, generatePublicBookingSlug } from "../src/services/bookingPublicLinkService.js";

test("public booking slugs use a concise immigration firm name", () => {
  assert.equal(bookingSlugBase("Réedim Immigration & Citizenship Inc."), "reedim-immigration-citizenship-inc");
  assert.equal(bookingSlugBase("  North Star Immigration  "), "north-star-immigration");
});

test("public booking slugs add a short suffix only when the name is already used", async () => {
  const checked = [];
  const db = {
    agency: { findUnique: async () => ({ name: "Reedim Immigration", legalName: null }) },
    bookingSettings: {
      findFirst: async ({ where }) => {
        checked.push(where.publicSlug);
        return where.publicSlug === "reedim-immigration" ? { id: "existing" } : null;
      },
    },
  };

  const slug = await generatePublicBookingSlug("agency-1", db);
  assert.equal(checked[0], "reedim-immigration");
  assert.match(slug, /^reedim-immigration-[a-z0-9_-]{4}$/);
});
