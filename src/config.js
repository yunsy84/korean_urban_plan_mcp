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
