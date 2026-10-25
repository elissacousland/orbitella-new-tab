// цвета закладок

"use strict";

const brandTileColors = new Map([
    ["youtube.com", "#c72d3a"],
    ["youtu.be", "#c72d3a"],
    ["telegram.org", "#34789a"],
    ["web.telegram.org", "#34789a"],
    ["vk.com", "#355f88"],
    ["iherb.com", "#43834f"],
    ["mega.io", "#ac3440"],
    ["mega.nz", "#ac3440"],
    ["azure.microsoft.com", "#2874ad"],
    ["portal.azure.com", "#2874ad"],
    ["pinterest.com", "#b92d3a"],
    ["aliexpress.com", "#bf482f"],
    ["makeup.com", "#ad6288"],
    ["gov.il", "#a76538"],
    ["paper-vpn.com", "#3e684f"],
    ["paper-vpn.io", "#3e684f"],
    ["papervpn.io", "#3e684f"],
    ["mail.yandex.com", "#aa6236"],
    ["mail.yandex.ru", "#aa6236"]
]);

const darkBrandHosts = [
    "chatgpt.com",
    "openai.com",
    "github.com",
    "killercoda.com",
    "endel.io",
    "music.yandex",
    "shein.com",
    "terraform.io",
    "hashicorp.com"
];

const faviconAppearanceRequests = new Map();
const FAVICON_SPHERE_SCALE = .94;

const tileColorFamilies = {
    red: ["hsl(352 54% 57%)", "hsl(8 55% 58%)", "hsl(340 51% 58%)"],
    orange: ["hsl(20 55% 59%)", "hsl(28 52% 60%)", "hsl(13 51% 58%)"],
    yellow: ["hsl(42 51% 57%)", "hsl(48 48% 57%)", "hsl(35 51% 56%)"],
    green: ["hsl(145 45% 50%)", "hsl(163 43% 50%)", "hsl(128 42% 51%)"],
    cyan: ["hsl(188 48% 53%)", "hsl(177 45% 52%)", "hsl(196 47% 55%)"],
    blue: ["hsl(211 53% 57%)", "hsl(223 50% 58%)", "hsl(202 51% 55%)"],
    violet: ["hsl(258 45% 60%)", "hsl(274 44% 59%)", "hsl(245 42% 61%)"],
    pink: ["hsl(324 49% 60%)", "hsl(338 47% 60%)", "hsl(310 45% 59%)"],
    neutralDark: ["hsl(214 25% 47%)", "hsl(232 23% 49%)", "hsl(258 21% 50%)", "hsl(194 25% 47%)"],
    neutralLight: ["hsl(216 28% 45%)", "hsl(244 26% 47%)", "hsl(192 28% 45%)", "hsl(268 24% 48%)"],
    neutral: ["hsl(216 27% 51%)", "hsl(244 25% 52%)", "hsl(192 27% 51%)", "hsl(272 23% 53%)"]
};

function getHostAppearance(pageUrl) {
    const host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase();
    if (darkBrandHosts.some(function(domain) {
            return host === domain || host.endsWith(`.${domain}`) || host.startsWith(`${domain}.`);
        })) {
        return {
            color: "#b8c2d4",
            neutral: true,
            tone: "dark"
        };
    }
    for (const [domain, color] of brandTileColors) {
        if (host === domain || host.endsWith(`.${domain}`)) {
            return {
                color: color,
                neutral: false,
                tone: "color"
            };
        }
    }
    return null;
}

function rgbToHsl(red, green, blue) {
    red /= 255;
    green /= 255;
    blue /= 255;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const difference = maximum - minimum;
    let hue = 0;
    if (difference) {
        if (maximum === red) hue = ((green - blue) / difference) % 6;
        if (maximum === green) hue = (blue - red) / difference + 2;
        if (maximum === blue) hue = (red - green) / difference + 4;
        hue = (hue * 60 + 360) % 360;
    }
    const lightness = (maximum + minimum) / 2;
    const saturation = difference ? difference / (1 - Math.abs(2 * lightness - 1)) : 0;
    return [hue, saturation, lightness];
}

function getImagePixels(image, size) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = size;
    canvas.height = size;
    context.drawImage(image, 0, 0, size, size);
    return context.getImageData(0, 0, size, size).data;
}

function isMegaHost(pageUrl) {
    try {
        const host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase();
        return host === "mega.io" || host === "mega.nz";
    } catch {
        return false;
    }
}

function getGroupColor(group) {
    const red = group.red / group.weight;
    const green = group.green / group.weight;
    const blue = group.blue / group.weight;
    const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
    const cleanSaturation = Math.min(.60, Math.max(.42, saturation));
    const cleanLightness = Math.min(.59, Math.max(.47, lightness));
    return `hsl(${Math.round(hue)} ${Math.round(cleanSaturation * 100)}% ${Math.round(cleanLightness * 100)}%)`;
}

// анализируем фавикон
function analyzeFaviconAppearance(icon) {
    try {
        const pixels = getImagePixels(icon, 48);
        const groups = Array.from({
            length: 18
        }, function() {
            return {
                weight: 0,
                red: 0,
                green: 0,
                blue: 0
            };
        });
        let visiblePixels = 0;
        let darkPixels = 0;
        let lightPixels = 0;
        let chromaticPixels = 0;
        let brightnessSum = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            const alpha = pixels[index + 3] / 255;
            if (alpha < .25) continue;
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];
            const brightness = red * .2126 + green * .7152 + blue * .0722;
            const [hue, saturation, lightness] = rgbToHsl(red, green, blue);
            visiblePixels++;
            brightnessSum += brightness;
            if (brightness < 72) darkPixels++;
            if (brightness > 218) lightPixels++;
            if (saturation < .28 || lightness < .08 || lightness > .92) continue;
            chromaticPixels++;
            const group = groups[Math.floor(hue / 20) % groups.length];
            const weight = alpha * (.35 + saturation);
            group.weight += weight;
            group.red += red * weight;
            group.green += green * weight;
            group.blue += blue * weight;
        }
        groups.sort(function(first, second) {
            return second.weight - first.weight;
        });
        const averageBrightness = brightnessSum / Math.max(1, visiblePixels);
        const mostlyMonochrome = chromaticPixels / Math.max(1, visiblePixels) < .12;
        if (darkPixels / Math.max(1, visiblePixels) > .55 || (mostlyMonochrome && averageBrightness < 115)) {
            return {
                color: "#b8c2d4",
                neutral: true,
                tone: "dark"
            };
        }
        if (lightPixels / Math.max(1, visiblePixels) > .55 || (mostlyMonochrome && averageBrightness > 180)) {
            return {
                color: "#4e6090",
                neutral: true,
                tone: "light"
            };
        }
        if (groups[0].weight < 1.5) {
            return {
                color: "#667087",
                neutral: true,
                tone: averageBrightness < 130 ? "dark" : "neutral"
            };
        }
        const color = getGroupColor(groups[0]);
        return {
            color: color,
            neutral: false,
            tone: "color"
        };
    } catch {
        return {
            color: "#667087",
            neutral: true,
            tone: "neutral"
        };
    }
}

async function getFaviconAppearance(icon, pageUrl) {
    const knownAppearance = getHostAppearance(pageUrl);
    if (knownAppearance) return knownAppearance;
    const key = `faviconAppearanceV7:${new URL(pageUrl).hostname.toLowerCase()}`;
    if (!faviconAppearanceRequests.has(key)) {
        faviconAppearanceRequests.set(key, (async function() {
            try {
                const saved = await chrome.storage.local.get(key);
                if (saved[key]) return saved[key];
            } catch {}
            const appearance = analyzeFaviconAppearance(icon);
            try {
                await chrome.storage.local.set({
                    [key]: appearance
                });
            } catch {}
            return appearance;
        })());
    }
    return faviconAppearanceRequests.get(key);
}

function getFaviconVisualScale(icon, pageUrl = "") {
    const hostScale = isMegaHost(pageUrl) ? .9 : 1;
    try {
        const size = 32;
        const pixels = getImagePixels(icon, size);
        let minimumX = size;
        let minimumY = size;
        let maximumX = -1;
        let maximumY = -1;
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                if (pixels[(y * size + x) * 4 + 3] < 48) continue;
                minimumX = Math.min(minimumX, x);
                minimumY = Math.min(minimumY, y);
                maximumX = Math.max(maximumX, x);
                maximumY = Math.max(maximumY, y);
            }
        }
        if (maximumX < minimumX || maximumY < minimumY) return FAVICON_SPHERE_SCALE * hostScale;
        const coverage = Math.max(maximumX - minimumX + 1,
            maximumY - minimumY + 1) / size;
        const opticalScale = Math.min(1.1, Math.max(.9, .9 / Math.max(.55, coverage)));
        return Number((opticalScale * FAVICON_SPHERE_SCALE * hostScale).toFixed(3));
    } catch {
        return FAVICON_SPHERE_SCALE * hostScale;
    }
}

function shouldOutlineFavicon(icon, pageUrl) {
    try {
        const host = new URL(pageUrl).hostname.replace(/^www\./, "").toLowerCase();
        if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") ||
            host === "openai.com" || host.endsWith(".openai.com")) {
            return false;
        }
        const size = 32;
        const pixels = getImagePixels(icon, size);
        const mask = new Uint8Array(size * size);
        let visiblePixels = 0;
        let lightPixels = 0;
        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] < 64) continue;
            mask[index / 4] = 1;
            visiblePixels += 1;
            const brightness = pixels[index] * .2126 + pixels[index + 1] * .7152 + pixels[index + 2] * .0722;
            if (brightness > 210) lightPixels += 1;
        }
        if (!visiblePixels) return false;
        let boundaryPixels = 0;
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const position = y * size + x;
                if (!mask[position]) continue;
                if (x === 0 || y === 0 || x === size - 1 || y === size - 1 ||
                    !mask[position - 1] || !mask[position + 1] ||
                    !mask[position - size] || !mask[position + size]) {
                    boundaryPixels += 1;
                }
            }
        }
        const lightRatio = lightPixels / visiblePixels;
        const coverage = visiblePixels / (size * size);
        const boundaryRatio = boundaryPixels / visiblePixels;
        return lightRatio < .48 && boundaryRatio < .58 &&
            !(coverage > .82 && lightRatio > .25);
    } catch {
        return false;
    }
}

function getCssColorHsl(color) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = 1;
    canvas.height = 1;
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return rgbToHsl(pixel[0], pixel[1], pixel[2]);
}

function getColorFamily(color) {
    const [hue, saturation] = getCssColorHsl(color);
    if (saturation < .25) return "neutral";
    if (hue < 15 || hue >= 345) return "red";
    if (hue < 38) return "orange";
    if (hue < 65) return "yellow";
    if (hue < 170) return "green";
    if (hue < 200) return "cyan";
    if (hue < 245) return "blue";
    if (hue < 295) return "violet";
    if (hue < 345) return "pink";
    return "red";
}

function getTextHash(text) {
    let hash = 0;
    for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash;
}

function getTileColor(appearance, pageUrl, bookmarkId) {
    let family = appearance.neutral ? "neutral" : getColorFamily(appearance.color);
    if (family === "neutral") {
        family = appearance.tone === "dark" ? "neutralDark" : appearance.tone === "light" ? "neutralLight" : "neutral";
    }
    const palette = tileColorFamilies[family];
    const position = layout.find(function(item) {
        return item.id === bookmarkId;
    }) || {
        x: 0,
        y: 0
    };
    const host = new URL(pageUrl).hostname.toLowerCase();
    const index = (getTextHash(host) + position.x + position.y * 2) % palette.length;
    let color = palette[index];
    if (!appearance.neutral) {
        const [, , iconLightness] = getCssColorHsl(appearance.color);
        const [hue, saturation, tileLightness] = getCssColorHsl(color);
        if (Math.abs(iconLightness - tileLightness) < .18) {
            const correctedLightness = iconLightness > .52 ?
                Math.max(.30, tileLightness - .16) : Math.min(.68, tileLightness + .16);
            color = `hsl(${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(correctedLightness * 100)}%)`;
        }
    }
    return color;
}

// подбираем палитру
function getTileMaterial(color) {
    const [hue, saturation, lightness] = getCssColorHsl(color);
    const softSaturation = Math.min(.57, Math.max(.40, saturation * .89));
    const softLightness = Math.min(.64, Math.max(.46, lightness));
    const companionHue = (hue + 8) % 360;
    return {
        base: `hsl(${Math.round(hue)} ${Math.round(softSaturation * 100)}% ${Math.round(softLightness * 100)}%)`,
        light: `hsl(${Math.round(hue)} ${Math.round(Math.max(.38, softSaturation - .04) * 100)}% ${Math.round(Math.min(.70, softLightness + .11) * 100)}%)`,
        soft: `hsl(${Math.round(companionHue)} ${Math.round(Math.max(.36, softSaturation - .06) * 100)}% ${Math.round(Math.min(.65, softLightness + .05) * 100)}%)`,
        deep: `hsl(${Math.round(hue)} ${Math.round(Math.min(.64, softSaturation + .02) * 100)}% ${Math.round(Math.max(.35, softLightness - .12) * 100)}%)`
    };
}

// применяем цвет
async function applyBookmarkTileColor(tile, icon, pageUrl, bookmarkId) {
    if (isMegaHost(pageUrl)) tile.dataset.faviconShape = "circle";
    else delete tile.dataset.faviconShape;
    tile.dataset.faviconOutline = shouldOutlineFavicon(icon, pageUrl) ? "white" : "none";
    const appearance = await getFaviconAppearance(icon, pageUrl);
    if (!tile.isConnected) return;
    const color = getTileColor(appearance, pageUrl, bookmarkId);
    const material = getTileMaterial(color);
    tile.style.setProperty("--tile-color", material.base);
    tile.style.setProperty("--tile-color-light", material.light);
    tile.style.setProperty("--tile-color-soft", material.soft);
    tile.style.setProperty("--tile-color-deep", material.deep);
    tile.style.setProperty("--favicon-visual-scale", String(getFaviconVisualScale(icon, pageUrl)));
}
