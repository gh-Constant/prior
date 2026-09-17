import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const version = argument("--version");
const tag = argument("--tag");
const artifactsDirectory = argument("--artifacts");
const outputPath = argument("--output");

if (!version || !tag || !artifactsDirectory || !outputPath) {
  throw new Error("Usage: generate-latest-json.mjs --version VERSION --tag TAG --artifacts DIR --output FILE");
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else files.push(path);
  }
  return files;
}

const files = await filesIn(artifactsDirectory);
const byName = new Map(files.map((path) => [path.split(/[\\/]/).pop(), path]));
const releaseBase = `https://github.com/gh-Constant/prior/releases/download/${tag}`;
const encodedUrl = (name) => `${releaseBase}/${encodeURIComponent(name)}`;

async function artifact(predicate, description) {
  const path = files.find((candidate) => {
    const name = candidate.split(/[\\/]/).pop();
    return predicate(name);
  });
  if (!path) return null;
  const name = path.split(/[\\/]/).pop();
  const signaturePath = byName.get(`${name}.sig`);
  if (!signaturePath) throw new Error(`Missing updater signature for ${description}: ${name}.sig`);
  return {
    url: encodedUrl(name),
    signature: (await readFile(signaturePath, "utf8")).trim(),
  };
}

const platforms = {};
const appImage = await artifact((name) => name.endsWith(".AppImage"), "Linux AppImage");
if (appImage) {
  platforms["linux-x86_64"] = appImage;
  platforms["linux-x86_64-appimage"] = appImage;
}
const deb = await artifact((name) => name.endsWith(".deb"), "Linux deb");
if (deb) platforms["linux-x86_64-deb"] = deb;
const rpm = await artifact((name) => name.endsWith(".rpm"), "Linux rpm");
if (rpm) platforms["linux-x86_64-rpm"] = rpm;

const nsis = await artifact((name) => name.endsWith("-setup.exe"), "Windows NSIS installer");
if (nsis) {
  platforms["windows-x86_64"] = nsis;
  platforms["windows-x86_64-nsis"] = nsis;
}
const msi = await artifact((name) => name.endsWith(".msi"), "Windows MSI installer");
if (msi) platforms["windows-x86_64-msi"] = msi;

const mac = await artifact((name) => name.endsWith(".app.tar.gz"), "macOS updater archive");
if (mac) {
  for (const platform of [
    "darwin-aarch64",
    "darwin-x86_64",
    "darwin-aarch64-app",
    "darwin-x86_64-app",
  ]) platforms[platform] = mac;
}

await writeFile(outputPath, `${JSON.stringify({
  version,
  notes: "",
  pub_date: new Date().toISOString(),
  platforms,
}, null, 2)}\n`);

console.log(`Generated updater metadata for ${Object.keys(platforms).length} platform entries from ${files.map((file) => relative(artifactsDirectory, file)).join(", ") || "no new updater artifacts"}.`);
