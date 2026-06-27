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

const testFindings = [
  {
    category: "readability",
    severity: "low",
    title: "Magic String Key",
    body: "The string contains a secret key.",
    path: "app.js",
    line: 10
  },
  {
    category: "security",
    severity: "critical",
    title: "Hardcoded credential token",
    body: "Extremely detailed description of security breach through hardcoded credential token.",
    path: "app.js",
    line: 10
  }
];

const normalizedTest = testFindings.map(f => ({
  ...f,
  category: normalizeCategory(f.category, f.title, f.body)
}));
const deduped = deduplicateFindings(normalizedTest);

if (deduped.length !== 1) {
  console.error("Deduplication failed to merge duplicate secrets");
  process.exit(1);
}

if (deduped[0].severity !== "critical" || deduped[0].category !== "security") {
  console.error("Deduplication failed to merge metadata correctly", deduped[0]);
  process.exit(1);
}

const jsCode = `
const { sum } = require("./utils");
function processData(data) {
  const total = sum(data);
  return total / data.length;
}
const status = "active";
const status = "inactive";
function brokenFunction() {
  console.log("This function has syntax issues"
}
module.exports = {
  processData,
};
`;

const pyCode = `
def broken_function():
  print("Hello"
`;

const jsPatch = `
@@ -1,10 +1,15 @@
 const { sum } = require("./utils");
 function processData(data) {
   const total = sum(data);
+  return total / data.length;
 }
+const status = "active";
+const status = "inactive";
+function brokenFunction() {
+  console.log("This function has syntax issues"
+}
`;

const files = [
  {
    path: "test.js",
    status: "modified",
    patch: jsPatch,
    content: jsCode
  },
  {
    path: "test.py",
    status: "modified",
    patch: "",
    content: pyCode
  }
];

const findings = runDeterministicChecks(files);
console.log("Findings count:", findings.length);
console.log(JSON.stringify(findings, null, 2));

const jsSyntaxFinding = findings.find(f => f.path === "test.js" && f.title.includes("syntax error"));
const pySyntaxFinding = findings.find(f => f.path === "test.py" && f.title.includes("syntax error"));

if (!jsSyntaxFinding) {
  console.error("Failed to detect JavaScript syntax error");
  process.exit(1);
}
if (!pySyntaxFinding) {
  console.error("Failed to detect Python syntax error");
  process.exit(1);
}

console.log("All deterministic checks verified successfully!");
process.exit(0);
