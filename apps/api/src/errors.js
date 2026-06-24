const DATABASE_ERROR_CODES = new Set([
  "22P02",
  "23502",
  "23503",
  "23505",
  "42P01",
  "42703"
]);

const INTERNAL_ERROR_PATTERNS = [
  /invalid input syntax/i,
  /duplicate key value/i,
  /violates .* constraint/i,
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /ECONNREFUSED/i,
  /ENOTFOUND/i,
  /password authentication failed/i,
  /NEON_DATABASE_URL/i,
  /DATABASE_URL/i
];

export function publicError(err) {
  const explicitStatus = Number.isInteger(err?.statusCode) ? err.statusCode : null;
  if (explicitStatus && explicitStatus < 500 && !isInternalError(err)) {
    return { statusCode: explicitStatus, message: err.message };
  }

  if (explicitStatus && explicitStatus < 500) {
    return { statusCode: explicitStatus, message: "The request could not be processed." };
  }

  return {
    statusCode: 500,
    message: "Something went wrong while handling the request."
  };
}

function isInternalError(err) {
  const message = String(err?.message ?? "");
  return DATABASE_ERROR_CODES.has(err?.code) || INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export class MissingInstallationIdError extends Error {
  constructor(message = "Missing installation ID on payload") {
    super(message);
    this.name = "MissingInstallationIdError";
    this.statusCode = 400;
  }
}
