import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const OCR_DIR = path.join(
  ROOT,
  "tests",
  "output",
  "pdf_ocr"
);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = argv.slice(2);

  const options = {
    pnu: "",
    noticeCode: "",
    jibun: "",
    ocrJson: ""
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--notice-code") {
      options.noticeCode =
        args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--jibun") {
      options.jibun =
        args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--ocr-json") {
      options.ocrJson =
        args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (
      !arg.startsWith("--") &&
      !options.pnu
    ) {
      options.pnu = arg;
    }
  }

  if (
    !options.pnu ||
    !/^\d{19}$/.test(options.pnu)
  ) {
    fail(
      "PNU must be exactly 19 digits."
    );
  }

  if (!options.noticeCode) {
    fail(
      "--notice-code is required."
    );
  }

  if (!options.jibun) {
    fail(
      '--jibun is required. Example: --jibun "백석동 1116번지"'
    );
  }

  return options;
}

function resolveOcrJson(options) {
  if (options.ocrJson) {
    return path.isAbsolute(
      options.ocrJson
    )
      ? options.ocrJson
      : path.resolve(
          ROOT,
          options.ocrJson
        );
  }

  return path.join(
    OCR_DIR,
    `eum_notice_pdf_ocr_${options.pnu}_${options.noticeCode}.json`
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch (error) {
    fail(
      `Failed to read JSON:\n${filePath}\n\n${
        error?.message ||
        String(error)
      }`
    );
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function compact(value) {
  return normalizeText(value)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForMatch(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(
      /[|｜,，:：.;·ㆍ"'"“”‘’()[\]{}<>《》「」『』\/\\_-]/g,
      ""
    )
    .toLowerCase();
}

function pageText(page) {
  return compact(
    page?.text || ""
  );
}

function makeJibunVariants(jibun) {
  const source =
    compact(jibun);

  const variants =
    new Set();

  if (source) {
    variants.add(source);
    variants.add(
      normalizeForMatch(
        source
      )
    );
  }

  const numberMatch =
    /(\d+(?:-\d+)?)\s*(?:번지)?$/u.exec(
      source
    );

  if (numberMatch) {
    const number =
      numberMatch[1];

    const prefix =
      source
        .slice(
          0,
          numberMatch.index
        )
        .trim();

    if (prefix) {
      variants.add(
        `${prefix} ${number}번지`
      );

      variants.add(
        `${prefix}${number}번지`
      );

      variants.add(
        `${prefix} ${number}`
      );

      variants.add(
        `${prefix}${number}`
      );
    }
  }

  return [
    ...variants
  ].filter(Boolean);
}

function makeContextAroundJibun(
  text,
  jibun,
  before = 220,
  after = 320
) {
  const source =
    compact(text);

  const normalizedSource =
    normalizeForMatch(
      source
    );

  const normalizedTarget =
    normalizeForMatch(
      jibun
    );

  const index =
    normalizedSource.indexOf(
      normalizedTarget
    );

  if (index < 0) {
    return null;
  }

  /*
   * 정규화 전 문자열에서
   * 대상 숫자 위치를 근사적으로 찾는다.
   */
  let normalizedCount = 0;
  let originalIndex = 0;

  for (
    let i = 0;
    i < source.length;
    i += 1
  ) {
    normalizedCount +=
      normalizeForMatch(
        source[i]
      ).length;

    if (
      normalizedCount >
      index
    ) {
      originalIndex = i;
      break;
    }

    originalIndex = i;
  }

  const start =
    Math.max(
      0,
      originalIndex - before
    );

  const end =
    Math.min(
      source.length,
      originalIndex +
        jibun.length +
        after
    );

  let snippet =
    source.slice(
      start,
      end
    );

  if (start > 0) {
    snippet =
      `...${snippet}`;
  }

  if (
    end <
    source.length
  ) {
    snippet +=
      "...";
  }

  return {
    matchedText:
      jibun,

    snippet
  };
}

function findParcelEvidence(
  pages,
  variants
) {
  const evidence = [];

  for (
    const page of pages
  ) {
    const text =
      pageText(page);

    if (!text) {
      continue;
    }

    for (
      const variant of variants
    ) {
      const context =
        makeContextAroundJibun(
          text,
          variant
        );

      if (!context) {
        continue;
      }

      evidence.push({
        page:
          page.page,

        variant,

        snippet:
          context.snippet
      });

      break;
    }
  }

  return evidence;
}

function extractAreaFromParcelSnippet(
  snippet,
  jibun
) {
  if (!snippet) {
    return {
      values: [],
      likelyArea: null,
      raw: null
    };
  }

  const source =
    compact(snippet);

  const normalizedSource =
    normalizeForMatch(
      source
    );

  const normalizedTarget =
    normalizeForMatch(
      jibun
    );

  const normalizedIndex =
    normalizedSource.indexOf(
      normalizedTarget
    );

  let localSource =
    source;

  if (
    normalizedIndex >= 0
  ) {
    let count = 0;
    let originalIndex = 0;

    for (
      let i = 0;
      i < source.length;
      i += 1
    ) {
      count +=
        normalizeForMatch(
          source[i]
        ).length;

      if (
        count >
        normalizedIndex
      ) {
        originalIndex = i;
        break;
      }

      originalIndex = i;
    }

    localSource =
      source.slice(
        originalIndex
      );
  }

  /*
   * OCR 표:
   * 백석동 1116번지 |16,028.5|16,028.5
   */
  const match =
    localSource.match(
      /(?:\||｜|\s)+(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+)\s*(?:\||｜)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+)/
    );

  if (!match) {
    return {
      values: [],
      likelyArea: null,
      raw: null
    };
  }

  const values = [
    match[1],
    match[2]
  ];

  let likelyArea =
    null;

  if (
    match[1] ===
    match[2]
  ) {
    likelyArea =
      match[1];
  } else {
    likelyArea =
      match[1];
  }

  return {
    values,
    likelyArea,
    raw:
      match[0]
  };
}

function hasNormalized(
  text,
  pattern
) {
  return normalizeForMatch(
    text
  ).includes(
    normalizeForMatch(
      pattern
    )
  );
}

/*
 * ------------------------------------------------------------
 * 시행지침
 * ------------------------------------------------------------
 */

function isGuidelineStartPage(
  text
) {
  const normalized =
    normalizeForMatch(
      text
    );

  /*
   * "지구단위계획 시행지침"
   * OCR이 괄호/공백을 넣어도
   * normalize 후 동일해진다.
   */
  return (
    normalized.includes(
      "지구단위계획시행지침"
    ) &&
    (
      normalized.includes(
        "변경"
      ) ||
      normalized.includes(
        "5."
      ) ||
      normalized.includes(
        "제6조"
      )
    )
  );
}

function findGuidelineStart(
  pages
) {
  for (
    const page of pages
  ) {
    if (
      isGuidelineStartPage(
        pageText(page)
      )
    ) {
      return page.page;
    }
  }

  return null;
}

/*
 * ------------------------------------------------------------
 * 결정도
 * ------------------------------------------------------------
 *
 * 핵심:
 *
 * 페이지 20:
 * 도시관리계획결정(기정)도
 *
 * 페이지 21:
 * 도시관리계획결정(변경)도
 *
 * 페이지 22/23:
 * 결정(기정)도 / 결정(변경)도
 *
 * OCR에서 괄호가 깨져도
 * "도시관리계획 + 결정 + 도" 계열을
 * 판정한다.
 */

function isDecisionDrawingPage(
  text
) {
  const normalized =
    normalizeForMatch(
      text
    );

  const hasUrbanPlan =
    normalized.includes(
      "도시관리계획"
    );

  const hasDecisionWord =
    normalized.includes(
      "결정"
    );

  const hasDrawingSuffix =
    normalized.includes(
      "결정도"
    ) ||
    normalized.includes(
      "기정도"
    ) ||
    normalized.includes(
      "변경도"
    ) ||
    normalized.includes(
      "결정기정도"
    ) ||
    normalized.includes(
      "결정변경도"
    );

  const hasMapContext =
    normalized.includes(
      "지구단위계획"
    ) ||
    normalized.includes(
      "가구및획지"
    ) ||
    normalized.includes(
      "도면"
    );

  /*
   * 결정도는 반드시 도시관리계획과
   * 결정도 계열을 함께 가져야 한다.
   *
   * 따라서 일반적인
   * "도시관리계획 결정조서" 페이지는
   * 여기 걸리지 않는다.
   */
  return (
    hasUrbanPlan &&
    hasDecisionWord &&
    hasDrawingSuffix &&
    hasMapContext &&
    !normalized.includes(
      "지형도면고시도"
    )
  );
}

function findDecisionPages(
  pages
) {
  return pages
    .filter(
      (page) =>
        isDecisionDrawingPage(
          pageText(page)
        )
    )
    .map(
      (page) =>
        page.page
    );
}

/*
 * ------------------------------------------------------------
 * 지형도면
 * ------------------------------------------------------------
 *
 * "지형도면" 하나만 검사하지 않는다.
 *
 * 고시 본문 1페이지에도
 * "지형도면 고시"가 나오므로
 * 반드시 "지형도면고시도" 계열을
 * 확인한다.
 */

function isTerrainMapPage(
  text
) {
  const normalized =
    normalizeForMatch(
      text
    );

  return (
    normalized.includes(
      "지형도면고시도"
    ) ||
    normalized.includes(
      "지형도면고시도"
    )
  );
}

function findTerrainPages(
  pages
) {
  return pages
    .filter(
      (page) =>
        isTerrainMapPage(
          pageText(page)
        )
    )
    .map(
      (page) =>
        page.page
    );
}

/*
 * ------------------------------------------------------------
 * 연속 구간
 * ------------------------------------------------------------
 */

function makeContinuousRange(
  firstPage,
  lastPage
) {
  if (
    firstPage === null ||
    lastPage === null ||
    firstPage > lastPage
  ) {
    return [];
  }

  const result = [];

  for (
    let page =
      firstPage;
    page <= lastPage;
    page += 1
  ) {
    result.push(
      page
    );
  }

  return result;
}

function buildGuidelineRange(
  guidelineStart,
  decisionPages,
  totalPages
) {
  if (
    guidelineStart === null
  ) {
    return [];
  }

  let end =
    totalPages;

  if (
    decisionPages.length > 0
  ) {
    const decisionStart =
      Math.min(
        ...decisionPages
      );

    end =
      decisionStart - 1;
  }

  return makeContinuousRange(
    guidelineStart,
    end
  );
}

function buildDecisionRange(
  decisionPages,
  terrainPages,
  totalPages
) {
  if (
    decisionPages.length === 0
  ) {
    return [];
  }

  const start =
    Math.min(
      ...decisionPages
    );

  /*
   * 지형도면 시작 전까지를
   * 결정도 구간으로 본다.
   *
   * 따라서 OCR이 중간의 특정 결정도
   * 제목을 놓쳐도 빠지지 않는다.
   */
  let end =
    totalPages;

  if (
    terrainPages.length > 0
  ) {
    const terrainStart =
      Math.min(
        ...terrainPages
      );

    if (
      terrainStart >
      start
    ) {
      end =
        terrainStart - 1;
    }
  }

  return makeContinuousRange(
    start,
    end
  );
}

function buildTerrainRange(
  terrainPages
) {
  if (
    terrainPages.length === 0
  ) {
    return [];
  }

  return makeContinuousRange(
    Math.min(
      ...terrainPages
    ),
    Math.max(
      ...terrainPages
    )
  );
}

function getPages(
  pages,
  pageNumbers
) {
  const pageSet =
    new Set(
      pageNumbers
    );

  return pages
    .filter(
      (page) =>
        pageSet.has(
          page.page
        )
    )
    .map(
      (page) => ({
        page:
          page.page,

        textPreview:
          pageText(page).slice(
            0,
            500
          ),

        textChars:
          String(
            page.text || ""
          ).length
      })
    );
}

async function main() {
  const options =
    parseArgs(
      process.argv
    );

  console.log(
    "=============================================================================="
  );

  console.log(
    "korean_urban_plan_mcp - Urban Plan evidence extractor v0.3"
  );

  console.log(
    "=============================================================================="
  );

  console.log(
    `PNU: ${options.pnu}`
  );

  console.log(
    `notice_code: ${options.noticeCode}`
  );

  console.log(
    `target jibun: ${options.jibun}`
  );

  const ocrJsonPath =
    resolveOcrJson(
      options
    );

  console.log(
    `OCR JSON: ${ocrJsonPath}`
  );

  if (
    !fs.existsSync(
      ocrJsonPath
    )
  ) {
    fail(
      `OCR JSON not found:\n${ocrJsonPath}`
    );
  }

  console.log(
    "\n[1] Load OCR result"
  );

  const ocr =
    readJson(
      ocrJsonPath
    );

  if (
    !Array.isArray(
      ocr.pages
    )
  ) {
    fail(
      "OCR JSON does not contain pages."
    );
  }

  const pages =
    ocr.pages
      .map(
        (page) => ({
          ...page,
          text:
            page.text || ""
        })
      )
      .sort(
        (a, b) =>
          a.page -
          b.page
      );

  const totalPages =
    pages.length;

  console.log(
    `Pages in OCR JSON: ${totalPages}`
  );

  const variants =
    makeJibunVariants(
      options.jibun
    );

  console.log(
    "\nTarget jibun variants:"
  );

  for (
    const variant of variants
  ) {
    console.log(
      `  ${variant}`
    );
  }

  /*
   * ----------------------------------------------------------
   * Parcel
   * ----------------------------------------------------------
   */

  console.log(
    "\n[2] Find exact parcel evidence"
  );

  const parcelEvidence =
    findParcelEvidence(
      pages,
      variants
    );

  const parcelPages =
    [
      ...new Set(
        parcelEvidence.map(
          (item) =>
            item.page
        )
      )
    ].sort(
      (a, b) =>
        a - b
    );

  console.log(
    `Parcel evidence pages: ${
      parcelPages.join(
        ", "
      ) || "(none)"
    }`
  );

  const primaryParcel =
    parcelEvidence[0] ||
    null;

  let parcelArea = {
    values: [],
    likelyArea: null,
    raw: null
  };

  if (
    primaryParcel
  ) {
    parcelArea =
      extractAreaFromParcelSnippet(
        primaryParcel.snippet,
        options.jibun
      );

    console.log(
      "\n------------------------------------------------------------"
    );

    console.log(
      `PAGE ${primaryParcel.page}`
    );

    console.log(
      `matched variant: ${primaryParcel.variant}`
    );

    console.log(
      `area values: ${
        parcelArea.values.join(
          ", "
        ) || "(none)"
      }`
    );

    console.log(
      `likely area: ${
        parcelArea.likelyArea ||
        "(none)"
      }`
    );

    console.log(
      "Parcel context:"
    );

    console.log(
      primaryParcel.snippet
    );
  }

  /*
   * ----------------------------------------------------------
   * Sections
   * ----------------------------------------------------------
   */

  console.log(
    "\n[3] Detect document sections"
  );

  const guidelineStart =
    findGuidelineStart(
      pages
    );

  const decisionPages =
    findDecisionPages(
      pages
    );

  const terrainPages =
    findTerrainPages(
      pages
    );

  const guidelineRange =
    buildGuidelineRange(
      guidelineStart,
      decisionPages,
      totalPages
    );

  const decisionRange =
    buildDecisionRange(
      decisionPages,
      terrainPages,
      totalPages
    );

  const terrainRange =
    buildTerrainRange(
      terrainPages
    );

  console.log(
    `Guideline start: ${
      guidelineStart ??
      "(none)"
    }`
  );

  console.log(
    `Guideline range: ${
      guidelineRange.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  console.log(
    `Decision keyword pages: ${
      decisionPages.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  console.log(
    `Decision range: ${
      decisionRange.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  console.log(
    `Terrain keyword pages: ${
      terrainPages.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  console.log(
    `Terrain range: ${
      terrainRange.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  /*
   * ----------------------------------------------------------
   * Section detail
   * ----------------------------------------------------------
   */

  console.log(
    "\n[4] Section detail"
  );

  const guidelineDetails =
    getPages(
      pages,
      guidelineRange
    );

  for (
    const item
    of guidelineDetails
  ) {
    const heading =
      hasNormalized(
        item.textPreview,
        "지구단위계획시행지침"
      );

    console.log(
      `GUIDELINE PAGE ${item.page}` +
      `${
        heading
          ? " [heading]"
          : ""
      }`
    );
  }

  const decisionDetails =
    getPages(
      pages,
      decisionRange
    );

  for (
    const item
    of decisionDetails
  ) {
    console.log(
      `DECISION PAGE ${item.page}`
    );
  }

  const terrainDetails =
    getPages(
      pages,
      terrainRange
    );

  for (
    const item
    of terrainDetails
  ) {
    console.log(
      `TERRAIN PAGE ${item.page}`
    );
  }

  /*
   * ----------------------------------------------------------
   * Structured result
   * ----------------------------------------------------------
   */

  console.log(
    "\n[5] Build structured evidence"
  );

  const result = {
    extractorVersion:
      "0.3",

    analyzedAt:
      new Date().toISOString(),

    input: {
      pnu:
        options.pnu,

      noticeCode:
        options.noticeCode,

      jibun:
        options.jibun,

      ocrJson:
        ocrJsonPath
    },

    source: {
      pdfPath:
        ocr.pdfPath ||
        null,

      fileSize:
        ocr.fileSize ||
        null,

      pdfPages:
        ocr.pdfPages ||
        totalPages
    },

    target: {
      jibun:
        options.jibun,

      variants
    },

    parcelEvidence: {
      pages:
        parcelPages,

      primary:
        primaryParcel
          ? {
              page:
                primaryParcel.page,

              matchedVariant:
                primaryParcel.variant,

              area:
                parcelArea,

              snippet:
                primaryParcel.snippet
            }
          : null,

      allMatches:
        parcelEvidence
    },

    sourceMaterials: {
      implementationGuideline: {
        startPage:
          guidelineStart,

        pages:
          guidelineRange,

        details:
          guidelineDetails
      },

      decisionDrawings: {
        keywordPages:
          decisionPages,

        pages:
          decisionRange,

        details:
          decisionDetails
      },

      terrainMaps: {
        keywordPages:
          terrainPages,

        pages:
          terrainRange,

        details:
          terrainDetails
      }
    },

    warnings: []
  };

  if (
    parcelEvidence.length === 0
  ) {
    result.warnings.push(
      "Target jibun was not found in OCR text."
    );
  }

  if (
    parcelArea.likelyArea === null
  ) {
    result.warnings.push(
      "Target parcel was found but area was not isolated."
    );
  }

  if (
    guidelineRange.length === 0
  ) {
    result.warnings.push(
      "Implementation guideline section was not detected."
    );
  }

  if (
    decisionRange.length === 0
  ) {
    result.warnings.push(
      "Decision drawing section was not detected."
    );
  }

  if (
    terrainRange.length === 0
  ) {
    result.warnings.push(
      "Terrain map section was not detected."
    );
  }

  const baseName =
    `urban_plan_evidence_${options.pnu}_${options.noticeCode}`;

  const jsonPath =
    path.join(
      OCR_DIR,
      `${baseName}.json`
    );

  const textPath =
    path.join(
      OCR_DIR,
      `${baseName}.txt`
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

  const report = [];

  report.push(
    "============================================================"
  );

  report.push(
    "URBAN PLAN EVIDENCE REPORT v0.3"
  );

  report.push(
    "============================================================"
  );

  report.push(
    `PNU: ${options.pnu}`
  );

  report.push(
    `notice_code: ${options.noticeCode}`
  );

  report.push(
    `target jibun: ${options.jibun}`
  );

  report.push(
    ""
  );

  report.push(
    "PARCEL EVIDENCE"
  );

  report.push(
    `pages: ${
      parcelPages.join(
        ", "
      ) || "(none)"
    }`
  );

  if (
    primaryParcel
  ) {
    report.push(
      `primary page: ${
        primaryParcel.page
      }`
    );

    report.push(
      `area: ${
        parcelArea.likelyArea ||
        "(none)"
      }`
    );

    report.push(
      ""
    );

    report.push(
      primaryParcel.snippet
    );
  }

  report.push(
    ""
  );

  report.push(
    "IMPLEMENTATION GUIDELINE"
  );

  report.push(
    `start page: ${
      guidelineStart ??
      "(none)"
    }`
  );

  report.push(
    `pages: ${
      guidelineRange.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  report.push(
    ""
  );

  report.push(
    "DECISION DRAWINGS"
  );

  report.push(
    `keyword pages: ${
      decisionPages.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  report.push(
    `section pages: ${
      decisionRange.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  report.push(
    ""
  );

  report.push(
    "TERRAIN MAPS"
  );

  report.push(
    `keyword pages: ${
      terrainPages.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  report.push(
    `section pages: ${
      terrainRange.join(
        ", "
      ) ||
      "(none)"
    }`
  );

  report.push(
    ""
  );

  report.push(
    "WARNINGS"
  );

  if (
    result.warnings.length === 0
  ) {
    report.push(
      "(none)"
    );
  } else {
    for (
      const warning
      of result.warnings
    ) {
      report.push(
        `- ${warning}`
      );
    }
  }

  fs.writeFileSync(
    textPath,
    report.join("\n"),
    "utf8"
  );

  console.log(
    "\n[6] Saved"
  );

  console.log(
    `JSON: ${jsonPath}`
  );

  console.log(
    `TEXT: ${textPath}`
  );

  console.log(
    "\n=============================================================================="
  );

  if (
    parcelEvidence.length > 0
  ) {
    console.log(
      "RESULT: PASS - PARCEL EVIDENCE FOUND"
    );
  } else {
    console.log(
      "RESULT: PASS - PARCEL EVIDENCE NOT FOUND"
    );
  }

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
      `${error?.name || "Error"}: ${
        error?.message ||
        String(error)
      }`
    );

    console.log(
      "=============================================================================="
    );

    process.exitCode = 1;
  }
);