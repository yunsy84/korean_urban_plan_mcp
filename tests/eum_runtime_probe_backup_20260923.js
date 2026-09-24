/**
 * EUM runtime probe - response body capture version
 *
 * 실제 Chrome/Chromium/Edge JavaScript 실행환경에서 토지이음 도시계획 상세 페이지를 열고
 * Network 요청과 핵심 응답 본문(response body)을 캡처합니다.
 *
 * 목적:
 *   1. static HTML 정규식 분석이 아니라 실제 JS 실행 후 발생하는 요청 확인
 *   2. UrlConnector.jsp / MapPlan / pnu_analysis / 고시 관련 호출 확인
 *   3. 관심 응답의 실제 본문 확보
 *   4. PNU -> 도시계획 식별자 -> 관련 고시 연결 구조 검증
 *
 * 중요:
 *   - 특정 PNU를 코드에 하드코딩하지 않습니다.
 *   - PNU는 실행 시 첫 번째 인자로 전달합니다.
 *   - 119.196.18.3 등의 내부 GIS 서버를 직접 호출하지 않습니다.
 *   - 브라우저가 실제 발생시킨 요청과 응답만 캡처합니다.
 *
 * 사용:
 *   node tests\eum_runtime_probe.js 4413310300111160000
 *
 * 선택 환경변수:
 *   set EUM_PROBE_BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe
 *   set EUM_PROBE_WAIT_MS=12000
 *   set EUM_PROBE_PORT=9229
 */

import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* =========================================================
 * 1. 입력
 * ========================================================= */

const pnu = String(
  process.argv[2] ?? ""
).trim();

if (!/^\d{19}$/.test(pnu)) {
  console.error(
    "ERROR: PNU must be exactly 19 digits."
  );

  process.exit(2);
}

/* =========================================================
 * 2. EUM 도시계획 상세 URL
 * ========================================================= */

const EUM_URL =
  "https://www.eum.go.kr/web/cp/cv/cvUpisDet.jsp" +
  "?isNoScr=script" +
  "&mode=search" +
  `&pnu=${encodeURIComponent(pnu)}` +
  "&s_type=1" +
  "&selGbn=umd";

/* =========================================================
 * 3. 실행 옵션
 * ========================================================= */

const WAIT_MS = Number(
  process.env.EUM_PROBE_WAIT_MS ?? 12000
);

const DEBUG_PORT = Number(
  process.env.EUM_PROBE_PORT ?? 9229
);

/* =========================================================
 * 4. CDP 상태
 * ========================================================= */

const runtimeEvents = [];

let nextId = 0;

const pending = new Map();

let socket = null;

/* =========================================================
 * 5. 유틸
 * ========================================================= */

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(resolve, ms)
  );
}

/* =========================================================
 * 6. Chrome / Edge 후보
 * ========================================================= */

function chromeCandidates() {
  const pf =
    process.env["ProgramFiles"] ??
    "C:\\Program Files";

  const lpf =
    process.env["ProgramFiles(x86)"] ??
    "C:\\Program Files (x86)";

  const local =
    process.env.LOCALAPPDATA ??
    "";

  return [
    join(
      pf,
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),

    join(
      lpf,
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),

    join(
      local,
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),

    join(
      pf,
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),

    join(
      lpf,
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),

    join(
      local,
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),
  ];
}

/* =========================================================
 * 7. 브라우저 검색
 * ========================================================= */

async function findBrowser() {
  const explicitBrowser =
    String(
      process.env.EUM_PROBE_BROWSER ??
      ""
    ).trim();

  if (explicitBrowser) {
    try {
      await access(
        explicitBrowser
      );

      return explicitBrowser;
    } catch {
      throw new Error(
        `EUM_PROBE_BROWSER 경로를 찾을 수 없습니다: ${explicitBrowser}`
      );
    }
  }

  for (
    const candidate of chromeCandidates()
  ) {
    try {
      await access(
        candidate
      );

      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error(
    "Chrome/Edge 실행 파일을 찾지 못했습니다. " +
    "EUM_PROBE_BROWSER 환경변수로 경로를 지정하세요."
  );
}

/* =========================================================
 * 8. CDP HTTP JSON
 * ========================================================= */

async function getJson(url) {
  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${url}`
    );
  }

  return response.json();
}

async function waitForJson(
  url,
  timeoutMs = 8000
) {
  const deadline =
    Date.now() + timeoutMs;

  let lastError = null;

  while (
    Date.now() < deadline
  ) {
    try {
      return await getJson(
        url
      );
    } catch (error) {
      lastError = error;

      await sleep(150);
    }
  }

  throw (
    lastError ??
    new Error(
      `Timed out: ${url}`
    )
  );
}

/* =========================================================
 * 9. CDP command
 * ========================================================= */

function send(
  method,
  params = {}
) {
  if (!socket) {
    return Promise.reject(
      new Error(
        "CDP WebSocket is not connected."
      )
    );
  }

  const id =
    ++nextId;

  socket.send(
    JSON.stringify({
      id,
      method,
      params,
    })
  );

  return new Promise(
    (resolve, reject) => {
      pending.set(
        id,
        {
          resolve,
          reject,
        }
      );

      setTimeout(() => {
        if (!pending.has(id)) {
          return;
        }

        pending.delete(id);

        reject(
          new Error(
            `CDP command timeout: ${method}`
          )
        );
      }, 20000);
    }
  );
}

/* =========================================================
 * 10. CDP WebSocket
 * ========================================================= */

function connectWebSocket(
  wsUrl
) {
  return new Promise(
    (resolve, reject) => {
      const ws =
        new WebSocket(
          wsUrl
        );

      let opened = false;

      ws.addEventListener(
        "open",
        () => {
          opened = true;

          socket = ws;

          resolve();
        }
      );

      ws.addEventListener(
        "error",
        (event) => {
          const message =
            event?.message ??
            "unknown WebSocket error";

          if (!opened) {
            reject(
              new Error(
                `WebSocket error: ${message}`
              )
            );
          }
        }
      );

      ws.addEventListener(
        "close",
        () => {
          socket = null;

          for (
            const [
              id,
              call,
            ] of pending.entries()
          ) {
            call.reject(
              new Error(
                `CDP socket closed while waiting for command id ${id}`
              )
            );
          }

          pending.clear();
        }
      );

      ws.addEventListener(
        "message",
        (event) => {
          let message;

          try {
            message =
              JSON.parse(
                event.data
              );
          } catch {
            return;
          }

          /*
           * CDP response
           */
          if (
            message.id &&
            pending.has(
              message.id
            )
          ) {
            const call =
              pending.get(
                message.id
              );

            pending.delete(
              message.id
            );

            if (
              message.error
            ) {
              call.reject(
                new Error(
                  `${message.error.code}: ${message.error.message}`
                )
              );
            } else {
              call.resolve(
                message.result
              );
            }
          }

          /*
           * CDP event
           */
          if (
            message.method
          ) {
            runtimeEvents.push(
              message
            );
          }
        }
      );
    }
  );
}

/* =========================================================
 * 11. Request category
 * ========================================================= */

function requestCategory(
  request
) {
  const type =
    String(
      request?.type ?? ""
    ).toLowerCase();

  if (
    [
      "xhr",
      "fetch",
      "document",
      "script",
      "stylesheet",
      "image",
      "font",
      "media",
      "other",
    ].includes(type)
  ) {
    return type;
  }

  return (
    type ||
    "other"
  );
}

/* =========================================================
 * 12. Initiator
 * ========================================================= */

function simplifyInitiator(
  initiator
) {
  if (!initiator) {
    return null;
  }

  return {
    type:
      initiator.type ??
      null,

    url:
      initiator.url ??
      null,

    lineNumber:
      initiator.lineNumber ??
      null,

    columnNumber:
      initiator.columnNumber ??
      null,

    requestId:
      initiator.requestId ??
      null,

    stack:
      initiator.stack
        ?.callFrames
        ?.map(
          (frame) => ({
            functionName:
              frame.functionName ??
              null,

            scriptId:
              frame.scriptId ??
              null,

            url:
              frame.url ??
              null,

            lineNumber:
              frame.lineNumber ??
              null,

            columnNumber:
              frame.columnNumber ??
              null,
          })
        ) ??
      null,
  };
}

/* =========================================================
 * 13. URL query parameter 분해
 * ========================================================= */

function extractQueryParams(
  url
) {
  try {
    const parsed =
      new URL(url);

    const result = {};

    for (
      const [
        key,
        value,
      ] of parsed.searchParams.entries()
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          result,
          key
        )
      ) {
        if (
          Array.isArray(
            result[key]
          )
        ) {
          result[key].push(
            value
          );
        } else {
          result[key] = [
            result[key],
            value,
          ];
        }
      } else {
        result[key] =
          value;
      }
    }

    return result;
  } catch {
    return {};
  }
}

/* =========================================================
 * 14. POST form 데이터 분석
 * ========================================================= */

function parseFormData(
  postData
) {
  if (!postData) {
    return null;
  }

  const raw =
    String(postData);

  try {
    const params =
      new URLSearchParams(
        raw
      );

    const form = {};

    for (
      const [
        key,
        value,
      ] of params.entries()
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          form,
          key
        )
      ) {
        if (
          Array.isArray(
            form[key]
          )
        ) {
          form[key].push(
            value
          );
        } else {
          form[key] = [
            form[key],
            value,
          ];
        }
      } else {
        form[key] =
          value;
      }
    }

    return {
      raw,
      form,
    };
  } catch {
    return {
      raw,
      form: null,
    };
  }
}

/* =========================================================
 * 15. 관심 URL
 * ========================================================= */

function isInterestingUrl(
  url
) {
  const lower =
    String(
      url ?? ""
    ).toLowerCase();

  return [
    "urlconnector.jsp",
    "mapplan",
    "pnu_analysis",
    "lulanddetcheckajaxxml.jsp",
    "mpsearchmapajaxxml.jsp",
    "mpsearchaddrajaxxml.jsp",
    "cvupisdetgosiajax.jsp",
    "gosi",
    "notice",
  ].some(
    (marker) =>
      lower.includes(marker)
  );
}

/* =========================================================
 * 16. 응답 body를 읽을 대상
 * ========================================================= */

function isResponseBodyTarget(
  url
) {
  const lower =
    String(
      url ?? ""
    ).toLowerCase();

  return [
    "pnu_analysis",
    "urlconnector.jsp",
    "cvupisdetgosiajax.jsp",
    "lulanddetcheckajaxxml.jsp",
    "mpsearchmapajaxxml.jsp",
    "mpsearchaddrajaxxml.jsp",
  ].some(
    (marker) =>
      lower.includes(marker)
  );
}

/* =========================================================
 * 17. Request 정리
 * ========================================================= */

function simplifyRequest(
  event
) {
  const request =
    event?.params?.request ??
    {};

  const url =
    String(
      request.url ?? ""
    );

  return {
    requestId:
      event?.params?.requestId ??
      null,

    loaderId:
      event?.params?.loaderId ??
      null,

    documentURL:
      event?.params?.documentURL ??
      null,

    type:
      requestCategory(
        request
      ),

    method:
      request.method ??
      null,

    url,

    queryParams:
      extractQueryParams(
        url
      ),

    postData:
      request.postData ??
      null,

    parsedPostData:
      parseFormData(
        request.postData
      ),

    requestHeaders:
      request.headers ??
      null,

    initiator:
      simplifyInitiator(
        event?.params?.initiator
      ),

    interesting:
      isInterestingUrl(
        url
      ) ||
      /119\.196\.18\.3/i.test(
        url
      ) ||
      /eum\.ne\.kr/i.test(
        url
      ),
  };
}

/* =========================================================
 * 18. Response 정리
 * ========================================================= */

function simplifyResponse(
  event
) {
  const response =
    event?.params?.response ??
    {};

  const url =
    String(
      response.url ?? ""
    );

  return {
    requestId:
      event?.params?.requestId ??
      null,

    status:
      response.status ??
      null,

    statusText:
      response.statusText ??
      null,

    mimeType:
      response.mimeType ??
      null,

    url,

    responseHeaders:
      response.headers ??
      null,

    remoteIPAddress:
      response.remoteIPAddress ??
      null,

    remotePort:
      response.remotePort ??
      null,

    protocol:
      response.protocol ??
      null,

    securityState:
      response.securityState ??
      null,

    fromDiskCache:
      response.fromDiskCache ??
      false,

    fromServiceWorker:
      response.fromServiceWorker ??
      false,

    bodyTarget:
      isResponseBodyTarget(
        url
      ),

    interesting:
      isInterestingUrl(
        url
      ) ||
      /119\.196\.18\.3/i.test(
        url
      ) ||
      /eum\.ne\.kr/i.test(
        url
      ),
  };
}

/* =========================================================
 * 19. loadingFinished
 * ========================================================= */

function simplifyLoadingFinished(
  event
) {
  return {
    requestId:
      event?.params?.requestId ??
      null,

    encodedDataLength:
      event?.params?.encodedDataLength ??
      null,

    shouldReportCorbBlockingReason:
      event?.params
        ?.shouldReportCorbBlockingReason ??
      null,

    shouldReportCorsError:
      event?.params
        ?.shouldReportCorsError ??
      null,
  };
}

/* =========================================================
 * 20. Event 추출
 * ========================================================= */

function getRequests() {
  return runtimeEvents
    .filter(
      (event) =>
        event.method ===
        "Network.requestWillBeSent"
    )
    .map(
      simplifyRequest
    );
}

function getResponses() {
  return runtimeEvents
    .filter(
      (event) =>
        event.method ===
        "Network.responseReceived"
    )
    .map(
      simplifyResponse
    );
}

function getLoadingFinished() {
  return runtimeEvents
    .filter(
      (event) =>
        event.method ===
        "Network.loadingFinished"
    )
    .map(
      simplifyLoadingFinished
    );
}

/* =========================================================
 * 21. requestId 기준 중복 제거
 * ========================================================= */

function dedupeByRequestId(
  items
) {
  const map =
    new Map();

  for (
    const item of items
  ) {
    if (
      !item.requestId
    ) {
      continue;
    }

    map.set(
      item.requestId,
      item
    );
  }

  return [
    ...map.values(),
  ];
}

/* =========================================================
 * 22. Request 찾기
 * ========================================================= */

function findRequestById(
  requests,
  requestId
) {
  return (
    requests.find(
      (request) =>
        request.requestId ===
        requestId
    ) ??
    null
  );
}

/* =========================================================
 * 23. Response body 안전하게 가져오기
 * ========================================================= */

async function getResponseBodySafe(
  requestId,
  response
) {
  const result = {
    requestId,

    success: false,

    body: null,

    base64Encoded: false,

    bodyLength: 0,

    error: null,
  };

  if (!requestId) {
    result.error =
      "missing_request_id";

    return result;
  }

  if (!response) {
    result.error =
      "response_not_found";

    return result;
  }

  try {
    const bodyResult =
      await send(
        "Network.getResponseBody",
        {
          requestId,
        }
      );

    const body =
      typeof bodyResult?.body ===
      "string"
        ? bodyResult.body
        : "";

    result.success =
      true;

    result.body =
      body;

    result.base64Encoded =
      bodyResult?.base64Encoded ??
      false;

    result.bodyLength =
      body.length;

    return result;
  } catch (error) {
    result.error =
      error instanceof Error
        ? error.message
        : String(error);

    return result;
  }
}

/* =========================================================
 * 24. JSON 파싱 시도
 * ========================================================= */

function tryParseJson(
  text
) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    return null;
  }
}

/* =========================================================
 * 25. Body 정리
 * ========================================================= */

function summarizeBody(
  bodyCapture,
  response
) {
  if (
    !bodyCapture?.success
  ) {
    return bodyCapture;
  }

  const body =
    String(
      bodyCapture.body ??
      ""
    );

  return {
    ...bodyCapture,

    contentType:
      response?.responseHeaders?.[
        "content-type"
      ] ??
      response?.responseHeaders?.[
        "Content-Type"
      ] ??
      null,

    httpStatus:
      response?.status ??
      null,

    parsedJson:
      tryParseJson(
        body
      ),
  };
}

/* =========================================================
 * 26. 관심 응답 body 수집
 * ========================================================= */

async function captureTargetResponseBodies(
  requests,
  responses
) {
  const targets =
    dedupeByRequestId(
      responses.filter(
        (response) =>
          response.bodyTarget
      )
    );

  const result = [];

  for (
    const response of targets
  ) {
    const request =
      findRequestById(
        requests,
        response.requestId
      );

    const bodyCapture =
      await getResponseBodySafe(
        response.requestId,
        response
      );

    result.push({
      request:
        request
          ? {
              requestId:
                request.requestId,

              type:
                request.type,

              method:
                request.method,

              url:
                request.url,

              queryParams:
                request.queryParams,

              postData:
                request.postData,

              parsedPostData:
                request.parsedPostData,
            }
          : null,

      response: {
        requestId:
          response.requestId,

        status:
          response.status,

        statusText:
          response.statusText,

        mimeType:
          response.mimeType,

        url:
          response.url,

        responseHeaders:
          response.responseHeaders,

        remoteIPAddress:
          response.remoteIPAddress,

        remotePort:
          response.remotePort,

        protocol:
          response.protocol,

        securityState:
          response.securityState,
      },

      body:
        summarizeBody(
          bodyCapture,
          response
        ),
    });
  }

  return result;
}

/* =========================================================
 * 27. 브라우저 페이지 JS 평가
 * ========================================================= */

async function evaluatePage(
  expression
) {
  try {
    const result =
      await send(
        "Runtime.evaluate",
        {
          expression,

          returnByValue:
            true,

          awaitPromise:
            true,
        }
      );

    return (
      result?.result?.value ??
      null
    );
  } catch {
    return null;
  }
}

/* =========================================================
 * 28. 브라우저 실행
 * ========================================================= */

async function launchBrowser(
  browserPath,
  profilePath
) {
  return spawn(
    browserPath,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,

      "--headless=new",

      "--disable-gpu",

      "--no-sandbox",

      "--disable-dev-shm-usage",

      "--disable-background-networking",

      "--disable-default-apps",

      "--disable-extensions",

      "--disable-sync",

      "--metrics-recording-only",

      "--no-first-run",

      "--no-default-browser-check",

      `--user-data-dir=${profilePath}`,

      "about:blank",
    ],
    {
      stdio: [
        "ignore",
        "ignore",
        "ignore",
      ],

      windowsHide:
        true,
    }
  );
}

/* =========================================================
 * 29. CDP page target
 * ========================================================= */

async function getPageTarget() {
  const targets =
    await waitForJson(
      `http://127.0.0.1:${DEBUG_PORT}/json/list`,
      5000
    );

  if (
    !Array.isArray(
      targets
    )
  ) {
    throw new Error(
      "CDP target 목록을 가져오지 못했습니다."
    );
  }

  const target =
    targets.find(
      (item) =>
        item.type ===
          "page" &&
        item.webSocketDebuggerUrl
    ) ??
    targets.find(
      (item) =>
        item.webSocketDebuggerUrl
    );

  if (!target) {
    throw new Error(
      "CDP page target를 찾지 못했습니다."
    );
  }

  return target;
}

/* =========================================================
 * 30. 메인
 * ========================================================= */

async function main() {
  const browser =
    process.env.EUM_PROBE_BROWSER ||
    await findBrowser();

  const profile =
    await mkdtemp(
      join(
        tmpdir(),
        "eum-runtime-probe-"
      )
    );

  let child = null;

  try {
    /* -----------------------------------------------------
     * 브라우저 실행
     * ----------------------------------------------------- */

    child =
      await launchBrowser(
        browser,
        profile
      );

    child.once(
      "error",
      (error) => {
        console.error(
          `Browser spawn error: ${error.message}`
        );
      }
    );

    /* -----------------------------------------------------
     * CDP 기동 대기
     * ----------------------------------------------------- */

    await waitForJson(
      `http://127.0.0.1:${DEBUG_PORT}/json/version`,
      10000
    );

    /* -----------------------------------------------------
     * Page target
     * ----------------------------------------------------- */

    const target =
      await getPageTarget();

    /* -----------------------------------------------------
     * WebSocket 연결
     * ----------------------------------------------------- */

    await connectWebSocket(
      target.webSocketDebuggerUrl
    );

    /* -----------------------------------------------------
     * Network / Page / Runtime 활성화
     * ----------------------------------------------------- */

    await send(
      "Network.enable",
      {
        maxTotalBufferSize:
          50 * 1024 * 1024,

        maxResourceBufferSize:
          10 * 1024 * 1024,
      }
    );

    await send(
      "Page.enable",
      {}
    );

    await send(
      "Runtime.enable",
      {}
    );

    /* -----------------------------------------------------
     * EUM 페이지 이동
     * ----------------------------------------------------- */

    await send(
      "Page.navigate",
      {
        url: EUM_URL,
      }
    );

    /* -----------------------------------------------------
     * 페이지 JS / AJAX 실행 대기
     * ----------------------------------------------------- */

    await sleep(
      WAIT_MS
    );

    /*
     * 관련 request가 모두 기록되도록 추가 대기
     */
    await sleep(
      1000
    );

    /* -----------------------------------------------------
     * 기본 Network 데이터
     * ----------------------------------------------------- */

    const requests =
      getRequests();

    const responses =
      getResponses();

    const loadingFinished =
      getLoadingFinished();

    /* -----------------------------------------------------
     * 핵심 응답 본문 캡처
     * ----------------------------------------------------- */

    const targetBodies =
      await captureTargetResponseBodies(
        requests,
        responses
      );

    /* -----------------------------------------------------
     * 페이지 상태
     * ----------------------------------------------------- */

    const pageInfo =
      await evaluatePage(
        `(() => ({
          title: document.title || null,
          readyState: document.readyState,
          href: location.href,
          origin: location.origin,
          pathname: location.pathname
        }))()`
      );

    /* -----------------------------------------------------
     * EUM runtime 전역변수
     * ----------------------------------------------------- */

    const runtimeGlobals =
      await evaluatePage(
        `(() => ({
          hasMapObj:
            typeof mapObj !== "undefined",

          mapObj:
            typeof mapObj !== "undefined"
              ? {
                  pnu:
                    mapObj?.pnu ??
                    null,

                  version:
                    mapObj?.version ??
                    null,

                  initVersion:
                    mapObj?.initVersion ??
                    null,

                  gisServer:
                    mapObj?.gisServer ??
                    null,

                  initTile:
                    mapObj?.initTile ??
                    null
                }
              : null,

          hasServer:
            typeof server !== "undefined",

          server:
            typeof server !== "undefined"
              ? server
              : null,

          hasUpisPnu:
            typeof upisPnu !== "undefined",

          upisPnu:
            typeof upisPnu !== "undefined"
              ? upisPnu
              : null,

          hasWtnncList:
            typeof wtnnc_list !== "undefined",

          wtnncList:
            typeof wtnnc_list !== "undefined"
              ? wtnnc_list
              : null,

          hasNtfcByPnuData:
            typeof ntfcByPnuData !== "undefined",

          ntfcByPnuData:
            typeof ntfcByPnuData !== "undefined"
              ? ntfcByPnuData
              : null,

          hasGetUpisUrlConnector:
            typeof getUpisUrlConnector !== "undefined",

          getUpisUrlConnector:
            typeof getUpisUrlConnector !== "undefined"
              ? getUpisUrlConnector
              : null,

          hasSelectNtfcByPnu:
            typeof selectNtfcByPnu !== "undefined",

          selectNtfcByPnu:
            typeof selectNtfcByPnu !== "undefined"
              ? selectNtfcByPnu
              : null,

          hasFnSearchGosi:
            typeof fn_searchGosi !== "undefined"
        }))()`
      );

    /* -----------------------------------------------------
     * 관심 요청
     * ----------------------------------------------------- */

    const interestingRequests =
      requests.filter(
        (request) =>
          request.interesting
      );

    const interestingResponses =
      responses.filter(
        (response) =>
          response.interesting
      );

    /* -----------------------------------------------------
     * 내부 MapPlan 서버
     * ----------------------------------------------------- */

    const internalGisRequests =
      requests.filter(
        (request) =>
          /eum\.ne\.kr/i.test(
            request.url
          ) ||
          /119\.196\.18\.3/i.test(
            request.url
          )
      );

    /* -----------------------------------------------------
     * URL별 핵심 요청
     * ----------------------------------------------------- */

    const urlConnectorRequests =
      requests.filter(
        (request) =>
          /UrlConnector\.jsp/i.test(
            request.url
          )
      );

    const pnuAnalysisRequests =
      requests.filter(
        (request) =>
          /pnu_analysis/i.test(
            request.url
          )
      );

    const gosiRequests =
      requests.filter(
        (request) =>
          /cvUpisDetGosiAjax\.jsp/i.test(
            request.url
          )
      );

    const landCheckRequests =
      requests.filter(
        (request) =>
          /luLandDetCheckAjaxXml\.jsp/i.test(
            request.url
          )
      );

    const mapSearchRequests =
      requests.filter(
        (request) =>
          /mpSearchMapAjaxXml\.jsp/i.test(
            request.url
          )
      );

    const addressSearchRequests =
      requests.filter(
        (request) =>
          /mpSearchAddrAjaxXml\.jsp/i.test(
            request.url
          )
      );

    /* -----------------------------------------------------
     * response body를 endpoint별로 분류
     * ----------------------------------------------------- */

    const responseBodiesByTarget = {
      pnuAnalysis:
        targetBodies.filter(
          (item) =>
            /pnu_analysis/i.test(
              item.response?.url ??
              ""
            )
        ),

      urlConnector:
        targetBodies.filter(
          (item) =>
            /UrlConnector\.jsp/i.test(
              item.response?.url ??
              ""
            )
        ),

      gosi:
        targetBodies.filter(
          (item) =>
            /cvUpisDetGosiAjax\.jsp/i.test(
              item.response?.url ??
              ""
            )
        ),

      landCheck:
        targetBodies.filter(
          (item) =>
            /luLandDetCheckAjaxXml\.jsp/i.test(
              item.response?.url ??
              ""
            )
        ),

      mapSearch:
        targetBodies.filter(
          (item) =>
            /mpSearchMapAjaxXml\.jsp/i.test(
              item.response?.url ??
              ""
            )
        ),

      addressSearch:
        targetBodies.filter(
          (item) =>
            /mpSearchAddrAjaxXml\.jsp/i.test(
              item.response?.url ??
              ""
            )
        ),
    };

    /* -----------------------------------------------------
     * UrlConnector body만 별도 간결화
     * ----------------------------------------------------- */

    const urlConnectorBodies =
      responseBodiesByTarget
        .urlConnector
        .map(
          (item) => ({
            request:
              item.request,

            response:
              item.response,

            bodySuccess:
              item.body?.success ??
              false,

            contentType:
              item.body?.contentType ??
              null,

            httpStatus:
              item.body?.httpStatus ??
              null,

            bodyLength:
              item.body?.bodyLength ??
              0,

            body:
              item.body?.body ??
              null,

            base64Encoded:
              item.body?.base64Encoded ??
              false,

            parsedJson:
              item.body?.parsedJson ??
              null,

            error:
              item.body?.error ??
              null,
          })
        );

    /* -----------------------------------------------------
     * pnu_analysis body
     * ----------------------------------------------------- */

    const pnuAnalysisBodies =
      responseBodiesByTarget
        .pnuAnalysis
        .map(
          (item) => ({
            request:
              item.request,

            response:
              item.response,

            bodySuccess:
              item.body?.success ??
              false,

            contentType:
              item.body?.contentType ??
              null,

            httpStatus:
              item.body?.httpStatus ??
              null,

            bodyLength:
              item.body?.bodyLength ??
              0,

            body:
              item.body?.body ??
              null,

            base64Encoded:
              item.body?.base64Encoded ??
              false,

            parsedJson:
              item.body?.parsedJson ??
              null,

            error:
              item.body?.error ??
              null,
          })
        );

    /* -----------------------------------------------------
     * 고시 AJAX body
     * ----------------------------------------------------- */

    const gosiBodies =
      responseBodiesByTarget
        .gosi
        .map(
          (item) => ({
            request:
              item.request,

            response:
              item.response,

            bodySuccess:
              item.body?.success ??
              false,

            contentType:
              item.body?.contentType ??
              null,

            httpStatus:
              item.body?.httpStatus ??
              null,

            bodyLength:
              item.body?.bodyLength ??
              0,

            body:
              item.body?.body ??
              null,

            base64Encoded:
              item.body?.base64Encoded ??
              false,

            parsedJson:
              item.body?.parsedJson ??
              null,

            error:
              item.body?.error ??
              null,
          })
        );

    /* -----------------------------------------------------
     * 최종 결과
     * ----------------------------------------------------- */

    const result = {
      success: true,

      pnu,

      browser,

      debugPort:
        DEBUG_PORT,

      eumUrl:
        EUM_URL,

      waitMs:
        WAIT_MS,

      page:
        pageInfo,

      runtimeGlobals,

      totals: {
        runtimeEvents:
          runtimeEvents.length,

        requests:
          requests.length,

        responses:
          responses.length,

        loadingFinished:
          loadingFinished.length,

        interestingRequests:
          interestingRequests.length,

        interestingResponses:
          interestingResponses.length,

        responseBodyTargets:
          targetBodies.length,
      },

      analysis: {
        urlConnectorFound:
          urlConnectorRequests.length >
          0,

        urlConnectorBodyCaptured:
          urlConnectorBodies.some(
            (item) =>
              item.bodySuccess
          ),

        pnuAnalysisFound:
          pnuAnalysisRequests.length >
          0,

        pnuAnalysisBodyCaptured:
          pnuAnalysisBodies.some(
            (item) =>
              item.bodySuccess
          ),

        gosiFound:
          gosiRequests.length >
          0,

        gosiBodyCaptured:
          gosiBodies.some(
            (item) =>
              item.bodySuccess
          ),

        landCheckFound:
          landCheckRequests.length >
          0,

        mapSearchFound:
          mapSearchRequests.length >
          0,

        addressSearchFound:
          addressSearchRequests.length >
          0,

        browserReachedInternalEumGis:
          internalGisRequests.length >
          0,
      },

      requiredMarkers: {
        pnuAnalysis:
          pnuAnalysisRequests,

        urlConnector:
          urlConnectorRequests,

        gosi:
          gosiRequests,

        landCheck:
          landCheckRequests,

        mapSearch:
          mapSearchRequests,

        addressSearch:
          addressSearchRequests,
      },

      responseBodies: {
        pnuAnalysis:
          pnuAnalysisBodies,

        urlConnector:
          urlConnectorBodies,

        gosi:
          gosiBodies,

        landCheck:
          responseBodiesByTarget
            .landCheck,

        mapSearch:
          responseBodiesByTarget
            .mapSearch,

        addressSearch:
          responseBodiesByTarget
            .addressSearch,
      },

      internalGisRequests,

      nextStep:
        "responseBodies.pnuAnalysis / responseBodies.urlConnector / responseBodies.gosi의 실제 응답본문을 기준으로 EUM 연계 구조를 확정합니다.",
    };

    console.log(
      JSON.stringify(
        result,
        null,
        2
      )
    );
  } finally {
    /* -----------------------------------------------------
     * 종료 처리
     * ----------------------------------------------------- */

    try {
      socket?.close();
    } catch {
      // ignore
    }

    try {
      child?.kill();
    } catch {
      // ignore
    }

    try {
      await rm(
        profile,
        {
          recursive: true,
          force: true,
        }
      );
    } catch {
      // ignore
    }
  }
}

/* =========================================================
 * 31. 실행
 * ========================================================= */

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          success: false,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        null,
        2
      )
    );

    process.exit(1);
  }
);