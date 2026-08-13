import imm1294 from "./imm1294";
import imm5257 from "./imm5257";
import imm1295 from "./imm1295";
import imm0008 from "./imm0008";
import imm1344 from "./imm1344";
import imm5532 from "./imm5532";
import imm5476 from "./imm5476";

const MAPPINGS_BY_FORM_NUMBER = {
  IMM1294: imm1294,
  IMM5257: imm5257,
  IMM1295: imm1295,
  IMM0008: imm0008,
  IMM1344: imm1344,
  IMM5532: imm5532,
  IMM5476: imm5476,
};

// A form with no entry here simply gets no readiness/autofill — the same
// "not yet authored" empty result every form got before IMM 1294 existed.
export function getFormFieldMapping(formNumber) {
  const normalized = String(formNumber || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return MAPPINGS_BY_FORM_NUMBER[normalized] || null;
}
