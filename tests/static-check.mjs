// проверяем структуру проекта

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function read(relativePath) {
    return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function assert(condition, message) {
    if (!condition) failures.push(message);
}

function getLocalResources(html) {
    return [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)]
        .map(match => match[1])
        .filter(resource => !/^(?:[a-z]+:|#)/i.test(resource));
}

function checkHtml(relativePath) {
    const html = read(relativePath);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    assert(!duplicateIds.length,
        `${relativePath}: повторяются id: ${duplicateIds.join(", ")}`);

    const references = [
        ...html.matchAll(/\bfor="([^"]+)"/g),
        ...html.matchAll(/\baria-(?:controls|describedby|labelledby)="([^"]+)"/g)
    ].flatMap(match => match[1].split(/\s+/));
    const missingReferences = references.filter(reference => !ids.includes(reference));
    assert(!missingReferences.length,
        `${relativePath}: отсутствуют цели атрибутов: ${missingReferences.join(", ")}`);

    getLocalResources(html).forEach(resource => {
        assert(fs.existsSync(path.join(projectRoot, resource)),
            `${relativePath}: не найден ресурс ${resource}`);
    });
    assert(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(html),
        `${relativePath}: найден встроенный исполняемый скрипт`);

    const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)]
        .map(match => match[1]);
    if (scripts.length) {
        const source = scripts.map(script => `\n/* ${script} */\n${read(script)}`).join("\n");
        try {
            new vm.Script(source, { filename: relativePath });
        } catch (error) {
            failures.push(`${relativePath}: конфликт или синтаксическая ошибка скриптов: ${error.message}`);
        }
    }
}

checkHtml("index.html");
checkHtml("microphone.html");

const dashboardHtml = read("index.html");
const backgroundScript = read(path.join("js", "background.js"));
const planetClockGlassScript = read(path.join("js", "planet-clock-glass.js"));
const bookmarkStoreScript = read(path.join("js", "bookmark-store.js"));
const bookmarkUiScript = read(path.join("js", "bookmarks-ui.js"));
const faviconScript = read(path.join("js", "favicon.js"));
const tileColorsScript = read(path.join("js", "tile-colors.js"));
const settingsScript = read(path.join("js", "settings.js"));
const mainScript = read(path.join("js", "main.js"));
const translationsScript = read(path.join("js", "translations.js"));
const weatherScript = read(path.join("js", "weather.js"));
const baseStyles = read(path.join("styles", "_base.scss"));
const sceneStyles = read(path.join("styles", "_scene.scss"));
const heroStyles = read(path.join("styles", "_hero.scss"));
const bookmarkStyles = read(path.join("styles", "_bookmarks.scss"));
const settingsStyles = read(path.join("styles", "_settings.scss"));
const overlayStyles = read(path.join("styles", "_overlays.scss"));
const responsiveStyles = read(path.join("styles", "_responsive.scss"));
const compiledStyles = read(path.join("styles", "style.css"));
const settingsButtonMarkup = dashboardHtml.match(
    /<button[^>]*class="floating-button settings-button"[\s\S]*?<\/button>/)?.[0] || "";
const settingsDialogMarkup = dashboardHtml.match(
    /<dialog class="settings-dialog"[^>]*>[\s\S]*?<\/dialog>/)?.[0] || "";
const spaceBackground = path.join("assets", "backgrounds",
    "default-space-bg-dark.webp");
const planetTextures = [
    "mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "moon", "sun"
];
assert(!/asteroid-belt|solar-surface|solar-corona-canvas/.test(dashboardHtml),
    "index.html: остались тяжёлые Canvas-слои космической сцены");
assert((dashboardHtml.match(/<dialog\b/g) || []).length ===
    (dashboardHtml.match(/<dialog\b[^>]*\baria-labelledby="[^"]+"/g) || []).length &&
    (dashboardHtml.match(/class="dialog-close"[^>]*\bdata-i18n-aria-label="close"/g) || []).length === 4 &&
    translationsScript.includes('close: "Закрыть"') &&
    translationsScript.includes('close: "Close"') &&
    /class="toast"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/.test(dashboardHtml),
"Доступность: диалоги, кнопки закрытия или уведомления не имеют доступных названий");
assert(weatherScript.includes('loading: "Загружаем погоду…"') &&
    weatherScript.includes('denied: "Геолокация запрещена"') &&
    weatherScript.includes('error: "Не удалось получить погоду"') &&
    weatherScript.includes('weatherStatus === "locating" || weatherStatus === "loading"') &&
    weatherScript.includes('weatherStatus === "denied"') &&
    weatherScript.includes('weatherStatus === "error"') &&
    weatherScript.includes('weatherStatus = "ready"') &&
    weatherScript.includes('locationDenied = error?.code === 1') &&
    weatherScript.includes('status: weatherStatus'),
"Погода: компактные состояния загрузки, запрета, ошибки и успеха настроены неверно");
assert((dashboardHtml.match(/space-scene__planet(?:\s|\")/g) || []).length === 8,
    "index.html: в сцене должно быть восемь планет");
assert((dashboardHtml.match(/space-scene__earth-moon\"/g) || []).length === 1,
    "index.html: у Земли должна остаться одна Луна");
assert(!/requestAnimationFrame|setInterval|collision|getBoundingClientRect/.test(backgroundScript),
    "background.js: обнаружены постоянные вычисления или логика столкновений");
assert(dashboardHtml.includes('src="js/planet-clock-glass.js"') &&
    dashboardHtml.includes('class="clock-weather"') &&
    dashboardHtml.includes('class="clock-weather-content"') &&
    dashboardHtml.includes('clock-glass-line--time') &&
    dashboardHtml.includes('clock-glass-line--date') &&
    dashboardHtml.includes('clock-glass-line--weather') &&
    planetClockGlassScript.includes('document.querySelector(".clock-weather")') &&
    planetClockGlassScript.includes('querySelectorAll(".clock-glass-line")') &&
    planetClockGlassScript.includes("horizontalMargin = 10") &&
    planetClockGlassScript.includes("verticalMargin = 4") &&
    planetClockGlassScript.includes('document.querySelectorAll(".space-scene__planet")') &&
    planetClockGlassScript.includes("getBoundingClientRect()") &&
    planetClockGlassScript.includes('classList.toggle("is-planet-behind"') &&
    planetClockGlassScript.includes("requestAnimationFrame(monitorPlanets)") &&
    planetClockGlassScript.includes("checkInterval = 64"),
"Часы: независимая проверка прохождения планет за строками не настроена");
assert(heroStyles.includes(".clock-glass-line") &&
    heroStyles.includes("&.is-planet-behind::before") &&
    heroStyles.includes("backdrop-filter: blur(6px)") &&
    heroStyles.includes("background: rgba(15, 18, 35, .045)") &&
    heroStyles.includes("border-radius: 999px") &&
    heroStyles.includes("inset: -4px -10px") &&
    heroStyles.includes("mask-image: radial-gradient") &&
    heroStyles.includes("transition: opacity 210ms ease") &&
    heroStyles.includes("pointer-events: none") &&
    heroStyles.includes("box-shadow: none") &&
    !heroStyles.includes(".clock-weather-content::before") &&
    !heroStyles.includes(".clock-weather.planet-behind"),
"Часы: локальный blur без общей карточки настроен неверно");
assert(baseStyles.includes('font-family: "Nunito"') &&
    baseStyles.includes('url("../assets/fonts/Nunito-Variable.ttf")') &&
    heroStyles.includes('font-family: "Nunito", sans-serif') &&
    heroStyles.includes("font-size: 64px") &&
    heroStyles.includes("font-weight: 500") &&
    heroStyles.includes("font-variant-numeric: tabular-nums") &&
    heroStyles.includes("color: #f5f1fa") &&
    heroStyles.includes("color: #d2cdde") &&
    heroStyles.includes("color: #eeeaf5") &&
    heroStyles.includes("text-shadow: none") &&
    !responsiveStyles.includes("font-size: 13px") &&
    !responsiveStyles.includes("font-size: 18px"),
"Часы: единая типографика Nunito, заданные цвета или адаптивные размеры настроены неверно");
assert(backgroundScript.includes("function getPlanetOrbitArc") &&
    backgroundScript.includes("createPlanetOrbitFrames") &&
    backgroundScript.includes("planet.animate(frames") &&
    backgroundScript.includes("const PLANET_TIME_ORIGIN = Date.UTC(2024, 0, 1)") &&
    backgroundScript.includes("const PLANET_HIDDEN_DURATION = 30_000") &&
    backgroundScript.includes("const PLANET_CLOCK_SYNC_INTERVAL = 30_000") &&
    backgroundScript.includes("const PLANET_VISIBLE_ORBIT_RATIOS = Object.freeze") &&
    backgroundScript.includes("getPlanetCycleTime(now") &&
    backgroundScript.includes('frames.at(-1).easing = "steps(1, end)"') &&
    backgroundScript.includes("getPlanetVisualExtent") &&
    backgroundScript.includes("synchronizeEarthMoon") &&
    backgroundScript.includes("synchronizePlanetWrapping") &&
    backgroundScript.includes('window.addEventListener("focus"') &&
    backgroundScript.includes("schedulePlanetClockSync") &&
    !backgroundScript.includes("localStorage") &&
    backgroundScript.includes('window.addEventListener("resize"') &&
    backgroundScript.includes('window.addEventListener("pageshow"') &&
    backgroundScript.includes('document.addEventListener("visibilitychange"') &&
    sceneStyles.includes(".space-scene__planet.is-screen-wrapped"),
"Планеты: бесшовное возвращение с противоположного края не настроено");
assert(bookmarkUiScript.includes("function getBookmarkGroupTop") &&
    bookmarkUiScript.includes("schedulePlanetOrbitAlignment") &&
    bookmarkUiScript.includes("planetOrbitLayout?.alignAbove") &&
    /function scheduleOrbitalResizeLayout\(\) \{\s*scheduleOrbitalLayout\(\);\s*\}/.test(bookmarkUiScript) &&
    bookmarkUiScript.includes("new ResizeObserver(scheduleOrbitalResizeLayout)") &&
    bookmarkUiScript.includes("observe(bookmarkGrid)") &&
    backgroundScript.includes("function alignPlanetOrbitsAbove") &&
    backgroundScript.includes("const PLANET_ORBIT_BASE_LIFT = 16") &&
    backgroundScript.includes("Math.min(0, requestedShift) - PLANET_ORBIT_BASE_LIFT") &&
    backgroundScript.includes("--planet-orbit-shift-y") &&
    sceneStyles.includes("--planet-orbit-shift-y: -16px") &&
    compiledStyles.includes("--planet-orbit-shift-y: -16px") &&
    !bookmarkStyles.includes("transition: height") &&
    !heroStyles.includes('&[data-search-visible="false"] .hero-info'),
"Раскладка: независимое положение солнца/закладок или адаптация орбит настроены неверно");
assert(!settingsScript.includes("DASHBOARD_COMPACT_TILE_GAP") &&
    bookmarkStoreScript.includes("if (!settings.showBookmarkTitles) return 0") &&
    bookmarkStoreScript.includes("const minimumSlotSpacing = tileDiameter + spacing.titledGap") &&
    bookmarkStoreScript.includes("reach: visibleReach") &&
    bookmarkUiScript.includes("const requestedGap = getDashboardBookmarkGap()") &&
    bookmarkUiScript.includes("const orbitGap = getDashboardBookmarkOrbitGap()") &&
    bookmarkUiScript.includes("const fixedStep = Math.min(maximumStep") &&
    bookmarkUiScript.includes("const firstLength = (totalLength - fixedStep * (capacity - 1)) / 2") &&
    bookmarkUiScript.includes("tileDiameter + tileMetrics.gap") &&
    bookmarkUiScript.includes("--orbit-title-offset-x") &&
    bookmarkUiScript.includes("tileDiameter + labelRoom + orbitGap") &&
    bookmarkUiScript.includes("const dashboardGap = getDashboardBookmarkGap()") &&
    settingsScript.includes("languageChanged || tileSizeChanged || bookmarkTitlesChanged"),
"Закладки: интервалы плиток и дуг не адаптируются к размеру и подписям");
assert(fs.existsSync(path.join(projectRoot, spaceBackground)),
    `Отсутствует космический фон ${spaceBackground}`);
assert(sceneStyles.includes("assets/backgrounds/default-space-bg-dark.webp") &&
    sceneStyles.includes("background-size: cover") &&
    sceneStyles.includes("background-position: center"),
"_scene.scss: новый космический фон не настроен как fullscreen cover");
assert(!fs.existsSync(path.join(projectRoot, "js", "wallpaper.js")) &&
    !dashboardHtml.includes("settings-wallpaper") &&
    !dashboardHtml.includes("space-scene__wallpaper") &&
    !dashboardHtml.includes("background-mode") &&
    !settingsScript.includes("backgroundMode") &&
    !settingsScript.includes("wallpaperPosition") &&
    !translationsScript.includes("wallpaperChoose") &&
    !sceneStyles.includes("data-background-mode") &&
    !sceneStyles.includes("space-scene__wallpaper"),
"Обои: пользовательский фон или его неиспользуемые настройки удалены не полностью");
assert(settingsDialogMarkup.includes('class="settings-field settings-inline"') &&
    settingsDialogMarkup.includes('class="settings-field settings-display"') &&
    settingsDialogMarkup.includes('class="settings-footer"') &&
    (settingsDialogMarkup.match(/<option\b/g) || []).length === 4 &&
    (settingsDialogMarkup.match(/id="tile-size-select"[\s\S]*?<\/select>/)?.[0]
        .match(/<option\b/g) || []).length === 2 &&
    settingsDialogMarkup.includes('value="extra-small" data-i18n="small"') &&
    settingsDialogMarkup.includes('value="small" data-i18n="medium"') &&
    !settingsDialogMarkup.includes('value="medium" data-i18n="large"') &&
    (settingsDialogMarkup.match(/type="checkbox"/g) || []).length === 3 &&
    (settingsDialogMarkup.match(/type="radio"/g) || []).length === 0 &&
    !settingsDialogMarkup.includes('type="file"') &&
    settingsDialogMarkup.indexOf('class="settings-sources"') < settingsDialogMarkup.indexOf("</form>") &&
    settingsStyles.includes("--settings-bg: #171c2b") &&
    settingsStyles.includes("--settings-accent: #8175ba") &&
    settingsStyles.includes("width: min(436px, calc(100% - 24px))") &&
    settingsStyles.includes("grid-template-columns: minmax(0, 1fr) 144px") &&
    settingsStyles.includes("width: 36px") &&
    settingsStyles.includes("height: 21px") &&
    settingsStyles.includes("min-height: 38px") &&
    settingsStyles.includes("font-size: 22px") &&
    (settingsStyles.match(/font-size: 15px/g) || []).length === 4 &&
    settingsStyles.includes("font-size: 14px") &&
    settingsStyles.includes("font-size: 13px") &&
    settingsStyles.includes("border-radius: 999px") &&
    settingsStyles.includes("transform: translateX(16px)") &&
    settingsStyles.includes(".settings-footer") &&
    settingsStyles.includes("max-height: calc(100dvh - 24px)") &&
    !settingsStyles.includes(":has(input:checked)") &&
    compiledStyles.includes("--settings-bg: #171c2b") &&
    compiledStyles.includes("width: min(436px, 100% - 24px)") &&
    /\.settings-dialog header h2 \{\s*font-size: 22px;/.test(compiledStyles) &&
    compiledStyles.includes(".settings-dialog .settings-footer"),
"Настройки: компактная компоновка, переключатели или палитра настроены неверно");
assert(sceneStyles.includes("--solar-orbit-rgb: 170 132 196") &&
    sceneStyles.includes("--mercury-orbit-min-radius: 72vh") &&
    sceneStyles.includes("--planet-orbit-step: 9.5vh"),
"_scene.scss: цвет или компактная геометрия планетных орбит настроены неверно");
assert(sceneStyles.includes("z-index: var(--orbit-depth)") &&
    [8, 7, 6, 5, 4, 3, 2, 1].every(depth =>
        sceneStyles.includes(`--orbit-depth: ${depth}`)),
"_scene.scss: внутренние планеты должны перекрывать внешние без смещения с орбит");
assert((sceneStyles.match(/--planet-direction: normal/g) || []).length === 4 &&
    (sceneStyles.match(/--planet-direction: reverse/g) || []).length === 4 &&
    (sceneStyles.match(/--planet-phase: /g) || []).length === 8 &&
    [1080, 1860, 1500, 2220, 1740, 2820, 2460, 3360]
        .every(duration => sceneStyles.includes(`--planet-duration: ${duration}s`)) &&
    backgroundScript.includes('getPropertyValue("--planet-direction")') &&
    backgroundScript.includes('getPropertyValue("--planet-phase")') &&
    backgroundScript.includes('direction === "reverse" ? arc.end : arc.start') &&
    backgroundScript.includes("fullDuration * PLANET_VISIBLE_ORBIT_RATIOS[index]") &&
    backgroundScript.includes("visibleDuration + PLANET_HIDDEN_DURATION") &&
    !backgroundScript.includes("getCurrentPlanetAngle"),
"Планеты: индивидуальные направления, скорости или фазы настроены неверно");
planetTextures.forEach(name => {
    assert(fs.existsSync(path.join(projectRoot, "assets", "planets", `${name}.webp`)),
        `assets/planets: отсутствует оптимизированная текстура ${name}.webp`);
    assert(!fs.existsSync(path.join(projectRoot, "assets", "planets", `${name}.png`)),
        `assets/planets: остался неиспользуемый дубль ${name}.png`);
});
assert(planetTextures.slice(0, -1).every(name =>
    sceneStyles.includes(`assets/planets/${name}.webp`)),
"_scene.scss: подключены не все текстуры планет");
assert(sceneStyles.includes("--moon-orbit-radius: clamp(50px, 5.6vw, 68px)") &&
    sceneStyles.includes("width: calc(var(--planet-size) * .38)") &&
    sceneStyles.includes("background: url('../assets/planets/moon.webp') center / contain no-repeat"),
"_scene.scss: изображение, размер или радиус орбиты Луны настроены неверно");
assert(sceneStyles.includes("--planet-size: clamp(78px, 9vw, 106px)") &&
    sceneStyles.includes("--planet-size: clamp(113px, 12.88vw, 153px)") &&
    sceneStyles.includes("--planet-size: clamp(57px, 7.02vw, 82px)") &&
    sceneStyles.includes("--planet-size: clamp(46px, 5.55vw, 65px)"),
"_scene.scss: относительные размеры больших и малых планет настроены неверно");
assert(!/updatePlanetLighting|getPlanetLightKeyframes|--light-[xy]/.test(backgroundScript) &&
    !/--planet-(?:light|night|limb)-strength|--planet-texture|--light-[xy]/.test(sceneStyles) &&
    !sceneStyles.includes(".space-scene__planet::after") &&
    !sceneStyles.includes(".space-scene__planet--saturn::before") &&
    sceneStyles.includes("background-image: var(--planet-image)") &&
    sceneStyles.includes("background-size: contain"),
"Космическая сцена: старое освещение не удалено или изображения подключены неверно");
assert(!dashboardHtml.includes("space-scene__sun-glow") &&
    !sceneStyles.includes("space-scene__sun-glow"),
"Космическая сцена: остался старый программный слой свечения Солнца");
assert(bookmarkStyles.includes("assets/planets/sun.webp") &&
    !/\.orbital-sun[\s\S]{0,220}(?:drop-shadow|brightness\()/.test(bookmarkStyles),
    "_bookmarks.scss: Солнце должно использовать исходное изображение без фильтров");
assert(bookmarkStyles.includes("background: rgba(41, 33, 61, .88)") &&
    bookmarkStyles.includes("border: 1px solid rgba(102, 85, 128, .58)") &&
    bookmarkStyles.includes("background: #3c3058") &&
    bookmarkStyles.includes("transform: rotate(45deg)") &&
    bookmarkStyles.includes("transition: transform 200ms ease") &&
    bookmarkStyles.includes("box-shadow: none") &&
    responsiveStyles.includes(".settings-button svg") &&
    (settingsButtonMarkup.match(/stroke-width="1\.8"/g) || []).length === 2 &&
    settingsButtonMarkup.includes('stroke-linecap="round"') &&
    compiledStyles.includes("background: rgba(41, 33, 61, 0.88)") &&
    compiledStyles.includes("transform: rotate(45deg)") &&
    !compiledStyles.includes("background-color: rgba(28, 34, 52, 0.2805)"),
"Настройки: кнопка не использует новый мягкий фон, тонкую рамку или поворот шестерёнки");
assert(bookmarkStyles.includes("top: calc(100% + 5px)") &&
    /"extra-small": 21,\s+small: 22,\s+medium: 24/.test(bookmarkStoreScript) &&
    bookmarkStoreScript.includes("const minimumSlotSpacing = tileDiameter + spacing.titledGap") &&
    bookmarkStoreScript.includes("tileDiameter + titledLabelRoom + spacing.titledOrbitGap") &&
    bookmarkStoreScript.includes("tileDiameter / 2 - 20") &&
    bookmarkUiScript.includes("tileDiameter + labelRoom + orbitGap") &&
    bookmarkUiScript.includes('cell.querySelector(".tile:not(.empty-tile)")') &&
    bookmarkUiScript.includes("viewportBottom - activeBottom") &&
    bookmarkUiScript.includes("verticalShift = Math.min(0, verticalShift)") &&
    bookmarkUiScript.includes("Math.min(widthScale, heightScale), .56, 1"),
"Закладки: безопасные интервалы и адаптивный масштаб раскладки настроены неверно");
assert(bookmarkStyles.includes("linear-gradient(148deg") &&
    bookmarkStyles.includes("--tile-surface-opacity: 100%") &&
    bookmarkStyles.includes("--tile-color-soft:") &&
    bookmarkStyles.includes("background-color: var(--tile-color)") &&
    bookmarkStyles.includes(".tile-surface") &&
    bookmarkStyles.includes(".tile-surface-detail") &&
    bookmarkStyles.includes("pointer-events: none") &&
    bookmarkStyles.includes('&[data-planet-pattern="2"]') &&
    bookmarkStyles.includes('&[data-planet-pattern="3"]') &&
    bookmarkStyles.includes('&[data-planet-pattern="4"]') &&
    bookmarkStyles.includes("border-radius: 51% 49% 48% 52%") &&
    bookmarkStyles.includes("&::after") &&
    bookmarkStyles.includes("transform: scale(1.035)") &&
    bookmarkStyles.includes("transition: transform 200ms ease") &&
    bookmarkStyles.includes("var(--favicon-visual-scale, 1)") &&
    bookmarkStyles.includes("backdrop-filter: none") &&
    bookmarkStyles.includes("&::before") &&
    bookmarkStyles.includes("inset -8px -9px 13px") &&
    bookmarkStyles.includes("opacity: .52") &&
    bookmarkStyles.includes("opacity: .38") &&
    bookmarkStyles.includes('filter: none') &&
    bookmarkStyles.includes('&[data-favicon-outline="white"] .favicon-box img') &&
    bookmarkStyles.includes('filter: url("#favicon-white-outline")') &&
    bookmarkStyles.includes('.tile[data-favicon-shape="circle"] .favicon-box img') &&
    compiledStyles.includes(".tile[data-favicon-shape=circle] .favicon-box img") &&
    !bookmarkStyles.includes("drop-shadow(1px 0 0 #fff)") &&
    !bookmarkStyles.includes("favicon-halo") &&
    dashboardHtml.includes('id="favicon-white-outline"') &&
    dashboardHtml.includes('operator="dilate" radius="1"') &&
    dashboardHtml.includes('flood-color="#fff"'),
"_bookmarks.scss: матовый мультяшный материал плиток настроен неверно");
assert(tileColorsScript.includes("const softSaturation = Math.min(.57, Math.max(.40") &&
    tileColorsScript.includes("const softLightness = Math.min(.64, Math.max(.46") &&
    tileColorsScript.includes("const FAVICON_SPHERE_SCALE = .94") &&
    tileColorsScript.includes("Math.abs(iconLightness - tileLightness) < .18") &&
    tileColorsScript.includes("faviconAppearanceV7") &&
    tileColorsScript.includes('function getFaviconVisualScale(icon, pageUrl = "")') &&
    tileColorsScript.includes("function isMegaHost(pageUrl)") &&
    tileColorsScript.includes("const hostScale = isMegaHost(pageUrl) ? .9 : 1") &&
    tileColorsScript.includes('tile.dataset.faviconShape = "circle"') &&
    tileColorsScript.includes("function shouldOutlineFavicon(icon, pageUrl)") &&
    tileColorsScript.includes('host === "chatgpt.com"') &&
    tileColorsScript.includes("const boundaryRatio = boundaryPixels / visiblePixels") &&
    tileColorsScript.includes('tile.dataset.faviconOutline = shouldOutlineFavicon(icon, pageUrl) ? "white" : "none"') &&
    tileColorsScript.includes('setProperty("--tile-color-soft"') &&
    !tileColorsScript.includes("getFaviconContrastMaterial") &&
    !tileColorsScript.includes("favicon-halo") &&
    !tileColorsScript.includes("favicon-shadow") &&
    !tileColorsScript.includes('setProperty("--favicon-edge-color"') &&
    tileColorsScript.includes('setProperty("--favicon-visual-scale"') &&
    bookmarkUiScript.includes('surface.className = "tile-surface"') &&
    bookmarkUiScript.includes('surfaceDetail.className = "tile-surface-detail"') &&
    bookmarkUiScript.includes('surface.setAttribute("aria-hidden", "true")') &&
    bookmarkUiScript.includes("tile.dataset.planetPattern") &&
    bookmarkUiScript.includes("getTextHash(patternKey) % 4 + 1") &&
    !tileColorsScript.includes("const vividSaturation"),
"Закладки: мягкая палитра, размеры favicon или стабильные шаблоны пятен не настроены");
assert(faviconScript.includes('const faviconCacheName = "dashboard-favicons-v4"') &&
    faviconScript.includes('const faviconStoragePrefix = "dashboardFaviconV4:"') &&
    faviconScript.includes('const browserManagedFaviconHosts = new Set(["mega.io", "mega.nz"])') &&
    faviconScript.includes("function shouldUseBrowserManagedFavicon(pageUrl)") &&
    faviconScript.includes("function getFaviconIdentity(pageUrl)") &&
    faviconScript.includes('new URL("/favicon.svg", requestedUrl)') &&
    faviconScript.includes('new URL("/apple-touch-icon.png", requestedUrl)'),
"Favicon: кеш по домену или резервные иконки высокого разрешения не настроены");
assert((dashboardHtml.match(/class="folder-color-dot"/g) || []).length === 3 &&
    dashboardHtml.includes('data-folder-color="amber"') &&
    dashboardHtml.includes('data-folder-color="mint"') &&
    dashboardHtml.includes('data-folder-color="violet"') &&
    bookmarkStoreScript.includes("function getFolderColor(folder)") &&
    bookmarkStoreScript.includes("function setFolderColor(folder, color)") &&
    bookmarkUiScript.includes("async function chooseFolderColor(event)") &&
    settingsScript.includes('"dashboardFolderColors"') &&
    bookmarkStyles.includes('&[data-folder-color="mint"]') &&
    bookmarkStyles.includes('&[data-folder-color="violet"]') &&
    ["#e3ad91", "#ffc23e", "#9ebbd5", "#62c9f5", "#b8a8d6", "#b77bf2"]
        .every(color => bookmarkStyles.includes(color) && compiledStyles.includes(color)) &&
    overlayStyles.includes("button.folder-color-dot") &&
    overlayStyles.includes('&[aria-checked="true"]'),
"Папки: выбор одного из трёх цветов или его сохранение настроены неверно");
assert(bookmarkUiScript.includes("const BOOKMARK_ORBIT_LIFT = 37") &&
    bookmarkUiScript.includes('settings.tileSize === "small" ? BOOKMARK_ORBIT_LIFT - 5') &&
    bookmarkUiScript.includes("gridRect.top - orbitLift"),
"bookmarks-ui.js: орбиты закладок не подняты над солнцем");
assert(bookmarkUiScript.includes('tile.setAttribute("draggable", "true")') &&
    bookmarkUiScript.includes("function finishDragSession()") &&
    /function finishDragSession\(\)[\s\S]*?resetDragPreview\(\);\s*schedulePlanetOrbitAlignment\(\);/.test(bookmarkUiScript) &&
    /function alignPlanetOrbitsToBookmarks\(\)[\s\S]*?if \(draggingId\) return;/.test(bookmarkUiScript) &&
    bookmarkUiScript.includes("не двигаем планеты во время перетаскивания") &&
    bookmarkUiScript.includes("requestAnimationFrame(() => {") &&
    bookmarkStyles.includes("-webkit-user-drag: element") &&
    bookmarkStyles.includes("> .favicon-box") &&
    compiledStyles.includes("-webkit-user-drag: element"),
"Закладки: нативное перетаскивание или безопасная очистка drag-состояния настроены неверно");
assert(bookmarkStyles.includes('font-family: "Nunito", sans-serif') &&
    bookmarkStyles.includes("font-weight: 600") &&
    bookmarkStyles.includes("font-size: 13px") &&
    bookmarkStyles.includes("color: #eeeaf5") &&
    bookmarkStyles.includes("line-height: 1.15") &&
    bookmarkStyles.includes("top: calc(100% + 5px)") &&
    bookmarkStyles.includes("var(--orbit-slot-gap))) - 2px") &&
    !baseStyles.includes("--tile-font-size") &&
    !bookmarkStyles.includes("--tile-font-size") &&
    !bookmarkStyles.includes('font-family: "Segoe UI Variable Text"') &&
    compiledStyles.includes('font-family: "Nunito", sans-serif') &&
    compiledStyles.includes("color: #eeeaf5"),
"Закладки: подписи не используют единую типографику Nunito блока погоды");
assert(bookmarkUiScript.includes('bookmarkTooltip.className = "bookmark-tooltip"') &&
    bookmarkUiScript.includes('tile.dataset.fullTitle = fullTitle') &&
    bookmarkUiScript.includes('closest(".tile[data-full-title]")') &&
    bookmarkUiScript.includes('tile.matches(":hover")') &&
    bookmarkUiScript.includes("}, 300);") &&
    bookmarkUiScript.includes("hideBookmarkTooltip(true);") &&
    !bookmarkUiScript.includes("tile.title = bookmark.title") &&
    bookmarkStyles.includes("html body .bookmark-tooltip") &&
    bookmarkStyles.includes("background: rgba(36, 32, 51, .94)") &&
    bookmarkStyles.includes("transition: opacity 180ms ease") &&
    bookmarkStyles.includes("pointer-events: none") &&
    compiledStyles.includes("html body .bookmark-tooltip.is-visible"),
"Закладки: общая подсказка полного названия или её защита от drag-and-drop настроена неверно");
assert(bookmarkStyles.includes("clip-path: ellipse(50% 100% at 50% 100%)"),
    "_bookmarks.scss: область нажатия поиска не повторяет границу Солнца");
assert(bookmarkStyles.includes("display: inline-flex") &&
    bookmarkStyles.includes("align-items: center") &&
    bookmarkStyles.includes("font-size: 22px") &&
    bookmarkStyles.includes("font-weight: 700") &&
    bookmarkStyles.includes("width: 22px") &&
    bookmarkStyles.includes("height: 22px") &&
    !bookmarkStyles.includes("var(--search-collapsed-cap-height) - 61px"),
    "_bookmarks.scss: надпись и значок поиска не выровнены общей flex-осью");
assert(bookmarkStyles.includes("width: var(--search-trigger-width)") &&
    bookmarkStyles.includes("height: var(--search-trigger-height)") &&
    bookmarkStyles.includes("background: transparent") &&
    bookmarkStyles.includes("border-radius: 0") &&
    bookmarkStyles.includes("background: radial-gradient(ellipse") &&
    bookmarkStyles.includes("&:focus-visible::before") &&
    !bookmarkStyles.includes("width: min(188px") &&
    bookmarkUiScript.includes('setProperty("--search-trigger-top"') &&
    bookmarkUiScript.includes('setProperty("--search-trigger-width"') &&
    bookmarkUiScript.includes('setProperty("--search-trigger-height"') &&
    bookmarkUiScript.includes("baseTriggerTop + 13") &&
    bookmarkUiScript.includes("visibleCapHeight - searchTriggerTop - 2"),
    "_bookmarks.scss: поиск не размещён с безопасным отступом внутри Солнца");
const manifest = JSON.parse(read("manifest.json"));
assert(manifest.manifest_version === 3, "manifest.json: требуется Manifest V3");
assert(manifest.name === "Orbitella" &&
    manifest.description === "A customizable cosmic new tab for Chrome with animated planets, bookmarks, search, weather, and a charming cartoon design." &&
    dashboardHtml.includes("<title>Orbitella</title>") &&
    mainScript.includes('document.title = "Orbitella"'),
"Название Orbitella указано не во всех пользовательских местах");
assert(fs.existsSync(path.join(projectRoot, manifest.chrome_url_overrides?.newtab || "")),
    "manifest.json: не найден файл новой вкладки");
assert(new Set(manifest.permissions || []).size === (manifest.permissions || []).length,
    "manifest.json: разрешения не должны повторяться");
const requiredPermissions = [
    "bookmarks", "storage", "search", "favicon", "geolocation",
    "identity", "identity.email", "history"
];
assert(requiredPermissions.every(permission => manifest.permissions?.includes(permission)),
    `manifest.json: отсутствуют разрешения ${requiredPermissions
        .filter(permission => !manifest.permissions?.includes(permission)).join(", ")}`);
assert(manifest.host_permissions?.includes("https://*/*") &&
    manifest.host_permissions?.includes("http://*/*"),
"manifest.json: поиск favicon должен сохранять доступ к HTTP(S)-сайтам пользователя");
assert(manifest.content_security_policy?.extension_pages?.includes("script-src 'self'"),
    "manifest.json: отсутствует локальная CSP для скриптов");

const javascript = fs.readdirSync(path.join(projectRoot, "js"))
    .filter(file => file.endsWith(".js"))
    .map(file => read(path.join("js", file)))
    .join("\n");
assert(!/\beval\s*\(|\bnew\s+Function\s*\(/.test(javascript),
    "JavaScript: найдено небезопасное динамическое выполнение кода");

const interfaceContext = vm.createContext({
    URL,
    document: {
        querySelector: () => null,
        querySelectorAll: () => []
    }
});
new vm.Script(read(path.join("js", "interface.js")), { filename: "interface.js" })
    .runInContext(interfaceContext);
assert(interfaceContext.normalizeWebsiteUrl(" example.com/path ") === "https://example.com/path" &&
    interfaceContext.normalizeWebsiteUrl("http://example.com/") === "http://example.com/" &&
    interfaceContext.normalizeWebsiteUrl("") === null &&
    interfaceContext.normalizeWebsiteUrl("not a url") === null,
"interface.js: нормализация адреса закладки должна принимать только HTTP(S) и добавлять HTTPS");

const bookmarkStoreContext = vm.createContext({
    DASHBOARD_TILE_GAP: 16,
    settings: {
        showBookmarkTitles: true,
        tileSize: "medium"
    },
    isWebsite: interfaceContext.isWebsite
});
new vm.Script(read(path.join("js", "bookmark-store.js")), { filename: "bookmark-store.js" })
    .runInContext(bookmarkStoreContext);
const decodedFolderColors = bookmarkStoreContext.decodeFolderColors({
    "folder:Apricot": "amber",
    "folder:Lavender": "violet",
    "folder:Invalid": "red"
});
assert(decodedFolderColors.get("folder:Apricot") === "amber" &&
    decodedFolderColors.get("folder:Lavender") === "violet" &&
    !decodedFolderColors.has("folder:Invalid"),
"bookmark-store.js: должны приниматься только три совместимых значения цвета папок");
assert(bookmarkStoreContext.getDashboardViewportClass(600) === "phone" &&
    bookmarkStoreContext.getDashboardViewportClass(601) === "tablet" &&
    bookmarkStoreContext.getDashboardViewportClass(1101) === "desktop" &&
    bookmarkStoreContext.compareDashboardLayoutItems(
        { order: 2, x: 0, y: 0 }, { order: 2, x: 1, y: 0 }) < 0,
"bookmark-store.js: профили экрана и стабильная сортировка раскладки изменились");
const titledArcMetrics = vm.runInContext("getDashboardArcMetrics(0)", bookmarkStoreContext);
const titledSecondArcMetrics = vm.runInContext("getDashboardArcMetrics(1)", bookmarkStoreContext);
const titledGap = vm.runInContext("getDashboardBookmarkGap()", bookmarkStoreContext);
const titledOrbitGap = vm.runInContext("getDashboardBookmarkOrbitGap()", bookmarkStoreContext);
const titledFillOrder = vm.runInContext("getDashboardArcFillOrder(0)", bookmarkStoreContext);
assert(titledFillOrder.length === titledArcMetrics.capacity &&
    new Set(titledFillOrder).size === titledArcMetrics.capacity &&
    Math.abs(titledFillOrder[0] - (titledArcMetrics.capacity - 1) / 2) <= .5 &&
    titledFillOrder.includes(0) && titledFillOrder.includes(titledArcMetrics.capacity - 1) &&
    vm.runInContext("getDashboardEllipseArcLength(300, 240, .8)", bookmarkStoreContext) >
        300 * Math.sin(.8),
"bookmark-store.js: дуга должна сохранять центральное заполнение и нижние слоты");
vm.runInContext("settings.showBookmarkTitles = false", bookmarkStoreContext);
const compactArcMetrics = vm.runInContext("getDashboardArcMetrics(0)", bookmarkStoreContext);
const compactSecondArcMetrics = vm.runInContext("getDashboardArcMetrics(1)", bookmarkStoreContext);
assert(vm.runInContext("getDashboardBookmarkTitleRoom()", bookmarkStoreContext) === 0 &&
    vm.runInContext("getDashboardBookmarkGap()", bookmarkStoreContext) < titledGap &&
    vm.runInContext("getDashboardBookmarkOrbitGap()", bookmarkStoreContext) < titledOrbitGap &&
    compactArcMetrics.capacity === titledArcMetrics.capacity &&
    compactArcMetrics.reach === titledArcMetrics.reach &&
    compactSecondArcMetrics.radiusX === titledSecondArcMetrics.radiusX &&
    compactArcMetrics.capacity >= 3,
"bookmark-store.js: скрытие подписей должно компактно перестраивать дуги");

const responsiveCompactMetrics = [
    [480, 640],
    [800, 600],
    [1280, 720],
    [1600, 900]
].map(([width, height]) => {
    bookmarkStoreContext.innerWidth = width;
    bookmarkStoreContext.innerHeight = height;
    vm.runInContext("settings.showBookmarkTitles = true", bookmarkStoreContext);
    const titled = vm.runInContext(
        "Array.from({ length: 10 }, (_, arc) => getDashboardArcMetrics(arc))",
        bookmarkStoreContext);
    vm.runInContext("settings.showBookmarkTitles = false", bookmarkStoreContext);
    const compact = vm.runInContext(
        "Array.from({ length: 10 }, (_, arc) => getDashboardArcMetrics(arc))",
        bookmarkStoreContext);
    return { titled, compact };
});
assert(responsiveCompactMetrics.every(({ titled, compact }) =>
    compact.every((metrics, arc) => metrics.capacity === titled[arc].capacity &&
        metrics.reach === titled[arc].reach && metrics.radiusX === titled[arc].radiusX)),
"bookmark-store.js: адаптивные интервалы не должны менять набор слотов дуги");
vm.runInContext("settings.tileSize = 'extra-small'; settings.showBookmarkTitles = true",
    bookmarkStoreContext);
const extraSmallSpacing = vm.runInContext(
    "({ tile: getDashboardBookmarkGap(), orbit: getDashboardBookmarkOrbitGap() })",
    bookmarkStoreContext);
vm.runInContext("settings.tileSize = 'small'", bookmarkStoreContext);
const smallSpacing = vm.runInContext(
    "({ tile: getDashboardBookmarkGap(), orbit: getDashboardBookmarkOrbitGap() })",
    bookmarkStoreContext);
assert(54 + extraSmallSpacing.tile < 66 + smallSpacing.tile &&
    54 + 21 + extraSmallSpacing.orbit < 66 + 22 + smallSpacing.orbit,
"bookmark-store.js: шаги между плитками и дугами должны учитывать размер значков");

const tileColorsContext = vm.createContext({ URL });
new vm.Script(read(path.join("js", "tile-colors.js")), { filename: "tile-colors.js" })
    .runInContext(tileColorsContext);
const redHsl = tileColorsContext.rgbToHsl(255, 0, 0);
assert(redHsl[0] === 0 && redHsl[1] === 1 && redHsl[2] === .5 &&
    tileColorsContext.getTextHash("abc") === 96354 &&
    tileColorsContext.getHostAppearance("https://www.youtube.com/watch?v=1")?.color === "#c72d3a" &&
    tileColorsContext.getHostAppearance("https://chatgpt.com/")?.tone === "dark" &&
    tileColorsContext.getFaviconVisualScale({}, "https://mega.nz/") === .846,
"tile-colors.js: преобразование цветов, стабильный хеш или известные палитры изменились");

const faviconContext = vm.createContext({ URL });
new vm.Script(read(path.join("js", "favicon.js")), { filename: "favicon.js" })
    .runInContext(faviconContext);
assert(faviconContext.shouldUseBrowserManagedFavicon("https://mega.io/") &&
    faviconContext.shouldUseBrowserManagedFavicon("https://mega.nz/fm") &&
    !faviconContext.shouldUseBrowserManagedFavicon("https://example.com/"),
"favicon.js: точечное исправление favicon MEGA настроено неверно");

const settingsContext = vm.createContext({
    console,
    TextEncoder,
    document: {
        querySelector: () => null,
        getElementById: () => null
    }
});
new vm.Script(read(path.join("js", "settings.js")), { filename: "settings.js" })
    .runInContext(settingsContext);
const normalizedSettings = settingsContext.normalizeDashboardSettings({
    language: "de",
    showSearch: false,
    showBookmarks: false,
    showBookmarkTitles: false,
    backgroundMode: "unsupported",
    wallpaperPosition: "unsupported",
    tileSize: "medium",
    obsoleteSetting: true
});
assert(normalizedSettings.settings.language === "ru" &&
    normalizedSettings.settings.showSearch === false &&
    normalizedSettings.settings.showBookmarks === false &&
    normalizedSettings.settings.showBookmarkTitles === false &&
    !("backgroundMode" in normalizedSettings.settings) &&
    !("wallpaperPosition" in normalizedSettings.settings) &&
    normalizedSettings.settings.tileSize === "small" &&
    normalizedSettings.settings.layoutModel === "fixed-spacing-v6" &&
    normalizedSettings.removedUnknownSettings === true &&
    normalizedSettings.migratedTileSize === true &&
    normalizedSettings.needsAutomaticLayoutMigration === true,
"settings.js: нормализация должна сохранять булевы настройки и безопасно исправлять старые значения");
const compatibleSettings = settingsContext.normalizeDashboardSettings({
    language: "en",
    showSearch: true,
    showBookmarks: true,
    showBookmarkTitles: true,
    tileSize: "small",
    layoutModel: "fixed-spacing-v6"
});
assert(compatibleSettings.settings.language === "en" &&
    compatibleSettings.settings.tileSize === "small" &&
    compatibleSettings.removedUnknownSettings === false &&
    compatibleSettings.migratedTileSize === false &&
    compatibleSettings.needsAutomaticLayoutMigration === false,
"settings.js: поддерживаемые сохранённые настройки не должны изменяться при нормализации");
const legacyWallpaperSettings = settingsContext.normalizeDashboardSettings({
    ...compatibleSettings.settings,
    backgroundMode: "custom",
    wallpaperPosition: "bottom-right"
});
assert(!("backgroundMode" in legacyWallpaperSettings.settings) &&
    !("wallpaperPosition" in legacyWallpaperSettings.settings) &&
    legacyWallpaperSettings.settings.showBookmarks === true &&
    legacyWallpaperSettings.removedUnknownSettings === true,
"settings.js: старые настройки обоев должны удаляться без потери остальных параметров");
const restoredLegacyLayout = settingsContext.decodeDashboardLayout([
    ["bookmark:Legacy\u001ehttps://example.com/", 4, 2, 7]
]);
assert(restoredLegacyLayout[0]?.syncKey === "bookmark:Legacy\u001ehttps://example.com/" &&
    restoredLegacyLayout[0]?.order === 4 &&
    restoredLegacyLayout[0]?.arc === 2 &&
    restoredLegacyLayout[0]?.slot === 7 &&
    restoredLegacyLayout[0]?.x === 7 &&
    restoredLegacyLayout[0]?.y === 2,
"settings.js: старый компактный формат раскладки должен оставаться совместимым");
const sampleSnapshot = {
    dashboardSettings: { language: "ru", tileSize: "medium" },
    dashboardLayout: [
        { id: "12", syncKey: "bookmark:Example\u001ehttps://example.com/", order: 0, arc: 1, slot: 2 }
    ],
    dashboardLayouts: {
        "medium@desktop-test": [
            { id: "12", syncKey: "bookmark:Example\u001ehttps://example.com/", order: 0, arc: 1, slot: 2 }
        ]
    },
    dashboardHiddenTitles: ["12"],
    dashboardFolderColors: { "folder:Example": "mint" },
    dashboardStateUpdatedAt: 123
};
const restoredSnapshot = settingsContext.decodeDashboardSyncPayload(
    settingsContext.createDashboardSyncPayload(sampleSnapshot));
assert(restoredSnapshot?.dashboardLayout?.[0]?.syncKey === sampleSnapshot.dashboardLayout[0].syncKey &&
    restoredSnapshot?.dashboardLayouts?.["medium@desktop-test"]?.[0]?.slot === 2 &&
    restoredSnapshot?.dashboardFolderColors?.["folder:Example"] === "mint" &&
    restoredSnapshot?.dashboardStateUpdatedAt === 123,
"settings.js: компактный формат синхронизации не проходит обратное преобразование");

const largeSerializedSnapshot = JSON.stringify(settingsContext.createDashboardSyncPayload({
    ...sampleSnapshot,
    dashboardLayout: Array.from({ length: 220 }, (_, index) => ({
        id: String(index),
        syncKey: `bookmark:Папка ${index}\u001ehttps://example.com/${index}/` + "я".repeat(32),
        order: index,
        arc: index % 7,
        slot: index % 19
    })),
    dashboardLayouts: {}
}));
const syncChunks = settingsContext.splitDashboardSyncPayload(largeSerializedSnapshot);
const syncRevision = "123-abcdef";
assert(syncChunks.length > 1 && syncChunks.length <= 15,
    "settings.js: синхронный снимок неверно разбит на части");
assert(syncChunks.every(chunk => Buffer.byteLength(JSON.stringify({
    revision: syncRevision,
    data: chunk
}), "utf8") < 8192),
"settings.js: часть синхронного снимка превышает квоту одного ключа");
assert(Buffer.byteLength(syncChunks.map((data, index) => JSON.stringify({
    [`dashboardSyncChunkV2:${index}`]: { revision: syncRevision, data }
})).join(""), "utf8") < 102400,
"settings.js: синхронный снимок превышает общую квоту Chrome");

const styleEntry = read(path.join("styles", "style.scss"));
for (const match of styleEntry.matchAll(/@use\s+"([^"]+)"/g)) {
    assert(fs.existsSync(path.join(projectRoot, "styles", `_${match[1]}.scss`)),
        `style.scss: не найден модуль ${match[1]}`);
}
const importedStyleModules = new Set([...styleEntry.matchAll(/@use\s+"([^"]+)"/g)]
    .map(match => `_${match[1]}.scss`));
const styleModules = fs.readdirSync(path.join(projectRoot, "styles"))
    .filter(file => file.startsWith("_") && file.endsWith(".scss"));
assert(styleModules.every(file => importedStyleModules.has(file)),
    `style.scss: не подключены модули ${styleModules.filter(file => !importedStyleModules.has(file)).join(", ")}`);
assert(!compiledStyles.includes("sourceMappingURL"),
    "style.css: подключена отсутствующая или устаревшая карта исходников");

const htmlSources = ["index.html", "microphone.html"].map(read).join("\n");
const referencedScripts = new Set([...htmlSources.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)]
    .map(match => match[1].replaceAll("\\", "/")));
const javascriptFiles = fs.readdirSync(path.join(projectRoot, "js"))
    .filter(file => file.endsWith(".js"))
    .map(file => `js/${file}`);
assert(javascriptFiles.every(file => referencedScripts.has(file)),
    `js: не подключены скрипты ${javascriptFiles.filter(file => !referencedScripts.has(file)).join(", ")}`);
assert(javascriptFiles.every(file => /^\/\/ [а-яё]/u.test(read(file))),
    `js: нет короткого комментария в начале ${javascriptFiles
        .filter(file => !/^\/\/ [а-яё]/u.test(read(file))).join(", ")}`);

const styleFiles = fs.readdirSync(path.join(projectRoot, "styles"))
    .filter(file => file.endsWith(".scss") || file.endsWith(".css"))
    .map(file => `styles/${file}`);
assert(styleFiles.every(file => !/\/\*[\s\S]*?\*\//.test(read(file))),
    `styles: остались комментарии в ${styleFiles
        .filter(file => /\/\*[\s\S]*?\*\//.test(read(file))).join(", ")}`);
const htmlComments = [...htmlSources.matchAll(/<!--([\s\S]*?)-->/g)]
    .map(match => match[1].trim());
assert(htmlComments.every(comment => /^[а-яё ]+$/u.test(comment)),
    `html: остались лишние комментарии ${htmlComments
        .filter(comment => !/^[а-яё ]+$/u.test(comment)).join(", ")}`);
assert(!heroStyles.includes(".hero h1") &&
    (bookmarkStyles.match(/^\s*\.orbital-sun\s*\{/gm) || []).length === 1 &&
    (compiledStyles.match(/^html body \.orbital-search-area \.orbital-sun \{$/gm) || []).length === 1,
"Стили: остался старый заголовок или дублирующий блок Солнца");

function listFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    });
}

const assetReferences = [
    ...["index.html", "microphone.html"].map(read),
    ...fs.readdirSync(path.join(projectRoot, "js")).filter(file => file.endsWith(".js"))
        .map(file => read(path.join("js", file))),
    ...fs.readdirSync(path.join(projectRoot, "styles"))
        .filter(file => file.endsWith(".scss") || file.endsWith(".css"))
        .map(file => read(path.join("styles", file)))
].join("\n").replaceAll("\\", "/");
const assetFiles = listFiles(path.join(projectRoot, "assets"))
    .map(file => path.relative(projectRoot, file).replaceAll("\\", "/"));
const assetLicenses = new Set(["assets/fonts/Nunito-OFL.txt"]);
assert([...assetLicenses].every(file => assetFiles.includes(file)),
    "assets: отсутствует лицензия шрифта Nunito");
assert(assetFiles.every(file => assetLicenses.has(file) || assetReferences.includes(file)),
    `assets: не используются файлы ${assetFiles
        .filter(file => !assetLicenses.has(file) && !assetReferences.includes(file)).join(", ")}`);

const translationContext = vm.createContext({ settings: { language: "ru" } });
new vm.Script(read(path.join("js", "translations.js")), { filename: "translations.js" })
    .runInContext(translationContext);
const translationCatalog = new vm.Script("translations").runInContext(translationContext);
const russianTranslationKeys = Object.keys(translationCatalog.ru).sort();
const englishTranslationKeys = Object.keys(translationCatalog.en).sort();
assert(JSON.stringify(russianTranslationKeys) === JSON.stringify(englishTranslationKeys),
    "translations.js: наборы ключей русского и английского языков различаются");
const translationReferences = new Set([
    ...[...assetReferences.matchAll(/\btranslate\(\s*["']([^"']+)["']/g)].map(match => match[1]),
    ...[...htmlSources.matchAll(/\bdata-i18n(?:-aria-label|-placeholder)?="([^"]+)"/g)]
        .map(match => match[1])
]);
assert([...translationReferences].every(key => Object.hasOwn(translationCatalog.ru, key)),
    `translations.js: отсутствуют переводы ${[...translationReferences]
        .filter(key => !Object.hasOwn(translationCatalog.ru, key)).join(", ")}`);

if (failures.length) {
    console.error(failures.map(failure => `- ${failure}`).join("\n"));
    process.exitCode = 1;
} else {
    console.log("Static audit checks passed.");
}
