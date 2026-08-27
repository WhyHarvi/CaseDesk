import assert from "node:assert/strict";
import test from "node:test";
import { avatarPresetBuffer, defaultAvatarPreset, normalizeAvatarPreset, STAFF_AVATAR_PRESETS } from "../src/services/staffAvatarPresetService.js";
import { readFile } from "node:fs/promises";

test("the professional avatar library contains twenty-one bundled presets", async () => {
  assert.equal(STAFF_AVATAR_PRESETS.length, 21);
  assert.equal(new Set(STAFF_AVATAR_PRESETS).size, 21);
  for (const preset of STAFF_AVATAR_PRESETS) {
    const image = await avatarPresetBuffer(preset);
    assert.ok(image.length > 10_000);
    assert.deepEqual([...image.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
});

test("automatic preset assignment is stable and invalid values are rejected", () => {
  assert.equal(defaultAvatarPreset("same-user"), defaultAvatarPreset("same-user"));
  assert.ok(STAFF_AVATAR_PRESETS.includes(defaultAvatarPreset("same-user")));
  assert.equal(normalizeAvatarPreset("avatar-7"), "avatar-7");
  assert.throws(() => normalizeAvatarPreset("../../secret", { required: true }), /valid professional avatar/i);
});

test("the sidebar shows every signed-in staff member's avatar, including admins", async () => {
  const [sidebar, controller] = await Promise.all([
    readFile(new URL("../../frontend/src/components/layout/Sidebar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/internalChatController.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(sidebar, /AdminWorkspaceAvatar/);
  assert.match(sidebar, /<StaffAvatar[\s\S]*user=\{appUser\}/);
  assert.match(controller, /role: \{ in: \["admin", "consultant", "frontdesk"\] \}/);
});
