import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const manifestPath = path.join(projectRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const version = manifest.version || "1.3.0";
const zipName = `FlowZero-ChromeWebStore-v${version}.zip`;
const zipPath = path.join(projectRoot, zipName);

console.log(`[FlowZero WebStore Packager] Building store-ready archive for v${version}...`);

// Runtime files/directories required for Chrome Web Store
const runtimeItems = ["manifest.json", "assets", "lib", "popup", "scripts"];

// Verify all runtime items exist
for (const item of runtimeItems) {
  const fullPath = path.join(projectRoot, item);
  if (!fs.existsSync(fullPath)) {
    console.error(`[Error] Missing runtime item: ${item}`);
    process.exit(1);
  }
}

// Remove old zip if exists
if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

try {
  if (process.platform === "win32") {
    const itemsList = runtimeItems.join(", ");
    const cmd = `powershell -Command "Compress-Archive -Path ${itemsList} -DestinationPath '${zipName}'"`;
    execSync(cmd, { cwd: projectRoot, stdio: "inherit" });
  } else {
    const itemsList = runtimeItems.join(" ");
    const cmd = `zip -r '${zipName}' ${itemsList}`;
    execSync(cmd, { cwd: projectRoot, stdio: "inherit" });
  }

  const stats = fs.statSync(zipPath);
  console.log(`\n✅ Chrome Web Store ZIP package created successfully!`);
  console.log(`   Filename: ${zipName}`);
  console.log(`   File Size: ${(stats.size / 1024).toFixed(2)} KB (${stats.size} bytes)`);
  console.log(`   Path: ${zipPath}\n`);
} catch (err) {
  console.error(`[Error] Packaging failed:`, err.message);
  process.exit(1);
}
