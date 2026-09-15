import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Pasted GitHub Secrets can include trailing newlines. The Cloudflare SDK
// reports an invalid Authorization header as an unhelpful "Connection error".
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (!name.startsWith("NEXT_PUBLIC_") && !["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"].includes(name)) continue;
  env[name] = env[name].trim();
  if (/[\r\n]/.test(env[name])) throw new Error(`${name} must be a single-line value`);
}

const commands = {
  build: ["node_modules/@opennextjs/cloudflare/dist/cli/index.js", "build"],
  deploy: ["node_modules/wrangler/bin/wrangler.js", "deploy"],
  status: ["node_modules/wrangler/bin/wrangler.js", "deployments", "status"],
};
const command = commands[process.argv[2]];
if (!command) throw new Error("Expected build, deploy or status");
const result = spawnSync(process.execPath, [resolve(command[0]), ...command.slice(1)], { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
