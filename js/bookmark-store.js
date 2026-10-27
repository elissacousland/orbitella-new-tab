// данные закладок и позиции

"use strict";

let bookmarks = [];

let bookmarkIndex = new Map();

let folderPath = [];

let bookmarkRefreshId = 0;

let bookmarkTreeSignature = null;

let bookmarksRendered = false;

let layout = [];

let layoutsByTileSize = Object.create(null);

let activeDashboardLayoutKey = "";

let creationPosition = null;

let hiddenBookmarkTitles = new Set();

const folderColorNames = new Set(["amber", "mint", "violet"]);

let folderColors = new Map();

const dashboardLayoutProfilesPerSize = 6;

const dashboardBookmarkTitleRoom = Object.freeze({
    "extra-small": 29,
    small: 32,
    medium: 24
});

const dashboardBookmarkSpacing = Object.freeze({
    "extra-small": {
        titledGap: 18, compactGap: 8, titledOrbitGap: 0, compactOrbitGap: 6,
        titledOrbitScale: .84, compactOrbitScale: .72
    },
    small: {
        titledGap: 12, compactGap: 10, titledOrbitGap: 7, compactOrbitGap: 8,
        titledOrbitScale: .9, compactOrbitScale: .78
    },
    medium: {
        titledGap: 24, compactGap: 12, titledOrbitGap: 16, compactOrbitGap: 9,
        titledOrbitScale: 1, compactOrbitScale: .86
    }
});

function getDashboardBookmarkTitleRoom() {
    if (!settings.showBookmarkTitles) return 0;
    return getDashboardBookmarkReservedTitleRoom();
}

function getDashboardBookmarkReservedTitleRoom() {
    return dashboardBookmarkTitleRoom[settings.tileSize] || dashboardBookmarkTitleRoom.medium;
}

function getDashboardBookmarkGap() {
    const spacing = dashboardBookmarkSpacing[settings.tileSize] || dashboardBookmarkSpacing.medium;
    return settings.showBookmarkTitles ? spacing.titledGap : spacing.compactGap;
}

function getDashboardBookmarkReservedGap() {
    const spacing = dashboardBookmarkSpacing[settings.tileSize] || dashboardBookmarkSpacing.medium;
    return Math.max(spacing.titledGap, spacing.compactGap);
}

function getDashboardBookmarkOrbitGap() {
    const spacing = dashboardBookmarkSpacing[settings.tileSize] || dashboardBookmarkSpacing.medium;
    return settings.showBookmarkTitles ? spacing.titledOrbitGap : spacing.compactOrbitGap;
}

function getDashboardBookmarkReservedOrbitGap() {
    const spacing = dashboardBookmarkSpacing[settings.tileSize] || dashboardBookmarkSpacing.medium;
    return Math.max(spacing.titledOrbitGap, spacing.compactOrbitGap);
}

function getDashboardBookmarkOrbitScale() {
    const spacing = dashboardBookmarkSpacing[settings.tileSize] || dashboardBookmarkSpacing.medium;
    return settings.showBookmarkTitles ? spacing.titledOrbitScale : spacing.compactOrbitScale;
}

function getDashboardBookmarkReservedOrbitScale() {
    const spacing = dashboardBookmarkSpacing[settings.tileSize] || dashboardBookmarkSpacing.medium;
    return Math.max(spacing.titledOrbitScale, spacing.compactOrbitScale);
}

function getBookmarkSyncKey(node, path) {
    const title = String(node.title || "").trim();
    const location = [...path, title].join("\u001f");
    return node.url ? `bookmark:${location}\u001e${node.url}` : `folder:${location}`;
}

function collectBookmarks(nodes, path = []) {
    return nodes.flatMap(node => {
        const syncKey = getBookmarkSyncKey(node, path);
        if (node.url) {
            if (!isWebsite(node.url)) {
                return [];
            }
            const bookmark = {
                id: String(node.id),
                parentId: String(node.parentId),
                index: node.index,
                title: node.title,
                url: node.url,
                syncKey
            };
            bookmarkIndex.set(bookmark.id, bookmark);
            return [bookmark];
        }
        const folder = {
            id: String(node.id),
            parentId: String(node.parentId),
            index: node.index,
            title: node.title,
            syncKey,
            children: collectBookmarks(node.children || [], [...path, String(node.title || "").trim()])
        };
        bookmarkIndex.set(folder.id, folder);
        return [folder];
    });
}

function resolveHiddenBookmarkTitles() {
    const bookmarksBySyncKey = new Map([...bookmarkIndex.values()]
        .filter(bookmark => bookmark.syncKey)
        .map(bookmark => [bookmark.syncKey, bookmark]));
    hiddenBookmarkTitles = new Set([...hiddenBookmarkTitles].flatMap(value => {
        const id = String(value);
        if (bookmarkIndex.has(id)) return [id];
        const bookmark = bookmarksBySyncKey.get(id);
        return bookmark ? [bookmark.id] : [];
    }));
}

function isBookmarkTitleHidden(bookmark) {
    return hiddenBookmarkTitles.has(bookmark.id) ||
        Boolean(bookmark.syncKey && hiddenBookmarkTitles.has(bookmark.syncKey));
}

function decodeFolderColors(value) {
    if (!value || typeof value !== "object") return new Map();
    const entries = Array.isArray(value) ? value : Object.entries(value);
    return new Map(entries.filter(entry => Array.isArray(entry) && entry.length === 2 &&
        folderColorNames.has(entry[1])).map(([identity, color]) => [String(identity), color]));
}

function getFolderColor(folder) {
    if (!folder || !Array.isArray(folder.children)) return "amber";
    return folderColors.get(folder.id) ||
        (folder.syncKey ? folderColors.get(folder.syncKey) : "") || "amber";
}

function setFolderColor(folder, color) {
    if (!folder || !Array.isArray(folder.children) || !folderColorNames.has(color)) return false;
    [folder.id, folder.syncKey].filter(Boolean).forEach(identity => {
        if (color === "amber") folderColors.delete(identity);
        else folderColors.set(identity, color);
    });
    return true;
}

function resolveFolderColors() {
    const resolved = new Map();
    bookmarkIndex.forEach(bookmark => {
        if (!Array.isArray(bookmark.children)) return;
        const color = getFolderColor(bookmark);
        if (color === "amber") return;
        resolved.set(bookmark.id, color);
        if (bookmark.syncKey) resolved.set(bookmark.syncKey, color);
    });
    folderColors = resolved;
}

function getFolderColorsSnapshot() {
    return Object.fromEntries(folderColors);
}

// загружаем закладки
async function loadBookmarks() {
    const requestId = ++bookmarkRefreshId;
    try {
        const tree = await chrome.bookmarks.getTree();
        if (requestId !== bookmarkRefreshId) {
            return;
        }
        bookmarkIndex = new Map();
        const nextBookmarks = collectBookmarks((tree[0]?.children || []).flatMap(root => root.children || []));
        const nextSignature = JSON.stringify(nextBookmarks);
        bookmarks = nextBookmarks;
        if (nextSignature === bookmarkTreeSignature) return;
        bookmarkTreeSignature = nextSignature;
        const previousLayout = JSON.stringify(layout);
        const previousHiddenTitles = JSON.stringify([...hiddenBookmarkTitles]);
        const previousFolderColors = JSON.stringify(getFolderColorsSnapshot());
        resolveHiddenBookmarkTitles();
        resolveFolderColors();
        updateBookmarkPositions();
        renderBookmarks(bookmarksRendered);
        renderFolderBookmarks(bookmarksRendered);
        bookmarksRendered = true;
        if (previousLayout !== JSON.stringify(layout) ||
            previousHiddenTitles !== JSON.stringify([...hiddenBookmarkTitles]) ||
            previousFolderColors !== JSON.stringify(getFolderColorsSnapshot())) {
            await saveDashboardSettings();
        }
    } catch (error) {
        console.error(error);
        showNotification(translate("bookmarkError"));
    }
}

function findBookmark(id) {
    return bookmarkIndex.get(id);
}

// считаем длину дуги
function getDashboardEllipseArcLength(radiusX, radiusY, halfSpan) {
    const sampleCount = Math.max(48, Math.ceil(halfSpan * 96));
    let length = 0;
    let previousX = 0;
    let previousY = -radiusY;
    for (let index = 1; index <= sampleCount; index += 1) {
        const angle = halfSpan * index / sampleCount;
        const x = radiusX * Math.sin(angle);
        const y = -radiusY * Math.cos(angle);
        length += Math.hypot(x - previousX, y - previousY);
        previousX = x;
        previousY = y;
    }
    return length;
}

function getDashboardMinimumArcCapacity(tileDiameter, titledLabelRoom, effectiveOrbitStep,
    perspective, viewportHeight) {
    const itemCount = Math.max(layout.length, bookmarks.length);
    if (!itemCount) return 1;
    const heroBounds = globalThis.document?.querySelector(".hero-info")?.getBoundingClientRect();
    const sunBounds = globalThis.document?.querySelector(".orbital-sun")?.getBoundingClientRect();
    const responsiveExtent = Math.min(Number(globalThis.innerWidth) || 1280, viewportHeight);
    const safeTop = Number.isFinite(heroBounds?.bottom) ?
        heroBounds.bottom + responsiveExtent * .012 : viewportHeight * .2;
    const sunGap = Math.max(8, tileDiameter * .12 + 2);
    const safeBottom = Number.isFinite(sunBounds?.top) && sunBounds.width && sunBounds.height ?
        sunBounds.top - sunGap : viewportHeight * .82;
    const availableHeight = Math.max(tileDiameter + titledLabelRoom, safeBottom - safeTop);
    const rowHeight = tileDiameter + titledLabelRoom;
    const rowStep = Math.max(1, effectiveOrbitStep * Math.max(.65, perspective));
    const maximumArcCount = Math.max(1,
        Math.floor(Math.max(0, availableHeight - rowHeight) / rowStep) + 1);
    return Math.max(1, Math.ceil(itemCount / maximumArcCount));
}

function getDashboardReachForCapacity(radiusX, radiusY, maximumReach, capacity, slotSpacing) {
    if (capacity <= 1) return 0;
    const requiredHalfLength = slotSpacing * (capacity - 1) / 2;
    let lowerReach = 0;
    let upperReach = Math.max(0, Math.min(maximumReach, radiusX * .995));
    const upperSpan = Math.asin(Math.min(.995, upperReach / Math.max(1, radiusX)));
    if (getDashboardEllipseArcLength(radiusX, radiusY, upperSpan) <= requiredHalfLength) {
        return upperReach;
    }
    for (let iteration = 0; iteration < 18; iteration += 1) {
        const middleReach = (lowerReach + upperReach) / 2;
        const middleSpan = Math.asin(Math.min(.995, middleReach / Math.max(1, radiusX)));
        if (getDashboardEllipseArcLength(radiusX, radiusY, middleSpan) < requiredHalfLength) {
            lowerReach = middleReach;
        } else {
            upperReach = middleReach;
        }
    }
    return upperReach;
}

// считаем размеры дуг
function getDashboardArcMetrics(arc) {
    const arcIndex = Math.max(0, Number(arc) || 0);
    const tileDiameter = ({ "extra-small": 54, small: 63, medium: 76 })[settings.tileSize] || 76;
    const spacing = dashboardBookmarkSpacing[settings.tileSize] || dashboardBookmarkSpacing.medium;
    const titledLabelRoom = dashboardBookmarkTitleRoom[settings.tileSize] ||
        dashboardBookmarkTitleRoom.medium;
    const minimumSlotSpacing = tileDiameter + spacing.titledGap;
    const viewportWidth = Math.max(320, Number(globalThis.innerWidth) || 1280);
    const viewportHeight = Math.max(320, Number(globalThis.innerHeight) || 720);
    const fallbackGeometry = {
        centerX: viewportWidth / 2,
        centerY: viewportHeight * 1.24,
        perspective: .92,
        bookmarkBaseRadius: viewportHeight * .46,
        bookmarkStep: viewportHeight * .09
    };
    const geometry = typeof globalThis.orbitalSystem?.readGeometry === "function" ?
        globalThis.orbitalSystem.readGeometry() : fallbackGeometry;
    const titledOrbitGap = Math.max(spacing.titledOrbitGap, spacing.titledGap * .35);
    const effectiveOrbitStep = Math.max(geometry.bookmarkStep * spacing.titledOrbitScale,
        (tileDiameter + titledLabelRoom + titledOrbitGap) /
            Math.max(.65, geometry.perspective));
    const radiusX = geometry.bookmarkBaseRadius + effectiveOrbitStep * arcIndex;
    const radiusY = radiusX * geometry.perspective;
    const bottomGap = settings.tileSize === "medium" ? 0 : 2;
    const bottomCenter = viewportHeight - tileDiameter / 2 - titledLabelRoom - bottomGap;
    const bottomRatio = Math.min(1, Math.max(0,
        (geometry.centerY - bottomCenter) / Math.max(1, radiusY)));
    const bottomReach = radiusX * Math.sin(Math.acos(bottomRatio));
    const gridWidth = Number(globalThis.document?.querySelector(".bookmark-grid")?.clientWidth);
    const availableWidth = Math.min(1500, Math.max(320, gridWidth || viewportWidth - 48));
    const gridLeft = (viewportWidth - availableWidth) / 2;
    const centerInGrid = geometry.centerX - gridLeft;
    const sideReach = Math.max(minimumSlotSpacing,
        Math.min(centerInGrid, availableWidth - centerInGrid) - tileDiameter / 2 - 20);
    const naturalReach = Math.max(minimumSlotSpacing, Math.min(bottomReach, sideReach));
    const minimumCapacity = getDashboardMinimumArcCapacity(tileDiameter, titledLabelRoom,
        effectiveOrbitStep, geometry.perspective, viewportHeight);
    const requiredReach = getDashboardReachForCapacity(radiusX, radiusY, sideReach,
        minimumCapacity, minimumSlotSpacing);
    const visibleReach = Math.min(sideReach, Math.max(naturalReach, requiredReach));
    const halfSpan = Math.asin(Math.min(.995, visibleReach / Math.max(1, radiusX)));
    const halfArcLength = getDashboardEllipseArcLength(radiusX, radiusY, halfSpan);
    const intervalCount = Math.max(2,
        Math.floor(halfArcLength * 2 / minimumSlotSpacing));
    return {
        capacity: Math.min(31, Math.max(minimumCapacity, intervalCount + 1)),
        reach: visibleReach,
        radiusX
    };
}

function getDashboardArcCapacity(arc) {
    return getDashboardArcMetrics(arc).capacity;
}

function getDashboardArcReach(arc) {
    return getDashboardArcMetrics(arc).reach;
}

function getDashboardBaseCapacity() {
    return getDashboardArcCapacity(0);
}

function getDashboardCapacitySignature() {
    return Array.from({ length: 10 }, (_, arc) => getDashboardArcCapacity(arc)).join(":");
}

function getDashboardViewportClass(width = Number(globalThis.innerWidth) || 1280) {
    if (width <= 600) return "phone";
    if (width <= 1100) return "tablet";
    return "desktop";
}

function hashDashboardLayoutProfile(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function getDashboardLayoutStorageKey(tileSize = settings.tileSize,
    capacitySignature = getDashboardCapacitySignature()) {
    const viewportClass = getDashboardViewportClass();
    return `${tileSize}@${viewportClass}-${hashDashboardLayoutProfile(capacitySignature)}`;
}

function getDashboardArcFillOrder(arc) {
    const capacity = getDashboardArcCapacity(arc);
    const slots = [];
    const center = (capacity - 1) / 2;
    for (let distance = 0; slots.length < capacity; distance += 1) {
        const left = Math.floor(center - distance);
        const right = Math.ceil(center + distance);
        if (left >= 0 && !slots.includes(left)) slots.push(left);
        if (right < capacity && !slots.includes(right)) slots.push(right);
    }
    return slots;
}

function getDashboardSlotKey(arc, slot) {
    return `${arc}:${slot}`;
}

function isValidDashboardSlot(arc, slot) {
    return Number.isInteger(arc) && arc >= 0 && Number.isInteger(slot) && slot >= 0 &&
        slot < getDashboardArcCapacity(arc);
}

function getFirstAvailableDashboardSlot(occupied = new Set()) {
    for (let arc = 0; arc < 100; arc += 1) {
        for (const slot of getDashboardArcFillOrder(arc)) {
            if (!occupied.has(getDashboardSlotKey(arc, slot))) {
                return { arc, slot, x: slot, y: arc };
            }
        }
    }
    return { arc: 0, slot: 0, x: 0, y: 0 };
}

function normalizeDashboardSlots(forceRepack = false) {
    const occupied = new Set();
    const pending = [];
    layout.forEach(function(item) {
        const arc = Number(item.arc);
        const slot = Number(item.slot);
        const key = getDashboardSlotKey(arc, slot);
        if (!forceRepack && isValidDashboardSlot(arc, slot) && !occupied.has(key)) {
            item.arc = arc;
            item.slot = slot;
            item.x = slot;
            item.y = arc;
            occupied.add(key);
        } else {
            pending.push(item);
        }
    });
    pending.forEach(function(item) {
        const position = getFirstAvailableDashboardSlot(occupied);
        Object.assign(item, position);
        occupied.add(getDashboardSlotKey(position.arc, position.slot));
    });
}

function repackDashboardLayout() {
    normalizeDashboardSlots(true);
    layout.forEach((item, index) => item.order = index);
}

function cloneDashboardLayout(source = layout) {
    return Array.isArray(source) ? source.map(item => ({ ...item })) : [];
}

function pruneDashboardLayoutProfiles() {
    ["extra-small", "small", "medium"].forEach(tileSize => {
        const profileKeys = Object.keys(layoutsByTileSize)
            .filter(layoutKey => layoutKey.startsWith(`${tileSize}@`));
        const removableKeys = profileKeys.filter(layoutKey => layoutKey !== activeDashboardLayoutKey);
        while (profileKeys.length > dashboardLayoutProfilesPerSize && removableKeys.length) {
            const key = removableKeys.shift();
            delete layoutsByTileSize[key];
            profileKeys.splice(profileKeys.indexOf(key), 1);
        }
    });
}

function rememberDashboardLayout(tileSize = settings.tileSize, storageKey = "") {
    if (!tileSize) return;
    const matchingActiveKey = activeDashboardLayoutKey.startsWith(`${tileSize}@`) ?
        activeDashboardLayoutKey : "";
    const key = storageKey || matchingActiveKey || getDashboardLayoutStorageKey(tileSize);
    layoutsByTileSize[key] = cloneDashboardLayout();
    pruneDashboardLayoutProfiles();
}

function activateDashboardLayout(tileSize, fallbackLayout = layout, storageKey = "") {
    const key = storageKey || getDashboardLayoutStorageKey(tileSize);
    const savedLayout = layoutsByTileSize[key];
    if (Array.isArray(savedLayout) && savedLayout.length) {
        activeDashboardLayoutKey = key;
        layout = cloneDashboardLayout(savedLayout);
        updateBookmarkPositions();
        return true;
    }
    const legacyLayout = layoutsByTileSize[tileSize];
    const sameSizeLayout = Object.entries(layoutsByTileSize)
        .find(([layoutKey, items]) => layoutKey.startsWith(`${tileSize}@`) &&
            Array.isArray(items) && items.length)?.[1];
    activeDashboardLayoutKey = key;
    layout = cloneDashboardLayout(Array.isArray(fallbackLayout) && fallbackLayout.length ?
        fallbackLayout : legacyLayout || sameSizeLayout || []);
    syncDashboardOrder();
    repackDashboardLayout();
    updateBookmarkPositions();
    rememberDashboardLayout(tileSize, key);
    return false;
}

function compareDashboardLayoutItems(first, second) {
    const firstOrder = Number.isInteger(first.order) ? first.order : Number.MAX_SAFE_INTEGER;
    const secondOrder = Number.isInteger(second.order) ? second.order : Number.MAX_SAFE_INTEGER;
    return firstOrder - secondOrder ||
        (Number(first.y) || 0) - (Number(second.y) || 0) ||
        (Number(first.x) || 0) - (Number(second.x) || 0);
}

function migrateDashboardLayoutToAutomaticArcs() {
    layout.sort(compareDashboardLayoutItems);
    repackDashboardLayout();
}

function syncDashboardOrder() {
    layout.sort(compareDashboardLayoutItems);
    layout.forEach((item, index) => item.order = index);
    normalizeDashboardSlots(true);
}

function getDashboardActiveArcCount(extraArc = -1) {
    const highestArc = layout.reduce((maximum, item) => Math.max(maximum, Number(item.arc) || 0), -1);
    const reserveSlots = Math.max(3, Math.ceil(getDashboardBaseCapacity() * .22));
    const requiredSlots = layout.length + reserveSlots;
    let automaticArcCount = 0;
    let availableSlots = 0;
    while (availableSlots < requiredSlots && automaticArcCount < 100) {
        availableSlots += getDashboardArcCapacity(automaticArcCount);
        automaticArcCount += 1;
    }
    return Math.max(1, automaticArcCount, highestArc + 1, Number(extraArc) + 1 || 0);
}

function getDashboardVisualSlots(arcCount = getDashboardActiveArcCount()) {
    const slots = [];
    for (let arc = 0; arc < arcCount; arc += 1) {
        const capacity = getDashboardArcCapacity(arc);
        for (let slot = 0; slot < capacity; slot += 1) {
            slots.push({ arc, slot, x: slot, y: arc, key: getDashboardSlotKey(arc, slot) });
        }
    }
    return slots;
}

function getDashboardPackedSlots(count) {
    const slots = [];
    for (let arc = 0; slots.length < count && arc < 100; arc += 1) {
        getDashboardArcFillOrder(arc).forEach(slot => {
            if (slots.length < count) slots.push({ arc, slot, x: slot, y: arc });
        });
    }
    return slots;
}

function applyDashboardOrder(orderedIds) {
    const positions = new Map();
    const slots = getDashboardPackedSlots(orderedIds.length);
    orderedIds.forEach((id, order) => {
        const position = slots[order];
        if (position) positions.set(id, { ...position, order });
    });
    return positions;
}

function getDashboardInsertionPlan(sourceId, targetId, afterTarget = false) {
    syncDashboardOrder();
    const target = layout.find(item => item.id === targetId && item.id !== sourceId);
    if (!target) return null;
    const orderedItems = [...layout].sort(compareDashboardLayoutItems);
    const remaining = orderedItems.filter(item => item.id !== sourceId);
    const targetOrder = remaining.findIndex(item => item.id === targetId);
    if (targetOrder < 0) return null;
    const insertionIndex = targetOrder + (afterTarget ? 1 : 0);
    const orderedIds = remaining.map(item => item.id);
    orderedIds.splice(insertionIndex, 0, sourceId);
    const positions = applyDashboardOrder(orderedIds);
    const insertionSlot = positions.get(sourceId);
    return { positions, insertionIndex, insertionSlot,
        arcCount: getDashboardActiveArcCount(insertionSlot?.arc) };
}

function moveDashboardLayoutItemToSlot(sourceId, arc, slot) {
    syncDashboardOrder();
    const source = layout.find(item => item.id === sourceId);
    if (!source || !isValidDashboardSlot(arc, slot)) return false;
    const target = layout.find(item => item.id !== sourceId && item.arc === arc && item.slot === slot);
    if (target) return insertDashboardLayoutItem(sourceId, target.id, undefined, undefined, false);
    const remainingIds = layout.filter(item => item.id !== sourceId)
        .sort(compareDashboardLayoutItems).map(item => item.id);
    const visualSlots = [];
    for (let currentArc = 0; currentArc <= arc; currentArc += 1) {
        getDashboardArcFillOrder(currentArc).forEach(currentSlot =>
            visualSlots.push({ arc: currentArc, slot: currentSlot }));
    }
    const requestedIndex = visualSlots.findIndex(position =>
        position.arc === arc && position.slot === slot);
    const insertionIndex = Math.max(0, Math.min(remainingIds.length,
        requestedIndex < 0 ? remainingIds.length : requestedIndex));
    remainingIds.splice(insertionIndex, 0, sourceId);
    applyDashboardOrder(remainingIds).forEach((position, id) => {
        const item = layout.find(layoutItem => layoutItem.id === id);
        if (item) Object.assign(item, position);
    });
    syncDashboardOrder();
    return true;
}

// меняем позиции закладок
function insertDashboardLayoutItem(sourceId, targetId, x, y, afterTarget = false) {
    syncDashboardOrder();
    const source = layout.find(item => item.id === sourceId);
    if (!source) return false;
    const target = targetId ? layout.find(item => item.id === targetId) : null;
    if (target && target.id !== source.id) {
        const plan = getDashboardInsertionPlan(sourceId, targetId, afterTarget);
        if (!plan) return false;
        plan.positions.forEach((position, id) => {
            const item = layout.find(layoutItem => layoutItem.id === id);
            if (item) Object.assign(item, position);
        });
        syncDashboardOrder();
        return true;
    }
    if (Number.isInteger(x) && Number.isInteger(y) && isValidDashboardSlot(y, x)) {
        return moveDashboardLayoutItemToSlot(sourceId, y, x);
    }
    const occupied = new Set(layout.filter(item => item.id !== sourceId)
        .map(item => getDashboardSlotKey(item.arc, item.slot)));
    Object.assign(source, getFirstAvailableDashboardSlot(occupied));
    normalizeDashboardSlots(false);
    return true;
}

function updateBookmarkPositions() {
    const bookmarkIds = new Set(bookmarks.map(function(bookmark) {
        return bookmark.id;
    }));
    const bookmarksBySyncKey = new Map(bookmarks
        .filter(bookmark => bookmark.syncKey)
        .map(bookmark => [bookmark.syncKey, bookmark]));
    layout.forEach(function(item) {
        if (!bookmarkIds.has(item.id) && item.syncKey && bookmarksBySyncKey.has(item.syncKey)) {
            item.id = bookmarksBySyncKey.get(item.syncKey).id;
        }
        const bookmark = bookmarkIndex.get(item.id);
        if (bookmark?.syncKey) item.syncKey = bookmark.syncKey;
    });
    const seenIds = new Set();
    layout = layout.filter(function(item) {
        if (!bookmarkIds.has(item.id)) {
            return false;
        }
        if (seenIds.has(item.id)) {
            return false;
        }
        seenIds.add(item.id);
        return true;
    });
    syncDashboardOrder();
    for (const bookmark of bookmarks) {
        if (!seenIds.has(bookmark.id)) {
            const occupied = new Set(layout.map(item => getDashboardSlotKey(item.arc, item.slot)));
            layout.push({ id: bookmark.id, syncKey: bookmark.syncKey, order: layout.length,
                ...getFirstAvailableDashboardSlot(occupied) });
            seenIds.add(bookmark.id);
        }
    }
    syncDashboardOrder();
}
