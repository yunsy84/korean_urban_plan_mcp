import fs from "node:fs/promises";
import path from "node:path";

const EUM_PAGE =
  "https://www.eum.go.kr/web/cp/cv/cvUpisDet.jsp";

const CONNECTOR =
  "https://www.eum.go.kr/web/api/Upis/UrlConnector.jsp";

const CONNECTOR_API =
  "/upispweb/linkmgmt/api/selectListNtfcHistByRec";

function usage() {
  console.log(`
Usage:

  node tests\\eum_direct_probe.js <PNU> --version <YYYYMMDD> --server <MapPlanBaseUrl>

Example:

  node tests\\eum_direct_probe.js 4413310300111160000 --version 20260614 --server https://www.eum.ne.kr:9002/MapPlan

Options:

  --version <YYYYMMDD>
  --server <MapPlanBaseUrl>
  --timeout <milliseconds>
`);
}

function parseArgs(argv) {
  const args = [...argv];

  let pnu = null;
  let version = null;
  let server = null;
  let timeoutMs = 20000;

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--version") {
      version = args.shift() ?? null;
      continue;
    }

    if (token === "--server") {
      server = args.shift() ?? null;
      continue;
    }

    if (token === "--timeout") {
      const value = Number(args.shift());

      if (!Number.isFinite(value) || value < 1000) {
        throw new Error("--timeout must be a number >= 1000.");
      }

      timeoutMs = value;
      continue;
    }

    if (token === "--help" || token === "-h") {
      usage();
      process.exit(0);
    }

    if (!pnu && !token.startsWith("--")) {
      pnu = token;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!/^\d{19}$/.test(pnu ?? "")) {
    throw new Error("PNU must be exactly 19 digits.");
  }

  if (!/^\d{8}$/.test(version ?? "")) {
    throw new Error(
      "--version must be exactly 8 digits. Example: 20260614"
    );
  }

  if (!server) {
    throw new Error(
      "--server is required. Example: https://www.eum.ne.kr:9002/MapPlan"
    );
  }

  return {
    pnu,
    version,
    server,
    timeoutMs
  };
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 20000
) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/153.0.0.0 Safari/537.36",

        ...(options.headers ?? {})
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function getSetCookieHeaders(headers) {
  try {
    if (typeof headers.getSetCookie === "function") {
      return headers.getSetCookie();
    }
  } catch {
    // ignore
  }

  const combined =
    headers.get("set-cookie");

  if (!combined) {
    return [];
  }

  /*
   * Node/HTTP 환경에 따라 여러 Set-Cookie가
   * 하나의 문자열로 합쳐질 수 있다.
   * 이 Probe에서는 쿠키 이름=값 부분만 사용한다.
   */
  return [combined];
}

function buildCookieHeader(setCookieHeaders) {
  const cookies = [];

  for (const header of setCookieHeaders) {
    if (!header) {
      continue;
    }

    /*
     * 하나의 Set-Cookie 문자열에서
     * 첫 번째 ';' 이전만 쿠키 본체로 사용한다.
     */
    const firstPart =
      String(header)
        .split(";")[0]
        .trim();

    if (!firstPart || !firstPart.includes("=")) {
      continue;
    }

    cookies.push(firstPart);
  }

  /*
   * 동일 쿠키명이 중복될 가능성을 고려하여
   * 마지막 값을 사용한다.
   */
  const map = new Map();

  for (const cookie of cookies) {
    const index = cookie.indexOf("=");

    const name =
      cookie.slice(0, index).trim();

    map.set(name, cookie);
  }

  return [...map.values()].join("; ");
}

async function readResponse(response) {
  const text =
    await response.text();

  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    // 그대로 보존
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    contentType:
      response.headers.get("content-type"),
    url: response.url,
    text,
    json
  };
}

function summarizeBody(text) {
  const value =
    String(text ?? "");

  return {
    length: value.length,
    preview:
      value.length <= 1000
        ? value
        : `${value.slice(0, 1000)}...`
  };
}

function normalizeJiguInfo(payload) {
  const rows =
    Array.isArray(payload?.jigu_info)
      ? payload.jigu_info
      : [];

  return rows.map((row) => ({
    code:
      String(row?.code ?? ""),

    present_sn:
      String(row?.present_sn ?? ""),

    wtnnc_sn:
      String(row?.wtnnc_sn ?? ""),

    fd_code:
      String(row?.fd_code ?? "")
  }));
}

function fdCodeToType(fdCode) {
  const value =
    String(fdCode ?? "")
      .toUpperCase();

  if (value.includes("DA")) {
    return "UQ160";
  }

  if (value.includes("CB")) {
    return "UQ150";
  }

  return null;
}

function buildConnectorItems(jiguInfo) {
  const items = [];
  const skipped = [];

  for (const row of jiguInfo) {
    const type =
      fdCodeToType(row.fd_code);

    if (!type) {
      skipped.push({
        reason:
          "unsupported_fd_code",

        ...row
      });

      continue;
    }

    if (!row.wtnnc_sn) {
      /*
       * EUM 원본 JS와 동일하게
       * wtnnc_cd가 없는 항목도 요청 배열에 남긴다.
       */
      items.push({
        type,
        wtnnc_cd: "",
        siteCd: ""
      });

      continue;
    }

    items.push({
      type,
      wtnnc_cd:
        row.wtnnc_sn,

      siteCd:
        row.wtnnc_sn.slice(0, 5)
    });
  }

  return {
    items,
    skipped
  };
}

function buildConnectorUrlEncoded(jsonItems) {
  const url =
    new URL(CONNECTOR);

  url.searchParams.set(
    "url",
    CONNECTOR_API
  );

  url.searchParams.set(
    "json",
    JSON.stringify(jsonItems)
  );

  return url.toString();
}

function buildConnectorUrlRaw(jsonItems) {
  /*
   * EUM 원본 JS는 다음과 같은 방식으로
   * URL 문자열을 직접 조립한다.

       getUpisUrlConnector +
       "?url=" +
       selectNtfcByPnu +
       "&json=" +
       JSON.stringify(json)

   * 따라서 URLSearchParams 방식과
   * 원본 JS 방식의 차이를 비교한다.
   */
  return (
    `${CONNECTOR}` +
    `?url=${CONNECTOR_API}` +
    `&json=${JSON.stringify(jsonItems)}`
  );
}

function browserHeaders({
  pageUrl,
  cookie
}) {
  const headers = {
    "Accept":
      "application/json, text/javascript, */*; q=0.01",

    "Accept-Language":
      "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",

    "Referer":
      pageUrl,

    "Origin":
      "https://www.eum.go.kr",

    "X-Requested-With":
      "XMLHttpRequest"
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  return headers;
}

function summarizeNotices(connectorJson) {
  if (
    !connectorJson ||
    typeof connectorJson !== "object"
  ) {
    return [];
  }

  const result = [];

  for (
    const [key, value]
    of Object.entries(connectorJson)
  ) {
    if (!key.endsWith("_ntfcList")) {
      continue;
    }

    const list =
      Array.isArray(value)
        ? value
        : [];

    result.push({
      key,

      count:
        list.length,

      samples:
        list.slice(0, 5).map((item) => ({
          ucode_nm:
            item?.ucode_nm ?? null,

          notice_code:
            item?.notice_code ?? null,

          notice_date:
            item?.notice_date ?? null,

          notice_no:
            item?.notice_no ?? null,

          organ_nm:
            item?.organ_nm ?? null,

          title:
            item?.title ?? null,

          ucode:
            item?.ucode ?? null,

          wtnnc_cd_p:
            item?.wtnnc_cd_p ?? null,

          wtnnc_cd:
            item?.wtnnc_cd ?? null,

          contentLength:
            typeof item?.content === "string"
              ? item.content.length
              : 0
        }))
    });
  }

  return result;
}

async function fetchEumPage({
  pnu,
  timeoutMs
}) {
  const pageUrl =
    new URL(EUM_PAGE);

  pageUrl.searchParams.set(
    "isNoScr",
    "script"
  );

  pageUrl.searchParams.set(
    "mode",
    "search"
  );

  pageUrl.searchParams.set(
    "pnu",
    pnu
  );

  pageUrl.searchParams.set(
    "s_type",
    "1"
  );

  pageUrl.searchParams.set(
    "selGbn",
    "umd"
  );

  console.log("");
  console.log("[S] EUM public page session test");
  console.log(pageUrl.toString());

  try {
    const response =
      await fetchWithTimeout(
        pageUrl.toString(),
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
      await readResponse(response);

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
        result.contentType ?? "(none)"
      }`
    );

    console.log(
      `Set-Cookie count: ${setCookies.length}`
    );

    console.log(
      `Cookie header produced: ${
        cookie ? "YES" : "NO"
      }`
    );

    return {
      success:
        result.ok,

      url:
        pageUrl.toString(),

      finalUrl:
        result.url,

      status:
        result.status,

      statusText:
        result.statusText,

      contentType:
        result.contentType,

      bodyLength:
        result.text.length,

      cookie,

      setCookies
    };

  } catch (error) {
    console.log(
      `PAGE ERROR: ${
        error?.message ??
        String(error)
      }`
    );

    return {
      success: false,
      error:
        error?.message ??
        String(error),

      cookie: ""
    };
  }
}

async function callConnector({
  label,
  url,
  pageUrl,
  cookie,
  timeoutMs
}) {
  console.log("");
  console.log("-".repeat(68));
  console.log(`[B] ${label}`);
  console.log("-".repeat(68));

  console.log(url);

  try {
    const response =
      await fetchWithTimeout(
        url,
        {
          headers:
            browserHeaders({
              pageUrl,
              cookie
            })
        },
        timeoutMs
      );

    const result =
      await readResponse(response);

    console.log(
      `HTTP: ${result.status} ${result.statusText}`
    );

    console.log(
      `Content-Type: ${
        result.contentType ?? "(none)"
      }`
    );

    console.log(
      `Final URL: ${result.url}`
    );

    console.log(
      `Body length: ${result.text.length}`
    );

    if (result.json) {
      console.log(
        "JSON: YES"
      );

      console.log(
        `Response keys: ${
          Object.keys(result.json).length
        }`
      );

      for (
        const summary
        of summarizeNotices(result.json)
      ) {
        console.log(
          `  ${summary.key}: ${summary.count} rows`
        );
      }

      return {
        label,

        success:
          result.ok,

        httpSuccess:
          result.ok,

        json:
          true,

        status:
          result.status,

        statusText:
          result.statusText,

        contentType:
          result.contentType,

        url:
          result.url,

        body:
          result.text,

        parsed:
          result.json,

        bodySummary:
          summarizeBody(
            result.text
          )
      };
    }

    console.log(
      "JSON: NO"
    );

    console.log(
      "RAW BODY:"
    );

    console.log(
      JSON.stringify(
        result.text
      )
    );

    return {
      label,

      success: false,

      httpSuccess:
        result.ok,

      json: false,

      status:
        result.status,

      statusText:
        result.statusText,

      contentType:
        result.contentType,

      url:
        result.url,

      body:
        result.text,

      parsed:
        null,

      bodySummary:
        summarizeBody(
          result.text
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

      success: false,

      httpSuccess:
        false,

      json:
        false,

      error:
        error?.message ??
        String(error)
    };
  }
}

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
    "=".repeat(68)
  );

  console.log(
    "korean_urban_plan_mcp - EUM direct Node probe v0.2"
  );

  console.log(
    "=".repeat(68)
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
    `MapPlan base: ${server}`
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
   *
   * Connector가 세션/Cookie에 의존하는지 확인하기 위해
   * 실제 PNU 상세 페이지를 먼저 Node에서 GET한다.
   * ---------------------------------------------------------------
   */
  const session =
    await fetchEumPage({
      pnu,
      timeoutMs
    });

  /*
   * ---------------------------------------------------------------
   * A) MapPlan pnu_analysis
   * ---------------------------------------------------------------
   */

  const mapPlanBase =
    server.replace(
      /\/$/,
      ""
    );

  const mapPlanUrl =
    `${mapPlanBase}/MapPlan` +
    `?req=pnu_analysis` +
    `&version=${encodeURIComponent(version)}` +
    `&pnus=${encodeURIComponent(pnu)}`;

  console.log("");
  console.log(
    "=".repeat(68)
  );

  console.log(
    "[A] MapPlan pnu_analysis"
  );

  console.log(
    mapPlanUrl
  );

  let mapPlanResponse;

  try {
    const response =
      await fetchWithTimeout(
        mapPlanUrl,
        {
          headers: {
            "Accept":
              "application/json,text/plain,*/*"
          }
        },
        timeoutMs
      );

    mapPlanResponse =
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

    process.exitCode = 2;
    return;
  }

  console.log(
    `HTTP: ${
      mapPlanResponse.status
    } ${
      mapPlanResponse.statusText
    }`
  );

  console.log(
    `Content-Type: ${
      mapPlanResponse.contentType ??
      "(none)"
    }`
  );

  console.log(
    `Body length: ${
      mapPlanResponse.text.length
    }`
  );

  if (!mapPlanResponse.ok) {
    console.error(
      "MapPlan HTTP failure."
    );

    console.error(
      JSON.stringify(
        mapPlanResponse.text
      )
    );

    process.exitCode = 2;
    return;
  }

  if (!mapPlanResponse.json) {
    console.error(
      "MapPlan did not return JSON."
    );

    console.error(
      JSON.stringify(
        mapPlanResponse.text
      )
    );

    process.exitCode = 2;
    return;
  }

  const jiguInfo =
    normalizeJiguInfo(
      mapPlanResponse.json
    );

  console.log(
    `jigu_info count: ${
      jiguInfo.length
    }`
  );

  if (!jiguInfo.length) {
    console.error(
      "MapPlan returned JSON but jigu_info is empty."
    );

    process.exitCode = 2;
    return;
  }

  for (
    const [index, row]
    of jiguInfo.entries()
  ) {
    console.log(
      `  ${index + 1}. ` +
      `code=${row.code} ` +
      `fd_code=${row.fd_code} ` +
      `present_sn=${row.present_sn || ""} ` +
      `wtnnc_sn=${row.wtnnc_sn || ""}`
    );
  }

  /*
   * ---------------------------------------------------------------
   * Build connector request
   * ---------------------------------------------------------------
   */

  const {
    items: connectorItems,
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

  /*
   * ---------------------------------------------------------------
   * B1) URLSearchParams
   *
   * 기존 Probe와 동일한 방식.
   * ---------------------------------------------------------------
   */

  const browserPageUrl =
    session.finalUrl ||
    `${EUM_PAGE}?isNoScr=script&mode=search&pnu=${pnu}&s_type=1&selGbn=umd`;

  const results = [];

  const encodedUrl =
    buildConnectorUrlEncoded(
      connectorItems
    );

  const encodedResult =
    await callConnector({
      label:
        "B1 URLSearchParams + browser headers + session cookie",

      url:
        encodedUrl,

      pageUrl:
        browserPageUrl,

      cookie:
        session.cookie,

      timeoutMs
    });

  results.push(
    encodedResult
  );

  if (encodedResult.success && encodedResult.json) {
    console.log("");
    console.log(
      "=".repeat(68)
    );

    console.log(
      "RESULT: DIRECT NODE A+B SUCCESS"
    );

    console.log(
      "UrlConnector succeeded with URLSearchParams."
    );

    await saveResult({
      pnu,
      version,
      server,
      session,
      mapPlanUrl,
      mapPlanResponse,
      connectorItems,
      skipped,
      results
    });

    return;
  }

  /*
   * ---------------------------------------------------------------
   * B2) Raw URL concatenation
   *
   * EUM 원본 cvUpisDet.js의 실제 URL 조립 방식과 동일하게
   * 직접 문자열을 만든다.
   * ---------------------------------------------------------------
   */

  const rawUrl =
    buildConnectorUrlRaw(
      connectorItems
    );

  const rawResult =
    await callConnector({
      label:
        "B2 raw query + browser headers + session cookie",

      url:
        rawUrl,

      pageUrl:
        browserPageUrl,

      cookie:
        session.cookie,

      timeoutMs
    });

  results.push(
    rawResult
  );

  if (rawResult.success && rawResult.json) {
    console.log("");
    console.log(
      "=".repeat(68)
    );

    console.log(
      "RESULT: DIRECT NODE A+B SUCCESS"
    );

    console.log(
      "UrlConnector succeeded with raw EUM-style query."
    );

    await saveResult({
      pnu,
      version,
      server,
      session,
      mapPlanUrl,
      mapPlanResponse,
      connectorItems,
      skipped,
      results
    });

    return;
  }

  /*
   * ---------------------------------------------------------------
   * B3) Raw query + NO cookie
   *
   * 세션 Cookie가 실제 필요한지 역으로 확인한다.
   * ---------------------------------------------------------------
   */

  const noCookieResult =
    await callConnector({
      label:
        "B3 raw query + browser headers + NO cookie",

      url:
        rawUrl,

      pageUrl:
        browserPageUrl,

      cookie:
        "",

      timeoutMs
    });

  results.push(
    noCookieResult
  );

  /*
   * ---------------------------------------------------------------
   * 최종 판정
   * ---------------------------------------------------------------
   */

  console.log("");
  console.log(
    "=".repeat(68)
  );

  console.log(
    "RESULT: A SUCCESS / B NOT YET VERIFIED"
  );

  console.log(
    "MapPlan direct Node communication is confirmed."
  );

  console.log(
    "UrlConnector direct Node communication is still unresolved."
  );

  console.log(
    "Compare B1/B2/B3 raw response bodies above."
  );

  await saveResult({
    pnu,
    version,
    server,
    session,
    mapPlanUrl,
    mapPlanResponse,
    connectorItems,
    skipped,
    results
  });
}

async function saveResult({
  pnu,
  version,
  server,
  session,
  mapPlanUrl,
  mapPlanResponse,
  connectorItems,
  skipped,
  results
}) {
  const outputDir =
    path.resolve(
      "tests",
      "output"
    );

  await fs.mkdir(
    outputDir,
    {
      recursive: true
    }
  );

  const outputPath =
    path.join(
      outputDir,
      `eum_direct_probe_${pnu}.json`
    );

  const output = {
    success:
      results.some(
        (item) =>
          item.success &&
          item.json
      ),

    testedAt:
      new Date().toISOString(),

    input: {
      pnu,
      version,
      mapPlanBase:
        server,

      connector:
        CONNECTOR
    },

    session: {
      pageUrl:
        session.url ?? null,

      finalUrl:
        session.finalUrl ?? null,

      status:
        session.status ?? null,

      contentType:
        session.contentType ?? null,

      bodyLength:
        session.bodyLength ?? null,

      hasCookie:
        Boolean(session.cookie),

      /*
       * 보안상 저장하지 않는다.
       */
      cookie:
        session.cookie
          ? "[REDACTED]"
          : ""
    },

    mapPlan: {
      url:
        mapPlanUrl,

      status:
        mapPlanResponse.status,

      statusText:
        mapPlanResponse.statusText,

      contentType:
        mapPlanResponse.contentType,

      bodyLength:
        mapPlanResponse.text.length,

      jigu_info:
        normalizeJiguInfo(
          mapPlanResponse.json
        )
    },

    connector: {
      requestItems:
        connectorItems,

      skippedItems:
        skipped,

      attempts:
        results.map(
          (item) => ({
            ...item,

            /*
             * 전체 고시 content는
             * Probe 결과 용량을 불필요하게 키우지 않도록
             * 필요할 경우에만 확인한다.
             */
            parsed:
              item.parsed
                ? summarizeNotices(
                    item.parsed
                  )
                : null,

            body:
              item.body ?? null
          })
        )
    }
  };

  await fs.writeFile(
    outputPath,
    JSON.stringify(
      output,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(
    `Saved: ${outputPath}`
  );
}

main().catch((error) => {
  console.error("");
  console.error(
    "RESULT: FAIL"
  );

  console.error(
    error?.stack ??
    error?.message ??
    String(error)
  );

  process.exitCode = 1;
});