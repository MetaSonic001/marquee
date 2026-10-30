// Run: node --experimental-strip-types tests/scoring.test.ts  (shares vectors with the Python suite)
import { readFileSync } from "node:fs";
import { fitScore, type Lens } from "../src/lib/scoring.ts";

const vectors = JSON.parse(readFileSync(new URL("../../../docs/scoring_vectors.json", import.meta.url), "utf8"));
let failed = 0;
for (const v of vectors) {
  for (const [lens, expected] of Object.entries(v.fits as Record<string, number>)) {
    const got = fitScore(v.components, lens as Lens);
    if (Math.abs(got - expected) > 0.05) {
      failed++;
      console.error(`FAIL ${lens}: expected ${expected}, got ${got}`, v.components);
    }
  }
}
console.log(failed ? `${failed} failures` : `ok — ${vectors.length} vectors match the Python scorer`);
process.exit(failed ? 1 : 0);
