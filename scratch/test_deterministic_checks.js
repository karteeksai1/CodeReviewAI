import { runDeterministicChecks } from "../apps/api/src/services/deterministic-checks.js";

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
