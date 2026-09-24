import { inspectDataset } from "../src/dataset_manager.js";
import { getServerStatus } from "../src/urban_plan_service.js";

async function main() {
  console.log(JSON.stringify(await getServerStatus(), null, 2));
  for (const dataset of ["district_plan", "notice"]) {
    console.log(`\n=== inspect ${dataset} ===`);
    console.log(JSON.stringify(await inspectDataset(dataset, 2), null, 2));
  }
  console.log("\n--- network dependency check ---");
  console.log("No EUM MapPlan/119.196.18.3:7070 connection is attempted by this probe.");
}
main().catch((e) => { console.error(e); process.exit(1); });
