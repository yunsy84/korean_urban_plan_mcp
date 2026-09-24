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
 *   - 내부 GIS 서버 주소를 코드에 하드코딩하지 않습니다.
 *   - 브라우저가 실제 발생시킨 요청과 응답을 캡처합니다.
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
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  join,
  resolve
} from "node:path";

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

if (
  !Number.isFinite(WAIT_MS) ||
  WAIT_MS < 1000
) {
  throw new Error(
    "EUM_PROBE_WAIT_MS must be >= 1000."
  );
}

if (
  !Number.isInteger(DEBUG_PORT) ||
  DEBUG_PORT < 1024 ||
  DEBUG_PORT > 65535
) {
  throw new Error(
    "EUM_PROBE_PORT must be an integer between 1024 and 65535."
  );
}

/* =========================================================
 * 4. CDP 상태
 * ========================================================= */

const runtimeEvents = [];

let nextId = 0;

const pending = new Map();

/*
 * requestId -> {
 *   response,
 *   capture
 * }
 */
const responseBodyCaptures = new Map();

/*
 * requestId -> Promise
 *
 * loadingFinished 이벤트 직후 body를 즉시 가져오기 위한
 * 중복 호출 방지용.
 */
const responseBodyCapturePromises = new Map();

let socket = null;

/* =========================================================
 * 5. 유틸
 * ========================================================= */

function sleep(ms) {
  return new Promise(
    (resolvePromise) =>
      setTimeout(
        resolvePromise,
        ms
      )
  );
}

function eventDataToString(data) {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(
      data
    );
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      data.buffer.slice(
        data.byteOffset,
        data.byteOffset +
          data.byteLength
      )
    );
  }

  return String(
    data ?? ""
  );
}

/* =========================================================
 * 6. Chrome / Edge 후보
 * ========================================================= */

function chromeCandidates() {
  const pf =
    process.env.ProgramFiles ??
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
    )
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
    const candidate of
      chromeCandidates()
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
    await fetch(
      url
    );

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
    Date.now() +
    timeoutMs;

  let lastError = null;

  while (
    Date.now() <
    deadline
  ) {
    try {
      return await getJson(
        url
      );
    } catch (error) {
      lastError = error;

      await sleep(
        150
      );
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
      params
    })
  );

  return new Promise(
    (
      resolvePromise,
      rejectPromise
    ) => {
      const timer =
        setTimeout(
          () => {
            if (!pending.has(id)) {
              return;
            }

            pending.delete(
              id
            );

            rejectPromise(
              new Error(
                `CDP command timeout: ${method}`
              )
            );
          },
          20000
        );

      pending.set(
        id,
        {
          resolve:
            (value) => {
              clearTimeout(
                timer
              );

              resolvePromise(
                value
              );
            },

          reject:
            (error) => {
              clearTimeout(
                timer
              );

              rejectPromise(
                error
              );
            }
        }
      );
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
    (
      resolvePromise,
      rejectPromise
    ) => {
      const ws =
        new WebSocket(
          wsUrl
        );

      let opened =
        false;

      ws.addEventListener(
        "open",
        () => {
          opened =
            true;

          socket =
            ws;

          resolvePromise();
        }
      );

      ws.addEventListener(
        "error",
        (event) => {
          const message =
            event?.message ??
            "unknown WebSocket error";

          if (!opened) {
            rejectPromise(
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
          socket =
            null;

          for (
            const call
            of pending.values()
          ) {
            call.reject(
              new Error(
                "CDP socket closed while waiting for command."
              )
            );
          }

          pending.clear();
        }
      );

      ws.addEventListener(
        "message",
        (event) => {
          const raw =
            eventDataToString(
              event.data
            );

          let message;

          try {
            message =
              JSON.parse(
                raw
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

            /*
             * Network.loadingFinished 시 대상 body를
             * 즉시 캡처한다.
             */
            void handleNetworkEvent(
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
      request?.type ??
      ""
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
      "other"
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
              null
          })
        ) ??
      null
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
        value
      ]
      of parsed.searchParams
        .entries()
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
            value
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
    String(
      postData
    );

  try {
    const params =
      new URLSearchParams(
        raw
      );

    const form = {};

    for (
      const [
        key,
        value
      ]
      of params.entries()
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
            value
          ];
        }
      } else {
        form[key] =
          value;
      }
    }

    return {
      raw,
      form
    };
  } catch {
    return {
      raw,
      form: null
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
    "pnu_analysis",
    "cvupisdetgosiajax.jsp",
    "lulanddetcheckajaxxml.jsp",
    "mpsearchmapajaxxml.jsp",
    "mpsearchaddrajaxxml.jsp"
  ].some(
    (marker) =>
      lower.includes(
        marker
      )
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
    "mpsearchaddrajaxxml.jsp"
  ].some(
    (marker) =>
      lower.includes(
        marker
      )
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
      request.url ??
      ""
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
      )
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
      response.url ??
      ""
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
      )
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
      event?.params
        ?.encodedDataLength ??
      null,

    shouldReportCorbBlockingReason:
      event?.params
        ?.shouldReportCorbBlockingReason ??
      null,

    shouldReportCorsError:
      event?.params
        ?.shouldReportCorsError ??
      null
  };
}

/* =========================================================
 * 20. Network loadingFailed
 * ========================================================= */

function simplifyLoadingFailed(
  event
) {
  return {
    requestId:
      event?.params?.requestId ??
      null,

    errorText:
      event?.params?.errorText ??
      null,

    canceled:
      event?.params?.canceled ??
      false,

    blockedReason:
      event?.params?.blockedReason ??
      null,

    corsErrorStatus:
      event?.params?.corsErrorStatus ??
      null
  };
}

/* =========================================================
 * 21. Event 추출
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

function getLoadingFailed() {
  return runtimeEvents
    .filter(
      (event) =>
        event.method ===
        "Network.loadingFailed"
    )
    .map(
      simplifyLoadingFailed
    );
}

/* =========================================================
 * 22. requestId 기준 중복 제거
 * ========================================================= */

function dedupeByRequestId(
  items
) {
  const map =
    new Map();

  for (
    const item
    of items
  ) {
    if (!item.requestId) {
      continue;
    }

    map.set(
      item.requestId,
      item
    );
  }

  return [
    ...map.values()
  ];
}

/* =========================================================
 * 23. Request 찾기
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
 * 24. Response 찾기
 * ========================================================= */

function findResponseById(
  responses,
  requestId
) {
  return (
    responses.find(
      (response) =>
        response.requestId ===
        requestId
    ) ??
    null
  );
}

/* =========================================================
 * 25. Response body 안전하게 가져오기
 * ========================================================= */

async function getResponseBodySafe(
  requestId,
  response
) {
  const result = {
    requestId,

    success: false,

    body: null,

    base64Encoded:
      false,

    bodyLength:
      0,

    error:
      null
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
          requestId
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
 * 26. JSON 파싱 시도
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
 * 27. Body 정리
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
      )
  };
}

/* =========================================================
 * 28. loadingFinished 시점 즉시 body 캡처
 *
 * 기존:
 *   페이지 대기 완료
 *      ->
 *   전체 response 목록 확인
 *      ->
 *   Network.getResponseBody 일괄 호출
 *
 * 보정:
 *   responseReceived
 *      ->
 *   loadingFinished
 *      ->
 *   즉시 Network.getResponseBody
 *
 * 마지막에 실패 body만 fallback 재시도.
 * ========================================================= */

async function handleNetworkEvent(
  event
) {
  if (
    event?.method !==
    "Network.loadingFinished"
  ) {
    return;
  }

  const requestId =
    event?.params?.requestId;

  if (!requestId) {
    return;
  }

  const responseEvents =
    runtimeEvents.filter(
      (item) =>
        item.method ===
          "Network.responseReceived" &&
        item.params?.requestId ===
          requestId
    );

  const responseEvent =
    responseEvents.at(-1);

  if (!responseEvent) {
    return;
  }

  const response =
    simplifyResponse(
      responseEvent
    );

  if (!response.bodyTarget) {
    return;
  }

  if (
    responseBodyCapturePromises.has(
      requestId
    )
  ) {
    await responseBodyCapturePromises.get(
      requestId
    );

    return;
  }

  const promise =
    getResponseBodySafe(
      requestId,
      response
    )
      .then(
        (capture) => {
          responseBodyCaptures.set(
            requestId,
            {
              response,
              capture
            }
          );

          return capture;
        }
      )
      .catch(
        (error) => {
          const capture = {
            requestId,

            success:
              false,

            body:
              null,

            base64Encoded:
              false,

            bodyLength:
              0,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          };

          responseBodyCaptures.set(
            requestId,
            {
              response,
              capture
            }
          );

          return capture;
        }
      );

  responseBodyCapturePromises.set(
    requestId,
    promise
  );

  await promise;
}

/* =========================================================
 * 29. 브라우저 페이지 JS 평가
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
            true
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
 * 30. 브라우저 실행
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

      "about:blank"
    ],
    {
      stdio: [
        "ignore",
        "ignore",
        "ignore"
      ],

      windowsHide:
        true
    }
  );
}

/* =========================================================
 * 31. CDP page target
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
 * 32. 관심 응답 body 최종 재구성
 * ========================================================= */

async function collectCapturedBodies(
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
    const response
    of targets
  ) {
    const request =
      findRequestById(
        requests,
        response.requestId
      );

    let stored =
      responseBodyCaptures.get(
        response.requestId
      );

    /*
     * loadingFinished가 발생하기 전에
     * 페이지 종료/상태 조회가 진행된 경우 등에는
     * fallback으로 직접 재시도한다.
     */
    if (
      !stored ||
      !stored.capture?.success
    ) {
      const capture =
        await getResponseBodySafe(
          response.requestId,
          response
        );

      stored = {
        response,
        capture
      };

      responseBodyCaptures.set(
        response.requestId,
        stored
      );
    }

    result.push({
      request:
        request
          ? {
              requestId:
                request.requestId,

              loaderId:
                request.loaderId,

              documentURL:
                request.documentURL,

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
                request.parsedPostData
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

        fromDiskCache:
          response.fromDiskCache,

        fromServiceWorker:
          response.fromServiceWorker
      },

      body:
        summarizeBody(
          stored.capture,
          response
        )
    });
  }

  return result;
}

/* =========================================================
 * 33. 최종 결과용 endpoint 분류
 * ========================================================= */

function classifyResponseBodies(
  targetBodies
) {
  return {
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
      )
  };
}

/* =========================================================
 * 34. 메인
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

  let child =
    null;

  try {
    /* -----------------------------------------------------
     * 브라우저 실행
     * ----------------------------------------------------- */

    child =
      await launchBrowser(
        browser,
        profile
      );

    let browserSpawnError =
      null;

    child.once(
      "error",
      (error) => {
        browserSpawnError =
          error;
      }
    );

    /* -----------------------------------------------------
     * CDP 기동 대기
     * ----------------------------------------------------- */

    await waitForJson(
      `http://127.0.0.1:${DEBUG_PORT}/json/version`,
      10000
    );

    if (
      browserSpawnError
    ) {
      throw browserSpawnError;
    }

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
          10 * 1024 * 1024
      }
    );

    await send(
      "Page.enable"
    );

    await send(
      "Runtime.enable"
    );

    /* -----------------------------------------------------
     * EUM 페이지 이동
     * ----------------------------------------------------- */

    await send(
      "Page.navigate",
      {
        url:
          EUM_URL
      }
    );

    /* -----------------------------------------------------
     * 페이지 JS / AJAX 실행 대기
     * ----------------------------------------------------- */

    await sleep(
      WAIT_MS
    );

    /*
     * DOM ready 이후의 비동기 AJAX를
     * 조금 더 받을 수 있도록 추가 대기.
     */
    await sleep(
      1000
    );

    /* -----------------------------------------------------
     * loadingFinished 시점 body capture 완료 대기
     * ----------------------------------------------------- */

    if (
      responseBodyCapturePromises.size >
      0
    ) {
      await Promise.allSettled(
        [
          ...responseBodyCapturePromises.values()
        ]
      );
    }

    /* -----------------------------------------------------
     * 기본 Network 데이터
     * ----------------------------------------------------- */

    const requests =
      getRequests();

    const responses =
      getResponses();

    const loadingFinished =
      getLoadingFinished();

    const loadingFailed =
      getLoadingFailed();

    /* -----------------------------------------------------
     * 관심 response body
     * ----------------------------------------------------- */

    const targetBodies =
      await collectCapturedBodies(
        requests,
        responses
      );

    /* -----------------------------------------------------
     * endpoint별 body 분류
     * ----------------------------------------------------- */

    const responseBodiesByTarget =
      classifyResponseBodies(
        targetBodies
      );

    /* -----------------------------------------------------
     * 페이지 상태
     * ----------------------------------------------------- */

    const pageInfo =
      await evaluatePage(
        `(() => ({
          title:
            document.title ||
            null,

          readyState:
            document.readyState,

          href:
            location.href,

          origin:
            location.origin,

          pathname:
            location.pathname
        }))()`
      );

    /* -----------------------------------------------------
     * EUM runtime 전역변수
     *
     * 실제 페이지가 유지하고 있는 상태를 그대로 캡처.
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
     *
     * 타일 등 모든 내부 GIS 요청은 internalGisRequests로
     * 따로 보존하고, interestingRequests는 분석 endpoint만
     * 중심으로 구성한다.
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
     * 내부 GIS 요청
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
     * response body 성공 여부
     * ----------------------------------------------------- */

    const urlConnectorBodyCaptured =
      responseBodiesByTarget.urlConnector.some(
        (item) =>
          item.body?.success ===
          true
      );

    const pnuAnalysisBodyCaptured =
      responseBodiesByTarget.pnuAnalysis.some(
        (item) =>
          item.body?.success ===
          true
      );

    const gosiBodyCaptured =
      responseBodiesByTarget.gosi.some(
        (item) =>
          item.body?.success ===
          true
      );

    /* -----------------------------------------------------
     * body capture 실패 내역
     * ----------------------------------------------------- */

    const bodyCaptureFailures =
      targetBodies
        .filter(
          (item) =>
            item.body?.success !==
            true
        )
        .map(
          (item) => ({
            requestId:
              item.response
                ?.requestId ??
              null,

            url:
              item.response
                ?.url ??
              null,

            error:
              item.body
                ?.error ??
              null
          })
        );

    /* -----------------------------------------------------
     * 핵심 response body의 간략 상태
     * ----------------------------------------------------- */

    const responseBodySummary = {
      pnuAnalysis:
        responseBodiesByTarget
          .pnuAnalysis
          .map(
            (item) => ({
              url:
                item.response?.url ??
                null,

              status:
                item.response?.status ??
                null,

              bodySuccess:
                item.body?.success ??
                false,

              bodyLength:
                item.body?.bodyLength ??
                0,

              parsedJson:
                item.body?.parsedJson ??
                null,

              error:
                item.body?.error ??
                null
            })
          ),

      urlConnector:
        responseBodiesByTarget
          .urlConnector
          .map(
            (item) => ({
              url:
                item.response?.url ??
                null,

              status:
                item.response?.status ??
                null,

              bodySuccess:
                item.body?.success ??
                false,

              bodyLength:
                item.body?.bodyLength ??
                0,

              parsedJson:
                item.body?.parsedJson ??
                null,

              error:
                item.body?.error ??
                null
            })
          ),

      gosi:
        responseBodiesByTarget
          .gosi
          .map(
            (item) => ({
              url:
                item.response?.url ??
                null,

              status:
                item.response?.status ??
                null,

              bodySuccess:
                item.body?.success ??
                false,

              bodyLength:
                item.body?.bodyLength ??
                0,

              parsedJson:
                item.body?.parsedJson ??
                null,

              error:
                item.body?.error ??
                null
            })
          )
    };

    /* -----------------------------------------------------
     * 최종 결과
     * ----------------------------------------------------- */

    const result = {
      success:
        true,

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

        loadingFailed:
          loadingFailed.length,

        interestingRequests:
          interestingRequests.length,

        interestingResponses:
          interestingResponses.length,

        responseBodyTargets:
          targetBodies.length,

        responseBodiesCaptured:
          targetBodies.filter(
            (item) =>
              item.body?.success ===
              true
          ).length,

        responseBodyCaptureFailures:
          bodyCaptureFailures.length
      },

      analysis: {
        urlConnectorFound:
          urlConnectorRequests.length >
          0,

        urlConnectorBodyCaptured,

        pnuAnalysisFound:
          pnuAnalysisRequests.length >
          0,

        pnuAnalysisBodyCaptured,

        gosiFound:
          gosiRequests.length >
          0,

        gosiBodyCaptured,

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
          0
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
          addressSearchRequests
      },

      responseBodySummary,

      bodyCaptureFailures,

      responseBodies:
        responseBodiesByTarget,

      internalGisRequests,

      loadingFailed,

      nextStep:
        "responseBodies.pnuAnalysis / responseBodies.urlConnector / responseBodies.gosi의 실제 응답본문을 기준으로 EUM 연계 구조를 확정합니다."
    };

    /* -----------------------------------------------------
     * 결과 파일 저장
     *
     * 콘솔 출력은 그대로 유지하고,
     * 별도의 JSON도 저장한다.
     * ----------------------------------------------------- */

    const outputDir =
      resolve(
        "tests",
        "output"
      );

    try {
      await mkdir(
        outputDir,
        {
          recursive:
            true
        }
      );

      const outputPath =
        join(
          outputDir,
          `eum_runtime_probe_${pnu}.json`
        );

      await writeFile(
        outputPath,
        JSON.stringify(
          result,
          null,
          2
        ),
        "utf8"
      );

      result.outputFile =
        outputPath;
    } catch (error) {
      result.outputFileError =
        error instanceof Error
          ? error.message
          : String(error);
    }

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
          recursive:
            true,

          force:
            true
        }
      );
    } catch {
      // ignore
    }
  }
}

/* =========================================================
 * 35. 실행
 * ========================================================= */

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          success:
            false,

          error:
            error instanceof Error
              ? error.message
              : String(error)
        },
        null,
        2
      )
    );

    process.exit(1);
  }
);