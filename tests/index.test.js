import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKey, normalizeValue, firstField, normalizeRecord } from "../src/field_matcher.js";

test("field matching is whitespace/case tolerant", () => {
  assert.equal(normalizeKey(" 지구단위_계획구역 "), "지구단위계획구역");
  assert.equal(normalizeValue("  ABC  123 "), "ABC123");
  assert.equal(firstField({ "고시번호 ": "123-4" }, ["고시번호"]), "123-4");
});

test("generic row normalization does not hardcode a locality", () => {
  const r = normalizeRecord({ PNU: "1234567890123456789", 구역명: "TEST-PLAN", 고시번호: "TEST-1" }, {
    pnu: ["PNU"], planName: ["구역명"], noticeNo: ["고시번호"]
  });
  assert.equal(r.pnu, "1234567890123456789");
  assert.equal(r.planName, "TEST-PLAN");
  assert.equal(r.noticeNo, "TEST-1");
});
