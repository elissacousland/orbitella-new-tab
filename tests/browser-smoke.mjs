// проверяем интерфейс в браузере

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const port = Number(process.argv[2]);

if (!Number.isInteger(port)) {
    console.error("Usage: node tests/browser-smoke.mjs <remote-debugging-port>");
    process.exit(2);
}

const targets = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json());
const page = targets.find(target => target.type === "page");
if (!page?.webSocketDebuggerUrl) {
    console.error("Browser page target was not found.");
    process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
const requestUrls = new Map();
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
        runtimeErrors.push(message.params.exceptionDetails.exception?.description ||
            message.params.exceptionDetails.text || "Runtime exception");
    }
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
        runtimeErrors.push([message.params.entry.text, message.params.entry.url]
            .filter(Boolean).join(" — "));
    }
    if (message.method === "Network.requestWillBeSent") {
        requestUrls.set(message.params.requestId, message.params.request.url);
    }
    if (message.method === "Network.loadingFailed" &&
        message.params.errorText === "net::ERR_FILE_NOT_FOUND") {
        runtimeErrors.push(`Не найден ресурс: ${requestUrls.get(message.params.requestId) || "неизвестный URL"}`);
    }
});

function call(method, params = {}) {
    const id = ++requestId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const browserMocks = String.raw`
(() => {
    const stores = { local: Object.create(null), sync: Object.create(null) };
    const storageChanged = (() => {
        const listeners = new Set();
        return {
            addListener(listener) { listeners.add(listener); },
            removeListener(listener) { listeners.delete(listener); },
            emit(changes, area) { listeners.forEach(listener => listener(changes, area)); }
        };
    })();
    const storageArea = area => ({
        async get(keys) {
            if (keys === null) return { ...stores[area] };
            const list = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(list.filter(key => key in stores[area])
                .map(key => [key, stores[area][key]]));
        },
        async set(values) {
            const changes = Object.fromEntries(Object.entries(values).map(([key, value]) =>
                [key, { oldValue: stores[area][key], newValue: value }]));
            Object.assign(stores[area], values);
            queueMicrotask(() => storageChanged.emit(changes, area));
        },
        async remove(keys) {
            const changes = {};
            (Array.isArray(keys) ? keys : [keys]).forEach(key => {
                if (!(key in stores[area])) return;
                changes[key] = { oldValue: stores[area][key] };
                delete stores[area][key];
            });
            if (Object.keys(changes).length) {
                queueMicrotask(() => storageChanged.emit(changes, area));
            }
        }
    });
    const createEvent = () => {
        const listeners = new Set();
        return {
            addListener(listener) { listeners.add(listener); },
            removeListener(listener) { listeners.delete(listener); },
            emit(...args) { listeners.forEach(listener => listener(...args)); }
        };
    };
    const bookmarkEvents = {
        onCreated: createEvent(),
        onRemoved: createEvent(),
        onChanged: createEvent(),
        onMoved: createEvent(),
        onChildrenReordered: createEvent(),
        onImportEnded: createEvent()
    };
    const clone = value => JSON.parse(JSON.stringify(value));
    const initialBookmarkTree = [{ id: "0", title: "", children: [{
        id: "1", parentId: "0", index: 0, title: "Bookmarks Bar", children: [
            { id: "11", parentId: "1", index: 0, title: "Pinterest",
                url: "https://example.com/pinterest" },
            { id: "12", parentId: "1", index: 1, title: "AliExpress",
                url: "https://example.com/aliexpress" },
            { id: "13", parentId: "1", index: 2, title: "Microsoft Azure",
                url: "https://example.com/azure" },
            { id: "14", parentId: "1", index: 3, title: "Записи уроков",
                url: "https://example.com/lessons" },
            { id: "15", parentId: "1", index: 4, title: "HCP Terraform",
                url: "https://example.com/terraform" },
            { id: "16", parentId: "1", index: 5, title: "ExtraordinarilyLongBookmark",
                url: "https://example.com/long" }
        ]
    }] }];
    let bookmarkTree = clone(initialBookmarkTree);
    let nextBookmarkId = 100;
    const findBookmarkNode = id => {
        const visit = nodes => {
            for (const node of nodes) {
                if (String(node.id) === String(id)) return node;
                const nested = visit(node.children || []);
                if (nested) return nested;
            }
            return null;
        };
        return visit(bookmarkTree);
    };
    const reindexChildren = parent => (parent.children || []).forEach((child, index) => {
        child.parentId = String(parent.id);
        child.index = index;
        if (child.children) reindexChildren(child);
    });
    const containsBookmarkNode = (folder, id) => (folder.children || []).some(child =>
        String(child.id) === String(id) || containsBookmarkNode(child, id));
    const removeBookmarkNode = id => {
        const node = findBookmarkNode(id);
        const parent = node && findBookmarkNode(node.parentId);
        if (!node || !parent) return null;
        const index = parent.children.findIndex(child => child.id === node.id);
        parent.children.splice(index, 1);
        reindexChildren(parent);
        return { node, parent, index };
    };
    const bookmarkApi = {
        async getTree() { return clone(bookmarkTree); },
        async create(options) {
            const parent = findBookmarkNode(options.parentId);
            if (!parent?.children) throw new Error("Parent folder was not found");
            const node = {
                id: String(nextBookmarkId++),
                parentId: String(parent.id),
                index: 0,
                title: String(options.title || "")
            };
            if (options.url !== undefined) node.url = String(options.url);
            else node.children = [];
            const index = Number.isInteger(options.index) ?
                Math.max(0, Math.min(parent.children.length, options.index)) : parent.children.length;
            parent.children.splice(index, 0, node);
            reindexChildren(parent);
            queueMicrotask(() => bookmarkEvents.onCreated.emit(node.id, clone(node)));
            return clone(node);
        },
        async update(id, changes) {
            const node = findBookmarkNode(id);
            if (!node) throw new Error("Bookmark was not found");
            if (changes.title !== undefined) node.title = String(changes.title);
            if (changes.url !== undefined) {
                if (node.children) throw new Error("A folder cannot have a URL");
                node.url = String(changes.url);
            }
            queueMicrotask(() => bookmarkEvents.onChanged.emit(String(id), clone(changes)));
            return clone(node);
        },
        async move(id, destination) {
            const node = findBookmarkNode(id);
            const nextParent = findBookmarkNode(destination.parentId ?? node?.parentId);
            if (!node || !nextParent?.children) throw new Error("Move destination was not found");
            if (node.children && (node.id === nextParent.id || containsBookmarkNode(node, nextParent.id))) {
                throw new Error("A folder cannot be moved into itself");
            }
            const previous = removeBookmarkNode(id);
            if (!previous) throw new Error("Bookmark parent was not found");
            const index = Number.isInteger(destination.index) ?
                Math.max(0, Math.min(nextParent.children.length, destination.index)) :
                nextParent.children.length;
            nextParent.children.splice(index, 0, node);
            reindexChildren(nextParent);
            queueMicrotask(() => {
                bookmarkEvents.onMoved.emit(String(id), {
                    parentId: String(nextParent.id),
                    index: node.index,
                    oldParentId: String(previous.parent.id),
                    oldIndex: previous.index
                });
                bookmarkEvents.onChildrenReordered.emit(String(previous.parent.id), {
                    childIds: previous.parent.children.map(child => child.id)
                });
                if (previous.parent.id !== nextParent.id) {
                    bookmarkEvents.onChildrenReordered.emit(String(nextParent.id), {
                        childIds: nextParent.children.map(child => child.id)
                    });
                }
            });
            return clone(node);
        },
        async remove(id) {
            const node = findBookmarkNode(id);
            if (!node || node.children?.length) throw new Error("Bookmark cannot be removed");
            const removed = removeBookmarkNode(id);
            queueMicrotask(() => bookmarkEvents.onRemoved.emit(String(id), {
                parentId: removed.parent.id,
                index: removed.index,
                node: clone(removed.node)
            }));
        },
        async removeTree(id) {
            const node = findBookmarkNode(id);
            if (!node?.children) throw new Error("Folder was not found");
            const removed = removeBookmarkNode(id);
            queueMicrotask(() => bookmarkEvents.onRemoved.emit(String(id), {
                parentId: removed.parent.id,
                index: removed.index,
                node: clone(removed.node)
            }));
        },
        ...bookmarkEvents
    };
    globalThis.__bookmarkMock = {
        initialTree: clone(initialBookmarkTree),
        restore() {
            bookmarkTree = clone(initialBookmarkTree);
            nextBookmarkId = 100;
        },
        find: findBookmarkNode,
        events: bookmarkEvents,
        stores
    };
    const event = { addListener() {}, removeListener() {} };
    globalThis.chrome = {
        i18n: { getUILanguage: () => "ru-RU" },
        runtime: { getURL: value => String(value).startsWith("/_favicon/")
            ? new URL("assets/planets/earth.webp", location.href).href
            : new URL(String(value).replace(/^\/+/, ""), location.href).href },
        storage: { local: storageArea("local"), sync: storageArea("sync"),
            onChanged: storageChanged },
        bookmarks: bookmarkApi,
        history: { search: async () => [] },
        search: { query: async () => undefined },
        identity: { getProfileUserInfo: async () => ({}), onSignInChanged: event },
        extension: { inIncognitoContext: false },
        tabs: { create: async () => undefined }
    };
    globalThis.fetch = async () => new Response("", { status: 404 });
    try {
        navigator.geolocation.getCurrentPosition = (_success, error) => error({ code: 1 });
    } catch {}
})();`;

await Promise.all([
    call("Runtime.enable"),
    call("Page.enable"),
    call("Log.enable"),
    call("Network.enable")
]);
await call("Page.addScriptToEvaluateOnNewDocument", { source: browserMocks });
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await call("Page.navigate", { url: pathToFileURL(path.join(projectRoot, "index.html")).href });
await new Promise(resolve => setTimeout(resolve, 3200));

const textureLoadResult = await call("Runtime.evaluate", {
    expression: `Promise.all([
        "mercury", "venus", "earth", "mars", "jupiter",
        "saturn", "uranus", "neptune", "sun"
    ].map(name => new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
        image.onerror = () => resolve(false);
        image.src = new URL("assets/planets/" + name + ".webp", location.href).href;
    }))).then(results => results.every(Boolean))`,
    awaitPromise: true,
    returnByValue: true
});

const evaluated = await call("Runtime.evaluate", {
    expression: `({
        title: document.title,
        loading: document.documentElement.classList.contains("dashboard-loading"),
        scene: Boolean(document.querySelector(".space-scene")),
        spaceBackground: (() => {
            const style = getComputedStyle(document.querySelector(".space-scene__backdrop"));
            return style.backgroundImage.includes("default-space-bg-dark.webp") &&
                style.backgroundSize === "cover" && style.backgroundPosition === "50% 50%";
        })(),
        permanentCosmicScene: (() => {
            const cosmicLayersVisible = [
                ".space-scene__backdrop",
                ".space-scene__stars",
                ".space-scene__planets",
                ".orbital-sun"
            ].every(selector => getComputedStyle(document.querySelector(selector)).display !== "none");
            return cosmicLayersVisible &&
                !document.querySelector(".space-scene__wallpaper") &&
                !document.querySelector(".settings-wallpaper") &&
                !("backgroundMode" in settings) && !("wallpaperPosition" in settings);
        })(),
        bookmarkGrid: Boolean(document.querySelector(".bookmark-grid")),
        clockGlass: (() => {
            const container = document.querySelector(".clock-weather");
            const glassArea = container?.querySelector(".clock-weather-content");
            const glassLines = [...(container?.querySelectorAll(".clock-glass-line") || [])];
            const planets = [...document.querySelectorAll(".space-scene__planet")];
            if (!container || !glassArea || glassLines.length !== 3 ||
                !planets.length || !globalThis.planetClockGlass) return false;
            const originalBounds = planets.map(planet => planet.getBoundingClientRect);
            const targetBounds = glassLines[0].getBoundingClientRect();
            const outsideBounds = {
                left: -1000, right: -900, top: -1000, bottom: -900,
                width: 100, height: 100, x: -1000, y: -1000
            };
            planets.forEach((planet, index) => {
                planet.getBoundingClientRect = () => index ? outsideBounds : targetBounds;
            });
            globalThis.planetClockGlass.refresh();
            const activatesOnlyTime = glassLines[0].classList.contains("is-planet-behind") &&
                glassLines.slice(1).every(line => !line.classList.contains("is-planet-behind"));
            planets.forEach(planet => planet.getBoundingClientRect = () => outsideBounds);
            globalThis.planetClockGlass.refresh();
            const deactivates = glassLines.every(line => !line.classList.contains("is-planet-behind"));
            planets.forEach((planet, index) => planet.getBoundingClientRect = originalBounds[index]);
            globalThis.planetClockGlass.refresh();
            const glass = getComputedStyle(glassLines[0], "::before");
            const removedGroupGlass = getComputedStyle(glassArea, "::before");
            return activatesOnlyTime && deactivates && glass.pointerEvents === "none" &&
                glass.transitionDuration.split(", ").every(value => value === "0.21s") &&
                glass.borderRadius === "999px" && glass.boxShadow === "none" &&
                glass.borderTopWidth === "0px" && glass.maskImage !== "none" &&
                removedGroupGlass.content === "none" &&
                Number(getComputedStyle(document.querySelector(".hero-info")).zIndex) > 0 &&
                Number(getComputedStyle(document.querySelector(".space-scene")).zIndex) < 0;
        })(),
        bookmarkCartoonStyle: (() => {
            const tiles = [...document.querySelectorAll(".bookmark-grid .tile")];
            return tiles.length > 0 && tiles.every(tile => {
                const style = getComputedStyle(tile);
                const highlight = getComputedStyle(tile, "::before");
                const shading = getComputedStyle(tile, "::after");
                const surface = tile.querySelector(":scope > .tile-surface");
                if (!surface) return false;
                const detail = surface.querySelector(":scope > .tile-surface-detail");
                if (!detail) return false;
                const surfaceStyle = getComputedStyle(surface);
                const detailStyle = getComputedStyle(detail);
                const firstShape = getComputedStyle(surface, "::before");
                const secondShape = getComputedStyle(surface, "::after");
                return style.borderRadius.includes("%") && style.borderRadius !== "50%" &&
                    style.backgroundImage.startsWith("linear-gradient") &&
                    (style.backgroundImage.match(/gradient/g) || []).length === 1 &&
                    style.getPropertyValue("--tile-surface-opacity").trim() === "100%" &&
                    style.getPropertyValue("--tile-color-soft").trim() !== "" &&
                    style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                    style.backdropFilter === "none" && style.boxShadow.includes("inset") &&
                    style.transitionDuration.split(", ").every(value => value === "0.2s") &&
                    ["1", "2", "3", "4"].includes(tile.dataset.planetPattern) &&
                    surfaceStyle.pointerEvents === "none" && surfaceStyle.overflow === "hidden" &&
                    surfaceStyle.backgroundImage.startsWith("linear-gradient") &&
                    detailStyle.pointerEvents === "none" &&
                    detailStyle.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                    detailStyle.borderRadius.includes("%") &&
                    firstShape.backgroundImage === "none" &&
                    firstShape.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                    firstShape.borderRadius.includes("%") &&
                    secondShape.backgroundImage === "none" &&
                    secondShape.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                    secondShape.borderRadius.includes("%") &&
                    highlight.backgroundImage === "none" &&
                    highlight.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                    shading.backgroundImage === "none";
            });
        })(),
        faviconSizing: (() => {
            const icons = [...document.querySelectorAll(".bookmark-grid .tile:not(.folder-tile) .favicon-box img")];
            return icons.length > 0 && icons.every(icon => {
                const tile = icon.closest(".tile");
                const scale = parseFloat(getComputedStyle(tile).getPropertyValue("--favicon-visual-scale"));
                return scale >= .84 && scale <= 1.04 && getComputedStyle(icon).objectFit === "contain";
            });
        })(),
        faviconContrast: (() => {
            const boxes = [...document.querySelectorAll(".bookmark-grid .tile:not(.folder-tile) .favicon-box")];
            return boxes.length > 0 && boxes.every(box => {
                const halo = getComputedStyle(box, "::before");
                const icon = getComputedStyle(box.querySelector("img"));
                const outlineMode = box.closest(".tile").dataset.faviconOutline;
                return halo.content === "none" &&
                    (outlineMode === "white" ? icon.filter.includes("favicon-white-outline") : icon.filter === "none") &&
                    !icon.filter.includes("drop-shadow") && !icon.filter.includes("blur(") &&
                    !icon.filter.includes("brightness") && !icon.filter.includes("contrast");
            });
        })(),
        bookmarkCentering: (() => {
            const grid = document.querySelector(".bookmark-grid").getBoundingClientRect();
            const center = grid.left + carouselState.geometry.centerX + carouselState.panX;
            return Math.abs(center - innerWidth / 2) < 1 && Math.abs(carouselState.panX) < .1;
        })(),
        bookmarkTitleWrapping: (() => {
            const titles = [...document.querySelectorAll(".bookmark-grid .tile-title")];
            const byText = text => titles.find(title => title.textContent === text);
            const singleWords = ["Pinterest", "AliExpress", "ExtraordinarilyLongBookmark"]
                .map(byText);
            const multipleWords = ["Microsoft Azure", "Записи уроков", "HCP Terraform"]
                .map(byText);
            const commonSingleWordsVisible = singleWords.slice(0, 2).every(title =>
                title && title.scrollWidth <= title.clientWidth + 1);
            const largeTitleFont = document.body.dataset.tileSize !== "small" ||
                singleWords.filter(Boolean).every(title =>
                    parseFloat(getComputedStyle(title).fontSize) >= 13);
            return singleWords.every(title => title &&
                title.classList.contains("tile-title--single-word") &&
                getComputedStyle(title).whiteSpace === "nowrap" &&
                title.closest(".tile").dataset.fullTitle === title.textContent) &&
                multipleWords.every(title => title &&
                    title.classList.contains("tile-title--multi-word") &&
                    getComputedStyle(title).whiteSpace === "normal" &&
                    getComputedStyle(title).wordBreak === "normal" &&
                    title.closest(".tile").dataset.fullTitle === title.textContent) &&
                commonSingleWordsVisible && largeTitleFont;
        })(),
        bookmarkOrbitLift: (() => {
            const geometry = carouselState.geometry;
            const sunGeometry = getOrbitalSunCollisionGeometry();
            const occupiedBounds = [...document.querySelectorAll(".bookmark-grid > .grid-cell")]
                .filter(cell => cell.querySelector(".tile[data-id]") &&
                    !cell.classList.contains("grid-cell--reserve"))
                .map(cell => {
                    const tile = cell.querySelector(".tile[data-id]").getBoundingClientRect();
                    const title = cell.querySelector(".tile-title:not([hidden])")
                        ?.getBoundingClientRect();
                    return {
                        left: Math.min(tile.left, title?.left ?? tile.left),
                        right: Math.max(tile.right, title?.right ?? tile.right),
                        bottom: Math.max(tile.bottom, title?.bottom ?? tile.bottom)
                    };
                });
            const clearances = occupiedBounds.map(bounds => {
                const boundary = getOrbitalSunBoundaryY(sunGeometry, bounds.left, bounds.right);
                return Number.isFinite(boundary) ? boundary - bounds.bottom : null;
            }).filter(Number.isFinite);
            const expectedGap = Math.max(6, geometry.tileDiameter * .12) + 2;
            return clearances.length > 0 && clearances.every(gap => gap >= expectedGap - 1) &&
                Math.min(...clearances) <= expectedGap + 1;
        })(),
        dragInsertionStability: (() => {
            const ordered = [...layout].sort((first, second) => first.order - second.order);
            const sourceId = ordered[0]?.id;
            const targetId = ordered.at(-1)?.id;
            if (!sourceId || !targetId || sourceId === targetId) return false;
            draggingId = sourceId;
            dragDashboardSnapshot = null;
            const snapshot = getDashboardSnapshot();
            const target = snapshot.items.find(item => item.id === targetId);
            if (!target) {
                finishDragSession();
                return false;
            }
            const pointer = {
                clientX: (target.rect.left + target.rect.right) / 2,
                clientY: (target.rect.top + target.rect.bottom) / 2
            };
            const initialIntent = resolveDashboardDropIntent(pointer);
            applyResolvedDragPreview(initialIntent);
            const stableIntent = resolveDashboardDropIntent(pointer);
            const plan = getDashboardInsertionPlan(sourceId, targetId, true);
            dragPreviewIntent = { key: "dashboard:other:before", containerId: "dashboard",
                targetId: "other", action: "before" };
            const waitsBeforeSwitch = !shouldApplyDragPreview("dashboard", targetId, "after");
            if (dragPreviewCandidate) dragPreviewCandidate.since -= DRAG_PREVIEW_SETTLE_MS + 1;
            const switchesAfterDelay = shouldApplyDragPreview("dashboard", targetId, "after");
            const result = initialIntent?.targetId === targetId &&
                stableIntent?.targetId === targetId && initialIntent.action === "after" &&
                plan?.positions.get(sourceId)?.order === ordered.length - 1 &&
                plan?.positions.get(targetId)?.order === ordered.length - 2 &&
                waitsBeforeSwitch && switchesAfterDelay;
            finishDragSession();
            return result;
        })(),
        dragClickGuard: (() => {
            const tile = document.querySelector(".bookmark-grid .tile[data-id]");
            if (!tile) return false;
            const transfer = new DataTransfer();
            tile.dispatchEvent(new DragEvent("dragstart", {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer
            }));
            const blockedAtStart = blockClickUntil > Date.now();
            tile.dispatchEvent(new DragEvent("dragend", {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer
            }));
            return blockedAtStart && blockClickUntil > Date.now() && !draggingId;
        })(),
        accessibility: (() => {
            const dialogs = [...document.querySelectorAll("dialog")];
            const closeButtons = [...document.querySelectorAll(".dialog-close")];
            const toast = document.querySelector(".toast");
            const checks = {
                labelledDialogs: dialogs.length > 0 && dialogs.every(dialog => {
                    const labelId = dialog.getAttribute("aria-labelledby");
                    return Boolean(labelId && dialog.querySelector("#" + CSS.escape(labelId)));
                }),
                localizedCloseButtons: closeButtons.length === 4 &&
                    closeButtons.every(button => button.getAttribute("aria-label") === "Закрыть"),
                liveToast: toast?.getAttribute("role") === "status" &&
                    toast.getAttribute("aria-live") === "polite" &&
                    toast.getAttribute("aria-atomic") === "true"
            };
            checks.ok = Object.values(checks).every(Boolean);
            return checks;
        })(),
        weatherState: (() => {
            const city = document.querySelector(".weather-city");
            const icon = document.querySelector(".weather-now span");
            const temperature = document.querySelector(".weather-now strong");
            const checks = {
                permissionDenied: city?.textContent === "Геолокация запрещена",
                compactFallback: icon?.textContent === "◌" && temperature?.textContent === "—",
                politeUpdates: document.querySelector(".weather-now")?.getAttribute("aria-live") === "polite"
            };
            checks.ok = Object.values(checks).every(Boolean);
            return checks;
        })(),
        settings: (() => {
            const button = document.querySelector(".settings-button");
            const dialog = document.querySelector(".settings-dialog");
            button?.click();
            const toggle = dialog?.querySelector('.settings-checkbox input[type="checkbox"]');
            const inline = dialog?.querySelector(".settings-inline");
            const footer = dialog?.querySelector(".settings-footer");
            const dialogStyle = dialog ? getComputedStyle(dialog) : null;
            const toggleStyle = toggle ? getComputedStyle(toggle) : null;
            const backgroundColor = dialogStyle?.backgroundColor || "";
            const backgroundProbe = document.createElement("span");
            backgroundProbe.style.background =
                "color-mix(in srgb, var(--overlay-bg) 90%, transparent)";
            document.body.append(backgroundProbe);
            const expectedBackground = getComputedStyle(backgroundProbe).backgroundColor;
            backgroundProbe.remove();
            const checks = {
                open: Boolean(dialog?.open),
                font: dialogStyle?.fontFamily.includes("Nunito"),
                background: backgroundColor === expectedBackground,
                height: parseFloat(dialogStyle?.maxHeight) <= innerHeight - 16,
                inline: getComputedStyle(inline).display === "grid",
                footer: getComputedStyle(footer).display === "flex",
                toggles: dialog.querySelectorAll('.settings-checkbox input[type="checkbox"]').length === 3,
                removedInputs: dialog.querySelectorAll('input[type="radio"], input[type="file"]').length === 0,
                tileSizes: [...dialog.querySelectorAll("#tile-size-select option")]
                    .map(option => option.value).join(",") === "extra-small,small",
                toggleSize: toggleStyle.width === "36px" && toggleStyle.height === "21px",
                toggleShape: toggleStyle.borderRadius === "999px",
                sources: dialog.querySelector("form").contains(dialog.querySelector(".settings-sources"))
            };
            const languageSelect = dialog.querySelector("#language-select");
            languageSelect.value = "en";
            languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
            checks.translatedCloseButtons = [...document.querySelectorAll(".dialog-close")]
                .every(closeButton => closeButton.getAttribute("aria-label") === "Close");
            languageSelect.value = "ru";
            languageSelect.dispatchEvent(new Event("change", { bubbles: true }));
            dialog?.querySelector("[data-close]")?.click();
            checks.closed = !dialog.open;
            checks.ok = Object.values(checks).every(Boolean);
            checks.backgroundColor = backgroundColor;
            checks.expectedBackground = expectedBackground;
            return checks;
        })(),
        planets: document.querySelectorAll(".space-scene__planet").length,
        earthMoons: document.querySelectorAll(".space-scene__earth-moon").length,
        moonTexture: (() => {
            const earth = document.querySelector(".space-scene__planet--earth");
            const moon = document.querySelector(".space-scene__earth-moon");
            const earthSize = parseFloat(getComputedStyle(earth).width);
            const moonStyle = getComputedStyle(moon);
            const moonSize = parseFloat(moonStyle.width);
            return moonStyle.backgroundImage.includes("moon.webp") &&
                moonStyle.backgroundSize === "contain" &&
                moonStyle.filter === "none" && moonStyle.boxShadow === "none" &&
                Math.abs(moonSize - earthSize * .38) < 1;
        })(),
        otherMoons: document.querySelectorAll(".space-scene__moon, .space-scene__mars-moon").length,
        staticStars: Boolean(document.querySelector(".space-scene__static-stars")),
        planetOrbitLayout: (() => {
            const geometry = globalThis.orbitalSystem.readGeometry();
            const orbits = [...document.querySelectorAll(".space-scene__orbit")]
                .filter(orbit => !orbit.classList.contains("space-scene__orbit--bookmarks"));
            const widths = orbits.map(orbit =>
                parseFloat(getComputedStyle(orbit, "::before").width));
            const onePlanetPerOrbit = orbits.every(orbit =>
                orbit.querySelectorAll(":scope > .space-scene__planet").length === 1);
            const ordered = widths.every((width, index) => !index || width > widths[index - 1]);
            const depths = orbits.map(orbit => Number(getComputedStyle(orbit).zIndex));
            const innerPlanetsStayOnTop = depths.every((depth, index) =>
                Number.isFinite(depth) && (!index || depth < depths[index - 1]));
            const border = getComputedStyle(orbits[0], "::before").borderTopColor;
            return Math.abs(geometry.planetMinimumRadius - innerHeight * .72) < 1 &&
                Math.abs(geometry.planetOrbitStep - innerHeight * .095) < 1 &&
                onePlanetPerOrbit && ordered && innerPlanetsStayOnTop &&
                border.includes("170, 132, 196");
        })(),
        planetOrbitShift: globalThis.planetOrbitLayout?.getShift(),
        planetTextures: [...document.querySelectorAll(".space-scene__planet")]
            .every(planet => getComputedStyle(planet).backgroundImage.includes(".webp")),
        planetSizing: [...document.querySelectorAll(".space-scene__planet")]
            .every(planet => getComputedStyle(planet).backgroundSize === "contain"),
        planetOverlaps: (() => {
            const planets = [...document.querySelectorAll(".space-scene__planet")];
            return planets.flatMap((planet, index) => {
                const first = planet.getBoundingClientRect();
                return planets.slice(index + 1).flatMap(other => {
                    const second = other.getBoundingClientRect();
                    const distance = Math.hypot(
                        first.left + first.width / 2 - second.left - second.width / 2,
                        first.top + first.height / 2 - second.top - second.height / 2
                    );
                    const minimumDistance = (first.width + second.width) / 2;
                    if (distance >= minimumDistance) return [];
                    return [{
                        first: planet.className,
                        second: other.className,
                        distance,
                        minimumDistance
                    }];
                });
            });
        })(),
        planetImagesOriginal: [...document.querySelectorAll(".space-scene__planet")]
            .every(planet => {
                const style = getComputedStyle(planet);
                return (style.backgroundImage.match(/url\\(/g) || []).length === 1 &&
                    style.filter === "none" && style.boxShadow === "none" &&
                    style.getPropertyValue("--light-x") === "" &&
                    style.getPropertyValue("--light-y") === "" &&
                    getComputedStyle(planet, "::before").content === "none" &&
                    getComputedStyle(planet, "::after").content === "none";
            }),
        saturnVisible: (() => {
            const saturn = document.querySelector(".space-scene__planet--saturn");
            const style = getComputedStyle(saturn);
            const bounds = saturn.getBoundingClientRect();
            return style.overflow === "visible" && parseFloat(style.width) > 0 &&
                style.visibility === "visible" && parseFloat(style.opacity) > .5 &&
                bounds.left >= 0 && bounds.top >= 0 &&
                bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
                (style.backgroundImage.match(/url\\(/g) || []).length === 1 &&
                style.backgroundImage.includes("saturn.webp") &&
                style.backgroundSize === "contain" && style.filter === "none" &&
                getComputedStyle(saturn, "::before").content === "none" &&
                getComputedStyle(saturn, "::after").content === "none";
        })(),
        sunTexture: (() => {
            const sun = document.querySelector(".orbital-sun");
            const style = getComputedStyle(sun);
            const image = getComputedStyle(sun, "::before");
            return image.backgroundImage.includes("sun.webp") &&
                image.backgroundSize === "100% auto" &&
                style.filter === "none" && image.filter === "none";
        })(),
        sunLifted: (() => {
            const sun = document.querySelector(".orbital-sun").getBoundingClientRect();
            const trigger = document.querySelector(".orbital-search-trigger").getBoundingClientRect();
            return trigger.left >= sun.left && trigger.right <= sun.right &&
                trigger.top >= sun.top + 30 && trigger.bottom <= sun.bottom;
        })(),
        searchTriggerVisual: (() => {
            const trigger = document.querySelector(".orbital-search-trigger");
            const icon = trigger.querySelector(".search-icon").getBoundingClientRect();
            const label = trigger.querySelector("span");
            const labelBounds = label.getBoundingClientRect();
            const bounds = trigger.getBoundingClientRect();
            const contentCenterX = (Math.min(icon.left, labelBounds.left) +
                Math.max(icon.right, labelBounds.right)) / 2;
            const contentCenterY = (Math.min(icon.top, labelBounds.top) +
                Math.max(icon.bottom, labelBounds.bottom)) / 2;
            const iconCenterY = icon.top + icon.height / 2;
            const labelCenterY = labelBounds.top + labelBounds.height / 2;
            const contentHit = document.elementFromPoint(contentCenterX, contentCenterY);
            const style = getComputedStyle(trigger);
            const curvedZone = getComputedStyle(trigger, "::before");
            const expectedContentCenterY = bounds.top +
                (bounds.height + parseFloat(style.paddingTop)) / 2;
            return Math.abs(contentCenterX - (bounds.left + bounds.width / 2)) < 1 &&
                Math.abs(contentCenterY - expectedContentCenterY) < 1 &&
                Math.abs(iconCenterY - labelCenterY) < 1 &&
                Math.abs(labelBounds.left - icon.right - 8) < 1 &&
                bounds.width >= 156 && bounds.width <= 196 &&
                style.color === "rgb(0, 0, 0)" &&
                parseFloat(getComputedStyle(label).fontSize) >= 22 &&
                ["flex", "inline-flex"].includes(style.display) &&
                style.alignItems === "center" && style.justifyContent === "center" &&
                style.overflow === "hidden" && style.backgroundColor === "rgba(0, 0, 0, 0)" &&
                style.borderRadius === "0px" && style.borderTopWidth === "0px" &&
                style.boxShadow === "none" && style.clipPath.startsWith("ellipse") &&
                curvedZone.pointerEvents === "none" &&
                curvedZone.backgroundImage.startsWith("radial-gradient") &&
                (contentHit === trigger || trigger.contains(contentHit));
        })(),
        sunCapHeight: parseFloat(getComputedStyle(document.querySelector(".orbital-search-area"))
            .getPropertyValue("--search-collapsed-cap-height")),
        asteroidBelt: Boolean(document.querySelector(".space-scene__asteroid-belt")),
        animatedSun: Boolean(document.querySelector(".solar-surface-canvas, .solar-corona-canvas")),
        orbitalSystem: Boolean(globalThis.orbitalSystem && globalThis.planetWrapSystem &&
            globalThis.planetWrapSystem.getAnimations().length === 8)
    })`,
    returnByValue: true
});
if (evaluated.exceptionDetails) {
    runtimeErrors.push(evaluated.exceptionDetails.exception?.description ||
        evaluated.exceptionDetails.text || "Runtime evaluation failed");
}
const state = evaluated.result.value;
if (!state) {
    console.error(JSON.stringify({
        evaluationError: evaluated.exceptionDetails?.exception?.description ||
            evaluated.exceptionDetails?.text || "Runtime evaluation returned no state",
        runtimeErrors
    }, null, 2));
    socket.close();
    process.exit(1);
}
state.planetAssetsLoaded = textureLoadResult.result.value;
const clockGlassEffectResult = await call("Runtime.evaluate", {
    expression: `new Promise(resolve => {
        const container = document.querySelector(".clock-weather");
        const glassLines = [...container.querySelectorAll(".clock-glass-line")];
        const glassArea = container.querySelector(".clock-glass-line--date");
        const planets = [...document.querySelectorAll(".space-scene__planet")];
        const originals = planets.map(planet => planet.getBoundingClientRect);
        const target = glassArea.getBoundingClientRect();
        planets.forEach((planet, index) => {
            planet.getBoundingClientRect = () => index ? {
                left: -1000, right: -900, top: -1000, bottom: -900
            } : target;
        });
        globalThis.planetClockGlass.refresh();
        setTimeout(() => {
            const glass = getComputedStyle(glassArea, "::before");
            const text = getComputedStyle(glassArea);
            const backgroundValues = glass.backgroundColor.startsWith("rgba(") ?
                glass.backgroundColor.slice(5, -1).split(",").map(Number) : [];
            const valid = glassArea.classList.contains("is-planet-behind") &&
                glassLines.filter(line => line !== glassArea)
                    .every(line => !line.classList.contains("is-planet-behind")) &&
                glass.backdropFilter === "blur(6px)" &&
                backgroundValues[0] === 15 && backgroundValues[1] === 18 &&
                backgroundValues[2] === 35 && backgroundValues[3] > 0 &&
                backgroundValues[3] <= .06 &&
                Math.abs(parseFloat(glass.opacity) - 1) < .01 &&
                text.filter === "none";
            planets.forEach((planet, index) => planet.getBoundingClientRect = originals[index]);
            globalThis.planetClockGlass.refresh();
            resolve(valid);
        }, 260);
    })`,
    awaitPromise: true,
    returnByValue: true
});
state.clockGlassEffect = clockGlassEffectResult.result.value;
const searchInteractionResult = await call("Runtime.evaluate", {
    expression: `new Promise(resolve => {
        const area = document.querySelector(".orbital-search-area");
        const trigger = document.querySelector(".orbital-search-trigger");
        const input = document.querySelector(".search-form input");
        trigger.click();
        requestAnimationFrame(() => {
            const opened = area.classList.contains("search-area--expanded") &&
                trigger.getAttribute("aria-expanded") === "true" &&
                document.body.classList.contains("search-focus-active") &&
                document.activeElement === input;
            document.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true
            }));
            resolve(opened && !area.classList.contains("search-area--expanded") &&
                trigger.getAttribute("aria-expanded") === "false" &&
                !document.body.classList.contains("search-focus-active"));
        });
    })`,
    awaitPromise: true,
    returnByValue: true
});
state.searchInteraction = searchInteractionResult.result.value;
const bookmarkFlowResult = await call("Runtime.evaluate", {
    expression: `new Promise(async resolve => {
        const settle = (delay = 360) => new Promise(done => requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(done, delay))));
        const originalLayout = layout.map(item => ({ ...item }));
        const originalSettings = { ...settings };
        const originalUpdatedAt = dashboardStateUpdatedAt;
        const checks = {};
        try {
            const folder = await chrome.bookmarks.create({
                parentId: "1",
                title: "Orbitella Audit Folder"
            });
            const first = await chrome.bookmarks.create({
                parentId: folder.id,
                title: "Audit First",
                url: "https://example.com/audit-first"
            });
            const second = await chrome.bookmarks.create({
                parentId: folder.id,
                title: "Audit Second",
                url: "https://example.com/audit-second"
            });
            const nested = await chrome.bookmarks.create({
                parentId: folder.id,
                title: "Audit Nested"
            });
            await settle();
            checks.created = Boolean(findBookmark(folder.id)?.children &&
                findBookmark(first.id)?.parentId === folder.id &&
                findBookmark(second.id)?.parentId === folder.id &&
                new Set(bookmarks.map(item => item.id)).size === bookmarks.length);

            await chrome.bookmarks.update(first.id, {
                title: "Audit First Renamed",
                url: "https://example.com/audit-first-renamed"
            });
            await settle();
            checks.renamed = findBookmark(first.id)?.title === "Audit First Renamed" &&
                findBookmark(first.id)?.url.endsWith("audit-first-renamed");

            checks.reorderedInFolder = await moveItemWithinFolder(second.id, folder.id,
                first.id, false);
            const reorderedFolder = findBookmark(folder.id);
            checks.reorderedInFolder = checks.reorderedInFolder &&
                reorderedFolder.children.findIndex(item => item.id === second.id) <
                reorderedFolder.children.findIndex(item => item.id === first.id);

            checks.movedIntoFolder = await moveItemIntoFolder("11", folder.id);
            checks.movedIntoFolder = checks.movedIntoFolder &&
                findBookmark("11")?.parentId === folder.id &&
                !layout.some(item => item.id === "11");

            const treeBeforeInvalidMove = JSON.stringify(await chrome.bookmarks.getTree());
            const invalidMove = await moveItemIntoFolder(folder.id, nested.id);
            checks.invalidNestingBlocked = invalidMove === false &&
                JSON.stringify(await chrome.bookmarks.getTree()) === treeBeforeInvalidMove;

            checks.movedBackToDashboard = await moveItemToDashboard("11", "12",
                undefined, undefined, false);
            const movedBackOrder = [...layout].sort(compareDashboardLayoutItems)
                .map(item => item.id);
            checks.movedBackToDashboard = checks.movedBackToDashboard &&
                findBookmark("11")?.parentId === "1" &&
                movedBackOrder.indexOf("11") === movedBackOrder.indexOf("12") - 1;

            await moveBookmark("16", "12", undefined, undefined, false);
            const expectedOrder = [...layout].sort(compareDashboardLayoutItems)
                .map(item => item.id);
            const saved = await chrome.storage.local.get("dashboardLayout");
            const savedOrder = decodeDashboardLayout(saved.dashboardLayout)
                .sort(compareDashboardLayoutItems).map(item => item.id);
            checks.dashboardOrderSaved = expectedOrder.join("|") === savedOrder.join("|");

            folderPath = [folder.id];
            renderFolderBookmarks();
            await chrome.bookmarks.move(first.id, { parentId: folder.id, index: 0 });
            await settle();
            const renderedFolderOrder = [...folderGrid.querySelectorAll(":scope > .tile[data-id]")]
                .map(tile => tile.dataset.id);
            checks.externalReorderRendered = renderedFolderOrder[0] === first.id;

            await chrome.bookmarks.remove(first.id);
            await settle();
            checks.removed = !findBookmark(first.id) &&
                !folderGrid.querySelector('[data-id="' + first.id + '"]');

            const synchronized = createDashboardStateSnapshot(true);
            synchronized.dashboardSettings = {
                ...synchronized.dashboardSettings,
                showBookmarkTitles: !settings.showBookmarkTitles
            };
            synchronized.dashboardStateUpdatedAt = dashboardStateUpdatedAt + 1000;
            await saveDashboardSyncState(synchronized);
            await settle(520);
            checks.syncApplied = settings.showBookmarkTitles ===
                synchronized.dashboardSettings.showBookmarkTitles &&
                document.body.dataset.bookmarkTitlesVisible === String(settings.showBookmarkTitles);
        } catch (error) {
            checks.unexpectedError = error?.stack || String(error);
        } finally {
            __bookmarkMock.restore();
            await loadBookmarks();
            settings = originalSettings;
            dashboardStateUpdatedAt = Math.max(dashboardStateUpdatedAt, originalUpdatedAt) + 1;
            layout = originalLayout.map(item => ({ ...item }));
            updateBookmarkPositions();
            folderPath = [];
            if (folderDialog.open) folderDialog.close();
            applyBookmarkTitlesVisibility();
            renderBookmarks(false);
            await saveDashboardSettings();
            await settle();
        }
        checks.noDuplicates = new Set(bookmarks.map(item => item.id)).size === bookmarks.length;
        checks.restored = bookmarks.length === 6 && layout.length === 6;
        checks.ok = ["created", "renamed", "reorderedInFolder", "movedIntoFolder",
            "invalidNestingBlocked", "movedBackToDashboard", "dashboardOrderSaved",
            "externalReorderRendered", "removed", "syncApplied", "noDuplicates", "restored"]
            .every(key => checks[key] === true) && !checks.unexpectedError;
        resolve(checks);
    })`,
    awaitPromise: true,
    returnByValue: true
});
state.bookmarkFlow = bookmarkFlowResult.result.value;
const layoutStabilityResult = await call("Runtime.evaluate", {
    expression: `new Promise(async resolve => {
        const settle = (delay = 280) => new Promise(done => requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(done, delay))));
        const copyRect = element => {
            const bounds = element.getBoundingClientRect();
            return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
        };
        const sameRect = (first, second, tolerance = 1) =>
            ["left", "top", "width", "height"].every(key =>
                Math.abs(first[key] - second[key]) <= tolerance);
        const setCheckbox = async (id, checked) => {
            const input = document.getElementById(id);
            input.checked = checked;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            await settle();
        };
        const setTileSize = async value => {
            const select = document.getElementById("tile-size-select");
            select.value = value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await settle(340);
        };
        if (!document.getElementById("show-search").checked) {
            await setCheckbox("show-search", true);
        }
        if (!document.getElementById("show-bookmarks").checked) {
            await setCheckbox("show-bookmarks", true);
        }
        if (!document.getElementById("show-bookmark-titles").checked) {
            await setCheckbox("show-bookmark-titles", true);
        }
        if (document.getElementById("tile-size-select").value !== "small") {
            await setTileSize("small");
        }
        const sun = document.querySelector(".orbital-sun");
        const hero = document.querySelector(".hero-info");
        const grid = document.querySelector(".bookmark-grid");
        const initialSun = copyRect(sun);
        const initialHero = copyRect(hero);
        const initialGrid = copyRect(grid);

        await setCheckbox("show-search", false);
        const searchStable = sameRect(initialSun, copyRect(sun)) &&
            sameRect(initialHero, copyRect(hero)) && sameRect(initialGrid, copyRect(grid));
        await setCheckbox("show-search", true);

        const tileMetricsBefore = [...grid.querySelectorAll(".tile[data-id]")].map(tile => {
            const bounds = tile.getBoundingClientRect();
            return { id: tile.dataset.id, left: bounds.left, top: bounds.top,
                right: bounds.right, bottom: bounds.bottom,
                width: bounds.width, height: bounds.height };
        });
        const titledGap = carouselState.geometry.gap;
        const titledOrbitStep = carouselState.geometry.orbitStep;
        await setCheckbox("show-bookmark-titles", false);
        const tileMetricsAfter = [...grid.querySelectorAll(".tile[data-id]")].map(tile => {
            const bounds = tile.getBoundingClientRect();
            return { id: tile.dataset.id, left: bounds.left, top: bounds.top, right: bounds.right,
                width: bounds.width, height: bounds.height };
        });
        const beforeWidth = Math.max(...tileMetricsBefore.map(item => item.right)) -
            Math.min(...tileMetricsBefore.map(item => item.left));
        const afterWidth = Math.max(...tileMetricsAfter.map(item => item.right)) -
            Math.min(...tileMetricsAfter.map(item => item.left));
        const sizesStable = tileMetricsBefore.length === tileMetricsAfter.length &&
            tileMetricsBefore.every(before => {
                const after = tileMetricsAfter.find(item => item.id === before.id);
                return after && Math.abs(before.width - after.width) <= 1 &&
                    Math.abs(before.height - after.height) <= 1;
            });
        const positionsStable = tileMetricsBefore.length === tileMetricsAfter.length &&
            tileMetricsBefore.every(before => {
                const after = tileMetricsAfter.find(item => item.id === before.id);
                return after && Math.abs(before.left - after.left) <= 1 &&
                    Math.abs(before.top - after.top) <= 1;
            });
        const compactGap = carouselState.geometry.gap;
        const compactOrbitStep = carouselState.geometry.orbitStep;
        const compactCentered =
            Math.abs((Math.max(...tileMetricsAfter.map(item => item.right)) +
                Math.min(...tileMetricsAfter.map(item => item.left))) / 2 - innerWidth / 2) <= 24;
        const adaptiveTitleSpacing = compactGap < titledGap &&
            compactOrbitStep < titledOrbitStep;
        await setCheckbox("show-search", false);
        scheduleOrbitalLayout();
        await settle();
        const compactSearchHiddenStable = [...grid.querySelectorAll(".tile[data-id]")]
            .every(tile => {
                const before = tileMetricsAfter.find(item => item.id === tile.dataset.id);
                const bounds = tile.getBoundingClientRect();
                return before && Math.abs(before.left - bounds.left) <= 1 &&
                    Math.abs(before.top - bounds.top) <= 1;
            });
        await setCheckbox("show-search", true);
        scheduleOrbitalLayout();
        await settle();
        const titlesHidden = [...grid.querySelectorAll(".tile-title")]
            .every(title => getComputedStyle(title).display === "none");
        await setCheckbox("show-bookmark-titles", true);
        const titleModeRestored = [...grid.querySelectorAll(".tile[data-id]")].every(tile => {
            const before = tileMetricsBefore.find(item => item.id === tile.dataset.id);
            const bounds = tile.getBoundingClientRect();
            return before && Math.abs(before.left - bounds.left) <= 1 &&
                Math.abs(before.width - bounds.width) <= 1;
        });
        const titlesCompact = sizesStable && adaptiveTitleSpacing && compactCentered &&
            compactSearchHiddenStable && titlesHidden && titleModeRestored;

        await setCheckbox("show-bookmarks", false);
        const hiddenOrbitDrop = innerHeight * .075;
        const baseOrbitLift = innerHeight * .018;
        const hiddenStable = sameRect(initialSun, copyRect(sun)) &&
            sameRect(initialHero, copyRect(hero)) &&
            Math.abs(globalThis.planetOrbitLayout.getShift() -
                (hiddenOrbitDrop - baseOrbitLift)) < .25;
        await setCheckbox("show-bookmarks", true);

        await setTileSize("extra-small");
        const extraSmallSun = copyRect(sun);
        const extraSmallShift = globalThis.planetOrbitLayout.getShift();
        const extraSmallDiameter = getDashboardTileDiameter();
        const extraSmallGap = carouselState.geometry.gap;
        const extraSmallOrbitStep = carouselState.geometry.orbitStep;
        await setTileSize("small");
        const smallShift = globalThis.planetOrbitLayout.getShift();
        const smallDiameter = getDashboardTileDiameter();
        const smallGap = carouselState.geometry.gap;
        const smallOrbitStep = carouselState.geometry.orbitStep;
        const tileSpacingAdaptive = smallDiameter + smallGap > extraSmallDiameter + extraSmallGap &&
            smallOrbitStep > extraSmallOrbitStep;
        const tileSizeStable = sameRect(initialSun, extraSmallSun) &&
            sameRect(initialSun, copyRect(sun)) && smallShift <= extraSmallShift + .25 &&
            tileSpacingAdaptive;
        await dashboardSettingsSaveQueue;
        const savedState = await chrome.storage.local.get("dashboardSettings");
        const settingsSaved = savedState.dashboardSettings?.language === "ru" &&
            savedState.dashboardSettings?.showSearch === true &&
            savedState.dashboardSettings?.showBookmarks === true &&
            savedState.dashboardSettings?.showBookmarkTitles === true &&
            savedState.dashboardSettings?.tileSize === "small";
        resolve({
            searchStable,
            titlesCompact,
            sizesStable,
            positionsStable,
            adaptiveTitleSpacing,
            compactCentered,
            compactSearchHiddenStable,
            titlesHidden,
            titleModeRestored,
            beforeWidth,
            afterWidth,
            afterCenter: (Math.max(...tileMetricsAfter.map(item => item.right)) +
                Math.min(...tileMetricsAfter.map(item => item.left))) / 2,
            viewportCenter: innerWidth / 2,
            hiddenStable,
            hiddenOrbitDrop,
            tileSizeStable,
            settingsSaved,
            extraSmallShift,
            smallShift,
            extraSmallGap,
            smallGap,
            extraSmallOrbitStep,
            smallOrbitStep,
            ok: searchStable && titlesCompact && hiddenStable && tileSizeStable && settingsSaved
        });
    })`,
    awaitPromise: true,
    returnByValue: true
});
state.layoutStability = layoutStabilityResult.result.value;
await call("Emulation.setDeviceMetricsOverride", {
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false
});
await call("Page.reload", { ignoreCache: true });
await new Promise(resolve => setTimeout(resolve, 1800));
const compactBookmarkCountsResult = await call("Runtime.evaluate", {
    expression: `new Promise(async resolve => {
        const settle = () => new Promise(done => requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(done, 80))));
        const originalBookmarks = bookmarks;
        const originalBookmarkIndex = bookmarkIndex;
        const originalLayout = layout.map(item => ({ ...item }));
        const originalShowTitles = settings.showBookmarkTitles;
        const originalTileSize = settings.tileSize;
        const measure = () => {
            const tileElements =
                [...document.querySelectorAll(".bookmark-grid .tile[data-id]")];
            const tiles = tileElements.map(tile => {
                    const bounds = tile.getBoundingClientRect();
                    return {
                        bounds,
                        arc: Number(tile.parentElement.dataset.arc),
                        slot: Number(tile.parentElement.dataset.slot)
                    };
                });
            const titleElements = tileElements.map(tile => tile.querySelector(".tile-title"))
                .filter(title => title && getComputedStyle(title).display !== "none");
            const intersects = (first, second) =>
                Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1 &&
                Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1;
            const titleTileOverlaps = titleElements.flatMap(title => {
                const titleBounds = title.getBoundingClientRect();
                const ownTile = title.closest(".tile");
                return tileElements.filter(tile => tile !== ownTile &&
                    intersects(titleBounds, tile.getBoundingClientRect())).map(tile => ({
                        title: title.textContent,
                        titleArc: Number(ownTile.parentElement.dataset.arc),
                        titleSlot: Number(ownTile.parentElement.dataset.slot),
                        tileArc: Number(tile.parentElement.dataset.arc),
                        tileSlot: Number(tile.parentElement.dataset.slot)
                    }));
            });
            const titleBounds = titleElements.map(title => title.getBoundingClientRect());
            const titleOverlaps = titleBounds.flatMap((first, index) =>
                titleBounds.slice(index + 1).filter(second => intersects(first, second)));
            const bounds = tiles.map(item => item.bounds);
            const left = Math.min(...bounds.map(item => item.left));
            const right = Math.max(...bounds.map(item => item.right));
            const gaps = bounds.flatMap((first, index) => bounds.slice(index + 1)
                .map(second => Math.hypot(
                    first.left + first.width / 2 - second.left - second.width / 2,
                    first.top + first.height / 2 - second.top - second.height / 2
                ) - (first.width + second.width) / 2));
            const slotGaps = tiles.flatMap((item, index) => tiles.slice(index + 1)
                .filter(other => item.arc === other.arc && Math.abs(item.slot - other.slot) === 1)
                .map(other => Math.hypot(
                    item.bounds.left + item.bounds.width / 2 -
                        other.bounds.left - other.bounds.width / 2,
                    item.bounds.top + item.bounds.height / 2 -
                        other.bounds.top - other.bounds.height / 2
                ) - (item.bounds.width + other.bounds.width) / 2));
            const gridBounds = document.querySelector(".bookmark-grid").getBoundingClientRect();
            const sunBounds = document.querySelector(".orbital-sun").getBoundingClientRect();
            const sunGeometry = getOrbitalSunCollisionGeometry();
            const sunGap = Math.max(6, carouselState.geometry.tileDiameter * .12) + 2;
            const clearsSun = item => {
                const boundary = getOrbitalSunBoundaryY(sunGeometry, item.left, item.right);
                return !Number.isFinite(boundary) || item.bottom <= boundary - sunGap + 1;
            };
            const avoidsSun = bounds.every(clearsSun) && titleBounds.every(clearsSun);
            const sunConflicts = [...bounds, ...titleBounds].filter(item => !clearsSun(item)).map(item => ({
                    left: item.left, right: item.right, top: item.top, bottom: item.bottom
                }));
            const lowerArcSlots = Array.from({ length: getDashboardActiveArcCount() }, (_, arc) => {
                const capacity = getDashboardArcCapacity(arc);
                const cells = [...document.querySelectorAll(
                    '.bookmark-grid > .grid-cell[data-arc="' + arc + '"]')];
                const occupied = layout.filter(item => Number(item.arc) === arc)
                    .sort((first, second) => first.order - second.order)
                    .map(item => Number(item.slot));
                const expected = getDashboardArcFillOrder(arc).slice(0, occupied.length);
                const edgePoints = [0, capacity - 1]
                    .map(slot => carouselState.geometry.slotMap.get(getDashboardSlotKey(arc, slot)));
                const edgeBottom = gridBounds.top + Math.max(...edgePoints.map(point => point.y)) +
                    carouselState.geometry.tileDiameter / 2 + getDashboardBookmarkTitleRoom();
                return {
                    arc,
                    allRendered: cells.length === capacity,
                    endpointsPresent: [0, capacity - 1].every(slot =>
                        cells.some(cell => Number(cell.dataset.slot) === slot)),
                    followsFillOrder: occupied.every((slot, index) => slot === expected[index]),
                    emptySlotsAvailable: cells.some(cell =>
                        cell.querySelector(":scope > .empty-tile")),
                    edgeBottomGap: innerHeight - edgeBottom
                };
            });
            return {
                bounds,
                width: right - left,
                gap: carouselState.geometry.gap,
                orbitStep: carouselState.geometry.orbitStep,
                overlaps: gaps.filter(gap => gap < -.5).length,
                titleOverlaps: titleTileOverlaps.length + titleOverlaps.length,
                titleTileOverlaps: titleTileOverlaps.length,
                titleTextOverlaps: titleOverlaps.length,
                titleOverlapDetails: titleTileOverlaps.slice(0, 8),
                avoidsSun,
                sunConflicts,
                sunBounds: {
                    left: sunBounds.left, right: sunBounds.right,
                    top: sunBounds.top, bottom: sunBounds.bottom
                },
                gridTop: gridBounds.top,
                geometry: {
                    height: carouselState.geometry.height,
                    tileDiameter: carouselState.geometry.tileDiameter,
                    tileScale: carouselState.geometry.tileScale,
                    titleScale: carouselState.geometry.titleScale,
                    centerY: carouselState.geometry.centerY,
                    bounds: carouselState.geometry.bounds
                },
                minimumGap: gaps.length ? Math.min(...gaps) : null,
                slotGaps,
                lowerSlots: {
                    arcs: lowerArcSlots,
                    allRendered: lowerArcSlots.every(arc => arc.allRendered),
                    endpointsPresent: lowerArcSlots.every(arc => arc.endpointsPresent),
                    followsFillOrder: lowerArcSlots.every(arc => arc.followsFillOrder),
                    emptySlotsAvailable: lowerArcSlots.some(arc => arc.emptySlotsAvailable),
                    minimumEdgeBottomGap: Math.min(...lowerArcSlots.map(arc => arc.edgeBottomGap)),
                    maximumEdgeBottomGap: Math.max(...lowerArcSlots.map(arc => arc.edgeBottomGap))
                }
            };
        };
        const results = [];
        const largeResults = [];
        try {
            for (let count = 1; count <= originalBookmarks.length; count += 1) {
                bookmarks = originalBookmarks.slice(0, count);
                bookmarkIndex = new Map(bookmarks.map(bookmark => [bookmark.id, bookmark]));
                const visibleIds = new Set(bookmarks.map(bookmark => bookmark.id));
                layout = originalLayout.filter(item => visibleIds.has(item.id))
                    .map(item => ({ ...item }));
                updateBookmarkPositions();
                settings.showBookmarkTitles = true;
                applyBookmarkTitlesVisibility();
                renderBookmarks(false);
                await settle();
                const titled = measure();
                settings.showBookmarkTitles = false;
                applyBookmarkTitlesVisibility();
                renderBookmarks(false);
                await settle();
                const compact = measure();
                results.push({
                    count,
                    titledWidth: titled.width,
                    compactWidth: compact.width,
                    sameSizes: titled.bounds.length === compact.bounds.length &&
                        titled.bounds.every((item, index) =>
                            Math.abs(item.width - compact.bounds[index].width) <= 1 &&
                            Math.abs(item.height - compact.bounds[index].height) <= 1),
                    samePositions: titled.bounds.length === compact.bounds.length &&
                        titled.bounds.every((item, index) =>
                            Math.abs(item.left - compact.bounds[index].left) <= 1 &&
                            Math.abs(item.top - compact.bounds[index].top) <= 1),
                    adaptiveSpacing: compact.gap < titled.gap &&
                        compact.orbitStep < titled.orbitStep,
                    compactNotWider: compact.width <= titled.width + 1,
                    noOverlaps: compact.overlaps === 0,
                    avoidsSun: titled.avoidsSun && compact.avoidsSun,
                    comfortableGap: count === 1 || compact.minimumGap >= 7.5,
                    minimumGap: compact.minimumGap,
                    titledSlotGaps: titled.slotGaps,
                    compactSlotGaps: compact.slotGaps,
                    titledGap: titled.gap,
                    compactGap: compact.gap,
                    lowerSlots: titled.lowerSlots,
                    orbitSteps: { titled: titled.orbitStep, compact: compact.orbitStep }
                });
            }
            for (const tileSize of ["extra-small", "small"]) {
                settings.tileSize = tileSize;
                for (const count of [9, 12, 18, 24]) {
                    bookmarks = Array.from({ length: count }, (_, index) => ({
                        ...originalBookmarks[index % originalBookmarks.length],
                        id: tileSize + "-spacing-" + index,
                        title: "Длинное название " + index,
                        url: "https://example.com/spacing-" + index,
                        syncKey: "bookmark:" + tileSize + "-spacing-" + index
                    }));
                    bookmarkIndex = new Map(bookmarks.map(bookmark => [bookmark.id, bookmark]));
                    layout = [];
                    updateBookmarkPositions();
                    for (const showTitles of [true, false]) {
                        settings.showBookmarkTitles = showTitles;
                        applyBookmarkTitlesVisibility();
                        renderBookmarks(false);
                        await settle();
                        const measured = measure();
                        largeResults.push({
                            tileSize,
                            count,
                            showTitles,
                            noOverlaps: measured.overlaps === 0,
                            noTitleOverlaps: measured.titleOverlaps === 0,
                            avoidsSun: measured.avoidsSun,
                            sunConflicts: measured.sunConflicts,
                            sunBounds: measured.sunBounds,
                            gridTop: measured.gridTop,
                            geometry: measured.geometry,
                            titleTileOverlaps: measured.titleTileOverlaps,
                            titleTextOverlaps: measured.titleTextOverlaps,
                            titleOverlapDetails: measured.titleOverlapDetails,
                            gap: measured.gap,
                            slotGaps: measured.slotGaps
                        });
                    }
                }
            }
        } finally {
            bookmarks = originalBookmarks;
            bookmarkIndex = originalBookmarkIndex;
            layout = originalLayout;
            settings.showBookmarkTitles = originalShowTitles;
            settings.tileSize = originalTileSize;
            applyBookmarkTitlesVisibility();
            renderBookmarks(false);
            await settle();
            // ждем выравнивание орбит после восстановления
            await new Promise(done => setTimeout(done, 260));
        }
        const fixedSpacing = results.every(item =>
            item.titledSlotGaps.every(gap => Math.abs(gap - item.titledGap) <= 2) &&
            item.compactSlotGaps.every(gap => Math.abs(gap - item.compactGap) <= 2));
        const largeFixedSpacing = largeResults.every(item => item.noOverlaps &&
            item.noTitleOverlaps && item.avoidsSun &&
            item.slotGaps.length > 0 && item.slotGaps.every(gap =>
                Math.abs(gap - item.gap) <= 2));
        resolve({
            results,
            largeResults,
            fixedSpacing,
            ok: results.length === originalBookmarks.length &&
                results.every(item => item.sameSizes && item.adaptiveSpacing &&
                    item.compactNotWider && item.noOverlaps && item.comfortableGap &&
                    item.avoidsSun &&
                    item.lowerSlots.allRendered && item.lowerSlots.endpointsPresent &&
                    item.lowerSlots.followsFillOrder) &&
                results.some(item => item.lowerSlots.emptySlotsAvailable) &&
                fixedSpacing && largeFixedSpacing
        });
    })`,
    awaitPromise: true,
    returnByValue: true
});
state.compactBookmarkCounts = compactBookmarkCountsResult.result.value;
const orbitCoverageResult = await call("Runtime.evaluate", {
    expression: `(() => {
        const planets = [...document.querySelectorAll(".space-scene__planet")];
        const states = globalThis.planetWrapSystem.getStates();
        const entries = planets.map((planet, index) => ({ planet, state: states[index],
            animation: states[index]?.animation }));
        const originalTimes = entries.map(entry => entry.animation?.currentTime ?? 0);
        const getVisualBounds = planet => {
            const bounds = [planet, ...planet.querySelectorAll(".space-scene__earth-moon")]
                .map(item => item.getBoundingClientRect());
            return {
                left: Math.min(...bounds.map(item => item.left)),
                right: Math.max(...bounds.map(item => item.right)),
                top: Math.min(...bounds.map(item => item.top)),
                bottom: Math.max(...bounds.map(item => item.bottom))
            };
        };
        const edgeTolerance = 2;
        const outsideSide = bounds => bounds.right <= edgeTolerance ? "left" :
            bounds.left >= innerWidth - edgeTolerance ? "right" :
            bounds.bottom <= edgeTolerance ? "top" :
                bounds.top >= innerHeight - edgeTolerance ? "bottom" : "";
        const holdIsThirtySeconds = entries.every(({ state }) => state &&
            Math.abs(state.cycleDuration - state.visibleDuration - 30000) < 1);
        const transformOnly = entries.every(({ animation }) => {
            const frames = animation.effect.getKeyframes();
            return frames.length > 360 && frames.every(frame => frame.transform &&
                frame.opacity === undefined) && frames.at(-2).easing.startsWith("steps(1");
        });
        const physicalWrapChecks = entries.map(({ planet, animation, state }) => {
            animation.currentTime = 0;
            const startBounds = getVisualBounds(planet);
            const startSide = outsideSide(startBounds);
            animation.currentTime = state.visibleDuration + 1000;
            const exitBounds = getVisualBounds(planet);
            const exitSide = outsideSide(exitBounds);
            const oppositeHorizontalHalves =
                ((startBounds.left + startBounds.right) / 2 - innerWidth / 2) *
                ((exitBounds.left + exitBounds.right) / 2 - innerWidth / 2) < 0;
            return {
                planet: planet.className,
                startSide,
                exitSide,
                oppositeHorizontalHalves,
                startBounds,
                exitBounds,
                ok: Boolean(startSide && exitSide &&
                    (startSide !== exitSide || oppositeHorizontalHalves))
            };
        });
        const physicalWrap = physicalWrapChecks.every(check => check.ok);
        const fixedNow = Date.UTC(2026, 6, 15, 12, 0, 0);
        globalThis.planetWrapSystem.synchronize(fixedNow);
        const firstSync = entries.map(entry => entry.animation.currentTime);
        globalThis.planetWrapSystem.synchronize(fixedNow);
        const deterministic = entries.every((entry, index) =>
            Math.abs(entry.animation.currentTime - firstSync[index]) < 1);
        globalThis.planetWrapSystem.synchronize(fixedNow + 15000);
        const advancesByTime = entries.every((entry, index) => {
            const expected = (firstSync[index] + 15000) % entry.state.cycleDuration;
            return Math.abs(entry.animation.currentTime - expected) < 2;
        });
        let minimumVisible = entries.length;
        let firstEmptySecond = null;
        for (let milliseconds = 0; milliseconds <= 2 * 60 * 60 * 1000;
            milliseconds += 5000) {
            globalThis.planetWrapSystem.synchronize(Date.UTC(2024, 0, 1) + milliseconds);
            const visible = entries.filter(({ planet }) => {
                const bounds = getVisualBounds(planet);
                return bounds.right > 0 && bounds.left < innerWidth &&
                    bounds.bottom > 0 && bounds.top < innerHeight;
            }).length;
            minimumVisible = Math.min(minimumVisible, visible);
            if (!visible && firstEmptySecond === null) firstEmptySecond = milliseconds / 1000;
        }
        entries.forEach((entry, index) => { entry.animation.currentTime = originalTimes[index]; });
        globalThis.planetWrapSystem.synchronize();
        const earth = entries.find(entry =>
            entry.planet.classList.contains("space-scene__planet--earth"));
        const moonIncluded = earth?.state.extent > parseFloat(getComputedStyle(earth.planet).width) / 2;
        return { minimumVisible, firstEmptySecond, holdIsThirtySeconds,
            transformOnly, physicalWrap, physicalWrapChecks, deterministic, advancesByTime,
            moonIncluded };
    })()`,
    returnByValue: true
});
state.orbitCoverage = orbitCoverageResult.result.value;
state.responsive = true;
state.responsiveChecks = [];
for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 720, height: 500 },
    { width: 768, height: 1024 },
    { width: 964, height: 727 },
    { width: 988, height: 392 },
    { width: 990, height: 768 },
    { width: 1024, height: 768 },
    { width: 1024, height: 768, scale: 1.25 },
    { width: 1122, height: 544 },
    { width: 1366, height: 768 },
    { width: 1366, height: 768, scale: 1.5 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1920, height: 1080, scale: 2 },
    { width: 2560, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 3840, height: 2160 }
]) {
    await call("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.scale || 1,
        mobile: false
    });
    await call("Page.reload", { ignoreCache: true });
    await new Promise(resolve => setTimeout(resolve, 1800));
    const responsiveResult = await call("Runtime.evaluate", {
        expression: `(() => {
            const scene = document.querySelector(".space-scene").getBoundingClientRect();
            const backdrop = getComputedStyle(document.querySelector(".space-scene__backdrop"));
            const sun = document.querySelector(".orbital-sun").getBoundingClientRect();
            const hero = document.querySelector(".hero-info").getBoundingClientRect();
            const clock = document.querySelector(".clock-weather-content").getBoundingClientRect();
            const searchTrigger = document.querySelector(".orbital-search-trigger");
            const searchIcon = searchTrigger.querySelector(".search-icon").getBoundingClientRect();
            const searchLabel = searchTrigger.querySelector("span").getBoundingClientRect();
            const searchContent = {
                left: Math.min(searchIcon.left, searchLabel.left),
                right: Math.max(searchIcon.right, searchLabel.right),
                top: Math.min(searchIcon.top, searchLabel.top),
                bottom: Math.max(searchIcon.bottom, searchLabel.bottom)
            };
            const bookmarkTileElements = [...document.querySelectorAll(".bookmark-grid .tile[data-id]")]
                .filter(tile => getComputedStyle(tile).visibility !== "hidden");
            const bookmarkTiles = bookmarkTileElements.map(tile => tile.getBoundingClientRect());
            const bookmarkTitleElements =
                [...document.querySelectorAll(".bookmark-grid .tile-title")]
                    .filter(title => getComputedStyle(title).display !== "none");
            const bookmarkTitles = bookmarkTitleElements.map(title => title.getBoundingClientRect());
            const bookmarkGridElement = document.querySelector(".bookmark-grid");
            const isClippedByAncestor = element => {
                const bounds = element.getBoundingClientRect();
                for (let ancestor = element.parentElement; ancestor && ancestor !== document.body;
                    ancestor = ancestor.parentElement) {
                    const style = getComputedStyle(ancestor);
                    if (![style.overflowX, style.overflowY].some(value =>
                        value === "hidden" || value === "clip")) continue;
                    const clipBounds = ancestor.getBoundingClientRect();
                    if (bounds.left < clipBounds.left - 1 || bounds.right > clipBounds.right + 1 ||
                        bounds.top < clipBounds.top - 1 || bounds.bottom > clipBounds.bottom + 1) {
                        return true;
                    }
                }
                return false;
            };
            const bookmarkClipSafe = getComputedStyle(bookmarkGridElement).overflow === "visible" &&
                [...bookmarkTileElements, ...bookmarkTitleElements]
                    .every(element => !isClippedByAncestor(element));
            const intersects = (first, second) =>
                Math.min(first.right, second.right) - Math.max(first.left, second.left) > 1 &&
                Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > 1;
            const bookmarkTitleTileOverlaps = bookmarkTitleElements.flatMap(title => {
                const titleBounds = title.getBoundingClientRect();
                const ownTile = title.closest(".tile");
                return bookmarkTileElements.filter(tile => tile !== ownTile &&
                    intersects(titleBounds, tile.getBoundingClientRect())).map(tile => ({
                        title: title.textContent,
                        titleBounds: {
                            left: titleBounds.left, right: titleBounds.right,
                            top: titleBounds.top, bottom: titleBounds.bottom
                        },
                        tile: tile.dataset.id,
                        tileBounds: (() => {
                            const bounds = tile.getBoundingClientRect();
                            return { left: bounds.left, right: bounds.right,
                                top: bounds.top, bottom: bounds.bottom };
                        })()
                    }));
            });
            const bookmarkTitleOverlaps = bookmarkTitles.flatMap((first, index) =>
                bookmarkTitles.slice(index + 1).filter(second => intersects(first, second)));
            const bookmarkTitleOverlapDetails = bookmarkTitleElements.flatMap((title, index) => {
                const first = title.getBoundingClientRect();
                return bookmarkTitleElements.slice(index + 1).flatMap(other =>
                    intersects(first, other.getBoundingClientRect()) ? [{
                        first: title.textContent,
                        second: other.textContent,
                        firstBounds: {
                            left: first.left, right: first.right,
                            top: first.top, bottom: first.bottom
                        },
                        secondBounds: (() => {
                            const second = other.getBoundingClientRect();
                            return { left: second.left, right: second.right,
                                top: second.top, bottom: second.bottom };
                        })()
                    }] : []);
            });
            const bookmarkExtents = {
                left: Math.min(...bookmarkTiles.map(bounds => bounds.left)),
                right: Math.max(...bookmarkTiles.map(bounds => bounds.right)),
                top: Math.min(...bookmarkTiles.map(bounds => bounds.top)),
                bottom: Math.max(...bookmarkTiles.map(bounds => bounds.bottom))
            };
            const bookmarkOverlaps = bookmarkTiles.flatMap((first, index) =>
                bookmarkTiles.slice(index + 1).filter(second => {
                    const distance = Math.hypot(
                        first.left + first.width / 2 - second.left - second.width / 2,
                        first.top + first.height / 2 - second.top - second.height / 2
                    );
                    return distance < (first.width + second.width) / 2 + 1;
                }).map(() => index));
            const bookmarkSafe = bookmarkTiles.every(bounds =>
                bounds.left >= -1 && bounds.right <= innerWidth + 1 &&
                bounds.top >= -1 && bounds.bottom <= innerHeight + 1) &&
                bookmarkTitles.every(bounds => bounds.left >= -1 && bounds.right <= innerWidth + 1) &&
                bookmarkOverlaps.length === 0 && bookmarkTitleTileOverlaps.length === 0 &&
                bookmarkTitleOverlaps.length === 0;
            const clockSafe = hero.top >= -1 && clock.top >= -1 && clock.bottom <= innerHeight + 1 &&
                Math.abs((hero.left + hero.right) / 2 - innerWidth / 2) < 1 &&
                hero.top >= innerHeight * .045 && hero.top <= innerHeight * .075 + 1;
            const bookmarkClearOfHero = [...bookmarkTiles, ...bookmarkTitles]
                .every(bounds => bounds.top >= hero.bottom - 1);
            const sunGeometry = getOrbitalSunCollisionGeometry();
            const sunGap = Math.max(6, carouselState.geometry.tileDiameter * .12) + 2;
            const clearsSun = bounds => {
                const boundary = getOrbitalSunBoundaryY(sunGeometry, bounds.left, bounds.right);
                return !Number.isFinite(boundary) || bounds.bottom <= boundary - sunGap + 1;
            };
            const bookmarkSunSafe = [...bookmarkTiles, ...bookmarkTitles].every(clearsSun);
            const bookmarkVisualBottom = Math.max(...[...bookmarkTiles, ...bookmarkTitles]
                .map(bounds => bounds.bottom));
            const bookmarkSunGap = sun.top - bookmarkVisualBottom;
            const bookmarkCloseToSun = bookmarkSunGap <=
                Math.max(12, Math.min(innerWidth, innerHeight) * .025);
            const geometry = carouselState.geometry;
            const orbitStepRegular = geometry.arcs.every((arc, index) =>
                arc.verticalOffsetY === 0 && (!index ||
                    Math.abs(arc.radiusX - geometry.arcs[index - 1].radiusX -
                        geometry.orbitStep) < .1));
            const pointsOnArcs = [...geometry.slotMap.values()].every(point => {
                const arc = geometry.arcs[point.arc];
                const expected = orbitalSystem.getPoint(arc.radiusX, point.angle,
                    geometry, geometry.centerX, geometry.centerY);
                return Math.hypot(point.x - expected.x, point.y - expected.y) < .1;
            });
            const occupiedArcPoints = new Map();
            [...layout].forEach(item => {
                const point = geometry.slotMap.get(getDashboardSlotKey(item.arc, item.slot));
                if (!point) return;
                if (!occupiedArcPoints.has(item.arc)) occupiedArcPoints.set(item.arc, []);
                occupiedArcPoints.get(item.arc).push(point);
            });
            const smoothBookmarkArcs = [...occupiedArcPoints.values()].every(points => {
                if (points.length < 3) return true;
                const verticalCurve = Math.max(...points.map(point => point.y)) -
                    Math.min(...points.map(point => point.y));
                return verticalCurve >= geometry.tileDiameter * .1;
            });
            const centeredBookmarkArcs = [...occupiedArcPoints.values()].every(points => {
                if (points.length < 2) return true;
                const horizontalCenter = (Math.min(...points.map(point => point.x)) +
                    Math.max(...points.map(point => point.x))) / 2;
                return Math.abs(horizontalCenter - geometry.centerX) <=
                    (geometry.tileDiameter + geometry.gap) / 2 + 1;
            });
            const expectedPackedSlots = getDashboardPackedSlots(layout.length);
            const denseLayout = [...layout].sort((first, second) => first.order - second.order)
                .every((item, order) => item.arc === expectedPackedSlots[order]?.arc &&
                    item.slot === expectedPackedSlots[order]?.slot);
            const sharedGeometry = orbitalSystem.readGeometry();
            const responsiveExtent = Math.min(innerWidth, innerHeight);
            const firstPlanetOrbitTop = sharedGeometry.centerY +
                globalThis.planetOrbitLayout.getShift() -
                getOrbitVerticalExtent(sharedGeometry.planetMinimumRadius, sharedGeometry);
            const planetOrbitsAboveBookmarks = firstPlanetOrbitTop <=
                bookmarkExtents.top - responsiveExtent * PLANET_ORBIT_BOOKMARK_GAP_RATIO + 1;
            const fixedBookmarkScale = Math.abs(geometry.tileScale - 1) < .001 &&
                Math.abs(geometry.titleScale - 1) < .001;
            const copyBounds = bounds => ({
                left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
                width: bounds.width, height: bounds.height
            });
            const bookmarkUnsafeTiles = bookmarkTiles.filter(bounds =>
                bounds.left < -1 || bounds.right > innerWidth + 1 ||
                bounds.top < -1 || bounds.bottom > innerHeight + 1).map(copyBounds);
            const bookmarkUnsafeTitles = bookmarkTitles.filter(bounds =>
                bounds.left < -1 || bounds.right > innerWidth + 1).map(copyBounds);
            const searchSafe = searchContent.top >= sun.top + 20 && searchContent.bottom <= sun.bottom &&
                bookmarkTiles.every(bounds => bounds.right <= searchContent.left ||
                    bounds.left >= searchContent.right || bounds.bottom <= searchContent.top ||
                    bounds.top >= searchContent.bottom);
            const planets = [...document.querySelectorAll(".space-scene__planet")];
            const visiblePlanets = planets.filter(planet => {
                const bounds = planet.getBoundingClientRect();
                return bounds.right > 0 && bounds.left < innerWidth &&
                    bounds.bottom > 0 && bounds.top < innerHeight;
            }).map(planet => planet.className);
            const overlaps = planets.flatMap((planet, index) => {
                const first = planet.getBoundingClientRect();
                return planets.slice(index + 1).flatMap(other => {
                    const second = other.getBoundingClientRect();
                    const distance = Math.hypot(
                        first.left + first.width / 2 - second.left - second.width / 2,
                        first.top + first.height / 2 - second.top - second.height / 2
                    );
                    if (distance >= (first.width + second.width) / 2) return [];
                    return [{
                        first: planet.className,
                        second: other.className,
                        distance,
                        minimumDistance: (first.width + second.width) / 2
                    }];
                });
            });
            const checks = {
                viewport: innerWidth === ${viewport.width} && innerHeight === ${viewport.height},
                scene: Math.abs(scene.width - innerWidth) < 1 &&
                    Math.abs(scene.height - innerHeight) < 1,
                backdrop: backdrop.backgroundSize === "cover",
                planetCount: planets.length === 8,
                planetImages: planets.every(planet => parseFloat(getComputedStyle(planet).opacity) > .5 &&
                    getComputedStyle(planet).backgroundImage.includes(".webp") &&
                    getComputedStyle(planet).filter === "none"),
                visiblePlanets,
                overlaps,
                bookmarkSafe,
                bookmarkClipSafe,
                bookmarkSunSafe,
                bookmarkCloseToSun,
                bookmarkSunGap,
                clockSafe,
                bookmarkClearOfHero,
                orbitStepRegular,
                pointsOnArcs,
                smoothBookmarkArcs,
                centeredBookmarkArcs,
                denseLayout,
                planetOrbitsAboveBookmarks,
                fixedBookmarkScale,
                bookmarkExtents,
                geometryBounds: carouselState.geometry?.bounds,
                geometryHeight: carouselState.geometry?.height,
                planetOrbitShift: globalThis.planetOrbitLayout?.getShift(),
                gridTop: document.querySelector(".bookmark-grid").getBoundingClientRect().top,
                bookmarkOverlaps,
                bookmarkTitleTileOverlaps: bookmarkTitleTileOverlaps.length,
                bookmarkTitleTileOverlapDetails: bookmarkTitleTileOverlaps,
                bookmarkTitleOverlaps: bookmarkTitleOverlaps.length,
                bookmarkTitleOverlapDetails,
                bookmarkUnsafeTiles,
                bookmarkUnsafeTitles,
                searchSafe,
                searchContent,
                sunBounds: copyBounds(sun),
                sun: sun.width > 0 && sun.bottom > innerHeight - 180,
                overflow: document.documentElement.scrollWidth <= innerWidth + 1
            };
            checks.ok = checks.viewport && checks.scene && checks.backdrop &&
                checks.planetCount && checks.planetImages &&
                checks.visiblePlanets.length >= 1 &&
                checks.bookmarkSafe && checks.bookmarkClipSafe && checks.bookmarkSunSafe &&
                checks.bookmarkCloseToSun &&
                checks.clockSafe &&
                checks.bookmarkClearOfHero && checks.searchSafe &&
                checks.orbitStepRegular && checks.pointsOnArcs && checks.smoothBookmarkArcs &&
                checks.centeredBookmarkArcs && checks.denseLayout &&
                checks.planetOrbitsAboveBookmarks && checks.fixedBookmarkScale &&
                checks.sun && checks.overflow;
            return checks;
        })()`,
        returnByValue: true
    });
    const titleVisibilityResult = await call("Runtime.evaluate", {
        expression: `new Promise(async resolve => {
            const settle = () => new Promise(done => requestAnimationFrame(() =>
                requestAnimationFrame(() => setTimeout(done, 280))));
            const input = document.getElementById("show-bookmark-titles");
            const sizeSelect = document.getElementById("tile-size-select");
            const setTitles = async visible => {
                input.checked = visible;
                input.dispatchEvent(new Event("change", { bubbles: true }));
                await settle();
            };
            const setSize = async size => {
                sizeSelect.value = size;
                sizeSelect.dispatchEvent(new Event("change", { bubbles: true }));
                await settle();
            };
            const measure = () => {
                const tiles = [...document.querySelectorAll(".bookmark-grid .tile[data-id]")];
                const bounds = tiles.map(tile => tile.getBoundingClientRect());
                const overlaps = bounds.flatMap((first, index) => bounds.slice(index + 1)
                    .filter(second => Math.hypot(
                        first.left + first.width / 2 - second.left - second.width / 2,
                        first.top + first.height / 2 - second.top - second.height / 2
                    ) < (first.width + second.width) / 2 - .5));
                return {
                    positions: bounds.map(item => ({ left: item.left, top: item.top })),
                    width: Math.max(...bounds.map(item => item.right)) -
                        Math.min(...bounds.map(item => item.left)),
                    center: (Math.max(...bounds.map(item => item.right)) +
                        Math.min(...bounds.map(item => item.left))) / 2,
                    gap: carouselState.geometry.gap,
                    tileScale: carouselState.geometry.tileScale,
                    titleScale: carouselState.geometry.titleScale,
                    orbitStep: carouselState.geometry.orbitStep,
                    safe: bounds.every(item => item.left >= -1 && item.right <= innerWidth + 1 &&
                        item.top >= -1 && item.bottom <= innerHeight + 1),
                    overlaps: overlaps.length
                };
            };
            const modeIsSafe = (titledMode, compactMode) =>
                titledMode.positions.length === compactMode.positions.length &&
                Math.abs(compactMode.center - titledMode.center) <= 5 &&
                compactMode.safe && !compactMode.overlaps &&
                titledMode.safe && !titledMode.overlaps;
            await setTitles(true);
            const titled = measure();
            await setTitles(false);
            const compact = measure();
            await setTitles(true);
            const restored = measure();
            await setSize("extra-small");
            const extraSmallTitled = measure();
            await setTitles(false);
            const extraSmallCompact = measure();
            await setTitles(true);
            await setSize("small");
            const largeModeSafe = modeIsSafe(titled, compact);
            const smallModeSafe = modeIsSafe(extraSmallTitled, extraSmallCompact);
            const dragTargeting = (() => {
                const ordered = [...layout].sort((first, second) => first.order - second.order);
                const sourceId = ordered[0]?.id;
                const targetId = ordered.at(-1)?.id;
                if (!sourceId || !targetId || sourceId === targetId) return false;
                draggingId = sourceId;
                dragDashboardSnapshot = null;
                const snapshot = getDashboardSnapshot();
                const target = snapshot.items.find(item => item.id === targetId);
                const intent = target && resolveDashboardDropIntent({
                    clientX: target.rect.right - 1,
                    clientY: (target.rect.top + target.rect.bottom) / 2
                });
                finishDragSession();
                return intent?.targetId === targetId && intent.action === "after";
            })();
            resolve({
                titled,
                compact,
                restored,
                extraSmallTitled,
                extraSmallCompact,
                largeModeSafe,
                smallModeSafe,
                dragTargeting,
                ok: largeModeSafe && smallModeSafe && dragTargeting &&
                    titled.positions.every((item, index) =>
                        Math.abs(item.left - restored.positions[index].left) <= 1 &&
                        Math.abs(item.top - restored.positions[index].top) <= 1)
            });
        })`,
        awaitPromise: true,
        returnByValue: true
    });
    state.responsiveChecks.push({ dimensions: viewport, ...responsiveResult.result.value,
        titleVisibility: titleVisibilityResult.result.value });
    state.responsive = state.responsive && responsiveResult.result.value.ok &&
        titleVisibilityResult.result.value.ok;
}
const beforeReloadResult = await call("Runtime.evaluate", {
    expression: `(() => {
        globalThis.planetWrapSystem.synchronize();
        return {
            now: Date.now(),
            states: globalThis.planetWrapSystem.getStates().map(state => ({
                currentTime: state.animation.currentTime,
                cycleDuration: state.cycleDuration
            }))
        };
    })()`,
    returnByValue: true
});
await call("Page.reload");
await new Promise(resolve => setTimeout(resolve, 2400));
const afterReloadResult = await call("Runtime.evaluate", {
    expression: `(() => {
        globalThis.planetWrapSystem.synchronize();
        return {
            now: Date.now(),
            states: globalThis.planetWrapSystem.getStates().map(state => ({
                currentTime: state.animation.currentTime,
                cycleDuration: state.cycleDuration
            }))
        };
    })()`,
    returnByValue: true
});
const beforeReload = beforeReloadResult.result.value;
const afterReload = afterReloadResult.result.value;
const reloadElapsed = afterReload.now - beforeReload.now;
state.planetReloadContinuity = beforeReload.states.length === 8 &&
    afterReload.states.length === 8 && beforeReload.states.every((before, index) => {
        const after = afterReload.states[index];
        const expected = (before.currentTime + reloadElapsed) % before.cycleDuration;
        return Math.abs(after.currentTime - expected) < 80 &&
            Math.abs(after.cycleDuration - before.cycleDuration) < 1;
    });
await call("Emulation.clearDeviceMetricsOverride");
socket.close();

const valid = state?.title === "Orbitella" && state.scene && state.spaceBackground &&
    state.permanentCosmicScene && state.layoutStability?.ok && state.compactBookmarkCounts?.ok &&
    state.bookmarkFlow?.ok &&
    state.bookmarkGrid && state.clockGlass && state.clockGlassEffect && state.bookmarkCartoonStyle &&
    state.faviconSizing && state.faviconContrast &&
    state.bookmarkCentering && state.bookmarkTitleWrapping &&
    state.bookmarkOrbitLift && state.dragInsertionStability && state.dragClickGuard &&
    state.accessibility?.ok && state.weatherState?.ok &&
    state.settings?.ok && state.planets === 8 &&
    state.earthMoons === 1 && state.moonTexture && state.otherMoons === 0 &&
    state.staticStars && state.planetOrbitLayout && state.planetTextures && state.planetSizing &&
    state.planetAssetsLoaded &&
    state.planetImagesOriginal && state.sunTexture && state.sunLifted &&
    state.searchTriggerVisual && state.searchInteraction &&
    state.sunCapHeight >= 74 && !state.asteroidBelt && !state.animatedSun &&
    state.orbitalSystem && state.orbitCoverage?.minimumVisible >= 1 &&
    state.orbitCoverage?.firstEmptySecond === null &&
    state.orbitCoverage?.holdIsThirtySeconds && state.orbitCoverage?.transformOnly &&
    state.orbitCoverage?.physicalWrap && state.orbitCoverage?.deterministic &&
    state.orbitCoverage?.advancesByTime && state.orbitCoverage?.moonIncluded &&
    state.planetReloadContinuity &&
    state.responsive && !state.loading;
if (!valid || runtimeErrors.length) {
    const responsiveFailures = (state?.responsiveChecks || [])
        .filter(item => !item.ok || !item.titleVisibility?.ok)
        .map(item => ({
            dimensions: item.dimensions,
            layoutOk: item.ok,
            bookmarkSafe: item.bookmarkSafe,
            bookmarkClipSafe: item.bookmarkClipSafe,
            bookmarkSunSafe: item.bookmarkSunSafe,
            bookmarkCloseToSun: item.bookmarkCloseToSun,
            bookmarkSunGap: item.bookmarkSunGap,
            clockSafe: item.clockSafe,
            bookmarkClearOfHero: item.bookmarkClearOfHero,
            planetOrbitsAboveBookmarks: item.planetOrbitsAboveBookmarks,
            fixedBookmarkScale: item.fixedBookmarkScale,
            orbitStepRegular: item.orbitStepRegular,
            pointsOnArcs: item.pointsOnArcs,
            smoothBookmarkArcs: item.smoothBookmarkArcs,
            centeredBookmarkArcs: item.centeredBookmarkArcs,
            denseLayout: item.denseLayout,
            searchSafe: item.searchSafe,
            overflow: item.overflow,
            bookmarkExtents: item.bookmarkExtents,
            geometryBounds: item.geometryBounds,
            geometryHeight: item.geometryHeight,
            gridTop: item.gridTop,
            sunBounds: item.sunBounds,
            bookmarkUnsafeTiles: item.bookmarkUnsafeTiles,
            bookmarkUnsafeTitles: item.bookmarkUnsafeTitles,
            bookmarkOverlaps: item.bookmarkOverlaps,
            bookmarkTitleTileOverlaps: item.bookmarkTitleTileOverlaps,
            bookmarkTitleTileOverlapDetails: item.bookmarkTitleTileOverlapDetails,
            bookmarkTitleOverlaps: item.bookmarkTitleOverlaps,
            bookmarkTitleOverlapDetails: item.bookmarkTitleOverlapDetails,
            titleVisibility: item.titleVisibility
        }));
    console.error(JSON.stringify({
        core: {
            bookmarkFlow: state?.bookmarkFlow,
            layoutStability: state?.layoutStability,
            compactBookmarkCounts: state?.compactBookmarkCounts ? {
                ok: state.compactBookmarkCounts.ok,
                fixedSpacing: state.compactBookmarkCounts.fixedSpacing,
                failingResults: state.compactBookmarkCounts.results.filter(item =>
                    !(item.sameSizes && item.adaptiveSpacing && item.compactNotWider &&
                        item.noOverlaps && item.comfortableGap && item.avoidsSun &&
                        item.lowerSlots.allRendered && item.lowerSlots.endpointsPresent &&
                        item.lowerSlots.followsFillOrder)),
                failingLargeResults: state.compactBookmarkCounts.largeResults.filter(item =>
                    !(item.noOverlaps && item.noTitleOverlaps && item.avoidsSun &&
                        item.slotGaps.length > 0 && item.slotGaps.every(gap =>
                            Math.abs(gap - item.gap) <= 2)))
            } : null,
            orbitCoverage: state?.orbitCoverage,
            responsive: state?.responsive,
            planetReloadContinuity: state?.planetReloadContinuity
        },
        responsiveFailures,
        runtimeErrors
    }, null, 2));
    process.exit(1);
}

console.log("Browser runtime smoke test passed.");
