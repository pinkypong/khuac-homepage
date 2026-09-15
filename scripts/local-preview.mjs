import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/@opennextjs/cloudflare/dist/cli/index.js", import.meta.url));
const port = 3100;

// Do not overwrite build files while an existing preview holds them open.
const probe = createServer();
try {
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
} catch {
  console.error("3100 포트가 사용 중입니다. 기존 미리보기 서버를 Ctrl+C로 종료한 뒤 다시 실행하세요.");
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: "production", NEXTJS_ENV: "production" };
// Always use the same top-level compatibility date, flags and bindings as
// production. Only the execution location changes; this command never deploys.
delete env.CLOUDFLARE_ENV;
async function run(args) {
  const child = spawn(process.execPath, [cli, ...args], { cwd: root, env, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) process.exit(code);
}

console.log("Cloudflare workerd preview → http://localhost:3100 (no commit, push or deploy)");
// Wrangler prints its own link as http://127.0.0.1:3100, and following it
// leaves the map blank: the Google Maps key is restricted to a list of
// referrers, that list holds localhost, and a browser treats the two as
// different origins. Every waypoint lookup then comes back PERMISSION_DENIED,
// which on screen looks like a course that cannot be placed rather than like a
// key that refused.
console.log("   ※ 반드시 localhost:3100 으로 여세요. 127.0.0.1 로 열면 지도 키가 거부합니다.");
await run(["build"]);

/**
 * Opens the browser once the server answers, on the name the map key knows.
 *
 * Wrangler prints its own link as 127.0.0.1:3100, and following it leaves the
 * map blank - the Google Maps key is restricted to a list of referrers, that
 * list holds localhost, and a browser treats the two names as different
 * origins. Every waypoint lookup then comes back PERMISSION_DENIED, which
 * reads as a broken course rather than a refused key.
 */
async function openWhenReady() {
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      await fetch(`http://localhost:${port}/`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
      spawn("cmd", ["/c", "start", "", `http://localhost:${port}`], { detached: true, stdio: "ignore" }).unref();
      console.log(`
브라우저를 열었습니다 → http://localhost:${port}`);
      return;
    } catch {
      // Still building, or workerd has not bound the port yet.
    }
  }
}
void openWhenReady();

// OpenNext populates the LOCAL R2 cache before starting Wrangler/workerd.
await run(["preview", "--local", "--ip", "127.0.0.1", "--port", String(port), "--var", "NEXTJS_ENV:production"]);
