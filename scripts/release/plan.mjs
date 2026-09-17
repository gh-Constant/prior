import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const tag = process.env.GITHUB_REF_NAME || execFileSync("git", ["describe", "--tags", "--exact-match"], { encoding: "utf8" }).trim();
const sha = process.env.GITHUB_SHA || "HEAD";
const tags = execFileSync("git", ["tag", "--sort=-version:refname"], { encoding: "utf8" })
  .split("\n")
  .map((value) => value.trim())
  .filter(Boolean);

function publishedReleaseTags() {
  if (!process.env.GITHUB_REPOSITORY) return [];
  try {
    const output = execFileSync(
      "gh",
      ["release", "list", "--repo", process.env.GITHUB_REPOSITORY, "--limit", "100", "--json", "tagName,isDraft,isPrerelease"],
      {
        encoding: "utf8",
        env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN },
      },
    );
    return JSON.parse(output)
      .filter((release) => release.isDraft === false && release.isPrerelease === false)
      .map((release) => release.tagName)
      .filter(Boolean);
  } catch {
    // Local planning and environments without GitHub CLI authentication still
    // use the git-tag fallback below.
    return [];
  }
}

const publishedTags = new Set(publishedReleaseTags());
const previousTag = tags.find((value) => value !== tag && (publishedTags.size === 0 || publishedTags.has(value))) || "";

function gitDiffFiles() {
  if (!previousTag) return [];
  return execFileSync("git", ["diff", "--name-only", `${previousTag}..${sha}`], { encoding: "utf8" })
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

function changedLines(path) {
  if (!previousTag) return [];
  const diff = execFileSync("git", ["diff", "--unified=0", `${previousTag}..${sha}`, "--", path], { encoding: "utf8" });
  return diff
    .split("\n")
    .filter((line) => /^[+-](?![+-])/.test(line))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);
}

function isVersionOnly(path) {
  if (![
    "app/package.json",
    "app/src-tauri/tauri.conf.json",
    "app/src-tauri/Cargo.toml",
    "app/src-tauri/Cargo.lock",
  ].includes(path)) return false;
  const lines = changedLines(path);
  return lines.length > 0 && lines.every((line) => /^\"version\"\s*:/.test(line) || /^version\s*=/.test(line));
}

function isCodexOnlyRustDiff(path) {
  if (path === "app/src-tauri/src/codex.rs") return true;
  if (path !== "app/src-tauri/src/lib.rs") return false;
  const lines = changedLines(path);
  return lines.length > 0 && lines.every((line) => /codex/i.test(line) || /cfg\(desktop\)/.test(line) || /^[{}[\](),;]+$/.test(line));
}

const files = gitDiffFiles().filter((path) => !isVersionOnly(path));
const frontendChanged = !previousTag || files.some((path) => (
  path.startsWith("app/src/")
  || path.startsWith("app/public/")
  || path === "app/index.html"
  || path === "app/package.json"
  || path === "pnpm-lock.yaml"
  || path.startsWith("app/vite.config")
  || path.startsWith("app/tsconfig")
));
const androidOnlyChanged = files.some((path) => path.startsWith("app/src-tauri/gen/android/"));
const codexOnlyChanged = files.length > 0 && files.every((path) => isCodexOnlyRustDiff(path));
const sharedNativeChanged = files.some((path) => (
  path.startsWith("app/src-tauri/")
  && !path.startsWith("app/src-tauri/gen/android/")
  && !isCodexOnlyRustDiff(path)
));
const desktopChanged = !previousTag || frontendChanged || sharedNativeChanged || codexOnlyChanged;
const androidChanged = !previousTag || frontendChanged || sharedNativeChanged || androidOnlyChanged;
const needsFrontend = desktopChanged || androidChanged;

const outputs = {
  previous_tag: previousTag,
  build_frontend: String(needsFrontend),
  build_desktop: String(desktopChanged),
  build_android: String(androidChanged),
};
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
}
console.log(JSON.stringify({ tag, previousTag, files, ...outputs }, null, 2));
