import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const MFM_DUMP_URL = "https://pub-6443f136c6fc4c60a15cc7935463d637.r2.dev/dump.json";
export const DEFAULT_DUMP_PATH = path.join(REPO_ROOT, "_private", "dump.json");

type Fetch = typeof fetch;

/** Download the current MFM snapshot into the gitignored local source location. */
export async function downloadMfmDump(
  outputPath = DEFAULT_DUMP_PATH,
  fetchImpl: Fetch = fetch,
): Promise<{ bytes: number }> {
  const response = await fetchImpl(MFM_DUMP_URL);
  if (!response.ok) throw new Error(`MFM dump download failed: HTTP ${response.status}.`);

  const body = Buffer.from(await response.arrayBuffer());
  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("MFM dump download failed: response is not valid JSON.");
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("MFM dump download failed: response must be a JSON object.");
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporaryPath, body, { flag: "wx" });
    fs.renameSync(temporaryPath, outputPath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return { bytes: body.byteLength };
}

export async function runMfmDownloadCli(): Promise<void> {
  const { bytes } = await downloadMfmDump();
  console.log(`MFM_DUMP_OK path=${DEFAULT_DUMP_PATH} bytes=${bytes}`);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runMfmDownloadCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
