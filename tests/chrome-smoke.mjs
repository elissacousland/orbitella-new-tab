// проверяем новую вкладку в хроме

const port = Number(process.argv[2]);

if (!Number.isInteger(port)) {
    console.error("Usage: node tests/chrome-smoke.mjs <remote-debugging-port>");
    process.exit(2);
}

const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
const page = targets.find(target => target.type === "page" &&
    ["chrome://newtab/", "edge://newtab/"].includes(target.url));

if (!page?.webSocketDebuggerUrl) {
    console.error("Chrome new-tab target was not found.");
    process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const runtimeErrors = [];
let requestId = 0;

await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
});

socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
        return;
    }
    if (message.method === "Runtime.exceptionThrown") {
        runtimeErrors.push(message.params.exceptionDetails.text || "Runtime exception");
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        runtimeErrors.push(message.params.entry.text);
    }
});

function call(method, params = {}) {
    const id = ++requestId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

await Promise.all([
    call("Runtime.enable"),
    call("Page.enable"),
    call("Log.enable")
]);
await call("Page.reload", { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 2500));

const evaluated = await call("Runtime.evaluate", {
    expression: `({
        title: document.title,
        language: document.documentElement.lang,
        loading: document.documentElement.classList.contains("dashboard-loading"),
        scene: Boolean(document.querySelector(".space-scene")),
        bookmarkGrid: Boolean(document.querySelector(".bookmark-grid")),
        settings: Boolean(document.querySelector(".settings-dialog")),
        mainScript: Boolean(document.querySelector('script[src="js/main.js"]')),
        planets: document.querySelectorAll(".space-scene__planet").length
    })`,
    returnByValue: true
});
const state = evaluated.result.value;
socket.close();

const valid = state?.title && state.scene && state.bookmarkGrid && state.settings &&
    state.mainScript && state.planets === 8 && !state.loading;
if (!valid || runtimeErrors.length) {
    console.error(JSON.stringify({ state, runtimeErrors }, null, 2));
    process.exit(1);
}

console.log("Chrome extension smoke test passed.");
