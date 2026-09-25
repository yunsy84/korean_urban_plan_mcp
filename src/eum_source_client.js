import https from "node:https";
import { URL } from "node:url";

const EUM_PAGE =
  "https://www.eum.go.kr/web/cp/cv/cvUpisDet.jsp";

const MAPPLAN_BASE =
  "https://www.eum.ne.kr:9001/MapPlan";

const CONNECTOR =
  "https://www.eum.go.kr/web/api/Upis/UrlConnector.jsp";

const CONNECTOR_API =
  "/upispweb/linkmgmt/api/selectListNtfcHistByRec";

const DEFAULT_VERSION =
  "20260614";

const DEFAULT_TIMEOUT_MS =
  60000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/153.0.0.0 Safari/537.36";

function requestBufferOnce(
  urlString,
  {
    method = "GET",
    headers = {},
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = 512 * 1024 * 1024
  } = {}
) {
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
        new Error(
          `Only HTTPS is supported: ${url.protocol}`
        )
      );
      return;
    }

    const req =
      https.request(
        url,
        {
          method,
          headers: {
            "User-Agent": USER_AGENT,
            Connection: "close",
            ...headers
          }
        },
        (res) => {
          const chunks = [];
          let total = 0;
          let truncated = false;

          res.on(
            "data",
            (chunk) => {
              if (!Buffer.isBuffer(chunk)) {
                chunk = Buffer.from(chunk);
              }

              if (total >= maxBytes) {
                return;
              }

              const remain =
                maxBytes - total;

              if (
                chunk.length >
                remain
              ) {
                chunks.push(
                  chunk.subarray(
                    0,
                    remain
                  )
                );

                total += remain;
                truncated = true;
              } else {
                chunks.push(chunk);
                total += chunk.length;
              }
            }
          );

          res.on(
            "end",
            () => {
              resolve({
                status:
                  res.statusCode ?? 0,

                headers:
                  Object.fromEntries(
                    Object.entries(
                      res.headers
                    ).map(
                      ([key, value]) => [
                        key,
                        Array.isArray(
                          value
                        )
                          ? value.join(
                              ", "
                            )
                          : String(
                              value ?? ""
                            )
                      ]
                    )
                  ),

                body:
                  Buffer.concat(
                    chunks
                  ),

                truncated
              });
            }
          );

          res.on(
            "error",
            reject
          );
        }
      );

    req.setTimeout(
      timeoutMs,
      () => {
        req.destroy(
          new Error(
            `REQUEST_TIMEOUT after ${timeoutMs} ms`
          )
        );
      }
    );

    req.on(
      "error",
      reject
    );

    if (
      body !== null &&
      body !== undefined
    ) {
      if (Buffer.isBuffer(body)) {
        req.write(body);
      } else {
        req.write(String(body));
      }
    }

    req.end();
  });
}

function isRetryableNetworkError(error) {
  const code =
    String(
      error?.code ??
      ""
    ).toUpperCase();

  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "ECONNABORTED"
  ].includes(code);
}

export async function requestBuffer(
  urlString,
  options = {}
) {
  const maxRetries =
    Number.isInteger(options.networkRetries)
      ? Math.max(0, options.networkRetries)
      : 2;

  let attempt = 0;

  while (true) {
    try {
      return await requestBufferOnce(
        urlString,
        options
      );
    } catch (error) {
      if (
        !isRetryableNetworkError(error) ||
        attempt >= maxRetries
      ) {
        throw error;
      }

      const delayMs =
        400 * (attempt + 1);

      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            delayMs
          )
      );

      attempt += 1;
    }
  }
}

function decodeText(
  buffer,
  contentType = ""
) {
  const isEucKr =
    /charset\s*=\s*(?:euc-?kr|ks_c_5601-1987|cp949)/i.test(
      contentType
    );

  const decoder =
    new TextDecoder(
      isEucKr
        ? "euc-kr"
        : "utf-8"
    );

  return {
    text:
      decoder.decode(buffer),

    encoding:
      isEucKr
        ? "euc-kr"
        : "utf-8"
  };
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getSetCookieHeaders(
  headers
) {
  const values =
    headers["set-cookie"];

  if (
    Array.isArray(values)
  ) {
    return values;
  }

  if (values) {
    return [values];
  }

  return [];
}

function buildCookieHeader(
  setCookies
) {
  const map =
    new Map();

  for (
    const raw
    of setCookies
  ) {
    const first =
      String(raw ?? "")
        .split(";", 1)[0]
        .trim();

    if (!first) {
      continue;
    }

    const eq =
      first.indexOf("=");

    if (eq <= 0) {
      continue;
    }

    const name =
      first.slice(
        0,
        eq
      );

    map.set(
      name,
      first
    );
  }

  return [
    ...map.values()
  ].join("; ");
}

function mergeCookieHeader(
  existing,
  setCookies
) {
  const map = new Map();

  for (const part of String(existing ?? "").split(";")) {
    const value = part.trim();
    const eq = value.indexOf("=");
    if (eq > 0) {
      map.set(value.slice(0, eq).trim(), value);
    }
  }

  for (const raw of setCookies) {
    const first = String(raw ?? "").split(";", 1)[0].trim();
    const eq = first.indexOf("=");
    if (eq > 0) {
      map.set(first.slice(0, eq).trim(), first);
    }
  }

  return [...map.values()].join("; ");
}

export async function getEumPublicPage(
  pnu
) {
  const url =
    new URL(EUM_PAGE);

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

  const response =
    await requestBuffer(
      url.toString(),
      {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language":
            "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      }
    );

  const contentType =
    response.headers[
      "content-type"
    ] ?? "";

  const decoded =
    decodeText(
      response.body,
      contentType
    );

  const setCookies =
    getSetCookieHeaders(
      response.headers
    );

  const cookie =
    buildCookieHeader(
      setCookies
    );

  return {
    url:
      url.toString(),

    status:
      response.status,

    contentType,

    bytes:
      response.body.length,

    text:
      decoded.text,

    encoding:
      decoded.encoding,

    cookie
  };
}

export async function callMapPlanPnu(
  pnu,
  {
    version = DEFAULT_VERSION,
    server = MAPPLAN_BASE
  } = {}
) {
  const url =
    new URL(
      `${server.replace(/\/$/, "")}/MapPlan`
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

  const response =
    await requestBuffer(
      url.toString(),
      {
        headers: {
          Accept:
            "application/json,text/plain,*/*",
          Referer:
            `${EUM_PAGE}?isNoScr=script&mode=search&pnu=${pnu}&s_type=1&selGbn=umd`
        }
      }
    );

  const contentType =
    response.headers[
      "content-type"
    ] ?? "";

  const decoded =
    decodeText(
      response.body,
      contentType
    );

  const json =
    parseJsonText(
      decoded.text
    );

  if (
    response.status < 200 ||
    response.status >= 400
  ) {
    throw new Error(
      `MapPlan HTTP ${response.status}`
    );
  }

  if (!json) {
    throw new Error(
      "MapPlan response is not valid JSON."
    );
  }

  return {
    url:
      url.toString(),

    status:
      response.status,

    contentType,

    encoding:
      decoded.encoding,

    json
  };
}


async function requestBufferWithFetch(
  urlString,
  {
    method = "GET",
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = 512 * 1024 * 1024
  } = {}
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        urlString,
        {
          method,
          headers,
          signal:
            controller.signal,
          redirect:
            "follow"
        }
      );

    const arrayBuffer =
      await response.arrayBuffer();

    const source =
      Buffer.from(
        arrayBuffer
      );

    const body =
      source.length > maxBytes
        ? source.subarray(
            0,
            maxBytes
          )
        : source;

    return {
      status:
        response.status,

      headers:
        Object.fromEntries(
          response.headers.entries()
        ),

      body,

      truncated:
        source.length > maxBytes
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildConnectorUrl(
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

function buildConnectorHeaders(
  pageUrl,
  {
    cookie = "",
    origin = false
  } = {}
) {
  const headers = {
    Accept:
      "application/json, text/javascript, */*; q=0.01",

    "Content-Type":
      "application/json",

    Referer:
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

async function requestConnector(
  requestUrl,
  pageUrl,
  {
    cookie = "",
    origin = false,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  const response =
    await requestBufferWithFetch(
      requestUrl,
      {
        headers:
          buildConnectorHeaders(
            pageUrl,
            {
              cookie,
              origin
            }
          ),
        timeoutMs
      }
    );

  const contentType =
    response.headers[
      "content-type"
    ] ?? "";

  const decoded =
    decodeText(
      response.body,
      contentType
    );

  const json =
    parseJsonText(
      decoded.text
    );

  return {
    url:
      requestUrl,

    status:
      response.status,

    contentType,

    encoding:
      decoded.encoding,

    json
  };
}

export async function callNoticeConnector(
  items,
  {
    pageUrl = EUM_PAGE,
    cookie = "",
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  const requestUrl =
    buildConnectorUrl(
      items
    );

  const attempts = [
    {
      label:
        "URLSearchParams + browser headers + no cookie",

      cookie:
        "",

      origin:
        false
    }
  ];

  if (cookie) {
    attempts.push({
      label:
        "URLSearchParams + browser headers + Origin + session cookie",

      cookie,

      origin:
        true
    });
  }

  attempts.push({
    label:
      "URLSearchParams + browser headers + Origin + no cookie",

    cookie:
      "",

    origin:
      true
  });

  let lastFailure =
    null;

  for (
    const attempt
    of attempts
  ) {
    try {
      const result =
        await requestConnector(
          requestUrl,
          pageUrl,
          {
            cookie:
              attempt.cookie,

            origin:
              attempt.origin,

            timeoutMs
          }
        );

      if (
        result.status >= 200 &&
        result.status < 400 &&
        result.json
      ) {
        return {
          ...result,

          attempt:
            attempt.label
        };
      }

      lastFailure =
        new Error(
          `UrlConnector HTTP ${result.status}`
        );
    } catch (error) {
      lastFailure =
        error instanceof Error
          ? error
          : new Error(
              String(error)
            );
    }
  }

  if (lastFailure) {
    throw lastFailure;
  }

  throw new Error(
    "UrlConnector request failed."
  );
}

export async function fetchEumDetailPage(
  urlString,
  {
    referer = EUM_PAGE,
    cookie = ""
  } = {}
) {
  const headers = {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

    Referer:
      referer,

    "Accept-Language":
      "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
  };

  if (cookie) {
    headers.Cookie = cookie;
  }

  const response =
    await requestBuffer(
      urlString,
      {
        headers
      }
    );

  const contentType =
    response.headers[
      "content-type"
    ] ?? "";

  const decoded =
    decodeText(
      response.body,
      contentType
    );

  if (
    response.status < 200 ||
    response.status >= 400
  ) {
    throw new Error(
      `EUM detail HTTP ${response.status}`
    );
  }

  const setCookies =
    getSetCookieHeaders(
      response.headers
    );

  const responseCookie =
    buildCookieHeader(
      setCookies
    );

  return {
    url:
      urlString,

    status:
      response.status,

    contentType,

    encoding:
      decoded.encoding,

    bytes:
      response.body.length,

    html:
      decoded.text,

    cookie:
      responseCookie || cookie
  };
}

export async function downloadBinary(
  urlString,
  {
    method = "GET",
    body = null,
    headers = {},
    referer = EUM_PAGE,
    timeoutMs = 120000
  } = {}
) {
  const requestHeaders = {
    Accept:
      "*/*",

    Referer:
      referer,

    ...headers
  };

  const response =
    await requestBuffer(
      urlString,
      {
        method,
        headers:
          requestHeaders,
        body,
        timeoutMs
      }
    );

  if (
    response.status < 200 ||
    response.status >= 400
  ) {
    throw new Error(
      `Attachment HTTP ${response.status}`
    );
  }

  return {
    url:
      urlString,

    status:
      response.status,

    contentType:
      response.headers[
        "content-type"
      ] ?? "",

    contentLength:
      response.headers[
        "content-length"
      ] ?? "",

    contentDisposition:
      response.headers[
        "content-disposition"
      ] ?? "",

    truncated:
      Boolean(
        response.truncated
      ),

    body:
      response.body
  };
}

function decodeHtmlEntitiesSimple(
  value
) {
  return String(value ?? "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function stripHtmlForSearch(
  value
) {
  return decodeHtmlEntitiesSimple(
    String(value ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function buildGosiListUrl(
  {
    noticeNo = "",
    noticeDate = "",
    pageNo = 1,
    listSize = 100
  } = {}
) {
  const url =
    new URL(
      "https://www.eum.go.kr/web/gs/gv/gvGosiList.jsp"
    );

  const params = {
    chrgorg: "",
    enddt: noticeDate || "",
    geul_yn: "",
    gihyung_yn: "",
    gosichrg: "",
    gosino: noticeNo || "",
    listSize: String(listSize),
    mobile_yn: "",
    pageNo: String(pageNo),
    prj_cat_cd: "",
    prj_nm: "",
    selSggCd: "",
    select2: "",
    select_3: "",
    silsi_yn: "",
    startdt: noticeDate || "",
    zonenm: ""
  };

  for (
    const [key, value]
    of Object.entries(params)
  ) {
    url.searchParams.set(
      key,
      value
    );
  }

  return url.toString();
}

function extractGosiDetailSeqs(
  html
) {
  const result = [];
  const seen = new Set();

  const regex =
    /gvGosiDet\.jsp[^"'<>]*?(?:[?&]|&amp;)seq(?:=|%3D)(\d+)/gi;

  for (
    const match of html.matchAll(regex)
  ) {
    const seq =
      String(match[1] ?? "").trim();

    if (
      !seq ||
      seen.has(seq)
    ) {
      continue;
    }

    seen.add(seq);
    result.push(seq);
  }

  return result;
}

export async function findEumDetailPages(
  notice,
  {
    maxPages = 5,
    listSize = 100,
    maxCandidates = 20
  } = {}
) {
  const noticeNo =
    String(
      notice?.notice_no ??
      ""
    ).trim();

  const noticeDate =
    String(
      notice?.notice_date ??
      ""
    ).trim();

  const targetOrgan =
    stripHtmlForSearch(
      notice?.organ_nm ?? ""
    );

  if (!noticeNo) {
    return [];
  }

  const candidateSeqs = [];
  const seenSeqs = new Set();
  const listPages = [];
  let cookie = "";

  for (
    let pageNo = 1;
    pageNo <= maxPages;
    pageNo += 1
  ) {
    const listUrl =
      buildGosiListUrl({
        noticeNo,
        noticeDate,
        pageNo,
        listSize
      });

    const headers = {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

      "Accept-Language":
        "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7"
    };

    if (cookie) {
      headers.Cookie = cookie;
    }

    const response =
      await requestBuffer(
        listUrl,
        {
          headers
        }
      );

    const contentType =
      response.headers[
        "content-type"
      ] ?? "";

    const decoded =
      decodeText(
        response.body,
        contentType
      );

    const setCookies =
      getSetCookieHeaders(
        response.headers
      );

    cookie =
      mergeCookieHeader(
        cookie,
        setCookies
      );

    const html =
      decoded.text;

    listPages.push({
      url:
        listUrl,

      status:
        response.status,

      encoding:
        decoded.encoding,

      bytes:
        response.body.length,

      seqs:
        extractGosiDetailSeqs(
          html
        )
    });

    const pageSeqs =
      extractGosiDetailSeqs(
        html
      );

    for (
      const seq
      of pageSeqs
    ) {
      if (
        seenSeqs.has(seq)
      ) {
        continue;
      }

      seenSeqs.add(seq);
      candidateSeqs.push(seq);

      if (
        candidateSeqs.length >=
        maxCandidates
      ) {
        break;
      }
    }

    if (
      candidateSeqs.length >=
      maxCandidates
    ) {
      break;
    }

    if (
      pageSeqs.length === 0
    ) {
      break;
    }
  }

  const details = [];

  for (
    const seq
    of candidateSeqs
  ) {
    const detailUrl =
      new URL(
        "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp"
      );

    detailUrl.searchParams.set(
      "mobile_yn",
      ""
    );

    detailUrl.searchParams.set(
      "seq",
      seq
    );

    const detailHeaders = {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

      "Accept-Language":
        "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",

      Referer:
        listPages.at(-1)?.url ||
        EUM_PAGE
    };

    if (cookie) {
      detailHeaders.Cookie =
        cookie;
    }

    const response =
      await requestBuffer(
        detailUrl.toString(),
        {
          headers:
            detailHeaders
        }
      );

    const contentType =
      response.headers[
        "content-type"
      ] ?? "";

    const decoded =
      decodeText(
        response.body,
        contentType
      );

    if (
      response.status < 200 ||
      response.status >= 400
    ) {
      continue;
    }

    const searchable =
      stripHtmlForSearch(
        decoded.text
      );

    if (
      noticeNo &&
      !searchable.includes(
        noticeNo
      )
    ) {
      continue;
    }

    if (
      noticeDate &&
      !searchable.includes(
        noticeDate
      )
    ) {
      continue;
    }

    if (
      targetOrgan &&
      !searchable.includes(
        targetOrgan
      )
    ) {
      continue;
    }

    const detailSetCookies =
      getSetCookieHeaders(
        response.headers
      );

    const detailCookie =
      mergeCookieHeader(
        cookie,
        detailSetCookies
      );

    details.push({
      seq,
      url:
        detailUrl.toString(),
      status:
        response.status,
      contentType,
      encoding:
        decoded.encoding,
      bytes:
        response.body.length,
      html:
        decoded.text,
      cookie:
        detailCookie
    });
  }

  return {
    listPages,
    candidateSeqs,
    details
  };
}

export function buildNoticeDetailUrl(
  notice
) {
  const seq =
    String(
      notice?.detailSeq ??
      ""
    ).trim();

  if (
    !/^\d+$/.test(seq)
  ) {
    throw new Error(
      "EUM detail seq is required. " +
      "It must be discovered from the EUM gosi list; " +
      "wtnnc_cd is not an EUM detail seq."
    );
  }

  const url =
    new URL(
      "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp"
    );

  url.searchParams.set(
    "seq",
    seq
  );

  url.searchParams.set(
    "mobile_yn",
    ""
  );

  return url.toString();
}