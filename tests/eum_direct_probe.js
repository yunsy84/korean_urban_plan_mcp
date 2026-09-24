import fs from "node:fs/promises";
import path from "node:path";

const EUM_PAGE =
  "https://www.eum.go.kr/web/cp/cv/cvUpisDet.jsp";

const DEFAULT_MAPPLAN =
  "https://www.eum.ne.kr:9001/MapPlan";

const CONNECTOR =
  "https://www.eum.go.kr/web/api/Upis/UrlConnector.jsp";

const CONNECTOR_API =
  "/upispweb/linkmgmt/api/selectListNtfcHistByRec";

const DEFAULT_VERSION =
  "20260614";

const DEFAULT_TIMEOUT_MS =
  20000;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "HeadlessChrome/153.0.0.0 " +
  "Safari/537.36";

/* ================================================================
 * Usage
 * ================================================================ */

function usage() {
  console.log(`
Usage:
  node tests\\eum_direct_probe.js <PNU>
  node tests\\eum_direct_probe.js <PNU> --version <YYYYMMDD>
  node tests\\eum_direct_probe.js <PNU> --server <MapPlanBaseUrl>
  node tests\\eum_direct_probe.js <PNU> --timeout <milliseconds>

Examples:
  node tests\\eum_direct_probe.js 4413310300111160000

  node tests\\eum_direct_probe.js 4413310300111160000 --version 20260614

  node tests\\eum_direct_probe.js 4413310300111160000 --server https://www.eum.ne.kr:9002/MapPlan

Options:
  --version <YYYYMMDD>
  --server <MapPlanBaseUrl>
  --timeout <milliseconds>
`);
}

/* ================================================================
 * Argument parsing
 * ================================================================ */

function parseArgs(argv) {
  const args = [...argv];

  let pnu = null;

  let version =
    DEFAULT_VERSION;

  let server =
    DEFAULT_MAPPLAN;

  let timeoutMs =
    DEFAULT_TIMEOUT_MS;

  while (args.length > 0) {
    const token =
      args.shift();

    if (token === "--version") {
      version =
        args.shift() ?? null;

      continue;
    }

    if (token === "--server") {
      server =
        args.shift() ?? null;

      continue;
    }

    if (token === "--timeout") {
      const value =
        Number(args.shift());

      if (
        !Number.isFinite(value) ||
        value < 1000
      ) {
        throw new Error(
          "--timeout must be a number >= 1000."
        );
      }

      timeoutMs =
        value;

      continue;
    }

    if (
      token === "--help" ||
      token === "-h"
    ) {
      usage();
      process.exit(0);
    }

    if (
      !pnu &&
      !token.startsWith("--")
    ) {
      pnu =
        token;

      continue;
    }

    throw new Error(
      `Unknown argument: ${token}`
    );
  }

  if (
    !/^\d{19}$/.test(
      pnu ?? ""
    )
  ) {
    throw new Error(
      "PNU must be exactly 19 digits."
    );
  }

  if (
    !/^\d{8}$/.test(
      version ?? ""
    )
  ) {
    throw new Error(
      "--version must be exactly 8 digits. Example: 20260614"
    );
  }

  if (!server) {
    throw new Error(
      "--server cannot be empty."
    );
  }

  return {
    pnu,
    version,
    server:
      String(server).replace(
        /\/$/,
        ""
      ),
    timeoutMs
  };
}

/* ================================================================
 * HTTP
 * ================================================================ */

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs =
    DEFAULT_TIMEOUT_MS
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => {
        controller.abort();
      },
      timeoutMs
    );

  try {
    return await fetch(
      url,
      {
        ...options,

        redirect:
          "follow",

        signal:
          controller.signal,

        headers: {
          "User-Agent":
            BROWSER_UA,

          ...(options.headers ?? {})
        }
      }
    );
  } finally {
    clearTimeout(
      timer
    );
  }
}

/* ================================================================
 * Cookie
 * ================================================================ */

function getSetCookieHeaders(
  headers
) {
  if (
    typeof headers.getSetCookie ===
    "function"
  ) {
    try {
      return headers.getSetCookie();
    } catch {
      // fallback
    }
  }

  const value =
    headers.get(
      "set-cookie"
    );

  return value
    ? [value]
    : [];
}

function buildCookieHeader(
  setCookieHeaders
) {
  const cookieMap =
    new Map();

  for (
    const raw of
      setCookieHeaders
  ) {
    const firstPart =
      String(
        raw ?? ""
      )
        .split(
          ";",
          1
        )[0]
        .trim();

    if (!firstPart) {
      continue;
    }

    const eq =
      firstPart.indexOf(
        "="
      );

    if (eq <= 0) {
      continue;
    }

    const name =
      firstPart
        .slice(
          0,
          eq
        )
        .trim();

    cookieMap.set(
      name,
      firstPart
    );
  }

  return [
    ...cookieMap.values()
  ].join("; ");
}

/* ================================================================
 * JSON / Encoding
 * ================================================================ */

function tryParseJson(
  text
) {
  try {
    return JSON.parse(
      text
    );
  } catch {
    return null;
  }
}

function decodeBytes(
  bytes,
  contentType = ""
) {
  /*
   * EUM 응답은 endpoint별로 charset 표기가 서로 다르다.
   *
   * MapPlan:
   *   application/json;charset=utf-8
   *
   * UrlConnector:
   *   text/html; charset=EUC-KR
   *
   * 따라서 JSON.parse 성공 여부만으로 encoding을
   * 선택하지 않는다.
   */

  const utf8 =
    new TextDecoder(
      "utf-8",
      {
        fatal:
          false
      }
    ).decode(
      bytes
    );

  const eucKr =
    new TextDecoder(
      "euc-kr",
      {
        fatal:
          false
      }
    ).decode(
      bytes
    );

  const utf8Json =
    tryParseJson(
      utf8
    );

  const eucKrJson =
    tryParseJson(
      eucKr
    );

  const utf8ReplacementCount =
    (
      utf8.match(
        /\uFFFD/g
      ) ??
      []
    ).length;

  const eucKrReplacementCount =
    (
      eucKr.match(
        /\uFFFD/g
      ) ??
      []
    ).length;

  const utf8HangulCount =
    (
      utf8.match(
        /[\uAC00-\uD7A3]/g
      ) ??
      []
    ).length;

  const eucKrHangulCount =
    (
      eucKr.match(
        /[\uAC00-\uD7A3]/g
      ) ??
      []
    ).length;

  const declaredEucKr =
    /charset\s*=\s*euc-?kr/i.test(
      String(
        contentType ??
        ""
      )
    );

  let selected =
    utf8;

  let encoding =
    "utf-8";

  let json =
    utf8Json;

  /*
   * 1. 서버가 EUC-KR이라고 명시했으면
   *    EUC-KR을 우선한다.
   */
  if (
    declaredEucKr &&
    eucKrJson
  ) {
    selected =
      eucKr;

    encoding =
      "euc-kr";

    json =
      eucKrJson;
  }

  /*
   * 2. UTF-8 JSON이 아니고
   *    EUC-KR JSON이면 EUC-KR.
   */
  else if (
    eucKrJson &&
    !utf8Json
  ) {
    selected =
      eucKr;

    encoding =
      "euc-kr";

    json =
      eucKrJson;
  }

  /*
   * 3. 둘 다 JSON이면
   *    깨짐 정도와 한글 수로 비교.
   */
  else if (
    eucKrJson &&
    utf8Json
  ) {
    const eucKrLooksBetter =
      eucKrReplacementCount <
        utf8ReplacementCount ||

      (
        eucKrReplacementCount ===
          utf8ReplacementCount &&

        eucKrHangulCount >
          utf8HangulCount
      );

    if (
      eucKrLooksBetter
    ) {
      selected =
        eucKr;

      encoding =
        "euc-kr";

      json =
        eucKrJson;
    }
  }

  return {
    encoding,
    text:
      selected,
    json,

    utf8,

    eucKr,

    diagnostics: {
      utf8ReplacementCount,
      eucKrReplacementCount,
      utf8HangulCount,
      eucKrHangulCount
    }
  };
}

async function readResponse(
  response
) {
  /*
   * response.text()를 사용하지 않고
   * raw bytes를 직접 받아서 charset을 판정한다.
   */
  const arrayBuffer =
    await response.arrayBuffer();

  const bytes =
    new Uint8Array(
      arrayBuffer
    );

  const contentType =
    response.headers.get(
      "content-type"
    ) ??
    "";

  const decoded =
    decodeBytes(
      bytes,
      contentType
    );

  const hexPreview =
    Buffer.from(
      bytes
    )
      .subarray(
        0,
        64
      )
      .toString(
        "hex"
      );

  return {
    ok:
      response.ok,

    status:
      response.status,

    statusText:
      response.statusText,

    contentType,

    contentLengthHeader:
      response.headers.get(
        "content-length"
      ),

    url:
      response.url,

    bytesLength:
      bytes.byteLength,

    encoding:
      decoded.encoding,

    text:
      decoded.text,

    json:
      decoded.json,

    utf8:
      decoded.utf8,

    eucKr:
      decoded.eucKr,

    diagnostics:
      decoded.diagnostics,

    hexPreview
  };
}

function summarizeText(
  text,
  limit = 1200
) {
  const value =
    String(
      text ?? ""
    );

  return {
    length:
      value.length,

    preview:
      value.length <= limit
        ? value
        : `${value.slice(
            0,
            limit
          )}...`
  };
}

/* ================================================================
 * MapPlan
 * ================================================================ */

function normalizeJiguInfo(
  payload
) {
  const rows =
    Array.isArray(
      payload?.jigu_info
    )
      ? payload.jigu_info
      : [];

  return rows.map(
    (row) => ({
      code:
        String(
          row?.code ??
          ""
        ),

      present_sn:
        String(
          row?.present_sn ??
          ""
        ),

      wtnnc_sn:
        String(
          row?.wtnnc_sn ??
          ""
        ),

      fd_code:
        String(
          row?.fd_code ??
          ""
        )
    })
  );
}

function fdCodeToType(
  fdCode
) {
  const value =
    String(
      fdCode ??
      ""
    )
      .toUpperCase();

  if (
    value.startsWith("DA") ||
    value.includes("DA")
  ) {
    return "UQ160";
  }

  if (
    value.startsWith("CB") ||
    value.includes("CB")
  ) {
    return "UQ150";
  }

  return null;
}

function buildConnectorItems(
  jiguInfo
) {
  const items =
    [];

  const skipped =
    [];

  for (
    const row of
      jiguInfo
  ) {
    const type =
      fdCodeToType(
        row.fd_code
      );

    if (!type) {
      skipped.push({
        reason:
          "unsupported_fd_code",

        ...row
      });

      continue;
    }

    /*
     * wtnnc_sn이 비어 있어도
     * 실제 브라우저 payload에서는 행이 남는다.
     */
    if (
      !row.wtnnc_sn
    ) {
      items.push({
        type,

        wtnnc_cd:
          "",

        siteCd:
          ""
      });

      continue;
    }

    items.push({
      type,

      wtnnc_cd:
        row.wtnnc_sn,

      siteCd:
        row.wtnnc_sn.slice(
          0,
          5
        )
    });
  }

  return {
    items,
    skipped
  };
}

function buildMapPlanUrl(
  server,
  version,
  pnu
) {
  const url =
    new URL(
      `${server}/MapPlan`
    );

  url.searchParams.set(
    "req",
    "pnu_analysis"
  );

  url.searchParams.set(
    "version",
    version
  );

  url.searchParams.set(
    "pnus",
    pnu
  );

  return url.toString();
}

/* ================================================================
 * UrlConnector URL
 * ================================================================ */

function buildConnectorUrlBrowserStyle(
  items
) {
  /*
   * cvUpisDet.js의 원래 조립 방식:
   *
   *   base
   *   + "?url="
   *   + selectNtfcByPnu
   *   + "&json="
   *   + JSON.stringify(json)
   *
   * new URL()을 통해 Chromium Network 로그와 같은
   * percent encoding 형태가 된다.
   */
  const raw =
    `${CONNECTOR}` +
    `?url=${CONNECTOR_API}` +
    `&json=${JSON.stringify(
      items
    )}`;

  return new URL(
    raw
  ).toString();
}

function buildConnectorUrlSearchParams(
  items
) {
  const url =
    new URL(
      CONNECTOR
    );

  url.searchParams.set(
    "url",
    CONNECTOR_API
  );

  url.searchParams.set(
    "json",
    JSON.stringify(
      items
    )
  );

  return url.toString();
}

/* ================================================================
 * Browser-like headers
 * ================================================================ */

function makeConnectorHeaders({
  pageUrl,
  cookie = "",
  origin = false
}) {
  const headers = {
    "Accept":
      "application/json, text/javascript, */*; q=0.01",

    "Content-Type":
      "application/json",

    "Referer":
      pageUrl,

    "X-Requested-With":
      "XMLHttpRequest",

    "sec-ch-ua-platform":
      '"Windows"',

    "sec-ch-ua":
      '"Google Chrome";v="153", "Not_A Brand";v="8", "Chromium";v="153"',

    "sec-ch-ua-mobile":
      "?0"
  };

  if (origin) {
    headers.Origin =
      "https://www.eum.go.kr";
  }

  if (cookie) {
    headers.Cookie =
      cookie;
  }

  return headers;
}

/* ================================================================
 * Notice summary
 * ================================================================ */

function summarizeNoticePayload(
  payload
) {
  if (
    !payload ||
    typeof payload !==
      "object"
  ) {
    return [];
  }

  const result =
    [];

  for (
    const [
      key,
      value
    ] of Object.entries(
      payload
    )
  ) {
    if (
      !key.endsWith(
        "_ntfcList"
      )
    ) {
      continue;
    }

    const list =
      Array.isArray(
        value
      )
        ? value
        : [];

    result.push({
      key,

      count:
        list.length,

      samples:
        list
          .slice(
            0,
            5
          )
          .map(
            (item) => ({
              notice_code:
                item?.notice_code ??
                null,

              notice_date:
                item?.notice_date ??
                null,

              notice_no:
                item?.notice_no ??
                null,

              organ_nm:
                item?.organ_nm ??
                null,

              title:
                item?.title ??
                null,

              ucode:
                item?.ucode ??
                null,

              ucode_nm:
                item?.ucode_nm ??
                null,

              wtnnc_cd:
                item?.wtnnc_cd ??
                null,

              wtnnc_cd_p:
                item?.wtnnc_cd_p ??
                null
            })
          )
    });
  }

  return result;
}

/* ================================================================
 * EUM public page
 * ================================================================ */

async function fetchPublicPage(
  pnu,
  timeoutMs
) {
  const url =
    new URL(
      EUM_PAGE
    );

  url.searchParams.set(
    "isNoScr",
    "script"
  );

  url.searchParams.set(
    "mode",
    "search"
  );

  url.searchParams.set(
    "pnu",
    pnu
  );

  url.searchParams.set(
    "s_type",
    "1"
  );

  url.searchParams.set(
    "selGbn",
    "umd"
  );

  console.log(
    "[S] EUM public page"
  );

  console.log(
    url.toString()
  );

  try {
    const response =
      await fetchWithTimeout(
        url.toString(),
        {
          headers: {
            "Accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "Accept-Language":
              "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
          }
        },
        timeoutMs
      );

    const result =
      await readResponse(
        response
      );

    const setCookies =
      getSetCookieHeaders(
        response.headers
      );

    const cookie =
      buildCookieHeader(
        setCookies
      );

    console.log(
      `HTTP: ${result.status} ${result.statusText}`
    );

    console.log(
      `Final URL: ${result.url}`
    );

    console.log(
      `Content-Type: ${
        result.contentType ??
        "(none)"
      }`
    );

    console.log(
      `Body bytes: ${
        result.bytesLength
      }`
    );

    console.log(
      `Set-Cookie count: ${
        setCookies.length
      }`
    );

    console.log(
      `Cookie produced: ${
        cookie
          ? "YES"
          : "NO"
      }`
    );

    return {
      ...result,

      requestUrl:
        url.toString(),

      setCookies,

      cookie
    };

  } catch (error) {
    console.log(
      `PAGE REQUEST ERROR: ${
        error?.message ??
        String(error)
      }`
    );

    return {
      ok:
        false,

      requestUrl:
        url.toString(),

      finalUrl:
        null,

      status:
        null,

      statusText:
        null,

      contentType:
        null,

      bytesLength:
        0,

      text:
        "",

      cookie:
        "",

      setCookies:
        [],

      error:
        error?.message ??
        String(error)
    };
  }
}

/* ================================================================
 * Connector attempt
 * ================================================================ */

async function callConnectorAttempt({
  label,
  url,
  pageUrl,
  cookie = "",
  origin = false,
  timeoutMs
}) {
  console.log("");
  console.log(
    "-".repeat(72)
  );

  console.log(
    `[B] ${label}`
  );

  console.log(
    "-".repeat(72)
  );

  console.log(
    url
  );

  const headers =
    makeConnectorHeaders({
      pageUrl,
      cookie,
      origin
    });

  console.log(
    "Request headers:"
  );

  console.log(
    JSON.stringify(
      {
        ...headers,

        Cookie:
          cookie
            ? "[REDACTED]"
            : undefined
      },
      null,
      2
    )
  );

  try {
    const response =
      await fetchWithTimeout(
        url,
        {
          method:
            "GET",

          headers
        },
        timeoutMs
      );

    const result =
      await readResponse(
        response
      );

    console.log(
      `HTTP: ${result.status} ${result.statusText}`
    );

    console.log(
      `Content-Type: ${
        result.contentType ??
        "(none)"
      }`
    );

    console.log(
      `Final URL: ${
        result.url
      }`
    );

    console.log(
      `Body bytes: ${
        result.bytesLength
      }`
    );

    console.log(
      `Decoded as: ${
        result.encoding
      }`
    );

    console.log(
      `JSON parse: ${
        result.json
          ? "YES"
          : "NO"
      }`
    );

    console.log(
      `Body preview: ${
        JSON.stringify(
          result.text.slice(
            0,
            1000
          )
        )
      }`
    );

    console.log(
      `Body hex(64): ${
        result.hexPreview
      }`
    );

    console.log(
      "Encoding diagnostics:"
    );

    console.log(
      JSON.stringify(
        result.diagnostics,
        null,
        2
      )
    );

    if (!result.json) {
      const alternate =
        result.encoding ===
          "utf-8"
          ? result.eucKr
          : result.utf8;

      console.log(
        `Alternate decode preview: ${
          JSON.stringify(
            alternate.slice(
              0,
              1000
            )
          )
        }`
      );
    }

    if (
      result.json
    ) {
      console.log(
        `Response keys: ${
          Object.keys(
            result.json
          ).length
        }`
      );

      const noticeGroups =
        summarizeNoticePayload(
          result.json
        );

      for (
        const group
          of noticeGroups
      ) {
        console.log(
          `  ${group.key}: ${group.count} rows`
        );

        for (
          const sample
            of group.samples
        ) {
          console.log(
            `    ${sample.notice_date ?? ""} | ` +
            `${sample.notice_no ?? ""} | ` +
            `${sample.organ_nm ?? ""} | ` +
            `${sample.title ?? ""}`
          );
        }
      }
    }

    return {
      label,

      requestUrl:
        url,

      requestHeaders: {
        ...headers,

        Cookie:
          cookie
            ? "[REDACTED]"
            : undefined
      },

      status:
        result.status,

      statusText:
        result.statusText,

      ok:
        result.ok,

      contentType:
        result.contentType,

      finalUrl:
        result.url,

      bytesLength:
        result.bytesLength,

      encoding:
        result.encoding,

      json:
        Boolean(
          result.json
        ),

      body:
        result.text,

      bodyUtf8:
        result.utf8,

      bodyEucKr:
        result.eucKr,

      diagnostics:
        result.diagnostics,

      hexPreview:
        result.hexPreview,

      parsed:
        result.json,

      noticeSummaries:
        summarizeNoticePayload(
          result.json
        )
    };

  } catch (error) {
    console.log(
      `REQUEST ERROR: ${
        error?.message ??
        String(error)
      }`
    );

    return {
      label,

      requestUrl:
        url,

      status:
        null,

      statusText:
        null,

      ok:
        false,

      contentType:
        null,

      finalUrl:
        null,

      bytesLength:
        0,

      encoding:
        null,

      json:
        false,

      body:
        "",

      error:
        error?.message ??
        String(error)
    };
  }
}

/* ================================================================
 * Main
 * ================================================================ */

async function main() {
  const {
    pnu,
    version,
    server,
    timeoutMs
  } = parseArgs(
    process.argv.slice(2)
  );

  console.log(
    "=".repeat(72)
  );

  console.log(
    "korean_urban_plan_mcp - EUM direct Node probe v0.4"
  );

  console.log(
    "=".repeat(72)
  );

  console.log(
    `Node: ${process.execPath}`
  );

  console.log(
    `Version: ${process.version}`
  );

  console.log(
    `PNU: ${pnu}`
  );

  console.log(
    `MapPlan: ${server}`
  );

  console.log(
    `MapPlan version: ${version}`
  );

  console.log(
    `Connector: ${CONNECTOR}`
  );

  /*
   * ---------------------------------------------------------------
   * S) EUM public page
   * ---------------------------------------------------------------
   */

  const page =
    await fetchPublicPage(
      pnu,
      timeoutMs
    );

  /*
   * ---------------------------------------------------------------
   * A) MapPlan pnu_analysis
   * ---------------------------------------------------------------
   */

  const mapPlanUrl =
    buildMapPlanUrl(
      server,
      version,
      pnu
    );

  console.log("");
  console.log(
    "=".repeat(72)
  );

  console.log(
    "[A] MapPlan pnu_analysis"
  );

  console.log(
    mapPlanUrl
  );

  let mapPlan;

  try {
    const response =
      await fetchWithTimeout(
        mapPlanUrl,
        {
          method:
            "GET",

          headers: {
            "Accept":
              "application/json,text/plain,*/*",

            "Origin":
              "https://www.eum.go.kr",

            "Referer":
              page.finalUrl ||
              page.requestUrl
          }
        },
        timeoutMs
      );

    mapPlan =
      await readResponse(
        response
      );

  } catch (error) {
    console.error(
      `MapPlan REQUEST ERROR: ${
        error?.message ??
        String(error)
      }`
    );

    process.exitCode =
      2;

    return;
  }

  console.log(
    `HTTP: ${
      mapPlan.status
    } ${
      mapPlan.statusText
    }`
  );

  console.log(
    `Content-Type: ${
      mapPlan.contentType ??
      "(none)"
    }`
  );

  console.log(
    `Body bytes: ${
      mapPlan.bytesLength
    }`
  );

  console.log(
    `Decoded as: ${
      mapPlan.encoding
    }`
  );

  console.log(
    `JSON parse: ${
      mapPlan.json
        ? "YES"
        : "NO"
    }`
  );

  if (
    !mapPlan.ok ||
    !mapPlan.json
  ) {
    console.error(
      "MapPlan failure body:"
    );

    console.error(
      JSON.stringify(
        mapPlan.text.slice(
          0,
          2000
        )
      )
    );

    process.exitCode =
      2;

    return;
  }

  const jiguInfo =
    normalizeJiguInfo(
      mapPlan.json
    );

  console.log(
    `jigu_info count: ${
      jiguInfo.length
    }`
  );

  for (
    const [
      index,
      row
    ] of jiguInfo.entries()
  ) {
    console.log(
      `  ${index + 1}. ` +
      `code=${row.code} ` +
      `fd_code=${row.fd_code} ` +
      `present_sn=${
        row.present_sn ||
        ""
      } ` +
      `wtnnc_sn=${
        row.wtnnc_sn ||
        ""
      }`
    );
  }

  /*
   * ---------------------------------------------------------------
   * Build UrlConnector payload
   * ---------------------------------------------------------------
   */

  const {
    items:
      connectorItems,

    skipped
  } =
    buildConnectorItems(
      jiguInfo
    );

  console.log("");
  console.log(
    "Derived UrlConnector payload:"
  );

  console.log(
    JSON.stringify(
      connectorItems,
      null,
      2
    )
  );

  if (
    skipped.length
  ) {
    console.log("");
    console.log(
      "Skipped jigu_info:"
    );

    console.log(
      JSON.stringify(
        skipped,
        null,
        2
      )
    );
  }

  const pageUrl =
    page.finalUrl ||
    `${EUM_PAGE}` +
    `?isNoScr=script` +
    `&mode=search` +
    `&pnu=${pnu}` +
    `&s_type=1` +
    `&selGbn=umd`;

  /*
   * ---------------------------------------------------------------
   * B1
   *
   * 가장 우선.
   *
   * 브라우저 Network에서 확인한 URL 구조를 사용한다.
   * Cookie는 사용하지 않는다.
   * ---------------------------------------------------------------
   */

  const browserExactUrl =
    buildConnectorUrlBrowserStyle(
      connectorItems
    );

  const attempts =
    [];

  const exactNoCookie =
    await callConnectorAttempt({
      label:
        "B1 exact browser-style URL + observed headers + NO cookie",

      url:
        browserExactUrl,

      pageUrl,

      cookie:
        "",

      origin:
        false,

      timeoutMs
    });

  attempts.push(
    exactNoCookie
  );

  /*
   * ---------------------------------------------------------------
   * B2
   *
   * B1 실패 시 session cookie 추가.
   * Origin도 실제 브라우저 환경 차이를 보기 위해 추가.
   * ---------------------------------------------------------------
   */

  if (
    !exactNoCookie.json
  ) {
    const exactWithCookie =
      await callConnectorAttempt({
        label:
          "B2 exact browser-style URL + observed headers + Origin + session cookie",

        url:
          browserExactUrl,

        pageUrl,

        cookie:
          page.cookie,

        origin:
          true,

        timeoutMs
      });

    attempts.push(
      exactWithCookie
    );
  }

  /*
   * ---------------------------------------------------------------
   * B3
   *
   * URLSearchParams 방식 비교.
   * ---------------------------------------------------------------
   */

  if (
    !attempts.some(
      (item) =>
        item.json
    )
  ) {
    const searchParamsUrl =
      buildConnectorUrlSearchParams(
        connectorItems
      );

    const searchParamsResult =
      await callConnectorAttempt({
        label:
          "B3 URLSearchParams serialization + observed headers + NO cookie",

        url:
          searchParamsUrl,

        pageUrl,

        cookie:
          "",

        origin:
          false,

        timeoutMs
      });

    attempts.push(
      searchParamsResult
    );
  }

  /*
   * ---------------------------------------------------------------
   * B4
   *
   * Cookie 없이 Origin만 추가.
   * ---------------------------------------------------------------
   */

  if (
    !attempts.some(
      (item) =>
        item.json
    )
  ) {
    const originResult =
      await callConnectorAttempt({
        label:
          "B4 exact browser-style URL + observed headers + Origin + NO cookie",

        url:
          browserExactUrl,

        pageUrl,

        cookie:
          "",

        origin:
          true,

        timeoutMs
      });

    attempts.push(
      originResult
    );
  }

  /*
   * ---------------------------------------------------------------
   * Success detection
   * ---------------------------------------------------------------
   */

  const successful =
    attempts.find(
      (item) =>
        item.json &&
        item.ok
    );

  /*
   * ---------------------------------------------------------------
   * Output JSON
   * ---------------------------------------------------------------
   */

  const output = {
    success:
      Boolean(
        successful
      ),

    testedAt:
      new Date().toISOString(),

    node: {
      execPath:
        process.execPath,

      version:
        process.version
    },

    input: {
      pnu,

      version,

      mapPlanBase:
        server,

      connector:
        CONNECTOR,

      connectorApi:
        CONNECTOR_API
    },

    publicPage: {
      requestUrl:
        page.requestUrl ??
        null,

      finalUrl:
        page.finalUrl ??
        null,

      status:
        page.status ??
        null,

      statusText:
        page.statusText ??
        null,

      contentType:
        page.contentType ??
        null,

      bodyBytes:
        page.bytesLength ??
        0,

      hasSessionCookie:
        Boolean(
          page.cookie
        ),

      /*
       * 실제 cookie 값은 저장하지 않는다.
       */
      cookie:
        page.cookie
          ? "[REDACTED]"
          : ""
    },

    mapPlan: {
      url:
        mapPlanUrl,

      status:
        mapPlan.status,

      statusText:
        mapPlan.statusText,

      contentType:
        mapPlan.contentType,

      bodyBytes:
        mapPlan.bytesLength,

      encoding:
        mapPlan.encoding,

      jiguInfoCount:
        jiguInfo.length,

      jigu_info:
        jiguInfo
    },

    connector: {
      browserExactUrl,

      searchParamsUrl:
        buildConnectorUrlSearchParams(
          connectorItems
        ),

      requestItems:
        connectorItems,

      skippedItems:
        skipped,

      attempts:
        attempts.map(
          (item) => ({
            ...item,

            body:
              summarizeText(
                item.body
              ).preview,

            bodyUtf8:
              summarizeText(
                item.bodyUtf8
              ).preview,

            bodyEucKr:
              summarizeText(
                item.bodyEucKr
              ).preview
          })
        ),

      successfulAttempt:
        successful?.label ??
        null,

      noticeSummaries:
        successful?.noticeSummaries ??
        []
    }
  };

  /*
   * ---------------------------------------------------------------
   * Save
   * ---------------------------------------------------------------
   */

  const outputDir =
    path.resolve(
      "tests",
      "output"
    );

  await fs.mkdir(
    outputDir,
    {
      recursive:
        true
    }
  );

  const outputPath =
    path.join(
      outputDir,
      `eum_direct_probe_${pnu}.json`
    );

  await fs.writeFile(
    outputPath,

    JSON.stringify(
      output,
      null,
      2
    ),

    "utf8"
  );

  /*
   * ---------------------------------------------------------------
   * Final console
   * ---------------------------------------------------------------
   */

  console.log("");

  console.log(
    "=".repeat(72)
  );

  if (
    successful
  ) {
    console.log(
      "RESULT: DIRECT NODE UrlConnector SUCCESS"
    );

    console.log(
      `Successful attempt: ${
        successful.label
      }`
    );

    console.log(
      `Decoded as: ${
        successful.encoding
      }`
    );

    console.log(
      `Notice key groups: ${
        successful.noticeSummaries.length
      }`
    );

    for (
      const group
        of successful.noticeSummaries
    ) {
      console.log(
        `  ${group.key}: ${group.count} rows`
      );
    }

  } else {
    console.log(
      "RESULT: DIRECT NODE UrlConnector NOT VERIFIED"
    );

    console.log(
      "All attempted Node variants were retained in the output JSON."
    );
  }

  console.log(
    `Saved: ${outputPath}`
  );

  console.log(
    "=".repeat(72)
  );

  if (
    !successful
  ) {
    process.exitCode =
      3;
  }
}

/* ================================================================
 * Entry
 * ================================================================ */

main().catch(
  (error) => {
    console.error("");
    console.error(
      "RESULT: FAIL"
    );

    console.error(
      error?.stack ??
      error?.message ??
      String(error)
    );

    process.exitCode =
      1;
  }
);