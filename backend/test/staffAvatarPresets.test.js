import assert from "node:assert/strict";
import test from "node:test";
import { avatarPresetBuffer, defaultAvatarPreset, normalizeAvatarPreset, STAFF_AVATAR_PRESETS } from "../src/services/staffAvatarPresetService.js";

test("the professional avatar library contains twelve bundled presets", async () => {
  assert.equal(STAFF_AVATAR_PRESETS.length, 12);
  assert.equal(new Set(STAFF_AVATAR_PRESETS).size, 12);
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
