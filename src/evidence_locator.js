import fs from "node:fs/promises";
import path from "node:path";

import {
  createCanvas
} from "@napi-rs/canvas";

import {
  createWorker
} from "tesseract.js";

import pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const TARGET_ROLE_PATTERNS = {
  implementation_guideline: [
    "지구단위계획 시행지침",
    "지구단위계획시행지침"
  ],

  decision_drawing: [
    "도시관리계획결정도",
    "도시관리계획 결정도",
    "도시관리계획결정(변경)도",
    "도시관리계획 결정(변경)도",
    "결정(변경)도"
  ],

  terrain_map: [
    "지형도면고시도",
    "지형도면 고시도"
  ]
};

function compact(
  value
) {
  return String(
    value ?? ""
  )
    .normalize("NFKC")
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function normalize(
  value
) {
  return compact(
    value
  )
    .replace(
      /[|｜,，:：.;·ㆍ"'"“”‘’()[\]{}<>《》「」『』\/\\_-]/g,
      ""
    )
    .toLowerCase();
}

function normalizeJibunVariants(
  jibun
) {
  const source =
    compact(
      jibun
    );

  const result =
    new Set();

  result.add(
    source
  );

  result.add(
    normalize(
      source
    )
  );

  const match =
    /(\d+(?:-\d+)?)\s*(?:번지)?$/u.exec(
      source
    );

  if (match) {
    const number =
      match[1];

    const prefix =
      source
        .slice(
          0,
          match.index
        )
        .trim();

    if (prefix) {
      result.add(
        `${prefix} ${number}`
      );

      result.add(
        `${prefix}${number}`
      );

      result.add(
        `${prefix} ${number}번지`
      );

      result.add(
        `${prefix}${number}번지`
      );
    }
  }

  return [
    ...result
  ].filter(Boolean);
}

function containsPattern(
  text,
  pattern
) {
  return normalize(
    text
  ).includes(
    normalize(
      pattern
    )
  );
}

function findRoleMatches(
  text
) {
  const roles = [];

  for (
    const [
      role,
      patterns
    ]
    of Object.entries(
      TARGET_ROLE_PATTERNS
    )
  ) {
    if (
      patterns.some(
        (pattern) =>
          containsPattern(
            text,
            pattern
          )
      )
    ) {
      roles.push(
        role
      );
    }
  }

  /*
   * "지형도면"이라는 단어만 있는
   * 일반 고시 페이지는 terrain_map으로
   * 판정하지 않는다.
   */
  if (
    roles.includes(
      "terrain_map"
    ) &&
    !containsPattern(
      text,
      "지형도면고시도"
    ) &&
    !containsPattern(
      text,
      "지형도면 고시도"
    )
  ) {
    return roles.filter(
      (role) =>
        role !==
        "terrain_map"
    );
  }

  return roles;
}

function findJibunHits(
  text,
  variants
) {
  const normalizedText =
    normalize(
      text
    );

  const hits = [];

  for (
    const variant of variants
  ) {
    if (
      normalizedText.includes(
        normalize(
          variant
        )
      )
    ) {
      hits.push(
        variant
      );
    }
  }

  return [
    ...new Set(hits)
  ];
}

function makeSnippet(
  text,
  keyword
) {
  const source =
    compact(
      text
    );

  const sourceNormalized =
    normalize(
      source
    );

  const target =
    normalize(
      keyword
    );

  const index =
    sourceNormalized.indexOf(
      target
    );

  if (
    index < 0
  ) {
    return null;
  }

  /*
   * 표시용 문맥은 OCR 문자열에서
   * 충분한 앞/뒤를 반환한다.
   */
  return source.slice(
    0,
    Math.min(
      source.length,
      800
    )
  );
}

class CanvasFactory {
  create(
    width,
    height
  ) {
    const canvas =
      createCanvas(
        Math.ceil(
          width
        ),
        Math.ceil(
          height
        )
      );

    return {
      canvas,

      context:
        canvas.getContext(
          "2d"
        )
    };
  }

  reset(
    pair,
    width,
    height
  ) {
    pair.canvas.width =
      Math.ceil(
        width
      );

    pair.canvas.height =
      Math.ceil(
        height
      );

    pair.context =
      pair.canvas.getContext(
        "2d"
      );
  }

  destroy(
    pair
  ) {
    pair.canvas = null;
    pair.context = null;
  }
}

async function createKoreanWorker() {
  const worker =
    await createWorker(
      "kor",
      1
    );

  await worker.setParameters({
    tessedit_pageseg_mode:
      "3",

    preserve_interword_spaces:
      "1",

    user_defined_dpi:
      "300"
  });

  return worker;
}

export async function locatePdfEvidence(
  pdfPath,
  {
    jibun,
    saveMatchedImages = false,
    imageOutputDir = null,
    scale = 2.5
  } = {}
) {
  if (!jibun) {
    throw new Error(
      "jibun is required for PDF evidence location."
    );
  }

  const buffer =
    await fs.readFile(
      pdfPath
    );

  const pdf =
    await pdfjsLib
      .getDocument({
        data:
          new Uint8Array(
            buffer
          ),

        disableWorker:
          true,

        useWorkerFetch:
          false,

        isEvalSupported:
          false
      })
      .promise;

  const variants =
    normalizeJibunVariants(
      jibun
    );

  const worker =
    await createKoreanWorker();

  const canvasFactory =
    new CanvasFactory();

  const pages = [];

  try {
    for (
      let pageNo = 1;
      pageNo <=
      pdf.numPages;
      pageNo += 1
    ) {
      const page =
        await pdf.getPage(
          pageNo
        );

      const viewport =
        page.getViewport({
          scale
        });

      const pair =
        canvasFactory.create(
          viewport.width,
          viewport.height
        );

      try {
        await page.render({
          canvasContext:
            pair.context,

          viewport,

          canvasFactory
        }).promise;

        const png =
          pair.canvas.toBuffer(
            "image/png"
          );

        const result =
          await worker.recognize(
            png
          );

        const text =
          compact(
            result?.data?.text ||
              ""
          );

        const jibunHits =
          findJibunHits(
            text,
            variants
          );

        const roles =
          findRoleMatches(
            text
          );

        const matched =
          jibunHits.length >
            0 ||
          roles.length >
            0;

        const pageResult = {
          page:
            pageNo,

          jibunHits,

          roles,

          matched,

          textChars:
            text.length
        };

        if (
          matched &&
          saveMatchedImages &&
          imageOutputDir
        ) {
          await fs.mkdir(
            imageOutputDir,
            {
              recursive:
                true
            }
          );

          const imagePath =
            path.join(
              imageOutputDir,
              `page_${String(
                pageNo
              ).padStart(
                3,
                "0"
              )}.png`
            );

          await fs.writeFile(
            imagePath,
            png
          );

          pageResult.imagePath =
            imagePath;
        }

        if (
          jibunHits.length >
            0
        ) {
          pageResult.snippet =
            makeSnippet(
              text,
              jibunHits[0]
            );
        }

        pages.push(
          pageResult
        );
      } finally {
        canvasFactory.destroy(
          pair
        );
      }
    }
  } finally {
    await worker.terminate();
  }

  const parcelPages =
    pages
      .filter(
        (page) =>
          page.jibunHits.length >
          0
      )
      .map(
        (page) =>
          page.page
      );

  const implementationGuidelinePages =
    pages
      .filter(
        (page) =>
          page.roles.includes(
            "implementation_guideline"
          )
      )
      .map(
        (page) =>
          page.page
      );

  const decisionDrawingPages =
    pages
      .filter(
        (page) =>
          page.roles.includes(
            "decision_drawing"
          )
      )
      .map(
        (page) =>
          page.page
      );

  const terrainMapPages =
    pages
      .filter(
        (page) =>
          page.roles.includes(
            "terrain_map"
          )
      )
      .map(
        (page) =>
          page.page
      );

  return {
    fileType:
      "pdf",

    filePath:
      pdfPath,

    pageCount:
      pdf.numPages,

    targetJibun:
      jibun,

    parcelPages,

    implementationGuidelinePages,

    decisionDrawingPages,

    terrainMapPages,

    pages
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
        result?.data?.text ||
          ""
      );

    const variants =
      normalizeJibunVariants(
        jibun
      );

    const jibunHits =
      findJibunHits(
        text,
        variants
      );

    const roles =
      findRoleMatches(
        text
      );

    return {
      fileType:
        "image",

      filePath:
        imagePath,

      targetJibun:
        jibun,

      jibunHits,

      roles,

      matched:
        jibunHits.length >
          0 ||
        roles.length >
          0,

      textChars:
        text.length
    };
  } finally {
    await worker.terminate();
  }
}