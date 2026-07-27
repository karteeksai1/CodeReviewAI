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
  while (Date.now() - startTime < maxDuration) {
    let shouldRetry = false;
    try {
      const response = await fetch(`${config.agentUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        return;
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        shouldRetry = true;
      } else {
        throw new Error(`Agent service responded with status ${response.status}`);
      }
    } catch (err) {
      if (err.name === "TimeoutError" || err.message.includes("fetch") || err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT") {
        shouldRetry = true;
      }
      if (!shouldRetry) {
        throw err;
      }
    }
    if (Date.now() - startTime + currentDelay >= maxDuration) {
      throw new Error("Agent service failed to start within 5 minutes");
    }
    if (onProgress) {
      await onProgress(`Agent service starting up... (attempt ${attempt})`);
    }
    await delay(currentDelay);
    attempt++;
    currentDelay = Math.min(currentDelay * 1.5, 25000);
  }
  throw new Error("Agent service failed to start within 5 minutes");
}
