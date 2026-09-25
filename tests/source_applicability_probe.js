import path from "node:path";
import { access } from "node:fs/promises";

import {
  analyzeTextApplicability
} from "../src/source_applicability.js";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = [...argv];

  const options = {
    file: "",
    pnu: "",
    jibun: "",
    noticeCode: "",
    disableOcr: false,
    ocrMaxPages: 24,
    ocrScale: 2.5
  };

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--file") {
      options.file = args.shift() ?? "";
      continue;
    }

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

  node tests\\source_applicability_probe.js \
    --file <local source file> \
    --pnu <19-digit PNU> \
    --jibun "<target jibun>" \
    --notice-code <notice code>

Options:

  --disable-ocr
  --ocr-max-pages <n>
  --ocr-scale <n>

Example:

  node tests\\source_applicability_probe.js \
    --file "C:\\AI_BOT_SEO\\korean_urban_plan_mcp\\cache\\notice\\...\\guideline.hwp" \
    --pnu 4413310300111160000 \
    --jibun "백석동 1116" \
    --notice-code 44130NTC202001020001
`);

      process.exit(0);
    }

    fail(`Unknown argument: ${token}`);
  }

  if (!options.file) {
    fail("--file is required.");
  }

  if (!/^\d{19}$/.test(options.pnu)) {
    fail("--pnu must be exactly 19 digits.");
  }

  if (!options.jibun) {
    fail("--jibun is required.");
  }

  if (!options.noticeCode) {
    fail("--notice-code is required.");
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(options.file);

  await access(filePath).catch(() => {
    fail(`Source file not found: ${filePath}`);
  });

  console.log("==============================================================================");
  console.log("source_applicability.js production-path probe");
  console.log("==============================================================================");
  console.log(`PNU          : ${options.pnu}`);
  console.log(`jibun        : ${options.jibun}`);
  console.log(`notice_code  : ${options.noticeCode}`);
  console.log(`source file  : ${filePath}`);
  console.log(`OCR fallback : ${options.disableOcr ? "disabled" : "enabled"}`);
  console.log(`OCR max pages: ${options.ocrMaxPages}`);
  console.log(`OCR scale    : ${options.ocrScale}`);

  const result = await analyzeTextApplicability({
    pnu: options.pnu,
    jibun: options.jibun,
    notice: {
      notice_code: options.noticeCode,
      title: "",
      content: ""
    },
    attachments: [
      {
        filePath,
        displayName: path.basename(filePath),
        kind: path.extname(filePath).slice(1).toLowerCase()
      }
    ],
    noticeDir: path.dirname(filePath),
    enableOcrFallback: !options.disableOcr,
    ocrMaxPages: options.ocrMaxPages,
    ocrScale: options.ocrScale
  });

  console.log("");
  console.log("=== RESULT ===");
  console.log(`status                  : ${result.status}`);
  console.log(`matchCount              : ${result.matchCount}`);
  console.log(`parcelNumberCandidates  : ${result.parcelNumberCandidateCount}`);
  console.log(`ocr attempted           : ${result.ocrSummary.attempted}`);
  console.log(`ocr skipped             : ${result.ocrSummary.skipped}`);

  if (result.ocrSummary.skippedReasons.length > 0) {
    console.log(
      `ocr skipped reasons     : ${result.ocrSummary.skippedReasons.join(", ")}`
    );
  }

  console.log("");
  console.log("=== MATCHED SOURCES ===");

  if (result.matchedSources.length === 0) {
    console.log("(none)");
  } else {
    for (const source of result.matchedSources) {
      console.log("");
      console.log(`file       : ${source.filePath}`);
      console.log(`type       : ${source.fileType}`);
      console.log(`role       : ${source.role}`);
      console.log(`method     : ${source.matchMethod ?? "(none)"}`);
      console.log(`matched    : ${source.matched}`);
      console.log(`variants   : ${(source.matchedVariants ?? []).join(", ") || "(none)"}`);

      if (source.matchedPages?.length) {
        console.log(
          `pages      : ${source.matchedPages.join(", ")}`
        );
      }

      if (source.snippet) {
        console.log("snippet:");
        console.log(source.snippet);
      }
    }
  }

  console.log("");
  console.log("=== SOURCE INVENTORY ===");

  for (const source of result.sources) {
    console.log(
      JSON.stringify(
        {
          fileType: source.fileType,
          role: source.role,
          status: source.status,
          textChars: source.textChars,
          matched: source.matched,
          matchMethod: source.matchMethod ?? null,
          matchedPages: source.matchedPages ?? [],
          parcelNumberMatched: source.parcelNumberMatched ?? false,
          ocrAttempted: source.ocrAttempted ?? false,
          ocrSkipped: source.ocrSkipped ?? false,
          ocrSkippedReason: source.ocrSkippedReason ?? null
        },
        null,
        2
      )
    );
  }

  console.log("");
  console.log("==============================================================================");
  console.log(
    result.matchCount > 0
      ? "RESULT: PARCEL EVIDENCE FOUND"
      : "RESULT: PARCEL EVIDENCE NOT FOUND"
  );
  console.log("==============================================================================");
}

main().catch((error) => {
  console.error("");
  console.error("==============================================================================");
  console.error("RESULT: FAIL");
  console.error(error?.message || String(error));
  console.error("==============================================================================");
  process.exitCode = 1;
});
