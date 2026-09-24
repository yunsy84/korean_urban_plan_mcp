import * as cheerio from 'cheerio';

const DEFAULT_BASE_URL = 'https://www.eum.go.kr';
const URBAN_PLAN_PAGE = '/web/cp/cv/cvUpisDet.jsp';
const RECENT_NOTICE_PATH = '/web/cp/cv/cvUpisDetGosiAjax.jsp';
const PARCEL_CHECK_PATH = '/web/ar/lu/luLandDetCheckAjaxXml.jsp';
const PARCEL_ADDR_PATH = '/web/am/mp/mpSearchMapAjaxXml.jsp';
const NOTICE_DETAIL_PATH = '/web/gs/gv/gvGosiDet.jsp';

function asText(value) {
  return value == null ? '' : String(value);
}

function decodeHtml(text) {
  return asText(text)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractStringVar(html, name) {
  const patterns = [
    new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*['"]([^'"]*)['"]`, 'i'),
    new RegExp(`(?:window\\.)?${name}\\s*=\\s*['"]([^'"]*)['"]`, 'i')
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return null;
}

function extractSetMapInvocation(html) {
  const patterns = [
    /(?:\$\.fn\.)?setMap\s*\(\s*['"]?([^,'"\s)]+)['"]?\s*,\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i,
    /(?:\$\.)?fn\.setMap\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^\)]+)\)/i
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (!match) continue;
    const raw = match.slice(1, 4).map(v => decodeHtml(v.replace(/^['"]|['"]$/g, '').trim()));
    if (raw[1] && raw[2]) return { pnu: raw[0], version: raw[1], gisServer: raw[2] };
  }
  return null;
}

function extractVersionFromHtml(html) {
  const $ = cheerio.load(html);
  const selected = $('select.city_sel option:selected').attr('value');
  if (selected) return selected;
  const option = $('select.city_sel option').filter((_, el) => $(el).attr('selected') != null).first().attr('value');
  return option || null;
}

function extractRuntimeConfig(html, baseUrl) {
  const setMap = extractSetMapInvocation(html);
  const context = extractStringVar(html, 'context') ?? '';
  const gisServer = process.env.EUM_GIS_SERVER ?? extractStringVar(html, 'gisServer') ?? extractStringVar(html, 'server') ?? setMap?.gisServer ?? null;
  const getUpisUrlConnector = process.env.EUM_UPIS_CONNECTOR ?? extractStringVar(html, 'getUpisUrlConnector');
  const selectNtfcByPnu = process.env.EUM_SELECT_NTFC ?? extractStringVar(html, 'selectNtfcByPnu');
  const version = process.env.EUM_VERSION ?? extractStringVar(html, 'version') ?? extractVersionFromHtml(html) ?? setMap?.version ?? null;

  return {
    baseUrl,
    context,
    gisServer,
    version,
    getUpisUrlConnector,
    selectNtfcByPnu,
    setMap
  };
}

function parseXmlText(xml, field) {
  if (!xml) return null;
  const re = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`, 'i');
  const match = String(xml).match(re);
  return match ? match[1].trim() : null;
}

function normalizeUrl(baseUrl, value, fallbackPath = '') {
  if (!value) return fallbackPath ? new URL(fallbackPath, baseUrl).toString() : null;
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value.startsWith('/') ? value : `/${value}`, baseUrl).toString();
}

function urlBase(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

export class EumClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.userAgent = options.userAgent ?? 'korean_urban_plan_mcp/0.2.0';
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.runtimeConfig = null;
    this.cookies = new Map();
  }

  storeCookies(headers) {
    const setCookie = headers.getSetCookie ? headers.getSetCookie() : [];
    for (const line of setCookie) {
      const first = String(line).split(';', 1)[0];
      const eq = first.indexOf('=');
      if (eq > 0) this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1));
    }
  }

  cookieHeader() {
    if (!this.cookies.size) return '';
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const requestHeaders = new Headers({
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6',
      ...(init.headers ?? {})
    });
    const cookie = this.cookieHeader();
    if (cookie && !requestHeaders.has('Cookie')) requestHeaders.set('Cookie', cookie);
    try {
      let response;
      try {
        response = await fetch(url, {
          ...init,
          signal: controller.signal,
          redirect: 'follow',
          headers: requestHeaders
        });
      } catch (error) {
        const cause = error?.cause;
        const detail = [
          error?.message,
          cause?.code ? `code=${cause.code}` : '',
          cause?.errno != null ? `errno=${cause.errno}` : '',
          cause?.syscall ? `syscall=${cause.syscall}` : '',
          cause?.address ? `address=${cause.address}` : '',
          cause?.port ? `port=${cause.port}` : ''
        ].filter(Boolean).join(' | ');
        throw new Error(`HTTP 요청 연결 실패: ${url} | ${detail}`);
      }
      this.storeCookies(response.headers);
      const body = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: response.url,
        headers: Object.fromEntries(response.headers.entries()),
        body
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async loadUrbanPlanPage(pnu) {
    const url = new URL(URBAN_PLAN_PAGE, this.baseUrl);
    url.search = new URLSearchParams({
      isNoScr: 'script',
      mode: 'search',
      pnu,
      s_type: '1',
      selGbn: 'umd'
    }).toString();

    const res = await this.request(url.toString());
    if (!res.ok) throw new Error(`토지이음 도시계획 페이지 요청 실패: HTTP ${res.status}`);

    const runtime = extractRuntimeConfig(res.body, this.baseUrl);
    this.runtimeConfig = runtime;
    return { ...res, runtime };
  }

  getConfigDiagnostics() {
    if (!this.runtimeConfig) return { loaded: false };
    const cfg = this.runtimeConfig;
    return {
      loaded: true,
      baseUrl: this.baseUrl,
      context: cfg.context,
      gisServer: cfg.gisServer,
      version: cfg.version,
      getUpisUrlConnector: cfg.getUpisUrlConnector,
      selectNtfcByPnu: cfg.selectNtfcByPnu,
      setMapDetected: Boolean(cfg.setMap)
    };
  }

  requireRuntimeConfig(fields) {
    const cfg = this.runtimeConfig;
    if (!cfg) throw new Error('도시계획 페이지를 먼저 조회해 runtime 설정을 확인해야 합니다.');
    const missing = fields.filter(name => !cfg[name]);
    if (missing.length) {
      throw new Error(`토지이음 페이지에서 필요한 runtime 값이 확인되지 않았습니다: ${missing.join(', ')}`);
    }
    return cfg;
  }

  async resolveUpisPnu(pnu, referer = new URL(URBAN_PLAN_PAGE, this.baseUrl).toString()) {
    const url = new URL(PARCEL_CHECK_PATH, this.baseUrl);
    const res = await this.request(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: new URL(URBAN_PLAN_PAGE, this.baseUrl).toString() },
      body: new URLSearchParams({ link_sys_id: 'UPIS', pnu }).toString(),
      headers: { Referer: referer }
    });

    if (!res.ok) throw new Error(`UPIS 연계 PNU 확인 실패: HTTP ${res.status}`);

    let json;
    try { json = JSON.parse(res.body); }
    catch { json = null; }

    let upisPnu = pnu;
    let closeReason = null;
    let closeReasonType = null;
    let previousPnu = null;
    let upisAvailable = true;

    if (json?.mapLuLandDetCheck) {
      const xml = json.mapLuLandDetCheck;
      const nodeText = parseXmlText(xml, 'node');
      if (!nodeText) {
        closeReason = parseXmlText(xml, 'closeRsnDesc');
        closeReasonType = parseXmlText(xml, 'closeRsnTy');
        upisAvailable = false;
      }
    }

    if (json?.mapPrevPnu) {
      const xml = json.mapPrevPnu;
      previousPnu = parseXmlText(xml, 'preLawdCd');
      const upisYn = parseXmlText(xml, 'upisYn');
      if (upisYn === 'Y' && previousPnu) upisPnu = previousPnu;
    }

    return {
      success: upisAvailable,
      originalPnu: pnu,
      upisPnu,
      previousPnu,
      closeReason,
      closeReasonType,
      raw: json
    };
  }

  async analyzePnu(pnu) {
    let page;
    try {
      page = await this.loadUrbanPlanPage(pnu);
    } catch (error) {
      return { success: false, stage: 'page', pnu, error: error.message };
    }

    let cfg;
    try {
      cfg = this.requireRuntimeConfig(['gisServer', 'version']);
    } catch (error) {
      return { success: false, stage: 'runtime_config', pnu, pageUrl: page.finalUrl, error: error.message };
    }

    let normalized;
    try {
      normalized = await this.resolveUpisPnu(pnu, page.finalUrl);
    } catch (error) {
      return {
        success: false,
        stage: 'upis_availability',
        pnu,
        pageUrl: page.finalUrl,
        runtime: this.getConfigDiagnostics(),
        error: error.message
      };
    }

    if (!normalized.success) {
      return {
        success: false,
        stage: 'upis_availability',
        pageUrl: page.finalUrl,
        normalized
      };
    }

    const url = new URL('/MapPlan', cfg.gisServer.endsWith('/') ? cfg.gisServer : `${cfg.gisServer}/`);
    url.search = new URLSearchParams({ req: 'pnu_analysis', version: cfg.version, pnus: normalized.upisPnu }).toString();
    let res;
    try {
      res = await this.request(url.toString(), { headers: { Referer: page.finalUrl } });
    } catch (error) {
      return {
        success: false,
        stage: 'pnu_analysis_connection',
        pnu,
        upisPnu: normalized.upisPnu,
        pageUrl: page.finalUrl,
        requestUrl: url.toString(),
        gisServer: cfg.gisServer,
        version: cfg.version,
        error: error.message
      };
    }
    if (!res.ok) {
      return {
        success: false,
        stage: 'pnu_analysis_http',
        pnu, upisPnu: normalized.upisPnu, pageUrl: page.finalUrl,
        requestUrl: url.toString(), status: res.status, error: `HTTP ${res.status}`
      };
    }

    let data;
    try { data = JSON.parse(res.body); }
    catch {
      return { success: false, stage: 'pnu_analysis_json', pnu, upisPnu: normalized.upisPnu, requestUrl: url.toString(), preview: res.body.slice(0, 1000), error: 'MapPlan pnu_analysis 응답이 JSON이 아닙니다.' };
    }

    return {
      success: true,
      pageUrl: page.finalUrl,
      originalPnu: pnu,
      upisPnu: normalized.upisPnu,
      version: cfg.version,
      gisServer: cfg.gisServer,
      data
    };
  }

  async getParcelPlanNotices(pnu) {
    const analysis = await this.analyzePnu(pnu);
    if (!analysis.success) return analysis;
    const cfg = this.requireRuntimeConfig(['getUpisUrlConnector', 'selectNtfcByPnu']);
    const infos = Array.isArray(analysis.data?.jigu_info) ? analysis.data.jigu_info : [];

    const list = infos.map(item => {
      const fd = asText(item.fd_code);
      let type = item.type;
      if (fd.includes('CB')) type = 'UQ150';
      else if (fd.includes('DA')) type = 'UQ160';
      return {
        type,
        wtnnc_cd: item.wtnnc_sn,
        siteCd: asText(item.wtnnc_sn).slice(0, 5),
        fd_code: fd
      };
    }).filter(item => item.wtnnc_cd);

    if (!list.length) {
      return {
        success: true,
        pnu,
        upisPnu: analysis.upisPnu,
        notices: [],
        source: '토지이음 필지 연계 고시 조회',
        note: 'pnu_analysis 결과에 연계 가능한 도시계획 객체가 없습니다.'
      };
    }

    const url = new URL(cfg.getUpisUrlConnector, this.baseUrl);
    url.searchParams.set('url', cfg.selectNtfcByPnu);
    url.searchParams.set('json', JSON.stringify(list));

    const res = await this.request(url.toString(), { headers: { Referer: analysis.pageUrl } });
    if (!res.ok) throw new Error(`필지 관련 고시 조회 실패: HTTP ${res.status}`);

    let data;
    try { data = JSON.parse(res.body); }
    catch { throw new Error('필지 관련 고시 응답이 JSON이 아닙니다.'); }

    const notices = [];
    for (const item of list) {
      const rows = Array.isArray(data?.[`${item.wtnnc_cd}_ntfcList`]) ? data[`${item.wtnnc_cd}_ntfcList`] : [];
      for (const row of rows) {
        if (row?.notExist !== undefined) continue;
        notices.push({
          wtnnc_sn: item.wtnnc_cd,
          type: item.type,
          ucode_nm: row.ucode_nm ?? null,
          organ_nm: row.organ_nm ?? null,
          notice_no: row.notice_no ?? null,
          title: row.title ?? null,
          notice_date: row.notice_date ?? null,
          content: row.content ?? null,
          org_cd: row.org_cd ?? null
        });
      }
    }

    return {
      success: true,
      pnu,
      upisPnu: analysis.upisPnu,
      planObjects: list,
      notices,
      raw: data
    };
  }

  async getRecentUrbanNotices(pnu, { keyword = '', pageNo = 1 } = {}) {
    const converted = await this.resolveUpisPnu(pnu);
    const effectivePnu = converted.upisPnu || pnu;
    const url = new URL(RECENT_NOTICE_PATH, this.baseUrl);
    url.search = new URLSearchParams({
      keyword,
      mobile_yn: 'N',
      pnu: effectivePnu,
      pageNo: String(pageNo)
    }).toString();

    const res = await this.request(url.toString(), { headers: { Referer: new URL(URBAN_PLAN_PAGE, this.baseUrl).toString() } });
    if (!res.ok) throw new Error(`최근 고시 조회 실패: HTTP ${res.status}`);

    return {
      success: true,
      pnu,
      upisPnu: effectivePnu,
      keyword,
      pageNo,
      html: res.body,
      sourceUrl: res.finalUrl
    };
  }

  async getParcelGeometry(pnu) {
    const page = await this.loadUrbanPlanPage(pnu);
    const cfg = this.requireRuntimeConfig(['gisServer', 'version']);
    const addrUrl = new URL(PARCEL_ADDR_PATH, this.baseUrl);
    const addrRes = await this.request(addrUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: page.finalUrl },
      body: new URLSearchParams({ sId: 'selectAddr', pnu }).toString()
    });

    let addrData = null;
    try { addrData = JSON.parse(addrRes.body); } catch { /* keep raw */ }

    const gisUrl = new URL('/MapPlan', cfg.gisServer.endsWith('/') ? cfg.gisServer : `${cfg.gisServer}/`);
    gisUrl.search = new URLSearchParams({ req: 'search', version: cfg.version, layer: 'FA', code: pnu }).toString();
    const gisRes = await this.request(gisUrl.toString(), { headers: { Referer: page.finalUrl } });

    let geojson = null;
    try { geojson = JSON.parse(gisRes.body); } catch { /* keep raw */ }

    return {
      success: gisRes.ok,
      pnu,
      addressResponse: addrData,
      geojson,
      geojsonRaw: geojson ? undefined : gisRes.body,
      sourceUrls: { address: addrRes.finalUrl, geometry: gisRes.finalUrl }
    };
  }

  async getNoticeDetail({ orgCd, noticeNo: inputNoticeNo, year, no, seq = '' }) {
    let noticeYear = year;
    let noticeNo = no || inputNoticeNo;
    if ((!noticeYear || !noticeNo) && noticeNo && String(noticeNo).includes('-')) {
      const parts = String(noticeNo).split('-');
      noticeYear = parts[0];
      noticeNo = parts[1];
    }
    if (!orgCd || !noticeYear || !noticeNo) {
      throw new Error('고시 상세 조회에는 orgCd + year + no가 필요합니다.');
    }

    const url = new URL(NOTICE_DETAIL_PATH, this.baseUrl);
    url.search = new URLSearchParams({
      seq,
      gosi_no_chrg: orgCd,
      gosi_no_year: noticeYear,
      gosi_no_no: noticeNo,
      mobile_yn: 'N'
    }).toString();

    const res = await this.request(url.toString());
    if (!res.ok) throw new Error(`고시 상세 조회 실패: HTTP ${res.status}`);
    return { success: true, url: res.finalUrl, html: res.body };
  }
}

export const EUM_CONSTANTS = {
  DEFAULT_BASE_URL,
  URBAN_PLAN_PAGE,
  RECENT_NOTICE_PATH,
  PARCEL_CHECK_PATH,
  PARCEL_ADDR_PATH,
  NOTICE_DETAIL_PATH,
  urlBase
};
