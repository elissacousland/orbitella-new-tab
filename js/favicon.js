// загрузка фавиконов

"use strict";

const faviconRequests = new Map();

const pendingFaviconUpgrades = new Set();

const faviconCacheName = "dashboard-favicons-v4";

const faviconCacheLifetime = 7 * 24 * 60 * 60 * 1000;

const faviconRequestTimeout = 8000;

const faviconPageMaxBytes = 1.5 * 1024 * 1024;

const faviconImageMaxBytes = 1024 * 1024;

const faviconStorageEntryMaxLength = 240000;

const faviconStorageMaxLength = 5 * 1024 * 1024;

const faviconStorageMaxEntries = 120;

const faviconCacheMaxEntries = 160;

const faviconStoragePrefix = "dashboardFaviconV4:";

const browserManagedFaviconHosts = new Set(["mega.io", "mega.nz"]);

let faviconStorageQueue = Promise.resolve();

function getFaviconUrl(pageUrl) {
    const faviconUrl = new URL(chrome.runtime.getURL("/_favicon/"));
    faviconUrl.searchParams.set("pageUrl", pageUrl);
    faviconUrl.searchParams.set("size", "256");
    return faviconUrl.href;
}

function getFaviconIdentity(pageUrl) {
    const url = new URL(pageUrl);
    return `${url.protocol}//${url.host.toLowerCase()}/`;
}

function shouldUseBrowserManagedFavicon(pageUrl) {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase();
    return browserManagedFaviconHosts.has(host);
}

function getDeclaredIconSize(link) {
    const sizes = link.getAttribute("sizes") || "";
    if (sizes.toLowerCase() === "any") {
        return 512;
    }
    return Math.max(0, ...Array.from(sizes.matchAll(/(\d+)x(\d+)/gi), function(match) {
        return Math.min(Number(match[1]), Number(match[2]));
    }));
}

async function readResponseWithLimit(response, maximumBytes, asText = false) {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        throw new RangeError("Response is too large");
    }
    if (!response.body) {
        const value = asText ? await response.text() : await response.blob();
        const size = asText ? new Blob([value]).size : value.size;
        if (size > maximumBytes) throw new RangeError("Response is too large");
        return value;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximumBytes) {
            await reader.cancel();
            throw new RangeError("Response is too large");
        }
        chunks.push(value);
    }
    const blob = new Blob(chunks, {
        type: response.headers.get("content-type") || "application/octet-stream"
    });
    return asText ? blob.text() : blob;
}

function inspectFavicon(url, svg, declaredSize) {
    return new Promise(function(resolve) {
        const image = new Image();
        let settled = false;
        const finish = function(value) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            image.removeEventListener("load", onLoad);
            image.removeEventListener("error", onError);
            resolve(value);
        };
        const onLoad = function() {
            const naturalSize = Math.min(image.naturalWidth, image.naturalHeight);
            const size = svg ? Math.max(naturalSize, declaredSize) : naturalSize;
            finish({
                url: url,
                score: svg ? 100000 + size : size
            });
        };
        const onError = () => finish(null);
        const timer = setTimeout(() => finish(null), 4000);
        image.addEventListener("load", onLoad, { once: true });
        image.addEventListener("error", onError, { once: true });
        image.src = url;
    });
}

async function selectBestFaviconCandidate(candidates) {
    const inspected = await Promise.all(candidates.map(function(candidate) {
        return inspectFavicon(candidate.url, candidate.svg, candidate.size);
    }));
    return inspected.filter(Boolean).sort(function(first, second) {
        return second.score - first.score;
    })[0] || null;
}

// ищем подходящий фавикон
async function findBestFavicon(pageUrl) {
    try {
        const requestedUrl = new URL(pageUrl);
        const candidates = [{
            url: new URL("/favicon.svg", requestedUrl).href,
            svg: true,
            size: 512
        }, {
            url: new URL("/apple-touch-icon.png", requestedUrl).href,
            svg: false,
            size: 180
        }, {
            url: new URL("/favicon.ico", requestedUrl).href,
            svg: false,
            size: 32
        }];
        if (requestedUrl.hostname === "google.com" || requestedUrl.hostname.endsWith(".google.com")) {
            const googleProductIcon = new URL("https://www.google.com/s2/favicons");
            googleProductIcon.searchParams.set("domain_url", requestedUrl.origin);
            googleProductIcon.searchParams.set("sz", "256");
            candidates.push({
                url: googleProductIcon.href,
                svg: false,

                size: 256
            });
        }
        const response = await fetch(pageUrl, {
            credentials: "omit",
            signal: AbortSignal.timeout(faviconRequestTimeout)
        });
        if (!response.ok) {
            return (await selectBestFaviconCandidate(candidates))?.url || null;
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() || "";
        if (contentType && !contentType.includes("html") && !contentType.includes("xml")) {
            return null;
        }
        const html = await readResponseWithLimit(response, faviconPageMaxBytes, true);
        const documentCopy = new DOMParser().parseFromString(html, "text/html");
        documentCopy.querySelectorAll("link[rel][href]").forEach(function(link) {
            if (candidates.length >= 24) return;
            const relTokens = new Set(link.getAttribute("rel").toLowerCase().split(/\s+/));
            if (!relTokens.has("icon") && !relTokens.has("apple-touch-icon") &&
                !relTokens.has("apple-touch-icon-precomposed")) {
                return;
            }
            const candidateUrl = new URL(link.getAttribute("href"), response.url);
            if (!["http:", "https:"].includes(candidateUrl.protocol)) return;
            const url = candidateUrl.href;
            const type = link.getAttribute("type")?.toLowerCase() || "";
            const svg = type.includes("svg") || new URL(url).pathname.toLowerCase().endsWith(".svg");
            candidates.push({
                url: url,
                svg: svg,
                size: getDeclaredIconSize(link)
            });
        });
        candidates.push({
            url: new URL("/favicon.ico", response.url).href,
            svg: false,
            size: 32
        });
        const uniqueCandidates = [...new Map(candidates.map(function(candidate) {
            return [candidate.url, candidate];
        })).values()];
        const best = await selectBestFaviconCandidate(uniqueCandidates);
        return best && best.score >= 48 ? best.url : null;
    } catch {
        return null;
    }
}

function getFaviconCacheRequest(pageUrl) {
    return new Request(chrome.runtime.getURL(`/favicon-cache/${encodeURIComponent(getFaviconIdentity(pageUrl))}`));
}

function getFaviconStorageKey(pageUrl) {
    return `${faviconStoragePrefix}${getFaviconIdentity(pageUrl)}`;
}

function blobToDataUrl(blob) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result), { once: true });
        reader.addEventListener("error", reject, { once: true });
        reader.readAsDataURL(blob);
    });
}

// сохраняем фавикон
async function saveFaviconToStorage(pageUrl, blob) {
    try {
        const dataUrl = await blobToDataUrl(blob);
        if (dataUrl.length > faviconStorageEntryMaxLength) return;
        const storageKey = getFaviconStorageKey(pageUrl);
        faviconStorageQueue = faviconStorageQueue.catch(() => undefined).then(async () => {
            await chrome.storage.local.set({
                [storageKey]: {
                    dataUrl: dataUrl,
                    cachedAt: Date.now()
                }
            });
            const saved = await chrome.storage.local.get(null);
            const entries = Object.entries(saved)
                .filter(([key, value]) => key.startsWith(faviconStoragePrefix) && value?.dataUrl)
                .sort((first, second) =>
                    (Number(second[1].cachedAt) || 0) - (Number(first[1].cachedAt) || 0));
            let totalLength = 0;
            const expiredKeys = [];
            entries.forEach(([key, value], index) => {
                totalLength += value.dataUrl.length;
                if (index >= faviconStorageMaxEntries || totalLength > faviconStorageMaxLength) {
                    expiredKeys.push(key);
                }
            });
            if (expiredKeys.length) {
                await chrome.storage.local.remove(expiredKeys);
                const cache = await caches.open(faviconCacheName);
                await Promise.all(expiredKeys.map(key => cache.delete(
                    getFaviconCacheRequest(key.slice(faviconStoragePrefix.length)))));
            }
        });
        await faviconStorageQueue;
    } catch {}
}

async function saveFaviconToCache(cache, request, response) {
    if (!cache) return;
    await cache.put(request, response);
    const requests = await cache.keys();
    const overflow = requests.length - faviconCacheMaxEntries;
    if (overflow > 0) {
        await Promise.all(requests.slice(0, overflow).map(cachedRequest => cache.delete(cachedRequest)));
    }
}

async function fetchAndCacheFavicon(pageUrl, cache, cacheRequest) {
    try {
        const bestUrl = await findBestFavicon(pageUrl);
        if (!bestUrl) return null;
        const response = await fetch(bestUrl, {
            credentials: "omit",
            signal: AbortSignal.timeout(faviconRequestTimeout)
        });
        if (!response.ok) return null;
        const blob = await readResponseWithLimit(response, faviconImageMaxBytes);
        if (!blob.type.startsWith("image/") && blob.type !== "application/octet-stream") return null;
        const cachedResponse = new Response(blob, {
            headers: {
                "Content-Type": blob.type || "image/x-icon",
                "X-Dashboard-Cached-At": String(Date.now())
            }
        });
        await saveFaviconToCache(cache, cacheRequest, cachedResponse).catch(() => {});
        await saveFaviconToStorage(pageUrl, blob);
        return blob;
    } catch {
        return null;
    }
}

async function readCachedFavicon(pageUrl) {
    const cacheRequest = getFaviconCacheRequest(pageUrl);
    let cache = null;
    try {
        const storageKey = getFaviconStorageKey(pageUrl);
        const saved = (await chrome.storage.local.get(storageKey))[storageKey];
        if (saved?.dataUrl) {
            if (Date.now() - (Number(saved.cachedAt) || 0) >= faviconCacheLifetime) {
                caches.open(faviconCacheName).then(function(openedCache) {
                    return fetchAndCacheFavicon(pageUrl, openedCache, cacheRequest);
                }).catch(() => {});
            }
            return {
                dataUrl: saved.dataUrl,
                blob: null,
                cache: null,
                cacheRequest: cacheRequest
            };
        }
    } catch {}
    try {
        cache = await caches.open(faviconCacheName);
        const cached = await cache.match(cacheRequest);
        if (cached) {
            const cachedAt = Number(cached.headers.get("X-Dashboard-Cached-At")) || 0;
            if (Date.now() - cachedAt >= faviconCacheLifetime) {
                fetchAndCacheFavicon(pageUrl, cache, cacheRequest).catch(() => {});
            }
            const blob = await cached.blob();
            saveFaviconToStorage(pageUrl, blob);
            return {
                dataUrl: null,
                blob: blob,
                cache: cache,
                cacheRequest: cacheRequest
            };
        }
    } catch {}
    return {
        dataUrl: null,
        blob: null,
        cache: cache,
        cacheRequest: cacheRequest
    };
}

function preloadFaviconSource(source) {
    return new Promise(resolve => {
        const image = new Image();
        let settled = false;
        const finish = function(ready) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            image.removeEventListener("load", onLoad);
            image.removeEventListener("error", onError);
            resolve(ready);
        };
        const onLoad = () => finish(true);
        const onError = () => finish(false);
        const timer = setTimeout(() => finish(false), 2500);
        image.addEventListener("load", onLoad, { once: true });
        image.addEventListener("error", onError, { once: true });
        image.src = source;
    });
}

async function applyFaviconSource(icon, source, fallbackUrl) {
    const ready = await preloadFaviconSource(source);
    if (!icon.isConnected) return false;
    const finalSource = ready ? source : fallbackUrl;
    await new Promise(resolve => {
        let settled = false;
        const finish = function() {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            icon.removeEventListener("load", finish);
            icon.removeEventListener("error", finish);
            resolve();
        };
        const timer = setTimeout(finish, 2500);
        icon.addEventListener("load", finish);
        icon.addEventListener("error", finish);
        icon.src = finalSource;
        if (icon.complete) {
            queueMicrotask(finish);
        }
    });
    return ready;
}

async function applyFaviconBlob(icon, faviconBlob, fallbackUrl) {
    try {
        const faviconUrl = URL.createObjectURL(faviconBlob);
        const ready = await preloadFaviconSource(faviconUrl);
        if (!ready || !icon.isConnected) {
            URL.revokeObjectURL(faviconUrl);
            if (icon.isConnected) {
                icon.src = fallbackUrl;
            }
            return;
        }
        await new Promise(resolve => {
            let settled = false;
            const finish = function(useFallback = false) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                icon.removeEventListener("load", onLoad);
                icon.removeEventListener("error", onError);
                URL.revokeObjectURL(faviconUrl);
                if (useFallback && icon.isConnected) icon.src = fallbackUrl;
                resolve();
            };
            const onLoad = () => finish(false);
            const onError = () => finish(true);
            const timer = setTimeout(() => finish(true), 2500);
            icon.addEventListener("load", onLoad, { once: true });
            icon.addEventListener("error", onError, { once: true });
            icon.src = faviconUrl;
        });
    } catch {}
}

// обновляем фавикон
async function upgradeFavicon(icon, pageUrl) {
    const fallbackUrl = getFaviconUrl(pageUrl);
    if (shouldUseBrowserManagedFavicon(pageUrl)) {
        await applyFaviconSource(icon, fallbackUrl, fallbackUrl);
        return;
    }
    const cached = await readCachedFavicon(pageUrl);
    const faviconIdentity = getFaviconIdentity(pageUrl);
    if (!icon.isConnected) {
        return;
    }
    if (cached.dataUrl) {
        await applyFaviconSource(icon, cached.dataUrl, fallbackUrl);
        return;
    }
    if (cached.blob) {
        await applyFaviconBlob(icon, cached.blob, fallbackUrl);
        return;
    }

    icon.src = fallbackUrl;
    if (!faviconRequests.has(faviconIdentity)) {
        const request = fetchAndCacheFavicon(pageUrl, cached.cache, cached.cacheRequest)
            .finally(() => faviconRequests.delete(faviconIdentity));
        faviconRequests.set(faviconIdentity, request);
    }
    const faviconBlob = await faviconRequests.get(faviconIdentity);
    if (faviconBlob && icon.isConnected) {
        await applyFaviconBlob(icon, faviconBlob, fallbackUrl);
    }
}

function queueFaviconUpgrade(icon, pageUrl) {
    const request = upgradeFavicon(icon, pageUrl);
    pendingFaviconUpgrades.add(request);
    const release = () => pendingFaviconUpgrades.delete(request);
    request.then(release, release);
    return request;
}

function waitForPendingFaviconUpgrades() {
    return Promise.allSettled([...pendingFaviconUpgrades]);
}
