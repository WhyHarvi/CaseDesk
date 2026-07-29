import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_BOOKING_PUBLIC_ORIGIN,
  bookingPublicOrigin,
  bookingSlugBase,
  generatePublicBookingSlug,
  publicBookingManageUrl,
  publicBookingPageUrl,
} from "../src/services/bookingPublicLinkService.js";

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

test("public booking avatars can be embedded by the separately hosted frontend", async () => {
  const controller = await readFile(new URL("../src/controllers/publicBookingController.js", import.meta.url), "utf8");
  assert.match(controller, /getPublicBookingAvatar[\s\S]*Cross-Origin-Resource-Policy", "cross-origin"/);
});

test("outbound booking links use the canonical CHK domain and never localhost", () => {
  const settings = { publicSlug: "chk-immigration-services-inc-421a" };
  const localEnvironment = {
    FRONTEND_URL: "http://localhost:5173",
    BOOKING_PUBLIC_ORIGIN: "http://localhost:5173",
  };

  assert.equal(bookingPublicOrigin(localEnvironment), DEFAULT_BOOKING_PUBLIC_ORIGIN);
  assert.equal(
    publicBookingPageUrl(settings, { environment: localEnvironment }),
    "https://casedesk.chkimmigration.ca/b/chk-immigration-services-inc-421a",
  );
  assert.equal(
    publicBookingManageUrl(settings, "appointment-token", { environment: localEnvironment }),
    "https://casedesk.chkimmigration.ca/b/chk-immigration-services-inc-421a/manage/appointment-token",
  );
});

test("the public booking path accepts secure appointment-management links", async () => {
  const routes = await readFile(new URL("../../frontend/src/routes/AppRoutes.jsx", import.meta.url), "utf8");
  assert.match(routes, /path="\/b\/:token\/manage\/:manageToken"/);
});
