import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSourcePackage
} from "../src/source_applicability.js";

import {
  analyzeUrbanPlan
} from "../src/urban_plan_service.js";

test("source package preserves downloaded attachment metadata", () => {
  const result =
    buildSourcePackage({
      noticeCode:
        "TEST-NOTICE",
      attachments: [
        {
          displayName:
            "원자료.pdf",
          kind:
            "pdf",
          filePath:
            "cache/TEST-NOTICE/001_원자료.pdf",
          bytes:
            1234,
          downloaded:
            true,
          cached:
            false,
          url:
            "https://example.invalid/file.pdf"
        }
      ]
    });

  assert.equal(
    result.noticeCode,
    "TEST-NOTICE"
  );

  assert.equal(
    result.preservedOriginalCount,
    1
  );

  assert.equal(
    result.files[0].displayName,
    "원자료.pdf"
  );

  assert.equal(
    result.files[0].filePath,
    "cache/TEST-NOTICE/001_원자료.pdf"
  );
});

test("PNU/jibun mismatch is rejected before network access", async () => {
  await assert.rejects(
    () =>
      analyzeUrbanPlan({
        pnu:
          "1234567890100123004",
        jibun:
          "123-5",
        noticeCode:
          "TEST-NOTICE",
        download:
          false
      }),
    /PNU\/jibun mismatch/
  );
});

test("analyze_urban_plan requires jibun for parcel evidence", async () => {
  await assert.rejects(
    () =>
      analyzeUrbanPlan({
        pnu:
          "1234567890100123004",
        noticeCode:
          "TEST-NOTICE",
        download:
          false
      }),
    /requires jibun/
  );
});
