import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = resolve(ROOT, "config", "urban_plan.config.json");

const DEFAULT_CONFIG = {
  dataRoot: "data",
  downloadRoot: "downloads",
  indexRoot: "index",
  datasets: {},
};

export function getRoot() { return ROOT; }

export function loadConfig() {
  let cfg = DEFAULT_CONFIG;
  if (existsSync(CONFIG_PATH)) {
    cfg = { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
  }

  /*
   * Agent System이 MCP 프로세스를 실행할 때는
   * URBAN_PLAN_DOWNLOAD_ROOT를 명시적으로 전달한다.
   *
   * 이를 우선 사용하여 원자료 다운로드 위치만 외부에서
   * 주입할 수 있도록 하고, Urban MCP standalone 실행에서는
   * 기존 config/downloads 기본 동작을 유지한다.
   */
  if (process.env.URBAN_PLAN_DOWNLOAD_ROOT) {
    cfg.downloadRoot = process.env.URBAN_PLAN_DOWNLOAD_ROOT;
  }

  for (const key of ["dataRoot", "downloadRoot", "indexRoot"]) {
    cfg[key] = resolve(ROOT, cfg[key]);
    mkdirSync(cfg[key], { recursive: true });
  }
  return cfg;
}

export function datasetConfig(id) {
  const cfg = loadConfig();
  const ds = cfg.datasets?.[id];
  if (!ds) throw new Error(`Unknown dataset: ${id}`);
  return { cfg, ds };
}

export function indexPath(id) {
  const cfg = loadConfig();
  return resolve(cfg.indexRoot, `${id}.json`);
}
