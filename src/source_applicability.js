import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { locatePdfEvidence } from "./evidence_locator.js";

const execFileAsync = promisify(execFile);

const HWP_EXTRACT_SCRIPT = String.raw`
import sys
import json
import struct
import zlib
import olefile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(
        encoding="utf-8",
        errors="strict"
    )

p = sys.argv[1]

ole = olefile.OleFileIO(p)

try:
    section_names = []

    for parts in ole.listdir(
        streams=True,
        storages=False
    ):
        if (
            len(parts) == 2
            and parts[0] == "BodyText"
            and __import__("re").fullmatch(
                r"Section\d+",
                parts[1]
            )
        ):
            section_names.append(parts[1])

    section_names.sort(
        key=lambda name:
            int(name[len("Section") :])
    )

    if not section_names:
        print(json.dumps({
            "ok": False,
            "reason": "BodyText/SectionN not found"
        }, ensure_ascii=False))
        raise SystemExit(0)

    parts = []
    section_meta = []

    for section_name in section_names:
        compressed = ole.openstream(
            ["BodyText", section_name]
        ).read()

        try:
            data = zlib.decompress(
                compressed,
                -15
            )
        except zlib.error:
            data = zlib.decompress(
                compressed
            )

        pos = 0
        section_record_count = 0

        while pos + 4 <= len(data):
            header = struct.unpack_from(
                "<I",
                data,
                pos
            )[0]
            pos += 4

            tag_id = header & 0x3FF
            size = (header >> 20) & 0xFFF

            if size == 0xFFF:
                if pos + 4 > len(data):
                    break

                size = struct.unpack_from(
                    "<I",
                    data,
                    pos
                )[0]
                pos += 4

            if pos + size > len(data):
                break

            payload = data[
                pos :
                pos + size
            ]
            pos += size

            if tag_id == 0x43:
                parts.append(
                    payload.decode(
                        "utf-16le",
                        errors="ignore"
                    )
                )
                section_record_count += 1

        section_meta.append({
            "name": section_name,
            "recordCount": section_record_count
        })

    text = "\n".join(parts)

    print(json.dumps({
        "ok": True,
        "text": text,
        "recordCount": len(parts),
        "sectionCount": len(section_names),
        "sections": section_meta
    }, ensure_ascii=False))

finally:
    ole.close()
`;

const ZIP_EXTRACT_SCRIPT = String.raw`
import sys
import json
import zipfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(
        encoding="utf-8",
        errors="strict"
    )

zip_path = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)

def detect(head, name):
    suffix = Path(name).suffix.lower()

    if suffix in (".txt", ".text"):
        return "text", ".txt"

    if suffix in (".hwp", ".hwpx"):
        return "hwp", ".hwp"

    if head.startswith(b"%PDF"):
        return "pdf", ".pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", ".png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg", ".jpg"
    if head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        return "ole", ".bin"
    if head.startswith(b"PK"):
        return "zip", ".zip"
    return "unknown", ".bin"

results = []

with zipfile.ZipFile(zip_path, "r") as z:
    for index, info in enumerate(z.infolist(), 1):
        if info.is_dir():
            continue

        with z.open(info) as f:
            head = f.read(32)

        kind, ext = detect(head, info.filename)

        if kind not in ("pdf", "ole", "text", "hwp"):
            continue

        out_path = out_dir / ("source_" + str(index).zfill(3) + ext)

        with z.open(info) as src, open(out_path, "wb") as dst:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                dst.write(chunk)

        results.append({
            "entryIndex": index,
            "entryName": info.filename,
            "kind": kind,
            "path": str(out_path),
            "originalBytes": info.file_size,
            "compressedBytes": info.compress_size
        })

print(json.dumps({
    "ok": True,
    "entries": results
}, ensure_ascii=False))
`;

function compact(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalize(value) {
  return compact(value)
    .replace(/[\\s]+/gu, "")
    .replace(
      /[|｜,，:：.;·ㆍ"'"“”‘’()[\]{}<>《》「」『』/\\_-]/g,
      ""
    )
    .toLowerCase();
}

function makeParcelNumberVariants(
  pnu
) {
  const value =
    String(pnu ?? "");

  if (!/^\d{19}$/.test(value)) {
    return [];
  }

  const mainNo =
    String(
      Number(
        value.slice(11, 15)
      )
    );

  const subNo =
    String(
      Number(
        value.slice(15, 19)
      )
    );

  const variants =
    new Set();

  if (mainNo === "0") {
    return [];
  }

  if (subNo === "0") {
    variants.add(mainNo);
    variants.add(mainNo + "번지");
  } else {
    variants.add(mainNo + "-" + subNo);
    variants.add(mainNo + subNo);
    variants.add(mainNo + "-" + subNo + "번지");
    variants.add(mainNo + " " + subNo + "번지");
  }

  return [
    ...variants
  ];
}


function makeJibunVariants(jibun) {
  const source = compact(jibun);
  const variants = new Set();

  if (!source) {
    return [];
  }

  variants.add(source);
  variants.add(normalize(source));

  const match =
    /(.*?)(\d+(?:-\d+)?)\s*(?:번지)?$/u.exec(source);

  if (match) {
    const prefix = compact(match[1]);
    const number = match[2];

    if (prefix) {
      variants.add(prefix + number);
      variants.add(prefix + " " + number);
      variants.add(prefix + number + "번지");
      variants.add(prefix + " " + number + "번지");
    }
  }

  return [...variants].filter(Boolean);
}

function findMatches(text, variants) {
  const normalizedText = normalize(text);
  const matches = [];

  for (const variant of variants) {
    if (
      normalizedText.includes(
        normalize(variant)
      )
    ) {
      matches.push(variant);
    }
  }

  return [...new Set(matches)];
}

function snippetAround(text, variant) {
  const source = compact(text);
  const target = normalize(variant);

  if (!target) {
    return null;
  }

  let normalizedText = "";
  const indexMap = [];

  for (let i = 0; i < source.length; i += 1) {
    const piece = normalize(source[i]);

    if (!piece) {
      continue;
    }

    for (let j = 0; j < piece.length; j += 1) {
      normalizedText += piece[j];
      indexMap.push(i);
    }
  }

  const normalizedIndex = normalizedText.indexOf(target);

  if (normalizedIndex < 0) {
    return null;
  }

  const originalIndex =
    indexMap[normalizedIndex] ?? -1;

  if (originalIndex < 0) {
    return null;
  }

  const start = Math.max(
    0,
    originalIndex - 240
  );

  const end = Math.min(
    source.length,
    originalIndex + variant.length + 360
  );

  return source.slice(start, end);
}

function roleFromName(name) {
  const value = compact(name).toLowerCase();

  if (
    value.includes("시행지침") ||
    value.includes("시행 지침")
  ) {
    return "implementation_guideline";
  }

  if (
    value.includes("결정도") ||
    value.includes("결정도면")
  ) {
    return "decision_drawing";
  }

  if (
    value.includes("지형도") ||
    value.includes("지형도면")
  ) {
    return "terrain_map";
  }

  if (
    value.includes("고시") ||
    value.includes("관보")
  ) {
    return "notice_document";
  }

  return "source_document";
}

async function fileHash(filePath) {
  const data =
    await fs.readFile(
      filePath
    );

  return crypto
    .createHash("sha256")
    .update(data)
    .digest("hex");
}


function extensionOf(filePath) {
  return path.extname(
    String(filePath ?? "")
  ).toLowerCase();
}

async function extractPdfNativeText(filePath) {
  const buffer = await fs.readFile(filePath);

  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false
  }).promise;

  const pages = [];

  for (
    let pageNo = 1;
    pageNo <= pdf.numPages;
    pageNo += 1
  ) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();

    const text = compact(
      content.items
        .map(item => item?.str ?? "")
        .join(" ")
    );

    pages.push({
      page: pageNo,
      text
    });

    page.cleanup();
  }

  return {
    pageCount: pdf.numPages,
    pages,
    text: pages
      .map(item => item.text)
      .filter(Boolean)
      .join("\n")
  };
}

async function runPythonJson(
  script,
  args
) {
  let lastError = null;

  for (
    const executable
    of ["python", "py"]
  ) {
    try {
      const result =
        await execFileAsync(
          executable,
          ["-c", script, ...args],
          {
            windowsHide: true,
            maxBuffer: 32 * 1024 * 1024,
            env: {
              ...process.env,
              PYTHONIOENCODING: "utf-8",
              PYTHONUTF8: "1"
            }
          }
        );

      const stdout =
        String(
          result.stdout ?? ""
        ).trim();

      if (!stdout) {
        throw new Error(
          "Python helper returned empty output."
        );
      }

      return JSON.parse(stdout);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    "Python helper failed: " +
    String(lastError?.message || lastError)
  );
}

async function extractHwpText(filePath) {
  return runPythonJson(
    HWP_EXTRACT_SCRIPT,
    [filePath]
  );
}

async function inspectZipTextSources(
  zipPath,
  noticeDir
) {
  const outputDir =
    path.join(
      noticeDir,
      "unzipped_text"
    );

  const result =
    await runPythonJson(
      ZIP_EXTRACT_SCRIPT,
      [
        zipPath,
        outputDir
      ]
    );

  return {
    outputDir,
    entries:
      Array.isArray(result.entries)
        ? result.entries
        : []
  };
}

async function classifyFile(
  filePath,
  displayName = ""
) {
  const name =
    String(displayName || filePath);

  const ext = extensionOf(filePath);

  if (ext === ".pdf") {
    return "pdf";
  }

  if (
    ext === ".txt" ||
    ext === ".text"
  ) {
    return "text";
  }

  if (
    ext === ".hwp" ||
    ext === ".hwpx"
  ) {
    return "hwp";
  }

  if (ext === ".zip") {
    return "zip";
  }

  const buffer =
    await fs.readFile(
      filePath
    );

  if (
    buffer.length >= 4 &&
    buffer.subarray(0, 4).toString() === "%PDF"
  ) {
    return "pdf";
  }

  if (
    buffer.length >= 2 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  ) {
    return "zip";
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).toString("hex") ===
      "d0cf11e0a1b11ae1"
  ) {
    return "ole";
  }

  if (
    /\\.hwp(?:x)?$/i.test(name)
  ) {
    return "hwp";
  }

  return "unknown";
}

async function analyzeOneTextSource(
  filePath,
  {
    displayName = null,
    sourceKind = null,
    variants,
    parcelNumberVariants = [],
    enableOcrFallback = true,
    ocrPsmModes = ["3", "6", "11"],
    ocrScale = 2.5,
    ocrMaxPages = 24
  } = {}
) {
  const kind =
    sourceKind ||
    await classifyFile(
      filePath,
      displayName
    );

  if (kind === "pdf") {
    const pdf =
      await extractPdfNativeText(
        filePath
      );

    const matches =
      findMatches(
        pdf.text,
        variants
      );

    const parcelNumberMatches =
      findMatches(
        pdf.text,
        parcelNumberVariants
      );

    const matchedPageNumbers =
      pdf.pages
        .filter(
          page =>
            findMatches(
              page.text,
              variants
            ).length > 0
        )
        .map(
          page => page.page
        );

    const parcelNumberMatchedPages =
      pdf.pages
        .filter(
          page =>
            findMatches(
              page.text,
              parcelNumberVariants
            ).length > 0
        )
        .map(
          page => page.page
        );

    const role = roleFromName(
      displayName || filePath
    );

    let ocr = null;
    let ocrSkippedReason = null;

    const mapOnlyRole =
      role === "decision_drawing" ||
      role === "terrain_map";

    if (!enableOcrFallback) {
      ocrSkippedReason = "disabled";
    } else if (mapOnlyRole) {
      ocrSkippedReason =
        "map_source_requires_manual_visual_review";
    } else if (pdf.pageCount > ocrMaxPages) {
      ocrSkippedReason =
        "large_pdf_over_page_limit";
    } else if (matches.length === 0) {
      try {
        ocr =
          await locatePdfEvidence(
            filePath,
            {
              jibun:
                variants[0] || "",
              saveMatchedImages:
                false,
              scale:
                ocrScale,
              ocrPsmModes
            }
          );
      } catch (error) {
        ocr = {
          error:
            String(
              error?.message ||
              error
            )
        };
      }
    }

    const ocrMatched =
      Boolean(
        ocr?.parcelEvidence?.pages?.length
      );

    const ocrEvidence =
      ocr?.parcelEvidence || {
        pages: [],
        primary: null,
        allMatches: []
      };

    return {
      fileType: "pdf",
      filePath,
      displayName,
      role,

      pageCount:
        pdf.pageCount,
      textChars:
        pdf.text.length,
      matched:
        matches.length > 0 ||
        ocrMatched,
      matchMethod:
        matches.length > 0
          ? "native_text"
          : ocrMatched
            ? "ocr"
            : null,
      matchedVariants:
        matches,
      matchedPages:
        matchedPageNumbers,
      parcelNumberMatched:
        parcelNumberMatches.length > 0,
      parcelNumberMatchedVariants:
        parcelNumberMatches,
      parcelNumberMatchedPages:
        parcelNumberMatchedPages,
      snippet:
        matches.length > 0
          ? snippetAround(
              pdf.text,
              matches[0]
            )
          : null,
      parcelNumberSnippet:
        parcelNumberMatches.length > 0
          ? snippetAround(
              pdf.text,
              parcelNumberMatches[0]
            )
          : null,
      ocrAttempted:
        Boolean(ocr),
      ocrSkipped:
        Boolean(ocrSkippedReason),
      ocrSkippedReason,
      ocrMaxPages,
      ocrMatched,
      ocrPsmModes:
        ocr?.ocrPsmModes ??
        ocrPsmModes,
      ocrEvidence,
      ocrWarnings:
        ocr?.warnings ?? [],
      ocrError:
        ocr?.error ?? null,
      status:
        pdf.text.length === 0
          ? (
              ocrMatched
                ? "ocr_confirmed"
                : ocrSkippedReason
                  ? "text_layer_unavailable_ocr_skipped"
                  : "text_layer_unavailable_ocr_not_confirmed"
            )
          : (
              ocrMatched
                ? "ocr_confirmed"
                : "text_extracted_not_confirmed"
            )
    };
  }

  if (
    kind === "hwp" ||
    kind === "ole"
  ) {
    try {
      const hwp =
        await extractHwpText(
          filePath
        );

      if (!hwp?.ok) {
        return {
          fileType:
            kind === "hwp"
              ? "hwp"
              : "ole",
          filePath,
          displayName,
          role:
            roleFromName(
              displayName || filePath
            ),
          textChars: 0,
          matched: false,
          matchedVariants: [],
          matchedPages: [],
          snippet: null,
          status:
            "hwp_text_unavailable",
          reason:
            hwp?.reason ||
            null
        };
      }

      const matches =
        findMatches(
          hwp.text,
          variants
        );

      const parcelNumberMatches =
        findMatches(
          hwp.text,
          parcelNumberVariants
        );

      return {
        fileType: "hwp",
        filePath,
        displayName,
        role:
          roleFromName(
            displayName || filePath
          ),
        textChars:
          compact(hwp.text).length,
        matched:
          matches.length > 0,
        matchMethod:
          matches.length > 0
            ? "native_text"
            : null,
        matchedVariants:
          matches,
        matchedPages: [],
        parcelNumberMatched:
          parcelNumberMatches.length > 0,
        parcelNumberMatchedVariants:
          parcelNumberMatches,
        parcelNumberMatchedPages: [],
        snippet:
          matches.length > 0
            ? snippetAround(
                hwp.text,
                matches[0]
              )
            : null,
        parcelNumberSnippet:
          parcelNumberMatches.length > 0
            ? snippetAround(
                hwp.text,
                parcelNumberMatches[0]
              )
            : null,
        status:
          "text_extracted"
      };
    } catch (error) {
      return {
        fileType:
          kind === "hwp"
            ? "hwp"
            : "ole",
        filePath,
        displayName,
        role:
          roleFromName(
            displayName || filePath
          ),
        textChars: 0,
        matched: false,
        matchedVariants: [],
        matchedPages: [],
        snippet: null,
        status:
          "hwp_text_error",
        reason:
          String(
            error?.message ||
            error
          )
      };
    }
  }

  if (
    kind === "text"
  ) {
    const text =
      compact(
        await fs.readFile(
          filePath,
          "utf8"
        )
      );

    const matches =
      findMatches(
        text,
        variants
      );

    const parcelNumberMatches =
      findMatches(
        text,
        parcelNumberVariants
      );

    return {
      fileType: "text",
      filePath,
      displayName,
      role:
        roleFromName(
          displayName || filePath
        ),
      textChars:
        text.length,
      matched:
        matches.length > 0,
      matchMethod:
        matches.length > 0
          ? "native_text"
          : null,
      matchedVariants:
        matches,
      matchedPages: [],
      parcelNumberMatched:
        parcelNumberMatches.length > 0,
      parcelNumberMatchedVariants:
        parcelNumberMatches,
      parcelNumberMatchedPages: [],
      snippet:
        matches.length > 0
          ? snippetAround(
              text,
              matches[0]
            )
          : null,
      parcelNumberSnippet:
        parcelNumberMatches.length > 0
          ? snippetAround(
              text,
              parcelNumberMatches[0]
            )
          : null
    };
  }

  return null;
}

export async function analyzeTextApplicability({
  pnu,
  jibun,
  notice,
  attachments,
  noticeDir,
  enableOcrFallback = true,
  ocrPsmModes = ["3", "6", "11"],
  ocrScale = 2.5,
  ocrMaxPages = 24
}) {
  const variants =
    makeJibunVariants(
      jibun
    );

  const parcelNumberVariants =
    makeParcelNumberVariants(
      pnu
    );

  const sources = [];

  const noticeText =
    compact(
      [
        notice?.title,
        notice?.content,
        notice?.ucode_nm,
        notice?.ucode
      ]
        .filter(Boolean)
        .join("\n")
    );

  if (noticeText) {
    const matches =
      findMatches(
        noticeText,
        variants
      );

    const parcelNumberMatches =
      findMatches(
        noticeText,
        parcelNumberVariants
      );

    sources.push({
      fileType: "notice_metadata",
      filePath: null,
      displayName:
        "EUM notice metadata/content",
      role: "notice_metadata",
      textChars:
        noticeText.length,
      matched:
        matches.length > 0,
      matchedVariants:
        matches,
      matchedPages: [],
      parcelNumberMatched:
        parcelNumberMatches.length > 0,
      parcelNumberMatchedVariants:
        parcelNumberMatches,
      parcelNumberMatchedPages: [],
      snippet:
        matches.length > 0
          ? snippetAround(
              noticeText,
              matches[0]
            )
          : null
    });
  }

  const processedFileHashes =
    new Map();

  for (
    const attachment
    of Array.isArray(
      attachments
    )
      ? attachments
      : []
  ) {
    if (!attachment?.filePath) {
      continue;
    }

    const attachmentHash =
      await fileHash(
        attachment.filePath
      );

    if (
      processedFileHashes.has(
        attachmentHash
      )
    ) {
      sources.push({
        fileType:
          await classifyFile(
            attachment.filePath,
            attachment.displayName
          ),
        filePath:
          attachment.filePath,
        displayName:
          attachment.displayName,
        role:
          roleFromName(
            attachment.displayName ||
            attachment.filePath
          ),
        duplicateOf:
          processedFileHashes.get(
            attachmentHash
          ),
        skipped:
          true,
        status:
          "duplicate_source_skipped"
      });

      continue;
    }

    processedFileHashes.set(
      attachmentHash,
      attachment.filePath
    );

    const kind =
      await classifyFile(
        attachment.filePath,
        attachment.displayName
      );

    if (
      kind === "pdf" ||
      kind === "hwp" ||
      kind === "ole" ||
      kind === "text"
    ) {
      const result =
        await analyzeOneTextSource(
          attachment.filePath,
          {
            displayName:
              attachment.displayName,
            sourceKind:
              kind,
            variants,
            parcelNumberVariants,
            enableOcrFallback,
            ocrPsmModes,
            ocrScale,
            ocrMaxPages
          }
        );

      if (result) {
        sources.push(result);
      }

      continue;
    }

    if (kind === "unknown") {
      continue;
    }

    if (
      attachment.kind === "zip" ||
      attachment.magic === "zip"
    ) {
      const zipInfo =
        await inspectZipTextSources(
          attachment.filePath,
          noticeDir
        );

      for (
        const entry
        of zipInfo.entries
      ) {
        const entryHash =
          await fileHash(
            entry.path
          );

        if (
          processedFileHashes.has(
            entryHash
          )
        ) {
          sources.push({
            fileType:
              entry.kind,
            filePath:
              entry.path,
            displayName:
              entry.entryName,
            role:
              roleFromName(
                entry.entryName
              ),
            duplicateOf:
              processedFileHashes.get(
                entryHash
              ),
            container:
              attachment.displayName,
            entryIndex:
              entry.entryIndex,
            skipped:
              true,
            status:
              "duplicate_source_skipped"
          });

          continue;
        }

        processedFileHashes.set(
          entryHash,
          entry.path
        );

        const result =
          await analyzeOneTextSource(
            entry.path,
            {
              displayName:
                entry.entryName,
              sourceKind:
                entry.kind === "pdf"
                  ? "pdf"
                  : entry.kind === "text"
                    ? "text"
                    : entry.kind === "hwp"
                      ? "hwp"
                      : "ole",
              variants,
              parcelNumberVariants,
              enableOcrFallback,
              ocrPsmModes,
              ocrScale,
              ocrMaxPages
            }
          );

        if (result) {
          sources.push({
            ...result,
            container:
              attachment.displayName,
            entryIndex:
              entry.entryIndex
          });
        }
      }

      continue;
    }
  }

  const matches =
    sources.filter(
      source =>
        source.matched
    );

  let status =
    "NOT_CONFIRMED_BY_TEXT";

  if (
    matches.some(
      source =>
        source.matchMethod ===
        "native_text"
    )
  ) {
    status =
      "CONFIRMED_BY_TEXT";
  } else if (
    matches.some(
      source =>
        source.matchMethod ===
        "ocr"
    )
  ) {
    status =
      "CONFIRMED_BY_OCR";
  } else if (
    sources.length === 0
  ) {
    status =
      "TEXT_SOURCE_UNAVAILABLE";
  } else if (
    sources.some(
      source =>
        source.status ===
          "text_layer_unavailable_ocr_not_confirmed" &&
        source.ocrAttempted
    )
  ) {
    status =
      "OCR_NOT_CONFIRMED";
  }

  const ocrSummary = {
    attempted:
      sources.filter(
        source =>
          source.ocrAttempted
      ).length,
    skipped:
      sources.filter(
        source =>
          source.ocrSkipped
      ).length,
    skippedReasons:
      [
        ...new Set(
          sources
            .map(
              source =>
                source.ocrSkippedReason
            )
            .filter(Boolean)
        )
      ]
  };

  return {
    status,
    target: {
      pnu:
        String(pnu ?? ""),
      jibun:
        compact(jibun),
      variants,
      parcelNumberVariants
    },
    matchCount:
      matches.length,
    ocrSummary,
    matchedSources:
      matches,
    parcelNumberCandidateCount:
      sources.filter(
        source =>
          source.parcelNumberMatched
      ).length,
    parcelNumberCandidateSources:
      sources.filter(
        source =>
          source.parcelNumberMatched
      ),
    sources
  };
}

export function buildSourcePackage(
  {
    noticeCode,
    attachments
  }
) {
  const files =
    Array.isArray(
      attachments
    )
      ? attachments.map(
          (attachment, index) => ({
            index:
              index + 1,
            displayName:
              attachment.displayName ??
              null,
            kind:
              attachment.kind ??
              null,
            magic:
              attachment.magic ??
              null,
            actualType:
              attachment.actualType ??
              null,
            filePath:
              attachment.filePath ??
              null,
            bytes:
              attachment.bytes ??
              null,
            downloaded:
              attachment.downloaded ??
              false,
            cached:
              attachment.cached ??
              false,
            originalUrl:
              attachment.url ??
              null
          })
        )
      : [];

  return {
    noticeCode:
      String(
        noticeCode ?? ""
      ),
    preservedOriginalCount:
      files.filter(
        file =>
          Boolean(
            file.filePath
          )
      ).length,
    files
  };
}
