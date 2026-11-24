import { convertPendingPages, renderNextUpload, resumeInterrupted } from "./jobs";

const IDLE_MS = 1500;

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log("Worker stopping after the current job.");
  });
}

async function main(): Promise<void> {
  // A few pages are converted at once, so the worker keeps more than one connection.
  process.env.DATABASE_POOL_MAX ??= "4";
  await resumeInterrupted();
  console.log("OCR worker watching for scans.");
  while (!stopping) {
    const rendered = await renderNextUpload();
    const converted = await convertPendingPages();
    if (!rendered && converted === 0) {
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
