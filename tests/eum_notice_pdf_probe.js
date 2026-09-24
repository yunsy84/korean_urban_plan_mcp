import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tests", "output");
const ATTACH_DIR = path.join(OUT_DIR, "attachments");

const DEFAULT_PDF =
  "44130NTC202001020001_1.pdf";

const KEYWORDS = [
  "백석동 1116",
  "백석동1116",
  "1116번지",
  "1116",
  "백석동",
  "천안물류단지",
  "지구단위계획",
  "도시관리계획",
  "결정조서",
  "결정도",
  "변경결정",
  "지형도면",
  "시행지침",
  "용도지역"
];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = argv.slice(2);

  const options = {
    pnu: "",
    noticeCode: "",
    pdfPath: ""
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--pdf") {
      options.pdfPath = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--notice-code") {
      options.noticeCode = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (!arg.startsWith("--") && !options.pnu) {
      options.pnu = arg;
    }
  }

  if (options.pnu && !/^\d{19}$/.test(options.pnu)) {
    fail(
      `PNU must be exactly 19 digits: ${options.pnu}`
    );
  }

  return options;
}

function resolvePdfPath(options) {
  if (options.pdfPath) {
    return path.isAbsolute(options.pdfPath)
      ? options.pdfPath
      : path.resolve(ROOT, options.pdfPath);
  }

  return path.join(
    ATTACH_DIR,
    DEFAULT_PDF
  );
}

async function loadPdfJs() {
  try {
    return await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );
  } catch (error) {
    console.log("");
    console.log(
      "pdfjs-dist is not installed or could not be loaded."
    );
    console.log(
      "Install it in korean_urban_plan_mcp with:"
    );
    console.log("");
    console.log(
      "npm install pdfjs-dist"
    );
    console.log("");
    console.log(
      `Original error: ${error?.message || String(error)}`
    );

    process.exitCode = 2;
    return null;
  }
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function compactText(text) {
  return normalizeText(text)
    .replace(/\s+/g, " ")
    .trim();
}

function makeSnippet(text, index, radius = 120) {
  const compact = compactText(text);

  if (index < 0) {
    return compact.slice(
      0,
      radius * 2
    );
  }

  const start = Math.max(
    0,
    index - radius
  );

  const end = Math.min(
    compact.length,
    index + radius
  );

  let snippet =
    compact.slice(start, end);

  if (start > 0) {
    snippet = `...${snippet}`;
  }

  if (end < compact.length) {
    snippet += "...";
  }

  return snippet;
}

function findKeywordHits(text) {
  const compact = compactText(text);

  const hits = [];

  for (const keyword of KEYWORDS) {
    let start = 0;
    let count = 0;
    const positions = [];

    while (true) {
      const index =
        compact.indexOf(
          keyword,
          start
        );

      if (index < 0) {
        break;
      }

      count += 1;

      positions.push({
        index,
        snippet: makeSnippet(
          compact,
          index
        )
      });

      start =
        index + keyword.length;

      if (positions.length >= 5) {
        break;
      }
    }

    if (count > 0) {
      hits.push({
        keyword,
        count,
        positions
      });
    }
  }

  return hits;
}

function countImageOperators(
  operatorList,
  pdfjsLib
) {
  if (!operatorList) {
    return {
      total: 0,
      imageOperators: 0,
      maskOperators: 0
    };
  }

  const {
    OPS
  } = pdfjsLib;

  let imageOperators = 0;
  let maskOperators = 0;

  for (
    const fn of operatorList.fnArray
  ) {
    if (
      fn === OPS.paintImageMaskXObject
    ) {
      maskOperators += 1;
      continue;
    }

    if (
      fn === OPS.paintImageMaskXObjectRepeat
    ) {
      maskOperators += 1;
      continue;
    }

    if (
      fn === OPS.paintImageXObject
    ) {
      imageOperators += 1;
      continue;
    }

    if (
      fn === OPS.paintInlineImageXObject
    ) {
      imageOperators += 1;
      continue;
    }

    if (
      fn === OPS.paintInlineImageXObjectGroup
    ) {
      imageOperators += 1;
      continue;
    }

    if (
      fn === OPS.paintJpegXObject
    ) {
      imageOperators += 1;
    }
  }

  return {
    total:
      operatorList.fnArray.length,

    imageOperators,

    maskOperators
  };
}

function classifyPage(
  text,
  imageInfo
) {
  const textChars =
    compactText(text).length;

  const imageObjects =
    imageInfo.imageOperators +
    imageInfo.maskOperators;

  if (
    textChars === 0 &&
    imageObjects > 0
  ) {
    return "image_or_scan";
  }

  if (
    textChars > 0 &&
    imageObjects > 0
  ) {
    return "text_plus_image";
  }

  if (
    textChars > 0
  ) {
    return "text";
  }

  return "empty_or_vector";
}

async function main() {
  const options =
    parseArgs(process.argv);

  const pdfPath =
    resolvePdfPath(options);

  console.log(
    "=============================================================================="
  );
  console.log(
    "korean_urban_plan_mcp - EUM PDF content probe v0.1"
  );
  console.log(
    "=============================================================================="
  );

  if (options.pnu) {
    console.log(
      `PNU: ${options.pnu}`
    );
  }

  if (options.noticeCode) {
    console.log(
      `notice_code: ${options.noticeCode}`
    );
  }

  console.log(
    `PDF: ${pdfPath}`
  );

  if (!fs.existsSync(pdfPath)) {
    fail(
      `PDF file not found:\n${pdfPath}`
    );
  }

  const stat =
    fs.statSync(pdfPath);

  if (!stat.isFile()) {
    fail(
      `Not a file:\n${pdfPath}`
    );
  }

  console.log(
    `Size: ${stat.size.toLocaleString()} bytes`
  );

  console.log(
    "\n[1] Load pdfjs-dist"
  );

  const pdfjsLib =
    await loadPdfJs();

  if (!pdfjsLib) {
    return;
  }

  console.log(
    "pdfjs-dist: loaded"
  );

  console.log(
    "\n[2] Read PDF"
  );

  const pdfBuffer =
    fs.readFileSync(pdfPath);

  const loadingTask =
    pdfjsLib.getDocument({
      data: new Uint8Array(
        pdfBuffer
      ),

      disableWorker: true,

      useWorkerFetch: false,

      isEvalSupported: false
    });

  const pdf =
    await loadingTask.promise;

  console.log(
    `PDF version: ${
      pdf.metadata
        ? "(metadata available)"
        : "(metadata unavailable)"
    }`
  );

  console.log(
    `Pages: ${pdf.numPages}`
  );

  let metadata = null;

  try {
    metadata =
      await pdf.getMetadata();
  } catch (error) {
    metadata = {
      error:
        error?.message ||
        String(error)
    };
  }

  const pages = [];

  const keywordPageMap =
    new Map();

  console.log(
    "\n[3] Analyze pages"
  );

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber += 1
  ) {
    const page =
      await pdf.getPage(
        pageNumber
      );

    const textContent =
      await page.getTextContent();

    const textParts = [];

    for (
      const item
      of textContent.items
    ) {
      if (
        typeof item.str !==
        "string"
      ) {
        continue;
      }

      if (
        item.str.length === 0
      ) {
        continue;
      }

      textParts.push(
        item.str
      );

      if (
        item.hasEOL
      ) {
        textParts.push(
          "\n"
        );
      } else {
        textParts.push(
          " "
        );
      }
    }

    const rawText =
      textParts.join("");

    const text =
      normalizeText(rawText);

    let operatorInfo;

    try {
      const operatorList =
        await page.getOperatorList();

      operatorInfo =
        countImageOperators(
          operatorList,
          pdfjsLib
        );
    } catch (error) {
      operatorInfo = {
        total: null,
        imageOperators: null,
        maskOperators: null,
        error:
          error?.message ||
          String(error)
      };
    }

    const classification =
      classifyPage(
        text,
        operatorInfo
      );

    const keywordHits =
      findKeywordHits(text);

    for (
      const hit
      of keywordHits
    ) {
      if (
        !keywordPageMap.has(
          hit.keyword
        )
      ) {
        keywordPageMap.set(
          hit.keyword,
          []
        );
      }

      keywordPageMap
        .get(hit.keyword)
        .push(
          pageNumber
        );
    }

    const pageResult = {
      page: pageNumber,

      textChars:
        compactText(text).length,

      rawTextChars:
        rawText.length,

      classification,

      imageOperators:
        operatorInfo.imageOperators,

      maskOperators:
        operatorInfo.maskOperators,

      totalOperators:
        operatorInfo.total,

      keywordHits,

      text
    };

    pages.push(
      pageResult
    );

    console.log(
      `Page ${String(pageNumber).padStart(3, " ")}` +
      ` | text=${String(pageResult.textChars).padStart(6, " ")}` +
      ` | images=${String(
        (pageResult.imageOperators ?? 0) +
        (pageResult.maskOperators ?? 0)
      ).padStart(3, " ")}` +
      ` | ${classification}`
    );
  }

  console.log(
    "\n[4] Keyword results"
  );

  const keywordResults = {};

  for (
    const keyword of KEYWORDS
  ) {
    const matchingPages =
      keywordPageMap.get(
        keyword
      ) || [];

    keywordResults[keyword] = {
      found:
        matchingPages.length > 0,

      pages:
        matchingPages
    };

    console.log(
      `${keyword.padEnd(16, " ")}` +
      ` : ${
        matchingPages.length > 0
          ? `FOUND page ${matchingPages.join(", ")}`
          : "NOT FOUND"
      }`
    );
  }

  console.log(
    "\n[5] Relevant page excerpts"
  );

  const relevantPages =
    pages.filter(
      (page) =>
        page.keywordHits.length > 0
    );

  if (!relevantPages.length) {
    console.log(
      "No keyword-matching text pages."
    );
  } else {
    for (
      const page
      of relevantPages
    ) {
      console.log(
        "\n------------------------------------------------------------"
      );

      console.log(
        `PAGE ${page.page}`
      );

      console.log(
        `classification: ${
          page.classification
        }`
      );

      console.log(
        `text chars: ${
          page.textChars
        }`
      );

      console.log(
        `images: ${
          (page.imageOperators ?? 0) +
          (page.maskOperators ?? 0)
        }`
      );

      for (
        const hit
        of page.keywordHits
      ) {
        console.log(
          `\nKEYWORD: ${hit.keyword}`
        );

        for (
          const position
          of hit.positions
        ) {
          console.log(
            position.snippet
          );
        }
      }
    }
  }

  console.log(
    "\n[6] Image / scan candidate pages"
  );

  const imagePages =
    pages.filter(
      (page) =>
        page.classification ===
          "image_or_scan" ||
        page.classification ===
          "text_plus_image"
    );

  if (!imagePages.length) {
    console.log(
      "No image-containing pages detected by PDF operator analysis."
    );
  } else {
    for (
      const page
      of imagePages
    ) {
      console.log(
        `Page ${
          page.page
        } | classification=${
          page.classification
        } | images=${
          (page.imageOperators ?? 0) +
          (page.maskOperators ?? 0)
        } | text=${
          page.textChars
        }`
      );
    }
  }

  const result = {
    probeVersion: "0.1",

    analyzedAt:
      new Date().toISOString(),

    pnu:
      options.pnu || null,

    noticeCode:
      options.noticeCode || null,

    pdfPath,

    fileSize:
      stat.size,

    pdfPages:
      pdf.numPages,

    metadata,

    keywordResults,

    pageSummary:
      pages.map(
        (page) => ({
          page: page.page,
          textChars:
            page.textChars,
          classification:
            page.classification,
          imageOperators:
            page.imageOperators,
          maskOperators:
            page.maskOperators,
          totalOperators:
            page.totalOperators,
          keywordHits:
            page.keywordHits.map(
              (hit) =>
                hit.keyword
            )
        })
      ),

    relevantPages:
      relevantPages.map(
        (page) => ({
          page:
            page.page,
          classification:
            page.classification,
          textChars:
            page.textChars,
          imageOperators:
            page.imageOperators,
          maskOperators:
            page.maskOperators,
          keywordHits:
            page.keywordHits,
          text:
            page.text
        })
      ),

    imagePages:
      imagePages.map(
        (page) => ({
          page:
            page.page,
          classification:
            page.classification,
          textChars:
            page.textChars,
          imageOperators:
            page.imageOperators,
          maskOperators:
            page.maskOperators
        })
      )
  };

  const baseName =
    options.noticeCode
      ? `eum_notice_pdf_${options.pnu || "unknown"}_${options.noticeCode}`
      : `eum_notice_pdf_${options.pnu || "unknown"}`;

  const jsonPath =
    path.join(
      OUT_DIR,
      `${baseName}.json`
    );

  const textPath =
    path.join(
      OUT_DIR,
      `${baseName}_relevant_pages.txt`
    );

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      result,
      null,
      2
    ),
    "utf8"
  );

  const textParts = [];

  for (
    const page
    of relevantPages
  ) {
    textParts.push(
      `============================================================`
    );

    textParts.push(
      `PAGE ${page.page}`
    );

    textParts.push(
      `classification: ${page.classification}`
    );

    textParts.push(
      `textChars: ${page.textChars}`
    );

    textParts.push(
      `images: ${
        (page.imageOperators ?? 0) +
        (page.maskOperators ?? 0)
      }`
    );

    textParts.push(
      ""
    );

    textParts.push(
      page.text
    );

    textParts.push(
      ""
    );
  }

  fs.writeFileSync(
    textPath,
    textParts.join("\n"),
    "utf8"
  );

  console.log(
    "\n[7] Saved"
  );

  console.log(
    jsonPath
  );

  console.log(
    textPath
  );

  console.log(
    "\n=============================================================================="
  );
  console.log(
    "RESULT: PASS"
  );
  console.log(
    "=============================================================================="
  );
}

main().catch(
  (error) => {
    console.log(
      "\n=============================================================================="
    );

    console.log(
      "RESULT: FAIL"
    );

    console.log(
      `${error?.name || "Error"}: ` +
      `${error?.message || String(error)}`
    );

    console.log(
      "=============================================================================="
    );

    process.exitCode = 1;
  }
);