/**
 * Live console and exceptions from the local workerd preview.
 *
 *   node scripts/watch-worker-log.mjs [seconds]
 *
 * `npm run cf:preview` runs the built Worker in workerd, which prints its
 * console to the terminal that started it - and that terminal belongs to
 * whoever ran the command. A 500 seen in a browser is therefore a 500 with no
 * message anywhere the person debugging can read, which is how "앨범 만들기가
 * 500을 낸다" stayed unexplained.
 *
 * workerd opens a DevTools inspector on 9229. Subscribing to it gets the same
 * lines, in a second terminal, without restarting the preview and losing the
 * session that reproduces the bug.
 */
import WebSocket from "ws";

const seconds = Number(process.argv[2] ?? 180);

const targets = await (await fetch("http://127.0.0.1:9229/json")).json();
const url = targets[0]?.webSocketDebuggerUrl;
if (!url) throw new Error("인스펙터를 찾지 못했습니다. cf:preview가 떠 있는지 확인하세요.");

// `ws` rather than Node's global WebSocket: workerd's inspector refuses the
// handshake the global client sends, and does so with an empty error.
const socket = new WebSocket(url, { headers: { Host: "localhost" } });
let id = 0;
const send = (method, params = {}) => socket.send(JSON.stringify({ id: ++id, method, params }));

const text = (arg) => {
  if (arg.type === "string") return arg.value;
  if ("value" in arg) return JSON.stringify(arg.value);
  if (arg.description) return arg.description;
  return arg.type;
};

socket.on("open", () => {
  send("Runtime.enable");
  send("Log.enable");
  console.log(`구독 시작 — ${seconds}초 동안 워커 로그를 받습니다.`);
});

socket.on("message", (data) => {
  const message = JSON.parse(data.toString());
  const stamp = new Date().toTimeString().slice(0, 8);
  if (message.method === "Runtime.consoleAPICalled") {
    const { type, args } = message.params;
    console.log(`[${stamp}] ${type}: ${args.map(text).join(" ")}`);
  } else if (message.method === "Runtime.exceptionThrown") {
    const d = message.params.exceptionDetails;
    console.log(`[${stamp}] EXCEPTION: ${d.text} ${d.exception?.description ?? ""}`);
  } else if (message.method === "Log.entryAdded") {
    const e = message.params.entry;
    console.log(`[${stamp}] ${e.level}: ${e.text}`);
  }
});
socket.on("error", (e) => console.error("소켓 오류", e?.message ?? e));
setTimeout(() => { socket.close(); process.exit(0); }, seconds * 1000);
