/**
 * Names every server action the local preview decodes, and how big it was.
 *
 *   node scripts/trace-actions.mjs [seconds]
 *
 * A server action that fails while its arguments are still being decoded fails
 * before any of our code runs, so nothing we wrote can say which action it was.
 * That is how "Maximum array nesting exceeded" - React's guard against large
 * nested arrays in an action payload - arrived with no request attached to it.
 *
 * This attaches a breakpoint whose condition logs and then evaluates false, so
 * the worker never pauses. Only the action id and the body's length are read;
 * the body itself holds whatever the member typed.
 */
import WebSocket from "ws";

const seconds = Number(process.argv[2] ?? 600);
const targets = await (await fetch("http://127.0.0.1:9229/json")).json();
const socket = new WebSocket(targets[0].webSocketDebuggerUrl, { headers: { Host: "localhost" } });

let id = 0;
const send = (method, params = {}) => socket.send(JSON.stringify({ id: ++id, method, params }));

socket.on("open", () => {
  send("Runtime.enable");
  send("Debugger.enable");
  // `p3 = await n11(t12, i2, ...)` - Next handing the raw body to decodeReply.
  // g2 is the action id, t12 the body. Logging from a breakpoint condition that
  // ends in `false` records the call without stopping the worker on it.
  send("Debugger.setBreakpointByUrl", {
    lineNumber: 29485,
    urlRegex: ".*worker\.js",
    condition: "(console.log('[action]', g2, 'body=' + t12.length), false)",
  });
});

const text = (a) => a.type === "string" ? a.value : ("value" in a ? JSON.stringify(a.value) : a.description ?? a.type);

socket.on("message", (data) => {
  const m = JSON.parse(data.toString());
  if (m.id && m.result && "breakpointId" in m.result) {
    console.log(`중단점 설정됨 (${m.result.locations?.length ?? 0}곳). ${seconds}초 동안 기록합니다.`);
  }
  if (m.id && m.error) console.log("CDP 오류", JSON.stringify(m.error));
  if (m.method === "Runtime.consoleAPICalled") {
    const line = m.params.args.map(text).join(" ");
    if (line.startsWith("[action]") || line.includes("nesting") || line.includes("[route-") || line.includes("[gemini")) {
      console.log(`[${new Date().toTimeString().slice(0, 8)}] ${line}`);
    }
  }
  if (m.method === "Debugger.paused") send("Debugger.resume");
});
socket.on("error", (e) => console.error("소켓 오류", e?.message ?? e));
setTimeout(() => { socket.close(); process.exit(0); }, seconds * 1000);
