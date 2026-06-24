import fs from "node:fs";

let cachedVersion: string | undefined;

export function packageVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }
  const packageJsonUrl = new URL("../package.json", import.meta.url);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonUrl, "utf8")) as { version?: unknown };
  cachedVersion = typeof packageJson.version === "string" && packageJson.version ? packageJson.version : "0.0.0";
  return cachedVersion;
}