import fs from "node:fs/promises";
import path from "node:path";

import {
  createCanvas
} from "@napi-rs/canvas";

import {
  createWorker
} from "tesseract.js";

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const TARGET_ROLE_PATTERNS = {
  implementation_guideline: [
    "지구단위계획 시행지침",
    "지구단위계획시행지침"
  ],

  decision_drawing: [
    "도시관리계획결정도",
    "도시관리계획 결정도",
    "도시관리계획결정(기정)도",
    "도시관리계획결정(변경)도",
    "도시관리계획 결정(기정)도",
    "도시관리계획 결정(변경)도"
  ],

  terrain_map: [
    "지형도면고시도",
    "지형도면 고시도"
  ]
};

const OMISSION_PATTERNS = [
  "게재생략",
  "게재 생략"
];

function compact(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return compact(value)
    .replace(
      /[|｜,，:：.;·ㆍ"'"“”‘’()[\]{}<>《》「」『』\/\\_-]/g,
      ""
    )
    .toLowerCase();
}

function normalizeJibunVariants(jibun) {
  const source = compact(jibun);
  const result = new Set();

  if (source) {
    result.add(source);
    result.add(normalize(source));
  }

  const match =
    /(\d+(?:-\d+)?)\s*(?:번지)?$/u.exec(source);

  if (match) {
    const number = match[1];
    const prefix =
      source.slice(0, match.index).trim();

    if (prefix) {
      result.add(prefix + " " + number + "번지");
      result.add(prefix + number + "번지");
      result.add(prefix + " " + number);
      result.add(prefix + number);
    }
  }

  return [...result].filter(Boolean);
}

function hasNormalized(text, pattern) {
  return normalize(text).includes(normalize(pattern));
}

function findOriginalIndexForNormalizedMatch(
  source,
  normalizedTarget
) {
  const target =
    normalize(
      normalizedTarget
    );

  if (!target) {
    return -1;
  }

  let normalizedText = "";
  const originalIndexMap = [];

  for (
    let i = 0;
    i < source.length;
    i += 1
  ) {
    const piece =
      normalize(
        source[i]
      );

    if (!piece) {
      continue;
    }

    for (
      let j = 0;
      j < piece.length;
      j += 1
    ) {
      normalizedText +=
        piece[j];

      originalIndexMap.push(
        i
      );
    }
  }

  const normalizedIndex =
    normalizedText.indexOf(
      target
    );

  if (
    normalizedIndex < 0
  ) {
    return -1;
  }

  return (
    originalIndexMap[
      normalizedIndex
    ] ?? -1
  );
}

function makeContextAroundJibun(
  text,
  jibun,
  before = 220,
  after = 320
) {
  const source =
    compact(
      text
    );

  const normalizedTarget =
    normalize(
      jibun
    );

  const originalIndex =
    findOriginalIndexForNormalizedMatch(
      source,
      normalizedTarget
    );

  if (
    originalIndex < 0
  ) {
    return null;
  }

  const start =
    Math.max(
      0,
      originalIndex -
        before
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

  if (
    start > 0
  ) {
    snippet =
      "..." +
      snippet;
  }

  if (
    end <
    source.length
  ) {
    snippet += "...";
  }

  return {
    matchedText:
      jibun,

    snippet
  };
}

function findJibunHits(text, variants) {
  const normalizedText = normalize(text);
  const hits = [];

  for (const variant of variants) {
    if (
      normalizedText.includes(
        normalize(variant)
      )
    ) {
      hits.push(variant);
    }
  }

  return [...new Set(hits)];
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
    compact(
      snippet
    );

  const originalIndex =
    findOriginalIndexForNormalizedMatch(
      source,
      jibun
    );

  const localSource =
    originalIndex >= 0
      ? source.slice(
          originalIndex
        )
      : source;

  const valuesPattern =
    /(?:\||｜|\s)+(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+)\s*(?:㎡|m²|m2)?\s*(?:\||｜)\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+)(?:\s*(?:㎡|m²|m2))?/i;

  const valuesMatch =
    localSource.match(
      valuesPattern
    );

  if (
    valuesMatch
  ) {
    return {
      values: [
        valuesMatch[1],
        valuesMatch[2]
      ],

      likelyArea:
        valuesMatch[1],

      raw:
        valuesMatch[0]
    };
  }

  const unitMatch =
    localSource.match(
      /(?:^|\s|\|)(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+\.\d+)\s*(?:㎡|m²|m2)\b/i
    );

  if (
    unitMatch
  ) {
    return {
      values: [
        unitMatch[1]
      ],

      likelyArea:
        unitMatch[1],

      raw:
        unitMatch[0]
    };
  }

  return {
    values: [],
    likelyArea: null,
    raw: null
  };
}

function hasGuidelineMarker(
  text
) {
  const normalized =
    normalize(
      text
    );

  return (
    normalized.includes(
      "지구단위계획시행지침"
    ) ||
    (
      normalized.includes(
        "지구단위계획"
      ) &&
      normalized.includes(
        "시행지침"
      )
    )
  );
}

function isGuidelineStartPage(
  text
) {
  const normalized =
    normalize(
      text
    );

  if (
    !hasGuidelineMarker(
      text
    )
  ) {
    return false;
  }

  return (
    normalized.includes("총칙") ||
    normalized.includes("목적") ||
    normalized.includes("제1조") ||
    normalized.includes("제2조") ||
    normalized.includes("제3조") ||
    normalized.includes("변경") ||
    normalized.includes("전문")
  );
}

function isDecisionDrawingPage(
  text
) {
  const normalized =
    normalize(
      text
    );

  const hasUrbanPlan =
    normalized.includes(
      "도시관리계획"
    );

  const hasDecision =
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

  const hasParcelDrawingContext =
    normalized.includes(
      "가구및획지"
    );

  const hasMapContext =
    normalized.includes(
      "지구단위계획"
    ) ||
    normalized.includes(
      "가구및획지"
    );

  const hasEditionMarker =
    normalized.includes(
      "기정"
    ) ||
    normalized.includes(
      "변경"
    );

  /*
   * 일반적인 도시관리계획 결정조서는
   * 제외하고 실제 도면 제목/도면 문맥을
   * 함께 요구한다.
   *
   * OCR에서 "결정도"가 깨지는 경우를 위해
   * 가구·획지 + 기정/변경 조합도 허용한다.
   */
  const hasExplicitDecisionDrawingTitle =
    normalized.includes(
      "도시관리계획결정도"
    ) ||
    normalized.includes(
      "도시관리계획결정기정도"
    ) ||
    normalized.includes(
      "도시관리계획결정변경도"
    );

  const drawingMatch =
    hasExplicitDecisionDrawingTitle ||
    (
      hasDrawingSuffix &&
      hasMapContext
    ) ||
    (
      hasParcelDrawingContext &&
      hasEditionMarker
    );

  return (
    hasUrbanPlan &&
    hasDecision &&
    drawingMatch &&
    !normalized.includes(
      "지형도면고시도"
    )
  );
}

function isTerrainMapPage(text) {
  const normalized = normalize(text);

  return (
    normalized.includes("지형도면고시도") ||
    normalized.includes("지형도면고시도")
  );
}

function isOmittedPage(text, materialPatterns) {
  const normalized = normalize(text);

  const hasOmission =
    OMISSION_PATTERNS.some(
      (pattern) =>
        normalized.includes(
          normalize(pattern)
        )
    );

  if (!hasOmission) {
    return false;
  }

  return materialPatterns.some(
    (pattern) =>
      normalized.includes(
        normalize(pattern)
      )
  );
}

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
    let page = firstPage;
    page <= lastPage;
    page += 1
  ) {
    result.push(page);
  }

  return result;
}

function buildGuidelineRange(
  guidelineStart,
  decisionPages,
  totalPages
) {
  if (guidelineStart === null) {
    return [];
  }

  let end = totalPages;

  if (decisionPages.length > 0) {
    const decisionStart =
      Math.min(...decisionPages);

    end = decisionStart - 1;
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
  if (decisionPages.length === 0) {
    return [];
  }

  const start =
    Math.min(...decisionPages);

  let end = totalPages;

  if (terrainPages.length > 0) {
    const terrainStart =
      Math.min(...terrainPages);

    if (terrainStart > start) {
      end = terrainStart - 1;
    }
  }

  return makeContinuousRange(
    start,
    end
  );
}

function buildTerrainRange(terrainPages) {
  if (terrainPages.length === 0) {
    return [];
  }

  return makeContinuousRange(
    Math.min(...terrainPages),
    Math.max(...terrainPages)
  );
}

function getPageDetails(
  pages,
  pageNumbers,
  extra = () => ({})
) {
  const pageSet = new Set(pageNumbers);

  return pages
    .filter((page) =>
      pageSet.has(page.page)
    )
    .map((page) => ({
      page: page.page,
      textPreview:
        page.text.slice(0, 500),
      textChars:
        page.text.length,
      ...extra(page)
    }));
}

function findParcelEvidence(
  pages,
  variants
) {
  const result = [];

  for (const page of pages) {
    if (!page.text) {
      continue;
    }

    for (const variant of variants) {
      const context =
        makeContextAroundJibun(
          page.text,
          variant
        );

      if (!context) {
        continue;
      }

      result.push({
        page: page.page,
        variant,
        snippet: context.snippet
      });

      break;
    }
  }

  return result;
}

function detectSourceMaterials(
  pages,
  totalPages
) {
  const guidelineStart =
    pages.find((page) =>
      isGuidelineStartPage(page.text)
    )?.page ?? null;

  const decisionPages =
    pages
      .filter((page) =>
        isDecisionDrawingPage(
          page.text
        )
      )
      .map((page) => page.page);

  const terrainPages =
    pages
      .filter((page) =>
        isTerrainMapPage(page.text)
      )
      .map((page) => page.page);

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

  const omittedGuidelinePages =
    pages
      .filter((page) =>
        guidelineRange.includes(page.page)
      )
      .filter((page) =>
        isOmittedPage(
          page.text,
          [
            "지구단위계획 시행지침",
            "전문"
          ]
        )
      )
      .map((page) => page.page);

  const omittedDrawingPages =
    pages
      .filter((page) =>
        decisionRange.includes(
          page.page
        )
      )
      .filter((page) =>
        isOmittedPage(
          page.text,
          [
            "관계도면",
            "도면"
          ]
        )
      )
      .map((page) => page.page);

  const omittedRelatedMaterialPages =
    pages
      .filter((page) =>
        isOmittedPage(
          page.text,
          [
            "관계도면",
            "지구단위계획 시행지침",
            "전문"
          ]
        )
      )
      .map((page) => page.page);

  return {
    implementationGuideline: {
      startPage:
        guidelineStart,
      pages:
        guidelineRange,
      keywordPages:
        pages
          .filter((page) =>
            hasGuidelineMarker(
              page.text
            )
          )
          .map((page) => page.page),
      details:
        getPageDetails(
          pages,
          guidelineRange
        ),
      fullTextAvailable:
        guidelineStart !== null &&
        omittedGuidelinePages.length === 0,
      omitted:
        omittedGuidelinePages.length > 0,
      omittedPages:
        omittedGuidelinePages,
      rangeBasis:
        decisionPages.length > 0
          ? "guideline_start_to_first_decision_page"
          : "guideline_start_to_pdf_end"
    },

    decisionDrawings: {
      keywordPages:
        decisionPages,
      pages:
        decisionRange,
      details:
        getPageDetails(
          pages,
          decisionRange
        ),
      omittedPages:
        omittedDrawingPages,
      rangeBasis:
        terrainPages.length > 0
          ? "first_decision_to_before_first_terrain"
          : "first_decision_to_pdf_end"
    },

    omissions: {
      relatedMaterialPages:
        omittedRelatedMaterialPages
    },

    terrainMaps: {
      keywordPages:
        terrainPages,
      pages:
        terrainRange,
      details:
        getPageDetails(
          pages,
          terrainRange
        ),
      rangeBasis:
        "first_to_last_detected_terrain_map_page"
    }
  };
}

class CanvasFactory {
  create(width, height) {
    const canvas =
      createCanvas(
        Math.ceil(width),
        Math.ceil(height)
      );

    return {
      canvas,
      context:
        canvas.getContext("2d")
    };
  }

  reset(pair, width, height) {
    pair.canvas.width =
      Math.ceil(width);

    pair.canvas.height =
      Math.ceil(height);

    pair.context =
      pair.canvas.getContext("2d");
  }

  destroy(pair) {
    pair.canvas = null;
    pair.context = null;
  }
}

async function createKoreanWorker(
  psmMode = "3"
) {
  const worker =
    await createWorker(
      "kor",
      1
    );

  await worker.setParameters({
    tessedit_pageseg_mode:
      String(psmMode),
    preserve_interword_spaces: "1",
    user_defined_dpi: "300"
  });

  return worker;
}

export async function locatePdfEvidence(
  pdfPath,
  {
    jibun,
    saveMatchedImages = false,
    imageOutputDir = null,
    scale = 2.5,
    ocrPsmModes = ["3"]
  } = {}
) {
  if (!jibun) {
    throw new Error(
      "jibun is required for PDF evidence location."
    );
  }

  const buffer =
    await fs.readFile(pdfPath);

  const pdf =
    await pdfjsLib
      .getDocument({
        data:
          new Uint8Array(buffer),
        disableWorker: true,
        useWorkerFetch: false,
        isEvalSupported: false
      })
      .promise;

  const variants =
    normalizeJibunVariants(jibun);

  const normalizedPsmModes =
    [
      ...new Set(
        (
          Array.isArray(
            ocrPsmModes
          )
            ? ocrPsmModes
            : [ocrPsmModes]
        )
          .map(
            (value) =>
              String(value).trim()
          )
          .filter(Boolean)
      )
    ];

  if (
    normalizedPsmModes.length === 0
  ) {
    normalizedPsmModes.push("3");
  }

  const canvasFactory =
    new CanvasFactory();

  const pagesByPsm = new Map();

  for (
    const psmMode
    of normalizedPsmModes
  ) {
    const worker =
      await createKoreanWorker(
        psmMode
      );

    const pages = [];

    try {
      for (
        let pageNo = 1;
        pageNo <= pdf.numPages;
        pageNo += 1
      ) {
      const page =
        await pdf.getPage(pageNo);

      const viewport =
        page.getViewport({ scale });

      const pair =
        canvasFactory.create(
          viewport.width,
          viewport.height
        );

      try {
        await page.render({
          canvasContext: pair.context,
          viewport,
          canvasFactory
        }).promise;

        const png =
          pair.canvas.toBuffer(
            "image/png"
          );

        const result =
          await worker.recognize(png);

        const text =
          compact(
            result?.data?.text || ""
          );

        const jibunHits =
          findJibunHits(
            text,
            variants
          );

        const roles = [];

        if (
          hasGuidelineMarker(
            text
          )
        ) {
          roles.push(
            "implementation_guideline"
          );
        }

        if (
          isDecisionDrawingPage(text)
        ) {
          roles.push(
            "decision_drawing"
          );
        }

        if (
          isTerrainMapPage(text)
        ) {
          roles.push(
            "terrain_map"
          );
        }

        const matched =
          jibunHits.length > 0 ||
          roles.length > 0;

        const pageResult = {
          page: pageNo,
          jibunHits,
          roles,
          matched,
          textChars: text.length,
          text
        };

        if (
          jibunHits.length > 0
        ) {
          const context =
            makeContextAroundJibun(
              text,
              jibunHits[0]
            );

          if (context) {
            pageResult.snippet =
              context.snippet;
          }
        }

        if (
          matched &&
          saveMatchedImages &&
          imageOutputDir
        ) {
          await fs.mkdir(
            imageOutputDir,
            {
              recursive: true
            }
          );

          const imagePath =
            path.join(
              imageOutputDir,
              "page_" +
              String(pageNo).padStart(3, "0") +
              ".png"
            );

          await fs.writeFile(
            imagePath,
            png
          );

          pageResult.imagePath =
            imagePath;
        }

        pages.push(pageResult);
      } finally {
        canvasFactory.destroy(pair);
        page.cleanup();
      }
    }

    pagesByPsm.set(
      psmMode,
      pages
    );
    } finally {
      await worker.terminate();
    }
  }

  let pages =
    pagesByPsm.get(
      normalizedPsmModes[0]
    ) || [];

  if (
    pages.every(
      (page) =>
        page.jibunHits.length === 0
    ) &&
    normalizedPsmModes.length > 1
  ) {
    const fallbackPages = [];

    for (
      let pageNo = 1;
      pageNo <= pdf.numPages;
      pageNo += 1
    ) {
      const candidates =
        normalizedPsmModes
          .map(
            (psmMode) =>
              pagesByPsm.get(
                psmMode
              )?.find(
                (page) =>
                  page.page === pageNo
              )
          )
          .filter(Boolean);

      const best =
        candidates.sort(
          (a, b) => {
            const aScore =
              (a.jibunHits.length > 0 ? 1000000 : 0) +
              (a.roles.length > 0 ? 100000 : 0) +
              a.textChars;

            const bScore =
              (b.jibunHits.length > 0 ? 1000000 : 0) +
              (b.roles.length > 0 ? 100000 : 0) +
              b.textChars;

            return bScore - aScore;
          }
        )[0];

      if (best) {
        fallbackPages.push(best);
      }
    }

    pages = fallbackPages;
  }

  const normalizedPages =
    pages.map((page) => ({
      ...page,
      text:
        compact(page.text || "")
    }));

  const parcelEvidence =
    findParcelEvidence(
      normalizedPages,
      variants
    );

  const parcelPages =
    [...new Set(
      parcelEvidence.map(
        (item) => item.page
      )
    )].sort(
      (a, b) => a - b
    );

  const primaryParcel =
    parcelEvidence[0] || null;

  const parcelArea =
    primaryParcel
      ? extractAreaFromParcelSnippet(
          primaryParcel.snippet,
          primaryParcel.variant
        )
      : {
          values: [],
          likelyArea: null,
          raw: null
        };

  const totalPages =
    pdf.numPages;

  const sourceMaterials =
    detectSourceMaterials(
      normalizedPages,
      totalPages
    );

  const warnings = [];

  if (parcelEvidence.length === 0) {
    warnings.push(
      "Target jibun was not found in OCR text."
    );
  }

  if (
    parcelEvidence.length > 0 &&
    parcelArea.likelyArea === null
  ) {
    warnings.push(
      "Target parcel was found, but a reliable area value was not extracted from the nearby OCR context."
    );
  }

  if (
    sourceMaterials.implementationGuideline.startPage === null
  ) {
    warnings.push(
      "Implementation guideline section was not located by OCR."
    );
  }

  if (
    sourceMaterials.implementationGuideline.omitted
  ) {
    warnings.push(
      "The guideline appears to contain a '게재생략' notice; full guideline text is not treated as available in this source PDF."
    );
  }

  if (
    sourceMaterials.decisionDrawings.pages.length === 0
  ) {
    warnings.push(
      "Decision drawing section was not located by OCR."
    );
  }

  if (
    sourceMaterials.terrainMaps.pages.length === 0
  ) {
    warnings.push(
      "Terrain-map section was not located by OCR."
    );
  }

  return {
    fileType: "pdf",
    filePath: pdfPath,
    pageCount: totalPages,
    targetJibun: jibun,
    targetVariants: variants,
    ocrPsmModes: normalizedPsmModes,

    parcelEvidence: {
      pages: parcelPages,
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

    sourceMaterials,

    warnings,

    pages:
      normalizedPages.map(
        (page) => ({
          page:
            page.page,
          jibunHits:
            page.jibunHits,
          roles:
            page.roles,
          matched:
            page.matched,
          textChars:
            page.textChars,
          snippet:
            page.snippet || null,
          imagePath:
            page.imagePath || null
        })
      )
  };
}

export async function locateImageEvidence(
  imagePath,
  {
    jibun
  } = {}
) {
  if (!jibun) {
    throw new Error(
      "jibun is required for image evidence location."
    );
  }

  const buffer =
    await fs.readFile(
      imagePath
    );

  const worker =
    await createKoreanWorker();

  try {
    const result =
      await worker.recognize(
        buffer
      );

    const text =
      compact(
        result?.data?.text || ""
      );

    const variants =
      normalizeJibunVariants(jibun);

    const jibunHits =
      findJibunHits(
        text,
        variants
      );

    const context =
      jibunHits.length > 0
        ? makeContextAroundJibun(
            text,
            jibunHits[0]
          )
        : null;

    const roles = [];

    if (
      hasGuidelineMarker(
        text
      )
    ) {
      roles.push(
        "implementation_guideline"
      );
    }

    if (
      isDecisionDrawingPage(text)
    ) {
      roles.push(
        "decision_drawing"
      );
    }

    if (
      isTerrainMapPage(text)
    ) {
      roles.push(
        "terrain_map"
      );
    }

    const omitted =
      isOmittedPage(
        text,
        [
          "지구단위계획 시행지침",
          "전문",
          "관계도면"
        ]
      );

    const warnings = [];

    if (
      jibunHits.length === 0
    ) {
      warnings.push(
        "Target jibun was not found in OCR text. This does not prove that the image is unrelated."
      );
    }

    if (omitted) {
      warnings.push(
        "The image OCR contains a '게재생략' notice; the source is preserved as-is and is not treated as a complete document replacement."
      );
    }

    return {
      fileType: "image",
      filePath: imagePath,
      targetJibun: jibun,
      targetVariants: variants,
      jibunHits,
      roles,
      matched:
        jibunHits.length > 0 ||
        roles.length > 0,
      snippet:
        context?.snippet || null,
      textChars:
        text.length,
      omitted,
      warnings
    };
  } finally {
    await worker.terminate();
  }
}
