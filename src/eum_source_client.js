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

function requestBuffer(
  urlString,
  {
    method = "GET",
    headers = {},
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

                truncated:
                  total >= maxBytes
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

    req.end();
  });
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

export async function callNoticeConnector(
  items,
  {
    pageUrl = EUM_PAGE,
    cookie = ""
  } = {}
) {
  const rawUrl =
    `${CONNECTOR}` +
    `?url=${CONNECTOR_API}` +
    `&json=${JSON.stringify(items)}`;

  const url =
    new URL(rawUrl);

  const requestUrl =
    url.toString();

  const response =
    await requestBuffer(
      requestUrl,
      {
        headers: {
          Accept:
            "application/json, text/javascript, */*; q=0.01",

          "Content-Type":
            "application/json",

          Referer:
            pageUrl,

          "X-Requested-With":
            "XMLHttpRequest",

          ...(cookie
            ? {
                Cookie:
                  cookie
              }
            : {})
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
      `UrlConnector HTTP ${response.status}`
    );
  }

  if (!json) {
    throw new Error(
      "UrlConnector response is not valid JSON."
    );
  }

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

export async function fetchEumDetailPage(
  urlString,
  {
    referer = EUM_PAGE
  } = {}
) {
  const response =
    await requestBuffer(
      urlString,
      {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          Referer:
            referer,

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

  if (
    response.status < 200 ||
    response.status >= 400
  ) {
    throw new Error(
      `EUM detail HTTP ${response.status}`
    );
  }

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
      decoded.text
  };
}

export async function downloadBinary(
  urlString,
  {
    referer = EUM_PAGE,
    timeoutMs = 120000
  } = {}
) {
  const response =
    await requestBuffer(
      urlString,
      {
        headers: {
          Accept:
            "*/*",

          Referer:
            referer
        },

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

    body:
      response.body
  };
}

export function buildNoticeDetailUrl(
  notice
) {
  const parts =
    String(
      notice.notice_no
    ).split("-");

  if (
    parts.length !== 2
  ) {
    throw new Error(
      `Unsupported notice_no format: ${notice.notice_no}`
    );
  }

  const url =
    new URL(
      "https://www.eum.go.kr/web/gs/gv/gvGosiDet.jsp"
    );

  url.searchParams.set(
    "seq",
    ""
  );

  url.searchParams.set(
    "gosi_no_chrg",
    String(
      notice.org_cd
    )
  );

  url.searchParams.set(
    "gosi_no_year",
    parts[0]
  );

  url.searchParams.set(
    "gosi_no_no",
    parts[1]
  );

  url.searchParams.set(
    "mobile_yn",
    ""
  );

  return url.toString();
}