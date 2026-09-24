import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { URL } from "node:url";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tests", "output");
const ATTACH_DIR = path.join(OUT_DIR, "attachments");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "HeadlessChrome/140.0.0.0 Safari/537.36";

function fail(message) {
  throw new Error(message);
}

function requestBuffer(urlString, options = {}) {
  const {
    timeoutMs = 120000,
    maxBytes = 512 * 1024 * 1024
  } = options;

  return new Promise((resolve, reject) => {
    let url;

    try {
      url = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }

    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          Referer:
            "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp",
          Connection: "close"
        }
      },
      (res) => {
        const chunks = [];
        let total = 0;

        res.on("data", (chunk) => {
          if (!Buffer.isBuffer(chunk)) {
            chunk = Buffer.from(chunk);
          }

          if (total >= maxBytes) {
            return;
          }

          const remain = maxBytes - total;

          if (chunk.length > remain) {
            chunks.push(chunk.subarray(0, remain));
            total += remain;
          } else {
            chunks.push(chunk);
            total += chunk.length;
          }
        });

        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(res.headers).map(([k, v]) => [
                k,
                Array.isArray(v)
                  ? v.join(", ")
                  : String(v ?? "")
              ])
            ),
            body: Buffer.concat(chunks),
            truncated: total >= maxBytes
          });
        });

        res.on("error", reject);
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(
        new Error(
          `REQUEST_TIMEOUT after ${timeoutMs} ms`
        )
      );
    });

    req.on("error", reject);

    req.end();
  });
}

function safeFileName(name) {
  return String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .trim();
}

function sniffMagic(buffer) {
  if (
    buffer.length >= 4 &&
    buffer.subarray(0, 4).equals(
      Buffer.from("%PDF")
    )
  ) {
    return "pdf";
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b
  ) {
    return "zip";
  }

  return "unknown";
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;

  const minOffset = Math.max(
    0,
    buffer.length - 65557
  );

  for (
    let offset = buffer.length - 22;
    offset >= minOffset;
    offset--
  ) {
    if (
      buffer.readUInt32LE(offset) === signature
    ) {
      return offset;
    }
  }

  return -1;
}

function decodeZipFileName(rawBytes, flags) {
  const utf8 = Boolean(flags & 0x0800);

  if (utf8) {
    try {
      return new TextDecoder("utf-8").decode(rawBytes);
    } catch {
      return new TextDecoder("euc-kr").decode(rawBytes);
    }
  }

  let eucKr;

  try {
    eucKr = new TextDecoder("euc-kr").decode(
      rawBytes
    );
  } catch {
    eucKr = "";
  }

  const utf8Candidate =
    new TextDecoder("utf-8").decode(rawBytes);

  const hasReplacement =
    utf8Candidate.includes("\uFFFD");

  if (!hasReplacement) {
    return utf8Candidate;
  }

  return eucKr || utf8Candidate;
}

function parseZipCentralDirectory(buffer) {
  if (sniffMagic(buffer) !== "zip") {
    fail(
      "The downloaded file does not begin with ZIP signature."
    );
  }

  const eocd = findEndOfCentralDirectory(buffer);

  if (eocd < 0) {
    fail(
      "ZIP end-of-central-directory record not found."
    );
  }

  const totalEntries =
    buffer.readUInt16LE(eocd + 10);

  const centralDirectorySize =
    buffer.readUInt32LE(eocd + 12);

  const centralDirectoryOffset =
    buffer.readUInt32LE(eocd + 16);

  const entries = [];

  let offset = centralDirectoryOffset;

  for (
    let i = 0;
    i < totalEntries;
    i++
  ) {
    if (
      offset + 46 > buffer.length ||
      buffer.readUInt32LE(offset) !== 0x02014b50
    ) {
      break;
    }

    const flags =
      buffer.readUInt16LE(offset + 8);

    const method =
      buffer.readUInt16LE(offset + 10);

    const compressedSize =
      buffer.readUInt32LE(offset + 20);

    const uncompressedSize =
      buffer.readUInt32LE(offset + 24);

    const fileNameLength =
      buffer.readUInt16LE(offset + 28);

    const extraLength =
      buffer.readUInt16LE(offset + 30);

    const commentLength =
      buffer.readUInt16LE(offset + 32);

    const externalAttributes =
      buffer.readUInt32LE(offset + 38);

    const localHeaderOffset =
      buffer.readUInt32LE(offset + 42);

    const start =
      offset + 46;

    const end =
      start + fileNameLength;

    const rawName =
      buffer.subarray(start, end);

    const fileName =
      decodeZipFileName(
        rawName,
        flags
      );

    const isDirectory =
      fileName.endsWith("/") ||
      Boolean(
        externalAttributes & 0x10
      );

    entries.push({
      index: i + 1,
      name: fileName,
      compressedSize,
      uncompressedSize,
      compressionMethod: method,
      localHeaderOffset,
      isDirectory
    });

    offset =
      end +
      extraLength +
      commentLength;
  }

  return {
    totalEntries,
    centralDirectorySize,
    centralDirectoryOffset,
    parsedEntries: entries.length,
    entries
  };
}

function classifyAttachmentNames(entries) {
  return entries.map((entry) => {
    const name =
      entry.name.toLowerCase();

    let category = "other";

    if (
      name.includes("고시") ||
      name.includes("공고")
    ) {
      category = "notice";
    }

    if (
      name.includes("결정도") ||
      name.includes("결정") &&
      (
        name.includes("도면") ||
        name.includes("도")
      )
    ) {
      category = "decision_drawing";
    }

    if (
      name.includes("지형도면") ||
      name.includes("지형도") ||
      name.includes("도면")
    ) {
      category = "map";
    }

    if (
      name.includes("시행지침") ||
      name.includes("지침")
    ) {
      category = "implementation_guideline";
    }

    if (
      name.includes("조서") ||
      name.includes("토지조서")
    ) {
      category = "land_register";
    }

    if (
      name.includes("변경결정도") ||
      name.includes("변경결정")
    ) {
      category = "changed_decision";
    }

    return {
      ...entry,
      category
    };
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, {
    recursive: true
  });

  fs.mkdirSync(ATTACH_DIR, {
    recursive: true
  });

  const args =
    process.argv.slice(2);

  const pnu = args[0];

  if (!pnu || !/^\d{19}$/.test(pnu)) {
    fail(
      "Usage: node tests\\eum_notice_attachment_probe.js <19-digit-PNU> [notice-code]"
    );
  }

  const noticeCode =
    args[1] || "";

  const detailFiles =
    fs.readdirSync(OUT_DIR)
      .filter((name) =>
        name.startsWith(
          `eum_notice_detail_${pnu}_`
        )
      )
      .filter((name) =>
        name.endsWith(".json")
      )
      .sort();

  if (!detailFiles.length) {
    fail(
      `No saved notice-detail JSON found for PNU ${pnu}.`
    );
  }

  let detailFile;

  if (noticeCode) {
    detailFile =
      detailFiles.find((name) =>
        name.includes(noticeCode)
      );
  } else {
    detailFile =
      detailFiles[detailFiles.length - 1];
  }

  if (!detailFile) {
    fail(
      `Saved detail JSON for notice_code ${noticeCode} not found.`
    );
  }

  const detailPath =
    path.join(
      OUT_DIR,
      detailFile
    );

  const detail =
    JSON.parse(
      fs.readFileSync(
        detailPath,
        "utf8"
      )
    );

  const selected =
    detail.selected_notice;

  console.log(
    "=============================================================================="
  );
  console.log(
    "korean_urban_plan_mcp - EUM attachment probe v0.1"
  );
  console.log(
    "=============================================================================="
  );

  console.log(
    `PNU: ${pnu}`
  );

  console.log(
    `notice_code: ${
      selected?.notice_code || "(unknown)"
    }`
  );

  console.log(
    `title: ${
      selected?.title || "(unknown)"
    }`
  );

  console.log(
    `detail source: ${detailPath}`
  );

  const attachments =
    Array.isArray(detail.attachments)
      ? detail.attachments
      : [];

  if (!attachments.length) {
    fail(
      "No attachments found in saved detail JSON."
    );
  }

  console.log(
    `Attachments in detail JSON: ${attachments.length}`
  );

  for (
    let i = 0;
    i < attachments.length;
    i++
  ) {
    const attachment =
      attachments[i];

    console.log("\n------------------------------------------------------------");
    console.log(
      `[${i + 1}] ${attachment.text || "(no text)"}`
    );

    console.log(
      `kind: ${attachment.kind}`
    );

    console.log(
      `url: ${attachment.url}`
    );

    const response =
      await requestBuffer(
        attachment.url
      );

    console.log(
      `HTTP status: ${response.status}`
    );

    console.log(
      `Content-Type: ${
        response.headers["content-type"] || ""
      }`
    );

    console.log(
      `Content-Length: ${
        response.headers["content-length"] || ""
      }`
    );

    console.log(
      `Downloaded bytes: ${response.body.length}`
    );

    console.log(
      `Magic: ${sniffMagic(response.body)}`
    );

    if (
      response.status < 200 ||
      response.status >= 400
    ) {
      console.log(
        "DOWNLOAD RESULT: FAIL"
      );
      continue;
    }

    const extension =
      attachment.kind === "zip"
        ? ".zip"
        : attachment.kind === "pdf"
          ? ".pdf"
          : ".bin";

    const base =
      safeFileName(
        `${selected.notice_code}_${i + 1}`
      );

    const outputPath =
      path.join(
        ATTACH_DIR,
        `${base}${extension}`
      );

    fs.writeFileSync(
      outputPath,
      response.body
    );

    console.log(
      `Saved: ${outputPath}`
    );

    if (
      attachment.kind === "zip"
    ) {
      const zip =
        parseZipCentralDirectory(
          response.body
        );

      const classified =
        classifyAttachmentNames(
          zip.entries
        );

      console.log("\nZIP SUMMARY");
      console.log(
        `Total entries: ${zip.totalEntries}`
      );
      console.log(
        `Parsed entries: ${zip.parsedEntries}`
      );

      console.log("\nZIP FILE LIST");

      for (const entry of classified) {
        console.log(
          `[${
            entry.category
          }] ${entry.name}`
        );

        console.log(
          `    compressed=${entry.compressedSize} ` +
          `uncompressed=${entry.uncompressedSize} ` +
          `method=${entry.compressionMethod}`
        );
      }

      const summary = {
        notice_code:
          selected.notice_code,

        notice_no:
          selected.notice_no,

        zip_file:
          outputPath,

        total_entries:
          zip.totalEntries,

        parsed_entries:
          zip.parsedEntries,

        entries:
          classified
      };

      const summaryPath =
        path.join(
          ATTACH_DIR,
          `${base}_contents.json`
        );

      fs.writeFileSync(
        summaryPath,
        JSON.stringify(
          summary,
          null,
          2
        ),
        "utf8"
      );

      console.log(
        `ZIP contents JSON: ${summaryPath}`
      );
    }
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

main().catch((error) => {
  console.log(
    "\nRESULT: FAIL"
  );

  console.log(
    `${error?.name || "Error"}: ` +
    `${error?.message || String(error)}`
  );

  process.exitCode = 1;
});