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
            "downloads/notice/TEST-NOTICE/001_원자료.pdf",
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
    "downloads/notice/TEST-NOTICE/001_원자료.pdf"
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


test("source package preserves attachment download errors without a file path", () => {
  const result =
    buildSourcePackage({
      noticeCode:
        "TEST-NOTICE",
      attachments: [
        {
          displayName:
            "원자료.hwp",
          kind:
            "hwp",
          url:
            "https://example.invalid/FileDownload.do",
          filePath:
            null,
          downloaded:
            false,
          cached:
            false,
          downloadError:
            "Attachment body does not look like the requested binary file."
        }
      ]
    });

  assert.equal(
    result.preservedOriginalCount,
    0
  );

  assert.equal(
    result.files[0].filePath,
    null
  );
});
