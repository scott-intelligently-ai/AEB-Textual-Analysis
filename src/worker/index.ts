import { createServer } from "node:http";
import { convertPendingPages, renderNextUpload, resumeInterrupted } from "./jobs";

const IDLE_MS = 1500;
const RETRY_MS = 5000;

/** Railway probes $PORT. The worker does no other serving. */
function listenForPlatform(): void {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port <= 0) return;
  createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok");
  }).listen(port, "0.0.0.0", () => {
    console.log(`Worker health check listening on ${port}.`);
  });
}

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    console.log("Worker stopping after the current job.");
  });
}

function reported(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  // A few pages are converted at once, so the worker keeps more than one connection.
  process.env.DATABASE_POOL_MAX ??= "4";
  listenForPlatform();
  for (;;) {
    if (stopping) return;
    try {
      await resumeInterrupted();
      break;
    } catch (error) {
      console.error(reported(error));
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
  console.log("Worker watching for uploads.");
  while (!stopping) {
    try {
      const rendered = await renderNextUpload();
      const converted = await convertPendingPages();
      if (!rendered && converted === 0) {
        await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
      }
    } catch (error) {
      console.error(reported(error));
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
