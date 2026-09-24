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

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = argv.slice(2);

  const options = {
    pdfPath: DEFAULT_PDF,
    pages: []
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--pdf") {
      options.pdfPath = args[i + 1] ?? "";
      i += 1;
      continue;
    }

    if (arg === "--pages") {
      const value = args[i + 1] ?? "";

      options.pages = value
        .split(",")
        .map((x) => Number(x.trim()))
        .filter(
          (x) =>
            Number.isInteger(x) &&
            x > 0
        );

      i += 1;
      continue;
    }
  }

  return options;
}

async function loadPdfJs() {
  try {
    return await import(
      "pdfjs-dist/legacy/build/pdf.mjs"
    );
  } catch (error) {
    fail(
      `pdfjs-dist load failed:\n${
        error?.message || String(error)
      }`
    );
  }
}

function visibleText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function printCodePoints(text) {
  const compact =
    String(text ?? "")
      .replace(/\s+/g, " ")
      .trim();

  const chars = [
    ...compact
  ].slice(0, 120);

  return chars
    .map(
      (char) =>
        `${char}(U+${char
          .codePointAt(0)
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")})`
    )
    .join(" ");
}

async function extractPageText(
  pdfjsLib,
  pdf,
  pageNumber
) {
  const page =
    await pdf.getPage(
      pageNumber
    );

  const textContent =
    await page.getTextContent();

  const parts = [];

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

    parts.push(
      item.str
    );

    if (item.hasEOL) {
      parts.push("\n");
    } else {
      parts.push(" ");
    }
  }

  return {
    pageNumber,
    items:
      textContent.items.length,
    text:
      visibleText(
        parts.join("")
      )
  };
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
    "korean_urban_plan_mcp - EUM PDF text diagnostic v0.1"
  );
  console.log(
    "=============================================================================="
  );

  console.log(
    `PDF: ${options.pdfPath}`
  );

  if (
    !fs.existsSync(
      options.pdfPath
    )
  ) {
    fail(
      `PDF file not found:\n${options.pdfPath}`
    );
  }

  const stat =
    fs.statSync(
      options.pdfPath
    );

  console.log(
    `Size: ${stat.size.toLocaleString()} bytes`
  );

  const pdfjsLib =
    await loadPdfJs();

  const buffer =
    fs.readFileSync(
      options.pdfPath
    );

  const loadingTask =
    pdfjsLib.getDocument({
      data: new Uint8Array(
        buffer
      ),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false
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
    pageNumbers = [
      ...new Set(
        options.pages.filter(
          (page) =>
            page <=
            pdf.numPages
        )
      )
    ];
  } else {
    pageNumbers = [
      1,
      2,
      3,
      4,
      5,
      14,
      19,
      20,
      21,
      22,
      23,
      24,
      25,
      26,
      27,
      28,
      29,
      30,
      31
    ];
  }

  console.log(
    `Diagnostic pages: ${pageNumbers.join(", ")}`
  );

  for (
    const pageNumber
    of pageNumbers
  ) {
    const result =
      await extractPageText(
        pdfjsLib,
        pdf,
        pageNumber
      );

    const text =
      result.text;

    console.log(
      "\n============================================================"
    );

    console.log(
      `PAGE ${pageNumber}`
    );

    console.log(
      `Text items: ${result.items}`
    );

    console.log(
      `Text length: ${text.length}`
    );

    console.log(
      "\n--- RAW EXTRACTED TEXT ---"
    );

    if (!text.trim()) {
      console.log(
        "(EMPTY)"
      );
    } else {
      console.log(
        text.slice(0, 2500)
      );
    }

    console.log(
      "\n--- COMPACT TEXT ---"
    );

    console.log(
      text
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1000)
    );

    console.log(
      "\n--- CODE POINT SAMPLE ---"
    );

    console.log(
      printCodePoints(text)
    );
  }

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