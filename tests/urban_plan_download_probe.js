import path from "node:path";
import {
  resolveUrbanPlan
} from "../src/urban_plan_service.js";

import {
  getNoticeDetail
} from "../src/notice_parser.js";

import {
  storeAllAttachments
} from "../src/attachment_store.js";

import {
  analyzeTextApplicability,
  buildSourcePackage
} from "../src/source_applicability.js";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = [...argv];

  const options = {
    pnu: "",
    jibun: "",
    noticeCode: "",
    noticeNo: "",
    noticeIndex: null,
    disableOcr: false,
    ocrMaxPages: 24,
    ocrScale: 2.5
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--pnu") {
      options.pnu = args.shift() ?? "";
      continue;
    }

    if (token === "--jibun") {
      options.jibun = args.shift() ?? "";
      continue;
    }

    if (token === "--notice-code") {
      options.noticeCode = args.shift() ?? "";
      continue;
    }

    if (token === "--notice-no") {
      options.noticeNo = args.shift() ?? "";
      continue;
    }

    if (token === "--notice-index") {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 0) {
        fail("--notice-index must be an integer >= 0.");
      }
      options.noticeIndex = value;
      continue;
    }

    if (token === "--disable-ocr") {
      options.disableOcr = true;
      continue;
    }

    if (token === "--ocr-max-pages") {
      const value = Number(args.shift());
      if (!Number.isInteger(value) || value < 1) {
        fail("--ocr-max-pages must be an integer >= 1.");
      }
      options.ocrMaxPages = value;
      continue;
    }

    if (token === "--ocr-scale") {
      const value = Number(args.shift());
      if (!Number.isFinite(value) || value <= 0) {
        fail("--ocr-scale must be > 0.");
      }
      options.ocrScale = value;
      continue;
    }

    if (token === "--help" || token === "-h") {
      console.log(`
Usage:
  node tests\\urban_plan_download_probe.js --pnu <19-digit-PNU> --jibun "<target jibun>" [selector]

Selectors:
  --notice-code <exact notice code>
  --notice-no <exact notice number>
  --notice-index <zero-based index from resolved notice list>

Without a selector, the probe stops after printing the PNU's resolved notice list.
`);
      process.exit(0);
    }

    fail(`Unknown argument: ${token}`);
  }

  if (!/^\d{19}$/.test(options.pnu)) {
    fail("--pnu must be exactly 19 digits.");
  }

  if (!options.jibun) {
    fail("--jibun is required.");
  }

  return options;
}

function selectNotice(notices, options) {
  if (options.noticeCode) {
    return notices.find(
      (notice) => notice.notice_code === options.noticeCode
    ) ?? null;
  }

  if (options.noticeNo) {
    return notices.find(
      (notice) => notice.notice_no === options.noticeNo
    ) ?? null;
  }

  if (options.noticeIndex !== null) {
    return notices[options.noticeIndex] ?? null;
  }

  return null;
}

function printNoticeList(notices) {
  console.log("");
  console.log("=== RESOLVED NOTICE LIST ===");

  if (!notices.length) {
    console.log("(none)");
    return;
  }

  notices.forEach((notice, index) => {
    console.log(
      `[${index}] ${notice.notice_date || ""} | ${notice.notice_no || ""} | ${notice.notice_code || ""}`
    );
    console.log(
      `    ${notice.title || ""}`
    );
    console.log(
      `    organ=${notice.organ_nm || ""} | ucode=${notice.ucode_nm || ""}`
    );
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log("==============================================================================");
  console.log("Urban Plan end-to-end source download/evidence probe");
  console.log("==============================================================================");
  console.log(`PNU   : ${options.pnu}`);
  console.log(`jibun : ${options.jibun}`);
  console.log("download root: configured downloads/ path");

  console.log("");
  console.log("=== 1. RESOLVE PNU ===");

  const resolved = await resolveUrbanPlan({
    pnu: options.pnu
  });

  console.log(`noticeCount: ${resolved.noticeCount}`);
  printNoticeList(resolved.notices);

  if (!options.noticeCode && !options.noticeNo && options.noticeIndex === null) {
    console.log("");
    console.log("STOP: notice selector is required for download/evidence stage.");
    console.log("Use one of --notice-code, --notice-no, or --notice-index.");
    return;
  }

  const selectedNotice = selectNotice(resolved.notices, options);

  if (!selectedNotice) {
    fail("Selected notice was not found in the PNU-resolved notice list.");
  }

  console.log("");
  console.log("=== 2. SELECT NOTICE ===");
  console.log(JSON.stringify({
    notice_code: selectedNotice.notice_code,
    notice_no: selectedNotice.notice_no,
    notice_date: selectedNotice.notice_date,
    organ_nm: selectedNotice.organ_nm,
    title: selectedNotice.title
  }, null, 2));

  console.log("");
  console.log("=== 3. GET EUM NOTICE DETAIL ===");

  const detail = await getNoticeDetail(selectedNotice);

  console.log(`detail seqs resolved: ${detail.details?.length ?? 0}`);
  console.log(`attachment candidates: ${detail.attachments?.length ?? 0}`);

  if (!detail.attachments?.length) {
    fail("No attachment candidates were found in the EUM notice detail.");
  }

  console.log("");
  console.log("=== 4. DOWNLOAD ORIGINAL ATTACHMENTS ===");

  const attachments = await storeAllAttachments(
    selectedNotice.notice_code,
    detail.attachments
  );

  for (const attachment of attachments) {
    console.log(
      JSON.stringify({
        displayName: attachment.displayName,
        kind: attachment.kind,
        filePath: attachment.filePath,
        downloaded: attachment.downloaded,
        cached: attachment.cached,
        bytes: attachment.bytes,
        actualType: attachment.actualType
      }, null, 2)
    );
  }

  console.log("");
  console.log("=== 5. PARCEL SOURCE EVIDENCE ===");

  const firstFilePath = attachments.find(
    (attachment) => attachment.filePath
  )?.filePath ?? "";

  const noticeDir = firstFilePath
    ? path.dirname(firstFilePath)
    : "";

  const applicability = await analyzeTextApplicability({
    pnu: options.pnu,
    jibun: options.jibun,
    notice: detail.notice,
    attachments,
    noticeDir,
    enableOcrFallback: !options.disableOcr,
    ocrMaxPages: options.ocrMaxPages,
    ocrScale: options.ocrScale
  });

  console.log(`status                 : ${applicability.status}`);
  console.log(`matchCount             : ${applicability.matchCount}`);
  console.log(`parcelNumberCandidates : ${applicability.parcelNumberCandidateCount}`);
  console.log(
    `ocr attempted          : ${applicability.ocrSummary.attempted}`
  );
  console.log(
    `ocr skipped            : ${applicability.ocrSummary.skipped}`
  );

  if (applicability.matchedSources?.length) {
    console.log("");
    console.log("MATCHED SOURCES");
    for (const source of applicability.matchedSources) {
      console.log(JSON.stringify({
        filePath: source.filePath,
        fileType: source.fileType,
        role: source.role,
        matchMethod: source.matchMethod ?? null,
        matchedVariants: source.matchedVariants ?? [],
        matchedPages: source.matchedPages ?? [],
        snippet: source.snippet ?? ""
      }, null, 2));
    }
  }

  console.log("");
  console.log("=== 6. SOURCE PACKAGE ===");

  const sourcePackage = buildSourcePackage({
    noticeCode: selectedNotice.notice_code,
    attachments
  });

  console.log(JSON.stringify({
    noticeCode: sourcePackage.noticeCode,
    preservedOriginalCount: sourcePackage.preservedOriginalCount,
    files: sourcePackage.files
  }, null, 2));

  console.log("");
  console.log("==============================================================================");
  console.log("RESULT: PASS - PNU -> notice -> detail -> attachment download -> evidence");
  console.log("==============================================================================");
}

main().catch((error) => {
  console.error("");
  console.error("==============================================================================");
  console.error("RESULT: FAIL");
  console.error(error?.stack || error?.message || String(error));
  console.error("==============================================================================");
  process.exitCode = 1;
});
