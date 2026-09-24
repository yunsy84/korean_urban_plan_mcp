import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { URL } from "node:url";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "tests", "output");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "HeadlessChrome/140.0.0.0 Safari/537.36";

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = argv.slice(2);

  if (!args[0]) {
    fail("PNU is required.");
  }

  const opts = {
    pnu: args[0],
    noticeCode: "",
    noticeNo: "",
    orgCd: "",
    downloadCheck: true
  };

  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--notice-code") {
      opts.noticeCode = args[i + 1] ?? "";
      i += 1;
    } else if (arg === "--notice-no") {
      opts.noticeNo = args[i + 1] ?? "";
      i += 1;
    } else if (arg === "--org-cd") {
      opts.orgCd = args[i + 1] ?? "";
      i += 1;
    } else if (arg === "--no-download-check") {
      opts.downloadCheck = false;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  if (!/^\d{19}$/.test(opts.pnu)) {
    fail("PNU must be exactly 19 digits.");
  }

  return opts;
}

function ensureOutputDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, num) =>
      String.fromCodePoint(Number(num))
    );
}

function absoluteUrl(baseUrl, href) {
  const clean = decodeHtmlEntities(href).trim();

  if (!clean) {
    return null;
  }

  if (/^(javascript:|#)/i.test(clean)) {
    return null;
  }

  try {
    return new URL(clean, baseUrl).toString();
  } catch {
    return null;
  }
}

function collectNoticeRecords(node, output = [], seen = new WeakSet()) {
  if (node === null || node === undefined) {
    return output;
  }

  if (typeof node === "object") {
    if (seen.has(node)) {
      return output;
    }

    seen.add(node);
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      collectNoticeRecords(item, output, seen);
    }

    return output;
  }

  if (typeof node !== "object") {
    return output;
  }

  const isNotice =
    typeof node.notice_code === "string" &&
    typeof node.notice_no === "string" &&
    typeof node.org_cd === "string" &&
    typeof node.title === "string";

  if (isNotice) {
    output.push(node);
  }

  for (const value of Object.values(node)) {
    collectNoticeRecords(value, output, seen);
  }

  return output;
}

function selectNotice(records, opts) {
  if (opts.noticeCode) {
    const found = records.find(
      (record) => record.notice_code === opts.noticeCode
    );

    if (!found) {
      fail(`notice_code not found: ${opts.noticeCode}`);
    }

    return {
      notice: found,
      selection: "explicit_notice_code"
    };
  }

  let filtered = records;

  if (opts.noticeNo) {
    filtered = filtered.filter(
      (record) => record.notice_no === opts.noticeNo
    );
  }

  if (opts.orgCd) {
    filtered = filtered.filter(
      (record) => record.org_cd === opts.orgCd
    );
  }

  if (!filtered.length) {
    fail("No notice matched the supplied filters.");
  }

  return {
    notice: filtered[0],
    selection: "filtered_first"
  };
}

/**
 * 상세 페이지 요청.
 *
 * 중요:
 * - AbortController 사용 안 함
 * - fetch 사용 안 함
 * - node:https.request 사용
 * - socket timeout이 발생하면 REQUEST_TIMEOUT으로 명확히 실패
 */
function requestBuffer(urlString, options = {}) {
  const {
    method = "GET",
    headers = {},
    timeoutMs = 60000,
    maxBytes = 32 * 1024 * 1024
  } = options;

  return new Promise((resolve, reject) => {
    let url;

    try {
      url = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }

    if (url.protocol !== "https:") {
      reject(
        new Error(`Only HTTPS is supported: ${url.protocol}`)
      );
      return;
    }

    const request = https.request(
      url,
      {
        method,
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
          Connection: "close",
          ...headers
        }
      },
      (response) => {
        const chunks = [];
        let totalBytes = 0;

        response.on("data", (chunk) => {
          if (!Buffer.isBuffer(chunk)) {
            chunk = Buffer.from(chunk);
          }

          if (totalBytes >= maxBytes) {
            return;
          }

          const remain = maxBytes - totalBytes;

          if (chunk.length > remain) {
            chunks.push(chunk.subarray(0, remain));
            totalBytes += remain;
          } else {
            chunks.push(chunk);
            totalBytes += chunk.length;
          }
        });

        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [
                key,
                Array.isArray(value)
                  ? value.join(", ")
                  : String(value ?? "")
              ])
            ),
            body: Buffer.concat(chunks),
            truncated: totalBytes >= maxBytes
          });
        });

        response.on("error", (error) => {
          reject(error);
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new Error(`REQUEST_TIMEOUT after ${timeoutMs} ms`)
      );
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
}

function decodeResponseText(buffer, headers) {
  const contentType = String(
    headers["content-type"] ?? ""
  ).toLowerCase();

  const charsetMatch =
    /charset\s*=\s*([\w-]+)/i.exec(contentType);

  const charset = charsetMatch
    ? charsetMatch[1].toLowerCase()
    : "";

  const useEucKr =
    charset === "euc-kr" ||
    charset === "ks_c_5601-1987" ||
    charset === "cp949";

  const decoder = new TextDecoder(
    useEucKr ? "euc-kr" : "utf-8"
  );

  return {
    text: decoder.decode(buffer),
    encoding: useEucKr ? "euc-kr" : "utf-8",
    contentType
  };
}

function extractAnchors(html, baseUrl) {
  const anchors = [];

  const regex =
    /<a\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = regex.exec(html)) !== null) {
    const attrs = `${match[1]} ${match[4]}`;
    const href = absoluteUrl(baseUrl, match[3]);

    if (!href) {
      continue;
    }

    const text = match[5]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    anchors.push({
      href,
      text,
      attrs
    });
  }

  return anchors;
}

function extractAttachmentCandidates(html, baseUrl) {
  const anchors = extractAnchors(html, baseUrl);

  const seen = new Set();
  const candidates = [];

  for (const anchor of anchors) {
    const combined =
      `${anchor.href} ${anchor.text}`.toLowerCase();

    const looksLikeDownload =
      /DownloadBig\.jsp/i.test(anchor.href) ||
      /DownloadZip\.jsp/i.test(anchor.href) ||
      /\/download(?:\b|\?)/i.test(anchor.href) ||
      /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|jpg|jpeg|png|zip)(?:[?#]|$)/i.test(
        anchor.href
      ) ||
      /\.(pdf|hwp|hwpx|doc|docx|xls|xlsx|jpg|jpeg|png|zip)\b/i.test(
        anchor.text
      );

    if (!looksLikeDownload) {
      continue;
    }

    if (seen.has(anchor.href)) {
      continue;
    }

    seen.add(anchor.href);

    let kind = "file";

    if (/DownloadZip\.jsp/i.test(anchor.href)) {
      kind = "zip";
    } else if (
      /\.pdf(?:[?#]|$)/i.test(anchor.href) ||
      /\bpdf\b/i.test(combined)
    ) {
      kind = "pdf";
    }

    candidates.push({
      text: anchor.text,
      url: anchor.href,
      kind
    });
  }

  return candidates;
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
    return "zip_or_office";
  }

  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .toString("hex") === "89504e470d0a1a0a"
  ) {
    return "png";
  }

  if (
    buffer.length >= 3 &&
    buffer
      .subarray(0, 3)
      .toString("hex") === "ffd8ff"
  ) {
    return "jpeg";
  }

  return "unknown";
}

async function checkAttachment(candidate, referer) {
  const response = await requestBuffer(candidate.url, {
    method: "GET",
    timeoutMs: 60000,
    maxBytes: 64 * 1024,
    headers: {
      Referer: referer,
      Accept: "*/*",
      Range: "bytes=0-65535"
    }
  });

  return {
    text: candidate.text,
    url: candidate.url,
    kind: candidate.kind,
    status: response.status,
    contentType:
      response.headers["content-type"] ?? "",
    contentDisposition:
      response.headers["content-disposition"] ?? "",
    contentLength:
      response.headers["content-length"] ?? "",
    contentRange:
      response.headers["content-range"] ?? "",
    acceptRanges:
      response.headers["accept-ranges"] ?? "",
    bytesCaptured: response.body.length,
    truncated: response.truncated,
    magic: sniffMagic(response.body),
    bodyPrefixHex:
      response.body.subarray(0, 32).toString("hex")
  };
}

async function main() {
  ensureOutputDir();

  const opts = parseArgs(process.argv);

  console.log("==============================================================================");
  console.log("korean_urban_plan_mcp - EUM notice detail probe v0.3");
  console.log("==============================================================================");
  console.log(`PNU: ${opts.pnu}`);
  console.log(
    `notice_code: ${opts.noticeCode || "(any)"}`
  );
  console.log(
    `notice_no: ${opts.noticeNo || "(any)"}`
  );
  console.log(
    `org_cd: ${opts.orgCd || "(any)"}`
  );
  console.log(
    `download check: ${opts.downloadCheck ? "YES" : "NO"}`
  );

  const directProbePath = path.join(
    OUT_DIR,
    `eum_direct_probe_${opts.pnu}.json`
  );

  if (!fs.existsSync(directProbePath)) {
    fail(
      `Saved direct-probe result not found:\n${directProbePath}`
    );
  }

  console.log("\n[1] Load saved direct-probe result");
  console.log(directProbePath);

  const directProbe = readJson(directProbePath);

  const rawRecords = collectNoticeRecords(directProbe);

  const uniqueRecords = [
    ...new Map(
      rawRecords.map((record) => [
        record.notice_code,
        record
      ])
    ).values()
  ];

  console.log(
    `Actual notice records: ${uniqueRecords.length}`
  );

  const selection = selectNotice(
    uniqueRecords,
    opts
  );

  const notice = selection.notice;

  console.log("\n[2] Selected notice");
  console.log(
    JSON.stringify(notice, null, 2)
  );
  console.log(
    `Selection: ${selection.selection}`
  );

  const noticeParts = String(
    notice.notice_no
  ).split("-");

  const noticeYear = noticeParts[0];
  const noticeNumber = noticeParts[1];

  if (!noticeYear || !noticeNumber) {
    fail(
      `Unsupported notice_no format: ${notice.notice_no}`
    );
  }

  const detailUrl = new URL(
    "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp"
  );

  detailUrl.searchParams.set("seq", "");
  detailUrl.searchParams.set(
    "gosi_no_chrg",
    notice.org_cd
  );
  detailUrl.searchParams.set(
    "gosi_no_year",
    noticeYear
  );
  detailUrl.searchParams.set(
    "gosi_no_no",
    noticeNumber
  );
  detailUrl.searchParams.set(
    "mobile_yn",
    ""
  );

  console.log("\n[3] Notice detail URL");
  console.log(detailUrl.toString());

  console.log("Query:");
  console.log(
    JSON.stringify(
      {
        seq: "",
        gosi_no_chrg: notice.org_cd,
        gosi_no_year: noticeYear,
        gosi_no_no: noticeNumber,
        mobile_yn: ""
      },
      null,
      2
    )
  );

  console.log(
    "\n[3a] HTTP request: node:https.request"
  );
  console.log(
    "[3a] AbortController: DISABLED"
  );
  console.log(
    "[3a] timeout: 60000 ms"
  );

  const referer =
    `https://www.eum.go.kr/web/cp/cv/cvUpisDet.jsp` +
    `?isNoScr=script` +
    `&mode=search` +
    `&pnu=${opts.pnu}` +
    `&s_type=1` +
    `&selGbn=umd`;

  const response = await requestBuffer(
    detailUrl.toString(),
    {
      method: "GET",
      timeoutMs: 60000,
      maxBytes: 32 * 1024 * 1024,
      headers: {
        Referer: referer,
        Accept:
          "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
      }
    }
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
    `Bytes: ${response.body.length}`
  );

  if (
    response.status < 200 ||
    response.status >= 400
  ) {
    fail(
      `Detail page HTTP ${response.status}`
    );
  }

  const decoded = decodeResponseText(
    response.body,
    response.headers
  );

  console.log(
    `Decoded encoding: ${decoded.encoding}`
  );

  const safeNoticeCode =
    notice.notice_code.replace(
      /[^0-9A-Za-z_-]/g,
      "_"
    );

  const htmlPath = path.join(
    OUT_DIR,
    `eum_notice_detail_${opts.pnu}_${safeNoticeCode}.html`
  );

  const jsonPath = path.join(
    OUT_DIR,
    `eum_notice_detail_${opts.pnu}_${safeNoticeCode}.json`
  );

  fs.writeFileSync(
    htmlPath,
    decoded.text,
    "utf8"
  );

  const anchors = extractAnchors(
    decoded.text,
    detailUrl.toString()
  );

  const attachments =
    extractAttachmentCandidates(
      decoded.text,
      detailUrl.toString()
    );

  console.log(
    `Anchors: ${anchors.length}`
  );

  console.log(
    `Attachment candidates: ${attachments.length}`
  );

  attachments.forEach((item, index) => {
    console.log(
      `  [${index + 1}] ${item.text || "(no text)"}`
    );
    console.log(
      `      ${item.url}`
    );
  });

  const keywordChecks = {
    첨부파일:
      decoded.text.includes("첨부파일"),

    고시문:
      decoded.text.includes("고시문"),

    결정도:
      decoded.text.includes("결정도"),

    지형도면:
      decoded.text.includes("지형도면"),

    시행지침:
      decoded.text.includes("시행지침"),

    일괄다운로드:
      decoded.text.includes("일괄 다운로드")
  };

  console.log("\nKeyword checks:");
  console.log(
    JSON.stringify(
      keywordChecks,
      null,
      2
    )
  );

  const attachmentChecks = [];

  if (opts.downloadCheck) {
    console.log(
      "\n[4] Attachment HTTP checks"
    );

    for (const candidate of attachments) {
      try {
        const result =
          await checkAttachment(
            candidate,
            detailUrl.toString()
          );

        attachmentChecks.push(result);

        console.log(
          JSON.stringify(
            result,
            null,
            2
          )
        );
      } catch (error) {
        const failed = {
          text: candidate.text,
          url: candidate.url,
          kind: candidate.kind,
          error:
            `${error?.name || "Error"}: ` +
            `${error?.message || String(error)}`
        };

        attachmentChecks.push(failed);

        console.log(
          "Attachment check failed:"
        );
        console.log(
          JSON.stringify(
            failed,
            null,
            2
          )
        );
      }
    }
  }

  const result = {
    version: "0.3",
    pnu: opts.pnu,
    selected_notice: notice,
    selection: selection.selection,

    detail_url:
      detailUrl.toString(),

    detail_http: {
      status: response.status,

      content_type:
        response.headers["content-type"] || "",

      content_length:
        response.headers["content-length"] || "",

      bytes:
        response.body.length,

      decoded_encoding:
        decoded.encoding
    },

    keyword_checks:
      keywordChecks,

    anchor_count:
      anchors.length,

    attachments:
      attachments,

    attachment_checks:
      attachmentChecks,

    saved_html:
      htmlPath
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

  console.log("\n[5] Saved");
  console.log(htmlPath);
  console.log(jsonPath);

  console.log("\nRESULT: PASS");
}

main().catch((error) => {
  console.log("\nRESULT: FAIL");
  console.log(
    `${error?.name || "Error"}: ` +
    `${error?.message || String(error)}`
  );

  process.exitCode = 1;
});