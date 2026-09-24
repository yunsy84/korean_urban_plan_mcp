import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const DEFAULT_PDF = path.join(
  ROOT,
  "tests",
  "output",
  "attachments",
  "44130NTC202001020001_1.pdf"
);

const OUTPUT_DIR = path.join(
  ROOT,
  "tests",
  "output",
  "pdf_ocr"
);

const TARGET_KEYWORDS = [
  "백석동 1116",
  "백석동1116",
  "1116번지",
  "1116",
  "백석동",
  "천안물류단지",
  "지구단위계획",
  "도시관리계획",
  "결정조서",
  "지형도면",
  "시행지침"
];

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = argv.slice(2);

  const options = {
    pdfPath: DEFAULT_PDF,
    pages: [],
    scale: 2.5,
    saveHitsOnly: true
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--pdf") {
      options.pdfPath = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--pages") {
      options.pages = parsePageSpec(
        args[i + 1] ?? ""
      );
      i += 1;
      continue;
    }

    if (arg === "--scale") {
      const scale =
        Number(args[i + 1]);

      if (
        !Number.isFinite(scale) ||
        scale <= 0
      ) {
        fail(
          `Invalid scale: ${args[i + 1]}`
        );
      }

      options.scale = scale;
      i += 1;
      continue;
    }

    if (arg === "--save-all") {
      options.saveHitsOnly = false;
      continue;
    }

    if (arg.startsWith("--")) {
      fail(
        `Unknown option: ${arg}`
      );
    }
  }

  return options;
}

function parsePageSpec(value) {
  const pages = [];

  for (
    const token
    of String(value)
      .split(",")
  ) {
    const part = token.trim();

    if (!part) {
      continue;
    }

    if (part.includes("-")) {
      const [aRaw, bRaw] =
        part.split("-", 2);

      const a = Number(aRaw);
      const b = Number(bRaw);

      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        a <= 0 ||
        b < a
      ) {
        fail(
          `Invalid page range: ${part}`
        );
      }

      for (
        let p = a;
        p <= b;
        p += 1
      ) {
        pages.push(p);
      }
    } else {
      const p = Number(part);

      if (
        !Number.isInteger(p) ||
        p <= 0
      ) {
        fail(
          `Invalid page number: ${part}`
        );
      }

      pages.push(p);
    }
  }

  return [
    ...new Set(pages)
  ];
}

async function loadDependencies() {
  let pdfjsLib;
  let canvasModule;
  let tesseract;

  try {
    pdfjsLib = await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );
  } catch (error) {
    fail(
      `pdfjs-dist load failed:\n${
        error?.message ||
        String(error)
      }`
    );
  }

  try {
    canvasModule = await import(
      "@napi-rs/canvas"
    );
  } catch (error) {
    fail(
      `@napi-rs/canvas load failed.\n` +
      `Install with:\n` +
      `npm install @napi-rs/canvas\n\n` +
      `Original error: ${
        error?.message ||
        String(error)
      }`
    );
  }

  try {
    tesseract = await import(
      "tesseract.js"
    );
  } catch (error) {
    fail(
      `tesseract.js load failed.\n` +
      `Install with:\n` +
      `npm install tesseract.js\n\n` +
      `Original error: ${
        error?.message ||
        String(error)
      }`
    );
  }

  return {
    pdfjsLib,
    canvasModule,
    tesseract
  };
}

class NodeCanvasFactory {
  constructor(createCanvas) {
    this.createCanvas =
      createCanvas;
  }

  create(width, height) {
    const canvas =
      this.createCanvas(
        Math.ceil(width),
        Math.ceil(height)
      );

    const context =
      canvas.getContext("2d");

    return {
      canvas,
      context
    };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width =
      Math.ceil(width);

    canvasAndContext.canvas.height =
      Math.ceil(height);

    canvasAndContext.context =
      canvasAndContext.canvas.getContext(
        "2d"
      );
  }

  destroy(canvasAndContext) {
    if (!canvasAndContext) {
      return;
    }

    canvasAndContext.canvas =
      null;

    canvasAndContext.context =
      null;
  }
}

function normalizeOcrText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function compactText(text) {
  return normalizeOcrText(
    text
  )
    .replace(/\s+/g, " ")
    .trim();
}

function findKeywordHits(text) {
  const compact =
    compactText(text);

  const results = [];

  for (
    const keyword
    of TARGET_KEYWORDS
  ) {
    const positions = [];

    let offset = 0;

    while (true) {
      const index =
        compact.indexOf(
          keyword,
          offset
        );

      if (index < 0) {
        break;
      }

      const start =
        Math.max(
          0,
          index - 100
        );

      const end =
        Math.min(
          compact.length,
          index +
            keyword.length +
            160
        );

      let snippet =
        compact.slice(
          start,
          end
        );

      if (start > 0) {
        snippet =
          `...${snippet}`;
      }

      if (
        end <
        compact.length
      ) {
        snippet += "...";
      }

      positions.push({
        index,
        snippet
      });

      offset =
        index +
        keyword.length;

      if (
        positions.length >= 5
      ) {
        break;
      }
    }

    if (positions.length > 0) {
      results.push({
        keyword,
        count:
          positions.length,
        positions
      });
    }
  }

  return results;
}

function getMatchingKeywords(text) {
  return findKeywordHits(
    text
  ).map(
    (item) =>
      item.keyword
  );
}

function savePng(
  canvas,
  outputPath
) {
  const png =
    canvas.toBuffer(
      "image/png"
    );

  fs.writeFileSync(
    outputPath,
    png
  );

  return png.length;
}

function printProgress(
  current,
  total,
  stage
) {
  console.log(
    `[${String(current).padStart(2, "0")}/${String(total).padStart(2, "0")}] ${stage}`
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
    "korean_urban_plan_mcp - EUM PDF OCR probe v0.1"
  );
  console.log(
    "=============================================================================="
  );

  console.log(
    `PDF: ${options.pdfPath}`
  );

  console.log(
    `Render scale: ${options.scale}`
  );

  if (
    options.pages.length > 0
  ) {
    console.log(
      `Pages: ${options.pages.join(", ")}`
    );
  } else {
    console.log(
      "Pages: ALL"
    );
  }

  console.log(
    `Save images: ${
      options.saveHitsOnly
        ? "HITS ONLY"
        : "ALL"
    }`
  );

  if (
    !fs.existsSync(
      options.pdfPath
    )
  ) {
    fail(
      `PDF not found:\n${options.pdfPath}`
    );
  }

  const stat =
    fs.statSync(
      options.pdfPath
    );

  console.log(
    `Size: ${stat.size.toLocaleString()} bytes`
  );

  fs.mkdirSync(
    OUTPUT_DIR,
    {
      recursive: true
    }
  );

  const {
    pdfjsLib,
    canvasModule,
    tesseract
  } =
    await loadDependencies();

  const {
    createCanvas
  } =
    canvasModule;

  const {
    createWorker
  } =
    tesseract;

  console.log(
    "\n[1] Open PDF"
  );

  const pdfBuffer =
    fs.readFileSync(
      options.pdfPath
    );

  const loadingTask =
    pdfjsLib.getDocument({
      data:
        new Uint8Array(
          pdfBuffer
        ),

      disableWorker:
        true,

      useWorkerFetch:
        false,

      isEvalSupported:
        false
    });

  const pdf =
    await loadingTask.promise;

  console.log(
    `Pages: ${pdf.numPages}`
  );

  let pageNumbers;

  if (
    options.pages.length > 0
  ) {
    pageNumbers =
      options.pages.filter(
        (page) =>
          page <=
          pdf.numPages
      );
  } else {
    pageNumbers =
      Array.from(
        {
          length:
            pdf.numPages
        },
        (_, index) =>
          index + 1
      );
  }

  if (
    pageNumbers.length === 0
  ) {
    fail(
      "No valid pages to process."
    );
  }

  console.log(
    `OCR pages: ${pageNumbers.length}`
  );

  console.log(
    "\n[2] Start Korean OCR worker"
  );

  const worker =
    await createWorker(
      "kor",
      1,
      {
        logger(message) {
          if (
            message &&
            typeof message.progress ===
              "number" &&
            (
              message.status ===
                "recognizing text" ||
              message.status ===
                "loading language traineddata"
            )
          ) {
            const pct =
              Math.round(
                message.progress * 100
              );

            process.stdout.write(
              `\r  ${
                message.status
              } ${pct}%`
            );
          }
        }
      }
    );

  process.stdout.write(
    "\n"
  );

  await worker.setParameters({
    tessedit_pageseg_mode:
      "3",

    preserve_interword_spaces:
      "1",

    user_defined_dpi:
      "300"
  });

  console.log(
    "OCR worker ready."
  );

  const canvasFactory =
    new NodeCanvasFactory(
      createCanvas
    );

  const pageResults = [];

  try {
    console.log(
      "\n[3] Render + OCR"
    );

    for (
      let index = 0;
      index <
      pageNumbers.length;
      index += 1
    ) {
      const pageNumber =
        pageNumbers[index];

      printProgress(
        index + 1,
        pageNumbers.length,
        `page ${pageNumber} render`
      );

      const page =
        await pdf.getPage(
          pageNumber
        );

      const viewport =
        page.getViewport({
          scale:
            options.scale
        });

      const canvasAndContext =
        canvasFactory.create(
          viewport.width,
          viewport.height
        );

      try {
        const renderTask =
          page.render({
            canvasContext:
              canvasAndContext.context,

            viewport,

            canvasFactory
          });

        await renderTask.promise;

        const pngBuffer =
          canvasAndContext.canvas.toBuffer(
            "image/png"
          );

        console.log(
          `  PNG: ${
            pngBuffer.length.toLocaleString()
          } bytes`
        );

        const {
          data
        } = await worker.recognize(
          pngBuffer
        );

        const rawText =
          String(
            data?.text || ""
          );

        const text =
          normalizeOcrText(
            rawText
          );

        const compact =
          compactText(
            text
          );

        const keywordHits =
          findKeywordHits(
            text
          );

        const matchingKeywords =
          getMatchingKeywords(
            text
          );

        const pageResult = {
          page:
            pageNumber,

          width:
            Math.round(
              viewport.width
            ),

          height:
            Math.round(
              viewport.height
            ),

          ocrTextChars:
            compact.length,

          matched:
            matchingKeywords.length >
            0,

          matchingKeywords,

          keywordHits,

          text
        };

        pageResults.push(
          pageResult
        );

        if (
          matchingKeywords.length >
          0
        ) {
          const imagePath =
            path.join(
              OUTPUT_DIR,
              `page_${String(
                pageNumber
              ).padStart(3, "0")}.png`
            );

          fs.writeFileSync(
            imagePath,
            pngBuffer
          );

          pageResult.renderedImage =
            imagePath;

          console.log(
            `  *** MATCH: ${
              matchingKeywords.join(
                ", "
              )
            }`
          );

          console.log(
            `  Saved image: ${imagePath}`
          );

          for (
            const hit
            of keywordHits
          ) {
            for (
              const position
              of hit.positions
            ) {
              console.log(
                `  ${hit.keyword}: ${position.snippet}`
              );
            }
          }
        } else if (
          !options.saveHitsOnly
        ) {
          const imagePath =
            path.join(
              OUTPUT_DIR,
              `page_${String(
                pageNumber
              ).padStart(3, "0")}.png`
            );

          fs.writeFileSync(
            imagePath,
            pngBuffer
          );

          pageResult.renderedImage =
            imagePath;
        }

        console.log(
          `  OCR chars: ${
            compact.length
          }`
        );
      } finally {
        canvasFactory.destroy(
          canvasAndContext
        );
      }
    }
  } finally {
    await worker.terminate();
  }

  console.log(
    "\n[4] OCR result summary"
  );

  const hitPages =
    pageResults.filter(
      (page) =>
        page.matched
    );

  if (
    hitPages.length === 0
  ) {
    console.log(
      "NO KEYWORD MATCH"
    );
  } else {
    for (
      const page
      of hitPages
    ) {
      console.log(
        `Page ${
          page.page
        } : ${
          page.matchingKeywords.join(
            ", "
          )
        }`
      );
    }
  }

  console.log(
    "\n[5] Page OCR preview"
  );

  for (
    const page
    of pageResults
  ) {
    const preview =
      compactText(
        page.text
      ).slice(
        0,
        250
      );

    console.log(
      `Page ${
        String(
          page.page
        ).padStart(3, " ")
      } | chars=${
        page.ocrTextChars
      } | ${
        page.matched
          ? "MATCH"
          : "----"
      }`
    );

    if (preview) {
      console.log(
        `  ${preview}`
      );
    } else {
      console.log(
        "  (OCR empty)"
      );
    }
  }

  const baseName =
    "eum_notice_pdf_ocr_4413310300111160000_44130NTC202001020001";

  const jsonPath =
    path.join(
      OUTPUT_DIR,
      `${baseName}.json`
    );

  const textPath =
    path.join(
      OUTPUT_DIR,
      `${baseName}.txt`
    );

  const result = {
    probeVersion:
      "0.1",

    analyzedAt:
      new Date().toISOString(),

    pdfPath:
      options.pdfPath,

    fileSize:
      stat.size,

    pdfPages:
      pdf.numPages,

    renderScale:
      options.scale,

    requestedPages:
      pageNumbers,

    targetKeywords:
      TARGET_KEYWORDS,

    hitPages:
      hitPages.map(
        (page) => ({
          page:
            page.page,

          matchingKeywords:
            page.matchingKeywords,

          renderedImage:
            page.renderedImage ||
            null,

          text:
            page.text,

          keywordHits:
            page.keywordHits
        })
      ),

    pages:
      pageResults.map(
        (page) => ({
          page:
            page.page,

          width:
            page.width,

          height:
            page.height,

          ocrTextChars:
            page.ocrTextChars,

          matched:
            page.matched,

          matchingKeywords:
            page.matchingKeywords,

          renderedImage:
            page.renderedImage ||
            null,

          keywordHits:
            page.keywordHits,

          text:
            page.text
        })
      )
  };

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
    of pageResults
  ) {
    textParts.push(
      "============================================================"
    );

    textParts.push(
      `PAGE ${page.page}`
    );

    textParts.push(
      `OCR chars: ${page.ocrTextChars}`
    );

    textParts.push(
      `MATCH: ${
        page.matched
          ? page.matchingKeywords.join(
              ", "
            )
          : "NO"
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
    hitPages.length > 0
  ) {
    console.log(
      "RESULT: PASS - TARGET FOUND"
    );
  } else {
    console.log(
      "RESULT: PASS - OCR COMPLETED, TARGET NOT FOUND"
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
      `${error?.name || "Error"}: ` +
      `${error?.message || String(error)}`
    );

    console.log(
      "=============================================================================="
    );

    process.exitCode = 1;
  }
);