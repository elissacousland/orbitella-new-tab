// настройки и сохранение данных

"use strict";

const DASHBOARD_TILE_GAP = 16;

const defaultSettings = {
    language: "ru",
    showSearch: true,
    showBookmarks: true,
    showBookmarkTitles: true,
    tileSize: "small",
    layoutModel: "fixed-spacing-v6"
};

let settings = {
    ...defaultSettings
};

let dashboardSettingsSaveQueue = Promise.resolve();

let dashboardStateUpdatedAt = 0;

const dashboardStorageKeys = [
    "dashboardSettings",
    "dashboardLayout",
    "dashboardLayouts",
    "dashboardHiddenTitles",
    "dashboardFolderColors",
    "dashboardStateUpdatedAt"
];

const dashboardSyncMetaKey = "dashboardSyncMetaV2";

const dashboardSyncChunkPrefix = "dashboardSyncChunkV2:";

const dashboardSyncChunkByteLength = 6000;

const dashboardSyncMaxChunks = 15;

const dashboardLegacySyncKeys = dashboardStorageKeys.filter(key => key !== "dashboardStateUpdatedAt");

let dashboardStorageChangeTimer = 0;

function decodeDashboardLayout(value) {
    if (!Array.isArray(value)) return [];
    return value.map(item => {
        if (!Array.isArray(item)) return { ...item };
        const [syncKey, order, arc, slot] = item;
        return { syncKey, order, arc, slot, x: slot, y: arc };
    });
}

function decodeDashboardLayouts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return Object.create(null);
    return Object.fromEntries(Object.entries(value)
        .filter(([layoutKey]) => /^(extra-small|small|medium)(@[a-z0-9-]+)?$/.test(layoutKey))
        .map(([layoutKey, items]) => [layoutKey, decodeDashboardLayout(items)]));
}

function getDashboardLayoutsSnapshot() {
    if (typeof rememberDashboardLayout === "function") rememberDashboardLayout(settings.tileSize);
    return Object.fromEntries(Object.entries(layoutsByTileSize || {})
        .map(([tileSize, items]) => [tileSize, items.map(item => {
            const bookmark = typeof findBookmark === "function" ? findBookmark(item.id) : null;
            return { ...item, syncKey: bookmark?.syncKey || item.syncKey || "" };
        })]));
}

// готовим данные для синхронизации
function createDashboardSyncPayload(snapshot) {
    const identities = [];
    const identityIndexes = new Map();
    const getIdentityIndex = function(item) {
        const identity = item.syncKey ? `s:${item.syncKey}` : `i:${item.id || ""}`;
        if (!identityIndexes.has(identity)) {
            identityIndexes.set(identity, identities.length);
            identities.push(identity);
        }
        return identityIndexes.get(identity);
    };
    const encodeLayout = items => items.map(item => [
        getIdentityIndex(item),
        Number(item.order) || 0,
        Number(item.arc) || 0,
        Number(item.slot) || 0
    ]);
    const hiddenTitles = snapshot.dashboardHiddenTitles.map(id => {
        const bookmark = typeof findBookmark === "function" ? findBookmark(id) : null;
        return bookmark?.syncKey ? `s:${bookmark.syncKey}` : `i:${id}`;
    });
    return {
        version: 2,
        updatedAt: snapshot.dashboardStateUpdatedAt,
        settings: snapshot.dashboardSettings,
        identities,
        layout: encodeLayout(snapshot.dashboardLayout),
        layouts: Object.entries(snapshot.dashboardLayouts)
            .map(([layoutKey, items]) => [layoutKey, encodeLayout(items)]),
        hiddenTitles,
        folderColors: snapshot.dashboardFolderColors || {}
    };
}

function decodeDashboardSyncPayload(payload) {
    if (payload?.version !== 2 || !Array.isArray(payload.identities) ||
        !Array.isArray(payload.layout) || !Array.isArray(payload.layouts)) return null;
    const decodeLayout = items => items.map(item => {
        if (!Array.isArray(item)) return null;
        const identity = String(payload.identities[Number(item[0])] || "");
        const syncKey = identity.startsWith("s:") ? identity.slice(2) : "";
        const id = identity.startsWith("i:") ? identity.slice(2) : "";
        const order = Number(item[1]) || 0;
        const arc = Number(item[2]) || 0;
        const slot = Number(item[3]) || 0;
        return { id, syncKey, order, arc, slot, x: slot, y: arc };
    }).filter(Boolean);
    const dashboardLayouts = Object.fromEntries(payload.layouts
        .filter(item => Array.isArray(item) && typeof item[0] === "string" && Array.isArray(item[1]))
        .map(([layoutKey, items]) => [layoutKey, decodeLayout(items)]));
    const hiddenTitles = Array.isArray(payload.hiddenTitles) ? payload.hiddenTitles.map(identity => {
        const value = String(identity || "");
        return value.startsWith("s:") || value.startsWith("i:") ? value.slice(2) : value;
    }).filter(Boolean) : [];
    return {
        dashboardSettings: payload.settings,
        dashboardLayout: decodeLayout(payload.layout),
        dashboardLayouts,
        dashboardHiddenTitles: hiddenTitles,
        dashboardFolderColors: payload.folderColors && typeof payload.folderColors === "object" ?
            payload.folderColors : {},
        dashboardStateUpdatedAt: Number(payload.updatedAt) || 0
    };
}

function splitDashboardSyncPayload(serialized) {
    const encoder = new TextEncoder();
    const chunks = [];
    let characters = [];
    let byteLength = 0;
    for (const character of serialized) {
        const characterByteLength = encoder.encode(character).byteLength;
        if (byteLength + characterByteLength > dashboardSyncChunkByteLength && characters.length) {
            chunks.push(characters.join(""));
            characters = [];
            byteLength = 0;
        }
        characters.push(character);
        byteLength += characterByteLength;
    }
    if (characters.length) chunks.push(characters.join(""));
    return chunks;
}

async function readDashboardSyncState() {
    const stored = await chrome.storage.sync.get([...dashboardStorageKeys, dashboardSyncMetaKey]);
    const meta = stored[dashboardSyncMetaKey];
    if (!meta || meta.version !== 2 || !Number.isInteger(meta.chunkCount) ||
        meta.chunkCount < 1 || meta.chunkCount > dashboardSyncMaxChunks || !meta.revision) {
        return stored;
    }
    const chunkKeys = Array.from({ length: meta.chunkCount },
        (_, index) => `${dashboardSyncChunkPrefix}${index}`);
    const savedChunks = await chrome.storage.sync.get(chunkKeys);
    const chunks = chunkKeys.map(key => savedChunks[key]);
    if (chunks.some(chunk => chunk?.revision !== meta.revision || typeof chunk.data !== "string")) {
        return {};
    }
    try {
        const decoded = decodeDashboardSyncPayload(JSON.parse(chunks.map(chunk => chunk.data).join("")));
        return decoded || {};
    } catch {
        return {};
    }
}

async function saveDashboardSyncState(snapshot) {
    const serialized = JSON.stringify(createDashboardSyncPayload(snapshot));
    const chunks = splitDashboardSyncPayload(serialized);
    if (!chunks.length || chunks.length > dashboardSyncMaxChunks) {
        throw new RangeError("Dashboard sync snapshot is too large");
    }
    const revision = `${snapshot.dashboardStateUpdatedAt}-${Math.random().toString(36).slice(2, 8)}`;
    const chunkValues = Object.fromEntries(chunks.map((data, index) => [
        `${dashboardSyncChunkPrefix}${index}`,
        { revision, data }
    ]));
    try {
        await chrome.storage.sync.set(chunkValues);
    } catch (error) {
        await chrome.storage.sync.remove(dashboardLegacySyncKeys);
        await chrome.storage.sync.set(chunkValues);
        console.info("Legacy dashboard sync data was replaced", error);
    }
    await chrome.storage.sync.set({
        [dashboardSyncMetaKey]: {
            version: 2,
            revision,
            chunkCount: chunks.length,
            updatedAt: snapshot.dashboardStateUpdatedAt
        },
        dashboardStateUpdatedAt: snapshot.dashboardStateUpdatedAt
    });
    const synchronized = await chrome.storage.sync.get(null);
    const staleChunkKeys = Object.keys(synchronized).filter(key => {
        if (!key.startsWith(dashboardSyncChunkPrefix)) return false;
        const index = Number(key.slice(dashboardSyncChunkPrefix.length));
        return Number.isInteger(index) && index >= chunks.length;
    });
    await chrome.storage.sync.remove([...dashboardLegacySyncKeys, ...staleChunkKeys]);
}

const settingsButton = document.querySelector(".settings-button");

const settingsDialog = document.querySelector(".settings-dialog");

const settingsForm = document.querySelector(".settings-dialog form");

const languageSelect = document.getElementById("language-select");

const showSearchInput = document.getElementById("show-search");

const showBookmarksInput = document.getElementById("show-bookmarks");

const showBookmarkTitlesInput = document.getElementById("show-bookmark-titles");

const bookmarksSection = document.querySelector(".bookmarks");

const tileSizeSelect = document.getElementById("tile-size-select");

const dashboardLanguageValues = new Set(["ru", "en"]);

const dashboardTileSizeValues = new Set(["extra-small", "small"]);

function normalizeDashboardSettings(savedSettings) {
    const source = savedSettings && typeof savedSettings === "object" &&
        !Array.isArray(savedSettings) ? { ...savedSettings } : {};
    const knownSettings = Object.fromEntries(Object.entries(source)
        .filter(([key]) => Object.hasOwn(defaultSettings, key)));
    const normalized = {
        ...defaultSettings,
        ...knownSettings
    };
    normalized.language = dashboardLanguageValues.has(normalized.language) ?
        normalized.language : defaultSettings.language;
    const normalizedTileSize = dashboardTileSizeValues.has(normalized.tileSize) ?
        normalized.tileSize : defaultSettings.tileSize;
    const migratedTileSize = normalizedTileSize !== normalized.tileSize;
    normalized.tileSize = normalizedTileSize;
    normalized.showSearch = normalized.showSearch !== false;
    normalized.showBookmarks = normalized.showBookmarks !== false;
    normalized.showBookmarkTitles = normalized.showBookmarkTitles !== false;
    return {
        settings: normalized,
        needsAutomaticLayoutMigration: source.layoutModel !== defaultSettings.layoutModel,
        removedUnknownSettings: Object.keys(knownSettings).length !== Object.keys(source).length,
        migratedTileSize
    };
}

function restoreDashboardLayout(saved) {
    layoutsByTileSize = decodeDashboardLayouts(saved.dashboardLayouts);
    const legacyLayout = decodeDashboardLayout(saved.dashboardLayout);
    activeDashboardLayoutKey = getDashboardLayoutStorageKey(settings.tileSize);
    const responsiveLayout = layoutsByTileSize[activeDashboardLayoutKey];
    const tileSizeLayout = layoutsByTileSize[settings.tileSize];
    layout = Array.isArray(responsiveLayout) ?
        responsiveLayout.map(item => ({ ...item })) :
        Array.isArray(tileSizeLayout) ? tileSizeLayout.map(item => ({ ...item })) : legacyLayout;
    if (!Array.isArray(responsiveLayout)) {
        layoutsByTileSize[activeDashboardLayoutKey] = layout.map(item => ({ ...item }));
    }
}

function getDashboardLayoutSnapshot(resolveSyncKeys = false) {
    return layout.map(item => {
        if (!resolveSyncKeys) return { ...item };
        const bookmark = typeof findBookmark === "function" ? findBookmark(item.id) : null;
        return { ...item, syncKey: bookmark?.syncKey || item.syncKey || "" };
    });
}

function createDashboardStateSnapshot(resolveLayoutSyncKeys = false) {
    return {
        dashboardSettings: { ...settings },
        dashboardLayout: getDashboardLayoutSnapshot(resolveLayoutSyncKeys),
        dashboardLayouts: getDashboardLayoutsSnapshot(),
        dashboardHiddenTitles: [...hiddenBookmarkTitles],
        dashboardFolderColors: getFolderColorsSnapshot(),
        dashboardStateUpdatedAt
    };
}

// загружаем настройки
async function loadDashboardSettings() {
    try {
        const [localSaved, syncedSaved] = await Promise.all([
            chrome.storage.local.get(dashboardStorageKeys),
            readDashboardSyncState().catch(() => ({}))
        ]);
        const localUpdatedAt = Number(localSaved.dashboardStateUpdatedAt) || 0;
        const syncedUpdatedAt = Number(syncedSaved.dashboardStateUpdatedAt) || 0;
        const syncedHasState = syncedSaved.dashboardSettings || Array.isArray(syncedSaved.dashboardLayout);
        const localHasState = localSaved.dashboardSettings || Array.isArray(localSaved.dashboardLayout);
        const saved = syncedHasState && (!localHasState || syncedUpdatedAt > localUpdatedAt) ?
            syncedSaved : localSaved;
        dashboardStateUpdatedAt = Math.max(localUpdatedAt, syncedUpdatedAt);
        const normalizedSettings = normalizeDashboardSettings(saved.dashboardSettings);
        const { removedUnknownSettings, migratedTileSize, needsAutomaticLayoutMigration } =
            normalizedSettings;
        settings = normalizedSettings.settings;
        restoreDashboardLayout(saved);
        if (needsAutomaticLayoutMigration) {
            const hasExplicitOrbitalSlots = layout.every(item => {
                const arc = Number(item.arc);
                const slot = Number(item.slot);
                return Number.isInteger(arc) && arc >= 0 &&
                    Number.isInteger(slot) && slot >= 0;
            });
            // сохраняем готовые орбитальные позиции
            if (!hasExplicitOrbitalSlots &&
                typeof migrateDashboardLayoutToAutomaticArcs === "function") {
                migrateDashboardLayoutToAutomaticArcs();
            }
            // завершаем миграцию
            settings.layoutModel = defaultSettings.layoutModel;
        }
        hiddenBookmarkTitles = new Set(Array.isArray(saved.dashboardHiddenTitles) ? saved.dashboardHiddenTitles.map(String) : []);
        folderColors = decodeFolderColors(saved.dashboardFolderColors);
        const normalizedSnapshot = createDashboardStateSnapshot();
        if (saved === syncedSaved || removedUnknownSettings || migratedTileSize || needsAutomaticLayoutMigration) {
            await chrome.storage.local.set(normalizedSnapshot);
        }
        if (removedUnknownSettings || migratedTileSize || needsAutomaticLayoutMigration ||
            (saved === localSaved && (localUpdatedAt > syncedUpdatedAt || !syncedHasState))) {
            await saveDashboardSyncState(normalizedSnapshot).catch(() => undefined);
        }
    } catch (error) {
        console.error(error);
        showNotification(translate("saveError"));
    }
}

// сохраняем настройки
async function saveDashboardSettings() {
    dashboardStateUpdatedAt = Math.max(Date.now(), dashboardStateUpdatedAt + 1);
    const snapshot = createDashboardStateSnapshot(true);
    dashboardSettingsSaveQueue = dashboardSettingsSaveQueue
        .catch(() => undefined)
        .then(async () => {
            await chrome.storage.local.set(snapshot);
            try {
                await saveDashboardSyncState(snapshot);
            } catch (error) {
                console.warn("Dashboard sync storage is unavailable", error);
            }
        });
    try {
        await dashboardSettingsSaveQueue;
    } catch (error) {
        console.error(error);
        showNotification(translate("saveError"));
    }
}

async function applyDashboardStorageChanges(changes, areaName) {
    if (!["local", "sync"].includes(areaName)) return;
    const syncChanged = areaName === "sync" && Object.keys(changes).some(key =>
        key === dashboardSyncMetaKey || key.startsWith(dashboardSyncChunkPrefix) ||
        key === "dashboardStateUpdatedAt");
    if (areaName === "local" && !changes.dashboardStateUpdatedAt ||
        areaName === "sync" && !syncChanged) return;
    try {
        const saved = areaName === "sync" ? await readDashboardSyncState() :
            await chrome.storage.local.get(dashboardStorageKeys);
        const updatedAt = Number(saved.dashboardStateUpdatedAt) || 0;
        if (updatedAt <= dashboardStateUpdatedAt) return;
        dashboardStateUpdatedAt = updatedAt;
        if (saved.dashboardSettings && typeof saved.dashboardSettings === "object" &&
            !Array.isArray(saved.dashboardSettings)) {
            settings = normalizeDashboardSettings(saved.dashboardSettings).settings;
        }
        if (Array.isArray(saved.dashboardLayout)) {
            restoreDashboardLayout(saved);
        }
        if (Array.isArray(saved.dashboardHiddenTitles)) {
            hiddenBookmarkTitles = new Set(saved.dashboardHiddenTitles.map(String));
            if (typeof resolveHiddenBookmarkTitles === "function") resolveHiddenBookmarkTitles();
        }
        if (saved.dashboardFolderColors && typeof saved.dashboardFolderColors === "object") {
            folderColors = decodeFolderColors(saved.dashboardFolderColors);
            if (typeof resolveFolderColors === "function" && bookmarks.length) resolveFolderColors();
        }
        if (typeof updateBookmarkPositions === "function" && bookmarks.length) {
            updateBookmarkPositions();
        }
        fillSettingsForm();
        applyLanguage();
        applySearchVisibility();
        applyBookmarksVisibility();
        applyBookmarkTitlesVisibility();
        if (typeof renderBookmarks === "function" && bookmarks.length) {
            renderBookmarks(true);
            renderFolderBookmarks(true);
        }
        if (areaName === "sync") {
            await chrome.storage.local.set(createDashboardStateSnapshot());
        }
    } catch (error) {
        console.warn("Could not apply synchronized dashboard state", error);
    }
}

function handleDashboardStorageChanges(changes, areaName) {
    if (areaName !== "sync") {
        void applyDashboardStorageChanges(changes, areaName);
        return;
    }
    const relevant = Object.keys(changes).some(key =>
        key === dashboardSyncMetaKey || key.startsWith(dashboardSyncChunkPrefix) ||
        key === "dashboardStateUpdatedAt");
    if (!relevant) return;
    clearTimeout(dashboardStorageChangeTimer);
    dashboardStorageChangeTimer = window.setTimeout(() => {
        dashboardStorageChangeTimer = 0;
        void applyDashboardStorageChanges(changes, areaName);
    }, 180);
}

function fillSettingsForm() {
    languageSelect.value = settings.language;
    showSearchInput.checked = settings.showSearch;
    showBookmarksInput.checked = settings.showBookmarks;
    showBookmarkTitlesInput.checked = settings.showBookmarkTitles;
    tileSizeSelect.value = settings.tileSize;
    refreshCustomSelects();
}

function applyBookmarksVisibility() {
    bookmarksSection.hidden = !settings.showBookmarks;
    document.body.dataset.bookmarksVisible = String(settings.showBookmarks);
    if (!settings.showBookmarks) {
        hideBookmarkMenu();
    }
    if (typeof scheduleOrbitalLayout === "function") {
        scheduleOrbitalLayout();
    }
}

function applyBookmarkTitlesVisibility() {
    document.body.dataset.bookmarkTitlesVisible = String(settings.showBookmarkTitles);
}

// применяем настройки
function changeSettings() {
    const previousLanguage = settings.language;
    const previousShowSearch = settings.showSearch;
    const previousShowBookmarks = settings.showBookmarks;
    const previousShowBookmarkTitles = settings.showBookmarkTitles;
    const previousTileSize = settings.tileSize;
    const selectedTileSize = tileSizeSelect.value;
    const tileSizeChanged = selectedTileSize !== previousTileSize;
    if (tileSizeChanged && typeof rememberDashboardLayout === "function") {
        rememberDashboardLayout(previousTileSize);
    }
    settings.language = languageSelect.value;
    settings.showSearch = showSearchInput.checked;
    settings.showBookmarks = showBookmarksInput.checked;
    settings.showBookmarkTitles = showBookmarkTitlesInput.checked;
    settings.tileSize = selectedTileSize;

    const languageChanged = settings.language !== previousLanguage;
    const searchVisibilityChanged = settings.showSearch !== previousShowSearch;
    const bookmarksVisibilityChanged = settings.showBookmarks !== previousShowBookmarks;
    const bookmarkTitlesChanged = settings.showBookmarkTitles !== previousShowBookmarkTitles;
    if (tileSizeChanged && typeof activateDashboardLayout === "function") {
        activateDashboardLayout(settings.tileSize, layout,
            getDashboardLayoutStorageKey(settings.tileSize));
        if (typeof resetCarouselViewport === "function") resetCarouselViewport();
    }

    if (languageChanged) applyLanguage();
    if (searchVisibilityChanged) applySearchVisibility();
    if (bookmarksVisibilityChanged) applyBookmarksVisibility();
    if (bookmarkTitlesChanged) applyBookmarkTitlesVisibility();

    if (languageChanged || tileSizeChanged || bookmarkTitlesChanged) {
        renderBookmarks(!tileSizeChanged);
    }
    saveDashboardSettings();
}

function initSettings() {
    settingsButton.addEventListener("click", function() {
        fillSettingsForm();
        settingsDialog.showModal();
    });
    settingsForm.addEventListener("submit", function(event) {
        event.preventDefault();
        settingsDialog.close();
    });
    languageSelect.addEventListener("change", changeSettings);
    showSearchInput.addEventListener("change", changeSettings);
    showBookmarksInput.addEventListener("change", changeSettings);
    showBookmarkTitlesInput.addEventListener("change", changeSettings);
    tileSizeSelect.addEventListener("change", changeSettings);
    chrome.storage.onChanged?.addListener(handleDashboardStorageChanges);
}
