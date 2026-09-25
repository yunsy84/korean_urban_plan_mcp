import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

import {
  buildSourcePackage,
  analyzeTextApplicability
} from "../src/source_applicability.js";

import {
  analyzeUrbanPlan
} from "../src/urban_plan_service.js";

import {
  extractAttachmentCandidates
} from "../src/notice_parser.js";


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



test("parcel evidence matches spaced and unspaced jibun notation", async () => {
  const dir =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "urban-plan-jibun-"
      )
    );

  const filePath =
    path.join(
      dir,
      "source.txt"
    );

  await fs.writeFile(
    filePath,
    "대상 필지: 수동460-10번지 |33.5|33.5",
    "utf8"
  );

  const result =
    await analyzeTextApplicability({
      pnu:
        "4311111200104600010",
      jibun:
        "수동 460-10",
      notice: {
        notice_code:
          "TEST-NOTICE",
        title:
          "",
        content:
          ""
      },
      attachments: [
        {
          filePath,
          displayName:
            "source.txt",
          kind:
            "text"
        }
      ],
      noticeDir:
        dir,
      enableOcrFallback:
        false
    });

  assert.equal(
    result.status,
    "CONFIRMED_BY_TEXT"
  );

  assert.equal(
    result.matchedSources[0].matchMethod,
    "native_text"
  );

  assert.equal(
    result.matchedSources[0].area.likelyArea,
    "33.5"
  );

  assert.deepEqual(
    result.matchedSources[0].matchedPages,
    []
  );
});

test("source analysis failure is isolated to the failed attachment", async () => {
  const result =
    await analyzeTextApplicability({
      pnu:
        "4311111200104600010",
      jibun:
        "수동 460-10",
      notice: {
        notice_code:
          "TEST-NOTICE",
        title:
          "",
        content:
          ""
      },
      attachments: [
        {
          filePath:
            path.join(
              os.tmpdir(),
              "urban-plan-missing-source-does-not-exist.txt"
            ),
          displayName:
            "missing.txt",
          kind:
            "text"
        }
      ],
      noticeDir:
        os.tmpdir(),
      enableOcrFallback:
        false
    });

  assert.equal(
    result.sources.length,
    1
  );

  assert.equal(
    result.sources[0].status,
    "source_analysis_error"
  );

  assert.equal(
    result.sources[0].matched,
    false
  );
});

test("internal download request metadata is not exposed by JSON serialization", () => {
  const attachments =
    extractAttachmentCandidates(
      '<a href="javascript:download(\'https://www.eum.go.kr/web/FileDownload.do\',\'/20200423/webcommon/mapboard/test.hwp\')">test.hwp</a>',
      "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=48400",
      {
        cookie:
          "JSESSIONID=secret-value"
      }
    );

  assert.equal(
    attachments.length,
    1
  );

  assert.equal(
    attachments[0]._download.headers.Cookie,
    "JSESSIONID=secret-value"
  );

  const serialized =
    JSON.stringify(
      attachments[0]
    );

  assert.equal(
    serialized.includes(
      "secret-value"
    ),
    false
  );

  assert.equal(
    serialized.includes(
      "_download"
    ),
    false
  );

});

test("source package preserves exact attachment download error", () => {
  const errorMessage =
    "Attachment body does not look like the requested binary file.";

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
            errorMessage
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

  assert.equal(
    result.files[0].downloadError,
    errorMessage
  );
});

async function findPythonExecutable() {
  for (const executable of ["python", "py"]) {
    try {
      await execFileAsync(
        executable,
        ["--version"],
        {
          windowsHide: true,
          timeout: 5000
        }
      );
      return executable;
    } catch {
      // try next
    }
  }

  return null;
}

test("HWPX source is extracted through the production applicability path", async (t) => {
  const pythonExecutable = await findPythonExecutable();

  if (!pythonExecutable) {
    t.skip("Python is required by the production HWPX extractor.");
    return;
  }

  const dir =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        "urban-plan-hwpx-"
      )
    );

  const filePath =
    path.join(
      dir,
      "source.hwpx"
    );

  const pythonScript = [
    "import sys",
    "import zipfile",
    "from xml.sax.saxutils import escape",
    "p = sys.argv[1]",
    "xml = '<root><p><t>' + escape('수동460-10번지') + '</t></p></root>'",
    "with zipfile.ZipFile(p, 'w', compression=zipfile.ZIP_STORED) as z:",
    "    z.writestr('[Content_Types].xml', '<Types/>')",
    "    z.writestr('Contents/section0.xml', xml)"
  ].join("\n");

  await execFileAsync(
    pythonExecutable,
    ["-c", pythonScript, filePath],
    {
      windowsHide: true,
      timeout: 10000
    }
  );

  const result =
    await analyzeTextApplicability({
      pnu:
        "4311111200104600010",
      jibun:
        "수동 460-10",
      notice: {
        notice_code:
          "TEST-HWPX",
        title:
          "",
        content:
          ""
      },
      attachments: [
        {
          filePath,
          displayName:
            "source.hwpx",
          kind:
            "hwpx"
        }
      ],
      noticeDir:
        dir,
      enableOcrFallback:
        false
    });

  assert.equal(
    result.status,
    "CONFIRMED_BY_TEXT"
  );

  assert.equal(
    result.matchedSources[0].fileType,
    "hwpx"
  );

  assert.equal(
    result.matchedSources[0].matchMethod,
    "native_text"
  );
});
