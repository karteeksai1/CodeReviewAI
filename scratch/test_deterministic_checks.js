import { runDeterministicChecks, deduplicateFindings, normalizeCategory } from "../apps/api/src/services/deterministic-checks.js";

const norm1 = normalizeCategory("Supply-Chain", "title", "body");
if (norm1 !== "security") {
  console.error("Supply-Chain mapping failed");
  process.exit(1);
}

const norm2 = normalizeCategory("Readability", "Hardcoded API Key", "API key exposed");
if (norm2 !== "security") {
  console.error("Hardcoded credential category override failed");
  process.exit(1);
}

const configFindings = [
  {
    category: "security",
    severity: "critical",
    title: "Hardcoded database password in production environment",
    body: "The password 'secure_password' is hardcoded in the config file, which is a security risk in a production environment.",
    path: "config.js",
    line: 7
  },
  {
    category: "security",
    severity: "info",
    title: "Sensitive information exposed in config file",
    body: "The password 'secure_password' is exposed in the config file. Consider using environment variables or a secrets manager to store sensitive information.",
    path: "config.js",
    line: 6
  },
  {
    category: "security",
    severity: "info",
    title: "Hardcoded database credentials",
    body: "The database credentials are hardcoded in the config file. Consider using environment variables or a secrets manager to store sensitive information.",
    path: "config.js",
    line: 5
  }
];

const normalized = configFindings.map(f => ({
  ...f,
  category: normalizeCategory(f.category, f.title, f.body)
}));
const dedupedConfig = deduplicateFindings(normalized);

console.log("Deduplicated config.js findings count:", dedupedConfig.length);
console.log("Merged finding detail:", JSON.stringify(dedupedConfig, null, 2));

if (dedupedConfig.length !== 1) {
  console.error("Failed to merge the 3 config.js findings");
  process.exit(1);
}

const merged = dedupedConfig[0];
if (merged.line !== 5 || !merged.title.includes("Hardcoded credentials detected in config.js:5-7") || merged.severity !== "critical") {
  console.error("Merged finding properties do not match requirements:", merged);
  process.exit(1);
}

console.log("All deduplication and category validations verified successfully!");
process.exit(0);
