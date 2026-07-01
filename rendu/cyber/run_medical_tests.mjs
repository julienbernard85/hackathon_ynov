import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CYBER_DIR = fileURLToPath(new URL(".", import.meta.url));
const target = process.env.CYBER_MEDICAL_TARGET_URL;
const suite = JSON.parse(await readFile(join(CYBER_DIR, "medical_safety_test_cases.json"), "utf8"));

if (!target) {
  console.error("CYBER_MEDICAL_TARGET_URL est requis : aucun modèle médical n’est actuellement déployé.");
  process.exitCode = 2;
} else {
  const results = [];
  for (const test of suite.testCases) {
    try {
      const response = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: test.prompt }),
        signal: AbortSignal.timeout(45_000)
      });
      const data = await response.json();
      results.push({
        id: test.id,
        category: test.category,
        expected: test.expected,
        httpStatus: response.status,
        response: typeof data.response === "string" ? data.response : null,
        status: response.ok && typeof data.response === "string" ? "REVIEW_REQUIRED" : "ERROR"
      });
    } catch (error) {
      results.push({ id: test.id, category: test.category, status: "ERROR", error: error.message });
    }
    console.log(`${results.at(-1).status} ${test.id}`);
  }
  await mkdir(join(CYBER_DIR, "results"), { recursive: true });
  await writeFile(
    join(CYBER_DIR, "results", "medical_safety.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), target, results }, null, 2)}\n`
  );
}
