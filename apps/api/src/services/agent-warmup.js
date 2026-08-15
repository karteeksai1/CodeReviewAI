import { config } from "../config.js";

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureAgentReady(onProgress) {
  if (!config.agentUrl) {
    return;
  }

  const maxDuration = 300000;
  const startTime = Date.now();
  let currentDelay = 3000;
  let attempt = 1;
  let lastStatus = null;
  let lastErrorMessage = null;

  while (Date.now() - startTime < maxDuration) {
    let shouldRetry = false;
    let retryAfterMs = null;

    try {
      const response = await fetch(`${config.agentUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });

      if (response.ok) {
        return;
      }

      lastStatus = response.status;

      if ([429, 502, 503, 504].includes(response.status)) {
        shouldRetry = true;

        const retryAfterHeader = response.headers.get("retry-after");
        if (retryAfterHeader) {
          const parsedSeconds = Number(retryAfterHeader);
          if (!Number.isNaN(parsedSeconds)) {
            retryAfterMs = parsedSeconds * 1000;
          } else {
            const retryAfterDate = new Date(retryAfterHeader).getTime();
            if (!Number.isNaN(retryAfterDate)) {
              retryAfterMs = Math.max(0, retryAfterDate - Date.now());
            }
          }
        }
      } else {
        lastErrorMessage = `Agent service responded with status ${response.status}`;
        throw new Error(lastErrorMessage);
      }
    } catch (err) {
      if (err.name === "TimeoutError" || err.message.includes("fetch") || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
        shouldRetry = true;
        lastErrorMessage = err.message;
      }
      if (!shouldRetry) {
        throw err;
      }
    }

    const waitMs = retryAfterMs ?? currentDelay;

    if (Date.now() - startTime + waitMs >= maxDuration) {
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      throw new Error(
        `Agent service failed to start within 5 minutes (attempts: ${attempt}, elapsed: ${elapsedSeconds}s, last status: ${lastStatus ?? "n/a"}, last error: ${lastErrorMessage ?? "n/a"})`
      );
    }

    if (onProgress) {
      await onProgress(`Agent service starting up... (attempt ${attempt}${lastStatus ? `, last status ${lastStatus}` : ""})`);
    }

    await delay(waitMs);
    attempt++;
    currentDelay = Math.min(currentDelay * 1.5, 25000);
  }

  const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
  throw new Error(
    `Agent service failed to start within 5 minutes (attempts: ${attempt}, elapsed: ${elapsedSeconds}s, last status: ${lastStatus ?? "n/a"}, last error: ${lastErrorMessage ?? "n/a"})`
  );
}
