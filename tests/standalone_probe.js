import { analyzeTextApplicability, buildSourcePackage } from "../src/source_applicability.js";
import { extractAttachmentCandidates } from "../src/notice_parser.js";
import { resolveUrbanPlan } from "../src/urban_plan_service.js";

async function main() {
  const sourceModule =
    await import("../src/source_applicability.js");

  const parserModule =
    await import("../src/notice_parser.js");

  const serviceModule =
    await import("../src/urban_plan_service.js");

  console.log("==============================================================================");
  console.log("korean_urban_plan_mcp - current module connection probe");
  console.log("==============================================================================");

  console.log("");
  console.log("SOURCE MODULE");
  console.log(
    JSON.stringify(
      {
        analyzeTextApplicability:
          typeof sourceModule.analyzeTextApplicability === "function",
        buildSourcePackage:
          typeof sourceModule.buildSourcePackage === "function"
      },
      null,
      2
    )
  );

  console.log("");
  console.log("NOTICE PARSER MODULE");
  console.log(
    JSON.stringify(
      {
        extractAttachmentCandidates:
          typeof parserModule.extractAttachmentCandidates === "function"
      },
      null,
      2
    )
  );

  console.log("");
  console.log("SERVICE MODULE");
  console.log(
    JSON.stringify(
      {
        resolveUrbanPlan:
          typeof serviceModule.resolveUrbanPlan === "function"
      },
      null,
      2
    )
  );

  const attachments =
    extractAttachmentCandidates(
      `<a href="javascript:download('https://www.eum.go.kr/web/FileDownload.do','/test.hwp')">test.hwp</a>`,
      "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp?seq=1"
    );

  console.log("");
  console.log("PARSER -> DOWNLOAD METADATA");
  console.log(
    JSON.stringify(
      {
        candidateCount:
          attachments.length,
        hasInternalDownloadMetadata:
          Boolean(
            attachments[0]?._download
          ),
        serialized:
          JSON.stringify(
            attachments[0] ?? null
          )
      },
      null,
      2
    )
  );

  const packageResult =
    buildSourcePackage({
      noticeCode:
        "PROBE",
      attachments: [
        {
          displayName:
            "probe.hwp",
          kind:
            "hwp",
          filePath:
            null,
          downloaded:
            false,
          cached:
            false,
          downloadError:
            "probe-error"
        }
      ]
    });

  console.log("");
  console.log("SOURCE PACKAGE");
  console.log(
    JSON.stringify(
      packageResult,
      null,
      2
    )
  );

  console.log("");
  console.log("NETWORK");
  console.log(
    "No EUM network request is made by this probe."
  );
  console.log(
    "For actual PNU -> EUM connectivity use the dedicated EUM probes."
  );

  void analyzeTextApplicability;
  void resolveUrbanPlan;
}

main().catch((error) => {
  console.error("RESULT: FAIL");
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
