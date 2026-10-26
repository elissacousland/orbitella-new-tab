// закладки папки и перетаскивание

"use strict";

// диалоги и состояние
const bookmarkKindInput = document.querySelector('input[name="add-kind"]');

const bookmarkKindButtons = document.querySelectorAll(".item-type-options button");

const creationOptions = document.querySelector(".item-type-options");

const creationDetails = document.querySelector(".creation-details");

const creationBackButton = document.querySelector(".creation-back");

const creationHeading = document.querySelector(".add-dialog h2");

const bookmarkParentSelect = document.getElementById("add-parent");

let draggingId = null;

let blockClickUntil = 0;

let creationAnchor = null;

let pendingCreationView = null;

let dragPreviewIntent = null;

let dragPreviewPlaceholder = null;

let dragDashboardSnapshot = null;

// предпросмотр перетаскивания
function clearDragIndicators() {
    document.querySelectorAll(".drag-over").forEach(element => element.classList.remove("drag-over"));
}

function getTileSlot(tile) {
    return tile?.classList.contains("grid-cell") ? tile : tile?.closest(".grid-cell") || tile;
}

function getDashboardSnapshot() {
    if (dragDashboardSnapshot) return dragDashboardSnapshot;
    syncDashboardOrder();
    const items = layout.map(item => {
        const tile = [...bookmarkGrid.querySelectorAll(".tile")]
            .find(element => element.dataset.id === item.id);
        const element = getTileSlot(tile);
        return element ? {
            id: item.id,
            element,
            rect: element.getBoundingClientRect()
        } : null;
    }).filter(Boolean);
    dragDashboardSnapshot = { items };
    return dragDashboardSnapshot;
}

function clearSortPreview() {
    document.querySelectorAll(".drag-preview-shift, .drag-preview-source").forEach(element => {
        element.classList.remove("drag-preview-shift", "drag-preview-source", "drag-preview-source--folder");
        element.style.removeProperty("--drag-shift-x");
        element.style.removeProperty("--drag-shift-y");
        element.removeAttribute("data-preview-order");
        element.removeAttribute("data-preview-arc");
        element.removeAttribute("data-preview-slot");
    });
    dragPreviewPlaceholder?.remove();
    dragPreviewPlaceholder = null;
    updateCarouselTransforms();
}

function resetDragPreview() {
    clearSortPreview();
    clearDragIndicators();
    dragPreviewIntent = null;
    dragDashboardSnapshot = null;
    carouselState.dragAutoX = 0;
    carouselState.dragAutoY = 0;
    bookmarkGrid?.classList.remove("bookmark-grid--drag-active");
}

function finishDragSession() {
    const sourceId = draggingId;
    document.querySelectorAll(".tile.dragging").forEach(tile => tile.classList.remove("dragging"));
    draggingId = null;
    resetDragPreview();
    schedulePlanetOrbitAlignment();
    return sourceId;
}

function getDragPlaceholder() {
    if (!dragPreviewPlaceholder) {
        dragPreviewPlaceholder = document.createElement("div");
        dragPreviewPlaceholder.className = "drag-placeholder";
        dragPreviewPlaceholder.addEventListener("dragover", event => {
            if (!draggingId || !dragPreviewIntent) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            updateCarouselDragAutoScroll(event.clientX, event.clientY);
        });
        dragPreviewPlaceholder.addEventListener("drop", async event => {
            event.preventDefault();
            event.stopPropagation();
            await commitInsertionPreview();
        });
    }
    return dragPreviewPlaceholder;
}

function showDragPlaceholder(rect) {
    const placeholder = getDragPlaceholder();
    placeholder.classList.remove("drag-placeholder--folder");
    const previewParent = folderDialog?.open ? folderDialog : document.body;
    if (placeholder.parentElement !== previewParent) previewParent.append(placeholder);
    Object.assign(placeholder.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
    });
}

async function commitInsertionPreview() {
    const intent = dragPreviewIntent;
    const sourceId = draggingId;
    if (!intent || !sourceId || !["before", "after", "end", "slot"].includes(intent.action)) return;
    finishDragSession();
    if (intent.containerId === "dashboard") {
        if (intent.action === "slot") {
            if (layout.some(item => item.id === sourceId)) {
                await moveBookmarkToSlot(sourceId, intent.arc, intent.slot);
            } else {
                await moveItemToDashboardSlot(sourceId, intent.arc, intent.slot);
            }
            return;
        }
        const targetLayout = intent.targetId ? layout.find(item => item.id === intent.targetId) : null;
        if (intent.action !== "end" && !targetLayout) return;
        if (layout.some(item => item.id === sourceId)) {
            await moveBookmark(sourceId, intent.targetId, undefined, undefined,
                intent.action === "after" || intent.action === "end");
        } else {
            await moveItemToDashboard(sourceId, intent.targetId, undefined, undefined,
                intent.action === "after" || intent.action === "end");
        }
        return;
    }
    await moveItemWithinFolder(sourceId, intent.containerId, intent.targetId, intent.action === "after");
}

function getFolderPreviewPositions() {
    return new Map([...folderGrid.querySelectorAll(":scope > .tile")]
        .filter(tile => tile.dataset.id !== draggingId)
        .map(tile => {
            const rect = tile.getBoundingClientRect();
            tile.getAnimations().forEach(animation => animation.cancel());
            return [tile.dataset.id, rect];
        }));
}

function animateFolderPreview(previousPositions) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    requestAnimationFrame(() => folderGrid.querySelectorAll(":scope > .tile").forEach(tile => {
        if (tile.dataset.id === draggingId) return;
        const previous = previousPositions.get(tile.dataset.id);
        if (!previous) return;
        const current = tile.getBoundingClientRect();
        const offsetX = previous.left - current.left;
        const offsetY = previous.top - current.top;
        if (Math.abs(offsetX) < 1 && Math.abs(offsetY) < 1) return;
        tile.getAnimations().forEach(animation => animation.cancel());
        const animation = tile.animate([
            { transform: `translate(${offsetX}px, ${offsetY}px)` },
            { transform: "translate(0, 0)" }
        ], { duration: 150, easing: "cubic-bezier(.2, .7, .2, 1)" });
        animation.addEventListener("finish", () => animation.cancel(), { once: true });
    }));
}

function showInsertionPreview(containerId, targetId, afterTarget) {
    const intentKey = `${containerId}:${targetId}:${afterTarget ? "after" : "before"}`;
    if (dragPreviewIntent?.key === intentKey) return;
    const previousFolderPositions = containerId === "dashboard" ? null : getFolderPreviewPositions();
    clearSortPreview();
    if (containerId !== "dashboard") {
        const sourceTile = [...folderGrid.querySelectorAll(":scope > .tile")]
            .find(tile => tile.dataset.id === draggingId);
        const targetTile = [...folderGrid.querySelectorAll(":scope > .tile")]
            .find(tile => tile.dataset.id === targetId);
        if (!targetTile) return;
        sourceTile?.classList.add("drag-preview-source", "drag-preview-source--folder");
        const placeholder = getDragPlaceholder();
        placeholder.classList.add("drag-placeholder--folder");
        targetTile.parentElement.insertBefore(placeholder,
            afterTarget ? targetTile.nextSibling : targetTile);
        dragPreviewIntent = { key: intentKey, containerId, targetId, afterTarget };
        animateFolderPreview(previousFolderPositions);
        return;
    }
    const snapshot = getDashboardSnapshot();
    const sourceItem = snapshot.items.find(item => item.id === draggingId);
    const plan = getDashboardInsertionPlan(draggingId, targetId, afterTarget);
    if (!plan) return;
    snapshot.items.forEach(item => {
        if (item.id === draggingId) return;
        const position = plan.positions.get(item.id);
        if (!position) return;
        item.element.dataset.previewOrder = String(position.order);
        item.element.dataset.previewArc = String(position.arc);
        item.element.dataset.previewSlot = String(position.slot);
        item.element.classList.add("drag-preview-shift");
    });
    sourceItem?.element.classList.add("drag-preview-source");
    updateCarouselTransforms();
    const insertionRect = getCarouselSlotRect(plan.insertionSlot?.arc, plan.insertionSlot?.slot);
    if (!insertionRect) return;
    showDragPlaceholder(insertionRect);
    dragPreviewIntent = { key: intentKey, containerId, targetId, afterTarget,
        insertionIndex: plan.insertionIndex,
        insertionSlot: plan.insertionSlot };
}

function getStableDropAction(containerId, targetId, isFolder, horizontalPosition) {
    const sameTarget = dragPreviewIntent?.containerId === containerId && dragPreviewIntent?.targetId === targetId;
    const previousAction = sameTarget ? dragPreviewIntent.action : null;
    if (isFolder) {
        if (previousAction === "inside" && horizontalPosition >= .14 && horizontalPosition <= .86) return "inside";
        if (previousAction === "before" && horizontalPosition < .22) return "before";
        if (previousAction === "after" && horizontalPosition > .78) return "after";
        if (horizontalPosition < .18) return "before";
        if (horizontalPosition > .82) return "after";
        return "inside";
    }
    if (previousAction === "before" && horizontalPosition < .58) return "before";
    if (previousAction === "after" && horizontalPosition > .42) return "after";
    return horizontalPosition < .5 ? "before" : "after";
}

function setDragPreviewAction(containerId, targetId, action) {
    const currentPreview = dragPreviewIntent?.containerId === containerId &&
        dragPreviewIntent?.targetId === targetId ? dragPreviewIntent : null;
    dragPreviewIntent = {
        ...currentPreview,
        key: `${containerId}:${targetId}:${action}`,
        containerId,
        targetId,
        action
    };
}

const bookmarkGrid = document.querySelector(".bookmark-grid");
const BOOKMARK_ORBIT_LIFT = 37;
const SMALL_BOOKMARK_ORBIT_LIFT = 18;

function getBookmarkOrbitLift() {
    if (settings.tileSize === "extra-small") {
        return settings.showBookmarkTitles ? SMALL_BOOKMARK_ORBIT_LIFT :
            SMALL_BOOKMARK_ORBIT_LIFT + 5;
    }
    if (settings.tileSize === "small") {
        return settings.showBookmarkTitles ? BOOKMARK_ORBIT_LIFT - 5 : BOOKMARK_ORBIT_LIFT - 20;
    }
    return BOOKMARK_ORBIT_LIFT;
}
const PLANET_ORBIT_BOOKMARK_GAP = 20;

const bookmarkTooltip = document.createElement("div");
bookmarkTooltip.className = "bookmark-tooltip";
bookmarkTooltip.setAttribute("role", "tooltip");
bookmarkTooltip.hidden = true;
document.body.append(bookmarkTooltip);

let bookmarkTooltipTarget = null;
let bookmarkTooltipShowTimer = 0;
let bookmarkTooltipHideTimer = 0;

// подсказка названия
function positionBookmarkTooltip(tile) {
    const tileBounds = tile.getBoundingClientRect();
    const tooltipBounds = bookmarkTooltip.getBoundingClientRect();
    const screenGap = 8;
    const tileGap = 10;
    const maximumLeft = Math.max(screenGap, window.innerWidth - tooltipBounds.width - screenGap);
    const left = Math.min(maximumLeft, Math.max(screenGap,
        tileBounds.left + (tileBounds.width - tooltipBounds.width) / 2));
    const topAbove = tileBounds.top - tooltipBounds.height - tileGap;
    const showAbove = topAbove >= screenGap;
    const maximumTop = Math.max(screenGap, window.innerHeight - tooltipBounds.height - screenGap);
    const top = showAbove ? topAbove : Math.min(maximumTop, tileBounds.bottom + tileGap);

    bookmarkTooltip.style.left = `${Math.round(left)}px`;
    bookmarkTooltip.style.top = `${Math.round(top)}px`;
    bookmarkTooltip.dataset.placement = showAbove ? "top" : "bottom";
}

function hideBookmarkTooltip(immediate = false) {
    window.clearTimeout(bookmarkTooltipShowTimer);
    window.clearTimeout(bookmarkTooltipHideTimer);
    bookmarkTooltipTarget = null;
    bookmarkTooltip.classList.remove("is-visible");
    if (immediate) {
        bookmarkTooltip.hidden = true;
        return;
    }
    bookmarkTooltipHideTimer = window.setTimeout(() => {
        if (!bookmarkTooltip.classList.contains("is-visible")) bookmarkTooltip.hidden = true;
    }, 180);
}

function scheduleBookmarkTooltip(tile) {
    hideBookmarkTooltip(true);
    if (draggingId || !tile.dataset.fullTitle) return;
    bookmarkTooltipTarget = tile;
    bookmarkTooltipShowTimer = window.setTimeout(() => {
        if (draggingId || bookmarkTooltipTarget !== tile || !tile.isConnected || !tile.matches(":hover")) {
            return;
        }
        bookmarkTooltip.textContent = tile.dataset.fullTitle;
        bookmarkTooltip.hidden = false;
        positionBookmarkTooltip(tile);
        requestAnimationFrame(() => {
            if (!draggingId && bookmarkTooltipTarget === tile) {
                bookmarkTooltip.classList.add("is-visible");
            }
        });
    }, 300);
}

document.addEventListener("pointerover", event => {
    if (event.pointerType === "touch") return;
    const tile = event.target instanceof Element ? event.target.closest(".tile[data-full-title]") : null;
    if (!tile || (event.relatedTarget instanceof Node && tile.contains(event.relatedTarget))) return;
    scheduleBookmarkTooltip(tile);
});

document.addEventListener("pointerout", event => {
    const tile = event.target instanceof Element ? event.target.closest(".tile[data-full-title]") : null;
    if (!tile || (event.relatedTarget instanceof Node && tile.contains(event.relatedTarget))) return;
    hideBookmarkTooltip();
});

window.addEventListener("resize", () => hideBookmarkTooltip(true));
document.addEventListener("scroll", () => hideBookmarkTooltip(true), true);

const emptyState = document.querySelector(".bookmarks > p");

const addDialog = document.querySelector(".add-dialog");

const addForm = document.querySelector(".add-dialog form");

const confirmDialog = document.querySelector(".confirm-dialog");

const confirmDialogMessage = document.querySelector(".confirm-dialog-message");

const bookmarkTitleInput = document.getElementById("add-title");

const bookmarkUrlInput = document.getElementById("add-url");

let orbitalLayoutFrame = 0;
let planetOrbitAlignmentFrame = 0;

let carouselAnimationFrame = 0;

const carouselState = {
    geometry: null,
    panX: 0,
    panY: 0,
    velocityX: 0,
    velocityY: 0,
    dragAutoX: 0,
    dragAutoY: 0,
    pointerId: null,
    panning: false,
    lastX: 0,
    lastY: 0,
    lastTime: 0
};

// раскладка по орбитам
function getDashboardTileDiameter() {
    const value = parseFloat(getComputedStyle(bookmarkGrid).getPropertyValue("--tile-width"));
    return Number.isFinite(value) && value > 0 ? value : 84;
}

function clampOrbitalValue(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
}

function snapToDevicePixel(value) {
    const pixelRatio = window.devicePixelRatio || 1;
    return Math.round(value * pixelRatio) / pixelRatio;
}

function syncAutomaticArcCapacity() {
    const nextCapacity = getDashboardCapacitySignature();
    const nextLayoutKey = getDashboardLayoutStorageKey(settings.tileSize, nextCapacity);
    const previousCapacity = bookmarkGrid.dataset.arcCapacities;
    const previousLayoutKey = bookmarkGrid.dataset.layoutProfile || activeDashboardLayoutKey;
    bookmarkGrid.dataset.arcCapacities = nextCapacity;
    bookmarkGrid.dataset.layoutProfile = nextLayoutKey;
    if (!previousCapacity) {
        activeDashboardLayoutKey = nextLayoutKey;
        return false;
    }
    if (previousCapacity === nextCapacity && previousLayoutKey === nextLayoutKey) return false;
    if (previousLayoutKey && !previousLayoutKey.startsWith(`${settings.tileSize}@`)) {
        // не перезаписываем старую раскладку
        activeDashboardLayoutKey = nextLayoutKey;
        return false;
    }

    // сохраняем раскладку для каждого экрана
    rememberDashboardLayout(settings.tileSize, previousLayoutKey);
    activateDashboardLayout(settings.tileSize, layout, nextLayoutKey);
    resetCarouselViewport();
    return true;
}

function getAdaptiveTileMetrics(arcCount, width, height, baseTileDiameter) {
    const foundationCapacity = getDashboardArcCapacity(0);
    const requestedGap = getDashboardBookmarkGap();
    const availableWidth = Math.max(baseTileDiameter, width - 20);
    const availableHeight = Math.max(baseTileDiameter, height - 12);
    const compactWidth = foundationCapacity * baseTileDiameter +
        (foundationCapacity - 1) * requestedGap;
    const widthScale = compactWidth > availableWidth ?
        (availableWidth - (foundationCapacity - 1) * requestedGap) /
            (foundationCapacity * baseTileDiameter) : 1;
    const nominalHeight = baseTileDiameter * (arcCount + 1.35);
    const heightScale = nominalHeight > availableHeight ? availableHeight / nominalHeight : 1;
    const scale = clampOrbitalValue(Math.min(widthScale, heightScale), .56, 1);
    return {
        scale,
        gap: requestedGap,
        tileDiameter: baseTileDiameter * scale
    };
}

function getEvenlySpacedEllipseAngles(radiusX, radiusY, halfSpan, capacity, slotStep) {
    if (capacity <= 1 || halfSpan <= 0) return [0];
    const sampleCount = Math.max(120, capacity * 16);
    const samples = [];
    let totalLength = 0;
    let previousX = 0;
    let previousY = 0;
    for (let index = 0; index <= sampleCount; index += 1) {
        const progress = index / sampleCount;
        const angle = -halfSpan + progress * halfSpan * 2;
        const x = radiusX * Math.sin(angle);
        const y = -radiusY * Math.cos(angle);
        if (index) totalLength += Math.hypot(x - previousX, y - previousY);
        samples.push({ angle, length: totalLength });
        previousX = x;
        previousY = y;
    }
    const angles = [];
    // фиксируем шаг между значками
    const maximumStep = totalLength / (capacity - 1);
    const fixedStep = Math.min(maximumStep,
        Number.isFinite(slotStep) && slotStep > 0 ? slotStep : maximumStep);
    const firstLength = (totalLength - fixedStep * (capacity - 1)) / 2;
    let sampleIndex = 1;
    for (let slot = 0; slot < capacity; slot += 1) {
        const targetLength = firstLength + fixedStep * slot;
        while (sampleIndex < samples.length - 1 &&
            samples[sampleIndex].length < targetLength) sampleIndex += 1;
        const previous = samples[sampleIndex - 1];
        const next = samples[sampleIndex];
        const segmentLength = Math.max(.0001, next.length - previous.length);
        const ratio = (targetLength - previous.length) / segmentLength;
        angles.push(previous.angle + (next.angle - previous.angle) * ratio);
    }
    return angles;
}

function getCarouselGeometry(arcCount, availableWidth, baseTileDiameter, adaptiveArcCount = arcCount) {
    const width = Math.max(baseTileDiameter + 24, availableWidth);
    const gridRect = bookmarkGrid.getBoundingClientRect();
    const main = bookmarkGrid.closest("main");
    const bottomReserve = Math.max(0, parseFloat(getComputedStyle(main).paddingBottom) || 0);
    const availableHeight = Math.max(baseTileDiameter + 70,
        window.innerHeight - gridRect.top - bottomReserve - 2);
    const tileMetrics = getAdaptiveTileMetrics(adaptiveArcCount, width, availableHeight, baseTileDiameter);
    const tileDiameter = tileMetrics.tileDiameter;
    const orbitGeometry = orbitalSystem.readGeometry();
    const widthPressure = clampOrbitalValue(width /
        Math.max(width, getDashboardArcCapacity(0) *
            (baseTileDiameter + 5)), .82, 1);
    const labelRoom = getDashboardBookmarkTitleRoom();
    const orbitGap = getDashboardBookmarkOrbitGap();
    const orbitScale = getDashboardBookmarkOrbitScale();
    const orbitLift = getBookmarkOrbitLift();
    const minimumOrbitStep = (tileDiameter + labelRoom + orbitGap) /
        Math.max(.65, orbitGeometry.perspective);
    const orbitStep = Math.max(minimumOrbitStep,
        orbitGeometry.bookmarkStep * widthPressure * orbitScale);
    const centerX = orbitGeometry.centerX - gridRect.left;
    let centerY = orbitGeometry.centerY - gridRect.top - orbitLift;
    const arcs = [];
    const slotMap = new Map();
    const titleMetrics = new Map([...bookmarkGrid.querySelectorAll(":scope > .grid-cell")]
        .map(cell => {
            const title = cell.querySelector(".tile-title");
            const titleStyle = title ? getComputedStyle(title) : null;
            return [getDashboardSlotKey(
                Number(cell.dataset.previewArc ?? cell.dataset.arc),
                Number(cell.dataset.previewSlot ?? cell.dataset.slot)), {
                lineCount: title?.classList.contains("tile-title--multi-word") ? 2 : 1,
                lineHeight: parseFloat(titleStyle?.lineHeight) || 13,
                singleWord: Boolean(title?.classList.contains("tile-title--single-word")),
                naturalWidth: title?.scrollWidth || 0
            }];
        }));
    let previousRadius = 0;

    for (let arc = 0; arc < arcCount; arc += 1) {
        const capacity = getDashboardArcCapacity(arc);
        const halfSlotWidth = getDashboardArcReach(arc);
        const radiusX = Math.max(orbitGeometry.bookmarkBaseRadius + orbitStep * arc,
            previousRadius ? previousRadius + orbitStep : 0);
        const radiusY = radiusX * orbitGeometry.perspective;
        const halfSpan = Math.asin(clampOrbitalValue(halfSlotWidth / radiusX, -.995, .995));
        const arcGeometry = { arc, capacity, radiusX, radiusY, halfSpan };
        previousRadius = radiusX;
        arcs.push(arcGeometry);
        const angles = getEvenlySpacedEllipseAngles(radiusX, radiusY, halfSpan, capacity,
            tileDiameter + tileMetrics.gap);
        const points = angles.map(angle => ({
            angle,
            ...orbitalSystem.getPoint(radiusX, angle, orbitGeometry, centerX, centerY)
        }));
        points.forEach((point, slot) => {
            const neighbors = [points[slot - 1], points[slot + 1]].filter(Boolean);
            const horizontalDistances = neighbors.map(neighbor =>
                Math.abs(point.x - neighbor.x));
            const responsiveLabelInset = (1 - tileMetrics.scale) * 14;
            const horizontalSpacing = Math.min(...horizontalDistances.filter(Number.isFinite));
            const titleTop = point.y + tileDiameter / 2 + 3;
            const titleMetric = titleMetrics.get(getDashboardSlotKey(arc, slot));
            const titleBottom = titleTop + (titleMetric?.lineCount || 2) *
                (titleMetric?.lineHeight || 13);
            const collisionSafeWidth = neighbors.reduce((safeWidth, neighbor) => {
                const overlapsVertically = titleTop < neighbor.y + tileDiameter / 2 &&
                    titleBottom > neighbor.y - tileDiameter / 2;
                if (!overlapsVertically) return safeWidth;
                const clearance = Math.abs(point.x - neighbor.x) - tileDiameter / 2 - 3;
                return Math.min(safeWidth, Math.max(12, clearance * 2));
            }, Number.POSITIVE_INFINITY);
            const labelSpacing = Math.max(12, Math.min(
                horizontalSpacing - responsiveLabelInset,
                collisionSafeWidth));
            slotMap.set(getDashboardSlotKey(arc, slot), {
                arc, slot, angle: point.angle, x: point.x, y: point.y, tangent: point.tangent,
                spacing: labelSpacing, titleOffsetX: 0, scale: 1, opacity: 1
            });
        });
    }
    const positions = [...slotMap.values()];
    const padding = 12;
    if (settings.tileSize === "small") {
        const intersects = (first, second) =>
            Math.min(first.right, second.right) - Math.max(first.left, second.left) > -1 &&
            Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) > -1;
        const getTitleRect = (point, metric, titleWidth, offsetY = 0) => ({
            left: point.x - titleWidth / 2,
            right: point.x + titleWidth / 2,
            top: point.y + tileDiameter / 2 + 3 + offsetY,
            bottom: point.y + tileDiameter / 2 + 3 + offsetY +
                (metric?.lineCount || 2) * (metric?.lineHeight || 13)
        });
        const tileRects = new Map(positions.map(point => [getDashboardSlotKey(point.arc, point.slot), {
            left: point.x - tileDiameter / 2,
            right: point.x + tileDiameter / 2,
            top: point.y - tileDiameter / 2,
            bottom: point.y + tileDiameter / 2
        }]));
        const titleRects = new Map(positions.flatMap(point => {
            const key = getDashboardSlotKey(point.arc, point.slot);
            const metric = titleMetrics.get(key);
            if (!metric?.naturalWidth) return [];
            const titleWidth = Math.min(90, Math.max(10, point.spacing - 2));
            return [[key, getTitleRect(point, metric, titleWidth)]];
        }));

        positions.forEach(point => {
            const key = getDashboardSlotKey(point.arc, point.slot);
            const metric = titleMetrics.get(key);
            if (!metric?.singleWord || metric.naturalWidth <= point.spacing - 2) return;
            const desiredWidth = Math.min(90, metric.naturalWidth + 2);
            const offsetY = Array.from({ length: 9 }, (_, index) => index).find(candidateOffsetY => {
                const candidate = getTitleRect(point, metric, desiredWidth, candidateOffsetY);
                if (candidate.left < padding || candidate.right > width - padding) return false;
                const hitsTile = [...tileRects].some(([otherKey, tileRect]) =>
                    otherKey !== key && intersects(candidate, tileRect));
                if (hitsTile) return false;
                return ![...titleRects].some(([otherKey, titleRect]) =>
                    otherKey !== key && intersects(candidate, titleRect));
            });
            if (offsetY === undefined) return;
            point.spacing = desiredWidth + 2;
            point.titleOffsetY = offsetY;
            titleRects.set(key, getTitleRect(point, metric, desiredWidth, offsetY));
        });

        const positionsByKey = new Map(positions.map(point =>
            [getDashboardSlotKey(point.arc, point.slot), point]));
        for (let pass = 0; pass < 4; pass += 1) {
            let adjusted = false;
            const entries = [...titleRects];
            for (let index = 0; index < entries.length && !adjusted; index += 1) {
                const [firstKey, firstRect] = entries[index];
                for (let otherIndex = index + 1; otherIndex < entries.length; otherIndex += 1) {
                    const [secondKey, secondRect] = entries[otherIndex];
                    if (!intersects(firstRect, secondRect)) continue;
                    const candidates = [[firstKey, firstRect], [secondKey, secondRect]]
                        .sort((first, second) => second[1].top - first[1].top);
                    for (const [candidateKey, currentRect] of candidates) {
                        const point = positionsByKey.get(candidateKey);
                        const metric = titleMetrics.get(candidateKey);
                        if (!point || !metric) continue;
                        const currentOffsetY = point.titleOffsetY || 0;
                        const candidateWidth = currentRect.right - currentRect.left;
                        const nextOffsetY = Array.from({ length: 8 }, (_, offsetIndex) =>
                            currentOffsetY + offsetIndex + 1).find(offset => {
                            const candidateRect = getTitleRect(point, metric, candidateWidth, offset);
                            const hitsTile = [...tileRects].some(([tileKey, tileRect]) =>
                                tileKey !== candidateKey && intersects(candidateRect, tileRect));
                            if (hitsTile) return false;
                            return ![...titleRects].some(([titleKey, titleRect]) =>
                                titleKey !== candidateKey && intersects(candidateRect, titleRect));
                        });
                        if (nextOffsetY === undefined) continue;
                        point.titleOffsetY = nextOffsetY;
                        titleRects.set(candidateKey,
                            getTitleRect(point, metric, candidateWidth, nextOffsetY));
                        adjusted = true;
                        break;
                    }
                    if (adjusted) break;
                }
            }
            if (!adjusted) break;
        }
    }
    const bounds = {
        left: Math.min(...positions.map(point => point.x - tileDiameter / 2)),
        right: Math.max(...positions.map(point => point.x + tileDiameter / 2)),
        top: Math.min(...positions.map(point => point.y - tileDiameter / 2)),
        bottom: Math.max(...positions.map(point => point.y + tileDiameter / 2 + labelRoom))
    };
    const occupiedPositions = [...bookmarkGrid.querySelectorAll(":scope > .grid-cell")]
        .filter(cell => cell.querySelector(".tile:not(.empty-tile)") &&
            !cell.classList.contains("grid-cell--reserve"))
        .map(cell => slotMap.get(getDashboardSlotKey(
            Number(cell.dataset.previewArc ?? cell.dataset.arc),
            Number(cell.dataset.previewSlot ?? cell.dataset.slot))))
        .filter(Boolean);
    const activePositions = positions.filter(point => point.arc < adaptiveArcCount);
    const visiblePositions = occupiedPositions.length ? occupiedPositions : positions;
    const visibleTop = Math.min(...visiblePositions.map(point => point.y - tileDiameter / 2));
    const activeBottom = Math.max(...activePositions.map(point =>
        point.y + tileDiameter / 2 + labelRoom));
    const viewportTop = -gridRect.top + padding;
    const viewportBottom = window.innerHeight - gridRect.top - bottomReserve - padding - orbitLift;
    let verticalShift = viewportBottom - activeBottom;
    if (verticalShift < 0) {
        verticalShift = Math.max(verticalShift, -Math.max(0, visibleTop - viewportTop));
    }
    if (Math.abs(verticalShift) >= .25) {
        centerY += verticalShift;
        positions.forEach(point => point.y += verticalShift);
        bounds.top += verticalShift;
        bounds.bottom += verticalShift;
    }
    const panBounds = {
        minX: Math.min(0, width - padding - bounds.right),
        maxX: Math.max(0, padding - bounds.left),
        minY: 0,
        maxY: 0
    };
    const outerRadius = arcs.at(-1)?.radiusX || orbitGeometry.bookmarkBaseRadius;
    orbitalSystem.reserveBookmarkBand(outerRadius,
        tileDiameter / 2 + Math.max(26, tileDiameter * .35), orbitGeometry);
    return {
        width, height: Math.floor(availableHeight), tileDiameter, baseTileDiameter,
        tileScale: tileMetrics.scale, gap: tileMetrics.gap, centerX, centerY,
        viewportCenterX: orbitGeometry.centerX,
        viewportCenterY: orbitGeometry.centerY,
        orbitStep,
        tilt: orbitGeometry.tilt,
        perspective: orbitGeometry.perspective,
        arcs,
        slotMap,
        bounds,
        panBounds
    };
}

function getCarouselPoint(arc, slot, geometry = carouselState.geometry) {
    if (!geometry) return null;
    const point = geometry.slotMap.get(getDashboardSlotKey(arc, slot));
    return point ? {
        ...point,
        x: point.x + carouselState.panX,
        y: point.y + carouselState.panY
    } : null;
}

function positionOrbitalSearch() {
    const area = document.querySelector(".orbital-search-area");
    if (!area) return;
    const geometry = orbitalSystem.readGeometry();
    const compactWidth = clampOrbitalValue(window.innerWidth * .22, 228, 300);
    area.style.setProperty("--search-orbit-x", `${geometry.centerX.toFixed(2)}px`);
    const foundationRadius = geometry.bookmarkBaseRadius;
    const orbitStep = geometry.bookmarkStep;
    const sunScale = window.innerWidth <= 600 ? 1.08 : 1.16;
    const sunRadius = Math.max(compactWidth / 2, (foundationRadius - orbitStep) * sunScale);
    const curveWidth = sunRadius * 2;
    const curveHeight = curveWidth * geometry.perspective;
    const viewportCenterY = geometry.centerY;
    const sunLift = clampOrbitalValue(window.innerHeight * .02, 10, 24);
    const naturalCurveTop = viewportCenterY - curveHeight / 2 - sunLift;
    const baseCapHeight = clampOrbitalValue(window.innerHeight - naturalCurveTop, 74,
        Math.min(250, curveHeight / 2));
    const visualLift = clampOrbitalValue(window.innerHeight * .055, 28, 42);
    const visibleCapHeight = Math.min(curveHeight / 2, baseCapHeight + visualLift);
    const curveTop = Math.min(naturalCurveTop, window.innerHeight - baseCapHeight) - visualLift;
    const curveRadiusY = curveHeight / 2;
    const capRatio = clampOrbitalValue((visibleCapHeight - curveRadiusY) /
        Math.max(1, curveRadiusY), -1, 1);
    const visibleCapWidth = Math.max(compactWidth,
        curveWidth * Math.sqrt(Math.max(0, 1 - capRatio * capRatio)) + 6);
    const requestedTriggerHeight = clampOrbitalValue(visibleCapHeight * .34, 48, 58);
    const baseTriggerTop = Math.min(visibleCapHeight - requestedTriggerHeight - 7,
        Math.max(34, visibleCapHeight * .58));
    const searchTriggerTop = baseTriggerTop + 13;
    const searchTriggerHeight = Math.max(36, Math.min(requestedTriggerHeight,
        visibleCapHeight - searchTriggerTop - 2));
    const searchTriggerWidth = clampOrbitalValue(visibleCapWidth * .68, 156, 196);
    area.style.setProperty("--search-curve-top", `${curveTop.toFixed(2)}px`);
    area.style.setProperty("--search-collapsed-cap-height", `${visibleCapHeight.toFixed(2)}px`);
    area.style.setProperty("--search-collapsed-width", `${visibleCapWidth.toFixed(2)}px`);
    area.style.setProperty("--search-curve-width", `${curveWidth.toFixed(2)}px`);
    area.style.setProperty("--search-curve-height", `${curveHeight.toFixed(2)}px`);
    area.style.setProperty("--search-trigger-top", `${Math.max(4, searchTriggerTop).toFixed(2)}px`);
    area.style.setProperty("--search-trigger-width", `${searchTriggerWidth.toFixed(2)}px`);
    area.style.setProperty("--search-trigger-height", `${searchTriggerHeight.toFixed(2)}px`);
}

function anchorCarouselToBottom(geometry) {
    if (!geometry) return;
    const gridBounds = bookmarkGrid.getBoundingClientRect();
    const tileHalf = geometry.tileDiameter / 2;
    const labelRoom = getDashboardBookmarkTitleRoom();
    const occupiedPoints = [...bookmarkGrid.querySelectorAll(":scope > .grid-cell")]
        .filter(cell => cell.querySelector(".tile:not(.empty-tile)") &&
            !cell.classList.contains("grid-cell--reserve"))
        .map(cell => geometry.slotMap.get(getDashboardSlotKey(
            Number(cell.dataset.previewArc ?? cell.dataset.arc),
            Number(cell.dataset.previewSlot ?? cell.dataset.slot))))
        .filter(Boolean);
    if (!occupiedPoints.length) return;
    const visibleBottom = Math.max(...occupiedPoints.map(point =>
        gridBounds.top + point.y + tileHalf + labelRoom));
    const main = bookmarkGrid.closest("main");
    const bottomReserve = Math.max(0, parseFloat(getComputedStyle(main).paddingBottom) || 0);
    let verticalShift = window.innerHeight - bottomReserve - 12 - getBookmarkOrbitLift() -
        visibleBottom;
    const trigger = document.querySelector(".orbital-search-trigger");
    if (trigger) {
        let triggerBounds = trigger.getBoundingClientRect();
        if (!triggerBounds.width || !triggerBounds.height) {
            const area = document.querySelector(".orbital-search-area");
            const styles = getComputedStyle(area);
            const centerX = parseFloat(styles.getPropertyValue("--search-orbit-x"));
            const curveTop = parseFloat(styles.getPropertyValue("--search-curve-top"));
            const triggerTop = parseFloat(styles.getPropertyValue("--search-trigger-top"));
            const triggerWidth = parseFloat(styles.getPropertyValue("--search-trigger-width"));
            const triggerHeight = parseFloat(styles.getPropertyValue("--search-trigger-height"));
            if ([centerX, curveTop, triggerTop, triggerWidth, triggerHeight].every(Number.isFinite)) {
                triggerBounds = {
                    left: centerX - triggerWidth / 2,
                    right: centerX + triggerWidth / 2,
                    top: curveTop + triggerTop,
                    bottom: curveTop + triggerTop + triggerHeight
                };
            }
        }
        const triggerCenterX = (triggerBounds.left + triggerBounds.right) / 2;
        const collisionWidth = Math.min(120, triggerBounds.right - triggerBounds.left);
        const collisionLeft = triggerCenterX - collisionWidth / 2;
        const collisionRight = triggerCenterX + collisionWidth / 2;
        const pointsAboveSearch = occupiedPoints.filter(point =>
            gridBounds.left + point.x + tileHalf > collisionLeft &&
            gridBounds.left + point.x - tileHalf < collisionRight);
        if (pointsAboveSearch.length) {
            const searchBottom = Math.max(...pointsAboveSearch.map(point =>
                gridBounds.top + point.y + tileHalf + labelRoom));
            verticalShift = Math.min(verticalShift, triggerBounds.top - 6 - searchBottom);
        }
    }
    // Полная дуга уже привязана к низу в getCarouselGeometry; здесь разрешаем
    // только подъём для защиты от поиска и не опускаем пустые слоты за экран.
    verticalShift = Math.min(0, verticalShift);
    if (Math.abs(verticalShift) < .25) return;
    const visibleTop = Math.min(...occupiedPoints.map(point =>
        gridBounds.top + point.y - tileHalf));
    if (verticalShift < 0) {
        verticalShift = Math.max(verticalShift, -Math.max(0, visibleTop - 12));
    }
    if (Math.abs(verticalShift) < .25) return;
    geometry.centerY += verticalShift;
    geometry.slotMap.forEach(point => point.y += verticalShift);
    geometry.bounds.top += verticalShift;
    geometry.bounds.bottom += verticalShift;
}

function getBookmarkGroupTop() {
    if (bookmarksSection.hidden) return null;
    const occupiedCells = [...bookmarkGrid.querySelectorAll(":scope > .grid-cell")]
        .filter(cell => !cell.classList.contains("grid-cell--reserve") &&
            cell.querySelector(":scope > .tile"));
    if (!occupiedCells.length) return null;
    const visualElements = occupiedCells.flatMap(cell => {
        const title = settings.showBookmarkTitles ? cell.querySelector(".tile-title:not([hidden])") : null;
        return title ? [cell, title] : [cell];
    });
    return Math.min(...visualElements.map(element => element.getBoundingClientRect().top));
}

function alignPlanetOrbitsToBookmarks() {
    planetOrbitAlignmentFrame = 0;
    if (draggingId) return;
    const bookmarkTop = getBookmarkGroupTop();
    globalThis.planetOrbitLayout?.alignAbove(bookmarkTop, PLANET_ORBIT_BOOKMARK_GAP);
}

function schedulePlanetOrbitAlignment() {
    // не двигаем планеты во время перетаскивания
    if (draggingId) {
        if (planetOrbitAlignmentFrame) cancelAnimationFrame(planetOrbitAlignmentFrame);
        planetOrbitAlignmentFrame = 0;
        return;
    }
    if (planetOrbitAlignmentFrame) cancelAnimationFrame(planetOrbitAlignmentFrame);
    planetOrbitAlignmentFrame = requestAnimationFrame(alignPlanetOrbitsToBookmarks);
}

function getCarouselSlotRect(arc, slot) {
    const geometry = carouselState.geometry;
    const point = getCarouselPoint(arc, slot, geometry);
    if (!geometry || !point) return null;
    const gridRect = bookmarkGrid.getBoundingClientRect();
    const size = geometry.tileDiameter * point.scale;
    return {
        left: gridRect.left + point.x - size / 2,
        top: gridRect.top + point.y - size / 2,
        width: size,
        height: size,
        right: gridRect.left + point.x + size / 2,
        bottom: gridRect.top + point.y + size / 2
    };
}

function updateCarouselTransforms() {
    let geometry = carouselState.geometry;
    if (!geometry) return;
    const cells = [...bookmarkGrid.querySelectorAll(":scope > .grid-cell")];
    const requiredArcCount = cells.reduce((maximum, cell) => Math.max(maximum,
        Number(cell.dataset.previewArc ?? cell.dataset.arc) + 1 || 0), geometry.arcs.length);
    if (requiredArcCount > geometry.arcs.length) {
        geometry = getCarouselGeometry(requiredArcCount, bookmarkGrid.clientWidth,
            geometry.baseTileDiameter, getDashboardActiveArcCount());
        carouselState.geometry = geometry;
        bookmarkGrid.style.setProperty("--orbit-tile-scale", geometry.tileScale.toFixed(4));
        bookmarkGrid.style.setProperty("--orbit-slot-gap", `${geometry.gap.toFixed(2)}px`);
        bookmarkGrid.style.height = `${geometry.height}px`;
        positionOrbitalSearch();
        anchorCarouselToBottom(geometry);
        applyCarouselPanBounds();
    }
    cells.forEach(cell => {
        const arc = Number(cell.dataset.previewArc ?? cell.dataset.arc);
        const slot = Number(cell.dataset.previewSlot ?? cell.dataset.slot);
        const point = getCarouselPoint(arc, slot, geometry);
        if (!point) return;
        cell.dataset.orbitAngle = String(point.tangent);
        cell.style.setProperty("--orbit-cell-spacing", `${point.spacing.toFixed(2)}px`);
        cell.style.setProperty("--orbit-title-offset-x", `${point.titleOffsetX.toFixed(2)}px`);
        cell.style.setProperty("--orbit-title-offset-y", `${(point.titleOffsetY || 0).toFixed(2)}px`);
        const cellX = snapToDevicePixel(point.x - geometry.tileDiameter / 2);
        const cellY = snapToDevicePixel(point.y - geometry.tileDiameter / 2);
        cell.style.transform = `translate3d(${cellX}px, ${cellY}px, 0)`;
        cell.style.visibility = "visible";
        cell.style.pointerEvents = "auto";
        cell.style.zIndex = String(20 + arc * 2 + Math.round(Math.cos(point.angle) * 3));
    });
    bookmarkGrid.querySelectorAll(":scope > .bookmark-arc-guide").forEach(guide => {
        const arc = geometry.arcs[Number(guide.dataset.arc)];
        if (!arc) return;
        guide.style.width = `${arc.radiusX * 2}px`;
        guide.style.height = `${arc.radiusY * 2}px`;
        guide.style.left = `${(geometry.centerX + carouselState.panX - arc.radiusX).toFixed(2)}px`;
        guide.style.top = `${(geometry.centerY + carouselState.panY - arc.radiusY).toFixed(2)}px`;
        guide.style.transform = `rotate(${geometry.tilt}rad)`;
    });
    if (dragPreviewPlaceholder && dragPreviewIntent?.containerId === "dashboard" &&
        dragPreviewIntent.insertionSlot) {
        const rect = getCarouselSlotRect(dragPreviewIntent.insertionSlot.arc,
            dragPreviewIntent.insertionSlot.slot);
        if (rect) showDragPlaceholder(rect);
    }
}

function applyCarouselPanBounds() {
    const geometry = carouselState.geometry;
    if (!geometry) return;
    carouselState.panX = clampOrbitalValue(carouselState.panX,
        geometry.panBounds.minX, geometry.panBounds.maxX);
    carouselState.panY = 0;
    const scrollable = geometry.panBounds.minX < geometry.panBounds.maxX ||
        geometry.panBounds.minY < geometry.panBounds.maxY;
    bookmarkGrid.classList.toggle("bookmark-grid--scrollable", scrollable);
}

function positionDashboardTiles() {
    orbitalLayoutFrame = 0;
    if (bookmarksSection.hidden) {
        positionOrbitalSearch();
        schedulePlanetOrbitAlignment();
        return;
    }
    if (syncAutomaticArcCapacity()) {
        renderBookmarks(true);
        void saveDashboardSettings();
        return;
    }
    const tileDiameter = getDashboardTileDiameter();
    const width = bookmarkGrid.clientWidth || bookmarkGrid.parentElement.clientWidth;
    const previewArc = [...bookmarkGrid.querySelectorAll("[data-preview-arc]")]
        .reduce((maximum, cell) => Math.max(maximum, Number(cell.dataset.previewArc) || 0), -1);
    const activeArcCount = getDashboardActiveArcCount(previewArc);
    const renderedArcCount = [...bookmarkGrid.querySelectorAll(":scope > .grid-cell")]
        .reduce((maximum, cell) => Math.max(maximum, Number(cell.dataset.arc) + 1 || 0), activeArcCount);
    const geometry = getCarouselGeometry(renderedArcCount, width, tileDiameter, activeArcCount);
    carouselState.geometry = geometry;
    bookmarkGrid.style.setProperty("--orbit-tile-scale", geometry.tileScale.toFixed(4));
    bookmarkGrid.style.setProperty("--orbit-slot-gap", `${geometry.gap.toFixed(2)}px`);
    bookmarkGrid.style.height = `${geometry.height}px`;
    positionOrbitalSearch();
    anchorCarouselToBottom(geometry);
    applyCarouselPanBounds();
    updateCarouselTransforms();
    schedulePlanetOrbitAlignment();
}

function scheduleOrbitalLayout() {
    if (orbitalLayoutFrame) cancelAnimationFrame(orbitalLayoutFrame);
    orbitalLayoutFrame = requestAnimationFrame(positionDashboardTiles);
}

function scheduleOrbitalResizeLayout() {
    scheduleOrbitalLayout();
}

function resetCarouselViewport() {
    if (carouselAnimationFrame) cancelAnimationFrame(carouselAnimationFrame);
    carouselAnimationFrame = 0;
    carouselState.panX = 0;
    carouselState.panY = 0;
    carouselState.velocityX = 0;
    carouselState.velocityY = 0;
    carouselState.dragAutoX = 0;
    carouselState.dragAutoY = 0;
}

window.addEventListener("resize", scheduleOrbitalResizeLayout);
window.addEventListener("load", scheduleOrbitalLayout);

const bookmarkResizeObserver = typeof ResizeObserver === "function" ?
    new ResizeObserver(scheduleOrbitalResizeLayout) : null;
bookmarkResizeObserver?.observe(bookmarkGrid);

function moveCarouselViewport(deltaX, deltaY) {
    const geometry = carouselState.geometry;
    if (!geometry) return false;
    const nextX = clampOrbitalValue(carouselState.panX + deltaX,
        geometry.panBounds.minX, geometry.panBounds.maxX);
    const changed = Math.abs(nextX - carouselState.panX) > .01;
    carouselState.panX = nextX;
    carouselState.panY = 0;
    if (changed) updateCarouselTransforms();
    return changed;
}

function runCarouselMotion() {
    carouselAnimationFrame = 0;
    if (carouselState.panning) return;
    const moved = moveCarouselViewport(carouselState.velocityX + carouselState.dragAutoX, 0);
    carouselState.velocityX *= .88;
    carouselState.velocityY = 0;
    if (!moved) {
        carouselState.velocityX = 0;
        carouselState.velocityY = 0;
    }
    if (Math.abs(carouselState.velocityX) > .08 || carouselState.dragAutoX) {
        carouselAnimationFrame = requestAnimationFrame(runCarouselMotion);
    }
}

function requestCarouselMotion() {
    if (!carouselAnimationFrame) carouselAnimationFrame = requestAnimationFrame(runCarouselMotion);
}

function updateCarouselDragAutoScroll(clientX, clientY) {
    const geometry = carouselState.geometry;
    if (!geometry) return;
    const bounds = bookmarkGrid.getBoundingClientRect();
    const edge = Math.min(86, Math.max(42, bounds.width * .1));
    carouselState.dragAutoX = 0;
    carouselState.dragAutoY = 0;
    if (geometry.panBounds.minX < geometry.panBounds.maxX) {
        if (clientX < bounds.left + edge) {
            carouselState.dragAutoX = 2 + (bounds.left + edge - clientX) / edge * 8;
        } else if (clientX > bounds.right - edge) {
            carouselState.dragAutoX = -2 - (clientX - bounds.right + edge) / edge * 8;
        }
    }
    if (carouselState.dragAutoX) requestCarouselMotion();
}

bookmarkGrid.addEventListener("wheel", event => {
    const geometry = carouselState.geometry;
    if (!geometry) return;
    const canPanX = geometry.panBounds.minX < geometry.panBounds.maxX;
    const horizontalIntent = event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY);
    if (!canPanX || !horizontalIntent) return;
    event.preventDefault();
    carouselState.velocityX = clampOrbitalValue(carouselState.velocityX -
        (event.deltaX || event.deltaY) * .18, -34, 34);
    requestCarouselMotion();
}, { passive: false });

bookmarkGrid.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.target.closest(".tile, .empty-tile, .drag-placeholder, button, a")) return;
    const geometry = carouselState.geometry;
    if (!geometry || geometry.panBounds.minX === geometry.panBounds.maxX) return;
    carouselState.pointerId = event.pointerId;
    carouselState.panning = true;
    carouselState.velocityX = 0;
    carouselState.velocityY = 0;
    carouselState.lastX = event.clientX;
    carouselState.lastY = event.clientY;
    carouselState.lastTime = performance.now();
    bookmarkGrid.classList.add("bookmark-grid--panning");
    bookmarkGrid.setPointerCapture(event.pointerId);
});

bookmarkGrid.addEventListener("pointermove", event => {
    if (!carouselState.panning || event.pointerId !== carouselState.pointerId) return;
    const now = performance.now();
    const deltaX = event.clientX - carouselState.lastX;
    const deltaY = event.clientY - carouselState.lastY;
    const deltaTime = Math.max(8, now - carouselState.lastTime);
    moveCarouselViewport(deltaX, 0);
    carouselState.velocityX = clampOrbitalValue(deltaX * 16 / deltaTime, -28, 28);
    carouselState.velocityY = 0;
    carouselState.lastX = event.clientX;
    carouselState.lastY = event.clientY;
    carouselState.lastTime = now;
});

function finishCarouselPointer(event) {
    if (!carouselState.panning || event.pointerId !== carouselState.pointerId) return;
    carouselState.panning = false;
    carouselState.pointerId = null;
    bookmarkGrid.classList.remove("bookmark-grid--panning");
    if (bookmarkGrid.hasPointerCapture(event.pointerId)) bookmarkGrid.releasePointerCapture(event.pointerId);
    requestCarouselMotion();
}

bookmarkGrid.addEventListener("pointerup", finishCarouselPointer);
bookmarkGrid.addEventListener("pointercancel", finishCarouselPointer);

function getBookmarkTileSignature(bookmark, compact) {
    const titleHidden = !bookmark.children && (!bookmark.title.trim() || isBookmarkTitleHidden(bookmark));
    const folderColor = bookmark.children ? getFolderColor(bookmark) : "";
    return JSON.stringify([bookmark.id, bookmark.title, bookmark.url || "", Boolean(compact), titleHidden, folderColor]);
}

// создаем плитки и папки
function createBookmarkTile(item, compact = false) {
    const bookmark = findBookmark(item.id);
    if (!bookmark) {
        return null;
    }
    const isFolder = Array.isArray(bookmark.children);
    const tile = document.createElement(isFolder ? "button" : "a");
    tile.className = "tile" + (isFolder ? " folder-tile" : "");
    if (isFolder) tile.dataset.folderColor = getFolderColor(bookmark);
    const patternKey = bookmark.syncKey || bookmark.url || bookmark.id;
    tile.dataset.planetPattern = String(getTextHash(patternKey) % 4 + 1);
    const surface = document.createElement("span");
    surface.className = "tile-surface";
    surface.setAttribute("aria-hidden", "true");
    const surfaceDetail = document.createElement("span");
    surfaceDetail.className = "tile-surface-detail";
    surface.append(surfaceDetail);
    tile.append(surface);
    const titleHidden = !isFolder && (!bookmark.title.trim() || isBookmarkTitleHidden(bookmark));
    tile.classList.toggle("tile--title-hidden", titleHidden);
    if (isFolder) {
        tile.type = "button";
        tile.setAttribute("aria-haspopup", "dialog");
        const iconBox = document.createElement("span");
        iconBox.className = "favicon-box folder-mini-icon";
        iconBox.setAttribute("aria-hidden", "true");
        iconBox.innerHTML = '<svg viewBox="0 0 48 48" focusable="false"><path class="folder-icon-back" d="M4 17V11.5A4.5 4.5 0 0 1 8.5 7h14.8a3.5 3.5 0 0 1 2.8 1.4L29.6 13H8a4 4 0 0 0-4 4Z"/><path class="folder-icon-front" d="M4 17a4 4 0 0 1 4-4h31.5a4.5 4.5 0 0 1 4.5 4.5V37a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/></svg>';
        tile.append(iconBox);
    } else {
        tile.href = bookmark.url;
        const iconBox = document.createElement("span");
        iconBox.className = "favicon-box";
        const icon = document.createElement("img");
        icon.addEventListener("load", function() {
            icon.classList.toggle("small-favicon", icon.naturalWidth <= 20 && icon.naturalHeight <= 20);
            applyBookmarkTileColor(tile, icon, bookmark.url, bookmark.id);
        });
        queueFaviconUpgrade(icon, bookmark.url);
        icon.alt = "";
        icon.draggable = false;
        iconBox.append(icon);
        tile.append(iconBox);
    }
    tile.addEventListener("contextmenu", event => {
        event.preventDefault();
        hideBookmarkTooltip(true);
        showBookmarkMenu(event, bookmark, tile);
    });
    const fullTitle = bookmark.title || (isFolder ? "Папка" : new URL(bookmark.url).hostname);
    tile.dataset.fullTitle = fullTitle;
    tile.setAttribute("aria-label", fullTitle);
    tile.dataset.id = bookmark.id;
    tile.dataset.renderSignature = getBookmarkTileSignature(bookmark, compact);
    tile.setAttribute("draggable", "true");
    const title = document.createElement("span");
    title.className = "tile-title";
    title.classList.add(/\s/u.test(fullTitle.trim()) ?
        "tile-title--multi-word" : "tile-title--single-word");
    title.textContent = fullTitle;
    title.hidden = titleHidden;
    tile.append(title);
    tile.addEventListener("click", event => {
        if (Date.now() < blockClickUntil) {
            event.preventDefault();
            return;
        }
        if (isFolder) {
            hideBookmarkMenu();
            folderPath = compact ? [...folderPath, bookmark.id] : [bookmark.id];
            renderFolderBookmarks();
            if (!folderDialog.open) {
                folderDialog.showModal();
            }
        }
    });
    tile.addEventListener("dragstart", event => {
        hideBookmarkTooltip(true);
        hideBookmarkMenu();
        clearDragIndicators();
        dragPreviewIntent = null;
        dragDashboardSnapshot = null;
        carouselState.dragAutoX = 0;
        carouselState.dragAutoY = 0;
        draggingId = bookmark.id;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", bookmark.id);
        requestAnimationFrame(() => {
            if (draggingId !== bookmark.id) return;
            tile.classList.add("dragging");
            bookmarkGrid.classList.add("bookmark-grid--drag-active");
        });
    });
    if (compact) {
        setupFolderDropTarget(tile, bookmark);
        tile.addEventListener("drag", event => {
            if (!folderDialog.open || (event.clientX === 0 && event.clientY === 0)) {
                return;
            }
            const bounds = folderDialog.getBoundingClientRect();
            const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
                event.clientY < bounds.top || event.clientY > bounds.bottom;
            if (outside) {
                folderDialog.close();
            }
        });
    }
    tile.addEventListener("dragend", () => {
        finishDragSession();
    });
    return tile;
}

const folderDialog = document.querySelector(".folder-dialog");

const folderGrid = document.querySelector(".folder-grid");

const folderBack = document.querySelector(".folder-back");

function createFolderAddTile() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-add-tile";
    button.setAttribute("aria-label", translate("addItem"));
    button.title = translate("addItem");
    const plus = document.createElement("span");
    plus.textContent = "+";
    plus.setAttribute("aria-hidden", "true");
    button.append(plus);
    button.addEventListener("click", () => openCreationDialog(null, button));
    button.addEventListener("dragover", event => {
        if (!draggingId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        clearDragIndicators();
        const folderId = folderPath.at(-1);
        const lastTarget = findBookmark(folderId)?.children.filter(item => item.id !== draggingId).at(-1);
        if (lastTarget) {
            showInsertionPreview(folderId, lastTarget.id, true);
            setDragPreviewAction(folderId, lastTarget.id, "after");
        } else {
            clearSortPreview();
            button.classList.add("drag-over");
            setDragPreviewAction(folderId, "end", "end");
        }
    });
    button.addEventListener("dragleave", event => {
        if (!button.contains(event.relatedTarget)) button.classList.remove("drag-over");
    });
    button.addEventListener("drop", async event => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = finishDragSession();
        if (sourceId && folderPath.length) {
            await moveItemWithinFolder(sourceId, folderPath.at(-1));
        }
    });
    return button;
}

function getHorizontalDropPosition(event, element) {
    const bounds = element.getBoundingClientRect();
    return bounds.width ? (event.clientX - bounds.left) / bounds.width : .5;
}

function getOrbitalDropPosition(event, element) {
    const bounds = element.getBoundingClientRect();
    const angle = Number(element.dataset.orbitAngle);
    if (!Number.isFinite(angle) || !bounds.width) return getHorizontalDropPosition(event, element);
    const offsetX = event.clientX - (bounds.left + bounds.width / 2);
    const offsetY = event.clientY - (bounds.top + bounds.height / 2);
    const tangentProjection = offsetX * Math.cos(angle) + offsetY * Math.sin(angle);
    return Math.max(0, Math.min(1, .5 + tangentProjection / bounds.width));
}

function setupFolderDropTarget(tile, targetBookmark) {
    tile.addEventListener("dragover", event => {
        const source = draggingId ? findBookmark(draggingId) : null;
        if (!source || source.id === targetBookmark.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        clearDragIndicators();
        const horizontalPosition = getHorizontalDropPosition(event, tile);
        const folderId = folderPath.at(-1);
        const isFolderTarget = Array.isArray(targetBookmark.children) &&
            !folderContains(source, targetBookmark.id);
        const action = getStableDropAction(folderId, targetBookmark.id, isFolderTarget, horizontalPosition);
        if (action === "inside") {
            if (dragPreviewIntent?.key !== `${folderId}:${targetBookmark.id}:inside`) clearSortPreview();
            tile.classList.add("drag-over");
        } else {
            showInsertionPreview(folderId, targetBookmark.id, action === "after");
        }
        setDragPreviewAction(folderId, targetBookmark.id, action);
    });
    tile.addEventListener("dragleave", event => {
        if (!tile.contains(event.relatedTarget)) {
            tile.classList.remove("drag-over");
        }
    });
    tile.addEventListener("drop", async event => {
        event.preventDefault();
        event.stopPropagation();
        const sourceId = draggingId;
        const source = sourceId ? findBookmark(sourceId) : null;
        const horizontalPosition = getHorizontalDropPosition(event, tile);
        const folderId = folderPath.at(-1);
        const isFolderTarget = source && Array.isArray(targetBookmark.children) &&
            source.id !== targetBookmark.id && !folderContains(source, targetBookmark.id);
        const action = dragPreviewIntent?.containerId === folderId &&
            dragPreviewIntent?.targetId === targetBookmark.id ? dragPreviewIntent.action :
            getStableDropAction(folderId, targetBookmark.id, isFolderTarget, horizontalPosition);
        finishDragSession();
        if (!source || source.id === targetBookmark.id || !folderPath.length) return;
        if (action === "inside") {
            await moveItemIntoFolder(sourceId, targetBookmark.id);
        } else {
            await moveItemWithinFolder(sourceId, folderId, targetBookmark.id, action === "after");
        }
    });
}

function renderFolderBookmarks(reuseTiles = false) {
    if (!folderPath.length) {
        return;
    }
    while (folderPath.length && !findBookmark(folderPath.at(-1))) folderPath.pop();
    const folder = findBookmark(folderPath.at(-1));
    if (!folder?.children) {
        folderDialog.close();
        return;
    }
    document.getElementById("folder-title").textContent = folder.title;
    folderBack.hidden = folderPath.length < 2;
    const existingTiles = reuseTiles ? new Map([...folderGrid.querySelectorAll(":scope > .tile:not(.folder-tile)")]
        .map(tile => [tile.dataset.id, tile])) : new Map();
    const tiles = folder.children.map(item => {
        const bookmark = findBookmark(item.id);
        const existingTile = existingTiles.get(item.id);
        return bookmark && existingTile?.dataset.renderSignature === getBookmarkTileSignature(bookmark, true) ?
            existingTile : createBookmarkTile(item, true);
    });
    folderGrid.replaceChildren(...tiles, createFolderAddTile());
}

folderBack.addEventListener("click", () => {
    hideBookmarkMenu();
    folderPath.pop();
    renderFolderBookmarks();
});

folderDialog.addEventListener("close", () => {
    resetDragPreview();
    folderPath = [];
    hideBookmarkMenu();
});

const bookmarkMenu = document.querySelector(".bookmark-menu");

const editBookmarkButton = document.querySelector(".bookmark-menu-edit");

const deleteBookmarkButton = document.querySelector(".bookmark-menu-delete");

const folderColorMenu = document.querySelector(".bookmark-menu-folder-colors");

const folderColorButtons = [...document.querySelectorAll(".folder-color-dot")];

const editBookmarkDialog = document.querySelector(".edit-bookmark-dialog");

const editBookmarkForm = editBookmarkDialog.querySelector("form");

const editBookmarkHeading = editBookmarkDialog.querySelector("h2");

const editBookmarkTitleInput = document.getElementById("edit-bookmark-title");

const editBookmarkUrlInput = document.getElementById("edit-bookmark-url");

const editBookmarkUrlField = document.querySelector(".edit-bookmark-url-field");

const editBookmarkShowTitleInput = document.getElementById("edit-bookmark-show-title");

const editBookmarkVisibility = document.querySelector(".edit-bookmark-visibility");

let editingBookmarkId = null;

let selectedBookmarkId = null;

let selectedBookmarkTile = null;

// меню и редактирование
function hideBookmarkMenu() {
    bookmarkMenu.hidden = true;
    selectedBookmarkId = null;
}

function showBookmarkMenu(event, bookmark, tile) {
    selectedBookmarkId = bookmark.id;
    selectedBookmarkTile = tile;
    (tile.closest("dialog") || document.body).append(bookmarkMenu);
    deleteBookmarkButton.textContent = translate(bookmark.children ? "deleteFolder" : "deleteBookmark");
    const isFolder = Array.isArray(bookmark.children);
    folderColorMenu.hidden = !isFolder;
    if (isFolder) {
        const selectedColor = getFolderColor(bookmark);
        folderColorButtons.forEach(button => {
            button.setAttribute("aria-checked", String(button.dataset.folderColor === selectedColor));
        });
    }
    bookmarkMenu.hidden = false;
    const rect = tile.getBoundingClientRect();
    const x = event.clientX || rect.left;
    const y = event.clientY || rect.bottom;
    bookmarkMenu.style.left = Math.max(8, Math.min(x, innerWidth - bookmarkMenu.offsetWidth - 8)) + "px";
    bookmarkMenu.style.top = Math.max(8, Math.min(y, innerHeight - bookmarkMenu.offsetHeight - 8)) + "px";
    editBookmarkButton.focus();
}

async function chooseFolderColor(event) {
    const button = event.currentTarget;
    const bookmark = findBookmark(selectedBookmarkId);
    if (!bookmark?.children || !setFolderColor(bookmark, button.dataset.folderColor)) return;
    selectedBookmarkTile.dataset.folderColor = getFolderColor(bookmark);
    selectedBookmarkTile.dataset.renderSignature = getBookmarkTileSignature(bookmark,
        Boolean(selectedBookmarkTile.closest(".folder-grid")));
    folderColorButtons.forEach(option => {
        option.setAttribute("aria-checked", String(option === button));
    });
    await saveDashboardSettings();
}

folderColorButtons.forEach(button => button.addEventListener("click", chooseFolderColor));

function openEditBookmarkDialog() {
    const bookmark = findBookmark(selectedBookmarkId);
    if (!bookmark) return;
    const isFolder = Array.isArray(bookmark.children);
    editingBookmarkId = bookmark.id;
    editBookmarkHeading.dataset.i18n = isFolder ? "editFolderHeading" : "editBookmarkHeading";
    editBookmarkHeading.textContent = translate(editBookmarkHeading.dataset.i18n);
    editBookmarkTitleInput.value = bookmark.title;
    editBookmarkTitleInput.required = isFolder;
    editBookmarkUrlInput.value = isFolder ? "" : bookmark.url;
    editBookmarkUrlInput.required = !isFolder;
    editBookmarkUrlField.hidden = isFolder;
    editBookmarkVisibility.hidden = isFolder;
    editBookmarkShowTitleInput.checked = !isBookmarkTitleHidden(bookmark);
    hideBookmarkMenu();
    editBookmarkDialog.showModal();
    editBookmarkTitleInput.focus();
    editBookmarkTitleInput.select();
}

async function updateBookmark() {
    const bookmark = findBookmark(editingBookmarkId);
    if (!bookmark) return;
    const isFolder = Array.isArray(bookmark.children);
    const title = editBookmarkTitleInput.value.trim();
    if (isFolder && !title) return;
    const changes = { title };
    if (!isFolder) {
        const url = normalizeWebsiteUrl(editBookmarkUrlInput.value);
        if (!url) {
            showNotification(translate("invalidUrl"));
            return;
        }
        changes.url = url;
    }
    const submitButton = editBookmarkForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
        await chrome.bookmarks.update(bookmark.id, changes);
        if (!isFolder && editBookmarkShowTitleInput.checked) hiddenBookmarkTitles.delete(bookmark.id);
        if (!isFolder && !editBookmarkShowTitleInput.checked) hiddenBookmarkTitles.add(bookmark.id);
        await saveDashboardSettings();
        editBookmarkDialog.close();
        await loadBookmarks();
    } catch (error) {
        console.error(error);
        showNotification(translate("editError"));
    } finally {
        submitButton.disabled = false;
    }
}

async function deleteBookmark() {
    const id = selectedBookmarkId;
    hideBookmarkMenu();
    const bookmark = findBookmark(id);
    if (!bookmark) {
        return;
    }
    const isFolder = Array.isArray(bookmark.children);
    if (isFolder && !await confirmFolderDeletion(bookmark.title)) {
        selectedBookmarkTile?.focus();
        return;
    }
    try {
        if (isFolder) {
            await chrome.bookmarks.removeTree(id);
        } else {
            await chrome.bookmarks.remove(id);
        }
        await loadBookmarks();
        if (folderDialog.open) {
            folderBack.hidden ? folderDialog.querySelector(".dialog-close")
                .focus() : folderBack.focus();
        } else {
            document.querySelector(".bookmark-grid .empty-tile")?.focus();
        }
    } catch (error) {
        console.error(error);
        showNotification(translate("deleteError"));
        selectedBookmarkTile?.focus();
    }
}

function confirmFolderDeletion(title) {
    confirmDialogMessage.textContent = translate("confirmDeleteFolder").replace("{title}", title);
    confirmDialog.returnValue = "";
    confirmDialog.showModal();
    return new Promise(resolve => {
        confirmDialog.addEventListener("close", () => {
            resolve(confirmDialog.returnValue === "confirm");
        }, { once: true });
    });
}

deleteBookmarkButton.addEventListener("click", deleteBookmark);

document.addEventListener("pointerdown", event => {
    if (!bookmarkMenu.contains(event.target)) {
        hideBookmarkMenu();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !bookmarkMenu.hidden) {
        event.preventDefault();
        event.stopPropagation();
        hideBookmarkMenu();
        selectedBookmarkTile?.focus();
    }
}, true);

document.addEventListener("scroll", hideBookmarkMenu, true);

window.addEventListener("resize", hideBookmarkMenu);

// переносим закладки и папки
async function moveBookmark(sourceId, targetId, x, y, afterTarget = false) {
    blockClickUntil = Date.now() + 300;
    if (!insertDashboardLayoutItem(sourceId, targetId, x, y, afterTarget)) return;
    const saved = saveDashboardSettings();
    renderBookmarks(true);
    await saved;
}

async function moveBookmarkToSlot(sourceId, arc, slot) {
    blockClickUntil = Date.now() + 300;
    if (!moveDashboardLayoutItemToSlot(sourceId, arc, slot)) return;
    const saved = saveDashboardSettings();
    renderBookmarks(true);
    await saved;
}

function folderContains(folder, itemId) {
    if (!Array.isArray(folder?.children)) {
        return false;
    }
    return folder.children.some(child => child.id === itemId || folderContains(child, itemId));
}

async function moveItemIntoFolder(sourceId, folderId) {
    const source = findBookmark(sourceId);
    const folder = findBookmark(folderId);
    const invalidNesting = sourceId === folderId || folderContains(source, folderId);
    if (!source || !Array.isArray(folder?.children) || invalidNesting) {
        return false;
    }
    blockClickUntil = Date.now() + 300;
    try {
        await chrome.bookmarks.move(sourceId, { parentId: folderId });
        await loadBookmarks();
        return true;
    } catch (error) {
        console.error(error);
        showNotification(translate("bookmarkError"));
        await loadBookmarks();
        return false;
    }
}

async function moveItemWithinFolder(sourceId, folderId, targetId = null, afterTarget = false) {
    const source = findBookmark(sourceId);
    const folder = findBookmark(folderId);
    const target = targetId ? findBookmark(targetId) : null;
    const invalidTarget = target && (target.id === sourceId || target.parentId !== folderId);
    const invalidNesting = sourceId === folderId || folderContains(source, folderId);
    if (!source || !Array.isArray(folder?.children) || invalidTarget || invalidNesting) {
        return false;
    }
    const destination = { parentId: folderId };
    if (target && Number.isInteger(target.index)) {
        let destinationIndex = target.index + (afterTarget ? 1 : 0);
        if (source.parentId === folderId && Number.isInteger(source.index) && source.index < destinationIndex) {
            destinationIndex--;
        }
        destination.index = Math.max(0, destinationIndex);
    }
    blockClickUntil = Date.now() + 300;
    try {
        await chrome.bookmarks.move(sourceId, destination);
        await loadBookmarks();
        return true;
    } catch (error) {
        console.error(error);
        showNotification(translate("bookmarkError"));
        await loadBookmarks();
        return false;
    }
}

function getDashboardParentId(item) {
    let topLevelItem = item;
    let parent = findBookmark(topLevelItem?.parentId);
    while (parent) {
        topLevelItem = parent;
        parent = findBookmark(topLevelItem.parentId);
    }
    return topLevelItem?.parentId || null;
}

async function moveItemToDashboard(sourceId, targetId, x, y, afterTarget = false) {
    const source = findBookmark(sourceId);
    const parentId = getDashboardParentId(source);
    if (!source || !parentId) {
        return false;
    }
    blockClickUntil = Date.now() + 300;
    try {
        await chrome.bookmarks.move(sourceId, { parentId: parentId });
        await loadBookmarks();
        if (!layout.some(item => item.id === sourceId)) {
            return false;
        }
        insertDashboardLayoutItem(sourceId, targetId, x, y, afterTarget);
        const saved = saveDashboardSettings();
        renderBookmarks(true);
        await saved;
        return true;
    } catch (error) {
        console.error(error);
        showNotification(translate("bookmarkError"));
        await loadBookmarks();
        return false;
    }
}

async function moveItemToDashboardSlot(sourceId, arc, slot) {
    const source = findBookmark(sourceId);
    const parentId = getDashboardParentId(source);
    if (!source || !parentId || !isValidDashboardSlot(arc, slot)) return false;
    blockClickUntil = Date.now() + 300;
    try {
        await chrome.bookmarks.move(sourceId, { parentId });
        await loadBookmarks();
        if (!layout.some(item => item.id === sourceId)) return false;
        moveDashboardLayoutItemToSlot(sourceId, arc, slot);
        const saved = saveDashboardSettings();
        renderBookmarks(true);
        await saved;
        return true;
    } catch (error) {
        console.error(error);
        showNotification(translate("bookmarkError"));
        await loadBookmarks();
        return false;
    }
}

function renderBookmarks(reuseTiles = false) {
    syncAutomaticArcCapacity();
    const previousPositions = reuseTiles && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? new Map([...bookmarkGrid.querySelectorAll(".tile")].map(tile =>
            [tile.dataset.id, tile.getBoundingClientRect()])) : new Map();
    const existingTiles = reuseTiles ? new Map([...bookmarkGrid.querySelectorAll(".tile")]
        .map(tile => [tile.dataset.id, tile])) : new Map();
    bookmarkGrid.replaceChildren();
    const dashboardGap = getDashboardBookmarkGap();
    bookmarkGrid.parentElement.style.setProperty("--grid-gap", `${dashboardGap}px`);
    bookmarkGrid.style.setProperty("--grid-gap", `${dashboardGap}px`);
    bookmarkGrid.setAttribute("role", "list");
    document.body.dataset.tileSize = settings.tileSize;
    syncDashboardOrder();
    const fragment = document.createDocumentFragment();
    const activeArcCount = getDashboardActiveArcCount();
    const renderedArcCount = activeArcCount + 1;
    for (let arc = 0; arc < renderedArcCount; arc += 1) {
        const guide = document.createElement("div");
        guide.className = "bookmark-arc-guide";
        guide.classList.toggle("bookmark-arc-guide--reserve", arc === activeArcCount);
        guide.dataset.arc = String(arc);
        guide.setAttribute("aria-hidden", "true");
        fragment.append(guide);
    }
    const occupied = new Map(layout.map(item => [getDashboardSlotKey(item.arc, item.slot), item]));
    getDashboardVisualSlots(renderedArcCount).forEach(position => {
        const item = occupied.get(position.key);
        const cell = document.createElement("div");
        cell.className = "grid-cell";
        cell.classList.toggle("grid-cell--reserve", position.arc === activeArcCount);
        cell.dataset.arc = String(position.arc);
        cell.dataset.slot = String(position.slot);
        if (!item) {
            cell.classList.add("grid-cell--empty");
            cell.setAttribute("role", "presentation");
            const emptyButton = document.createElement("button");
            emptyButton.type = "button";
            emptyButton.className = "empty-tile";
            emptyButton.setAttribute("aria-label", translate("addItem"));
            emptyButton.title = translate("addItem");
            const plus = document.createElement("span");
            plus.textContent = "+";
            plus.setAttribute("aria-hidden", "true");
            emptyButton.append(plus);
            emptyButton.addEventListener("click", () => openCreationDialog({
                arc: position.arc, slot: position.slot, x: position.slot, y: position.arc
            }, emptyButton));
            cell.append(emptyButton);
            cell.addEventListener("dragover", event => {
                if (!draggingId) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                updateCarouselDragAutoScroll(event.clientX, event.clientY);
                clearDragIndicators();
                const previewKey = `dashboard:slot:${position.key}`;
                if (dragPreviewIntent?.key !== previewKey) {
                    clearSortPreview();
                    const sourceCell = getTileSlot([...bookmarkGrid.querySelectorAll(".tile")]
                        .find(tile => tile.dataset.id === draggingId));
                    sourceCell?.classList.add("drag-preview-source");
                    dragPreviewIntent = {
                        key: previewKey,
                        containerId: "dashboard",
                        targetId: null,
                        action: "slot",
                        arc: position.arc,
                        slot: position.slot
                    };
                    showDragPlaceholder(cell.getBoundingClientRect());
                }
                cell.classList.add("drag-over");
            });
            cell.addEventListener("dragleave", event => {
                if (!cell.contains(event.relatedTarget)) cell.classList.remove("drag-over");
            });
            cell.addEventListener("drop", async event => {
                event.preventDefault();
                event.stopPropagation();
                await commitInsertionPreview();
            });
            fragment.append(cell);
            return;
        }

        const bookmark = findBookmark(item.id);
        if (!bookmark) return;
        const index = layout.findIndex(layoutItem => layoutItem.id === item.id);
        const existingTile = existingTiles.get(item.id);
        const tile = existingTile?.dataset.renderSignature === getBookmarkTileSignature(bookmark, false) ?
            existingTile : createBookmarkTile(item);
        if (!tile) return;
        tile.classList.remove("grid-cell");
        tile.removeAttribute("data-x");
        tile.removeAttribute("data-y");
        cell.dataset.order = String(item.order);
        cell.setAttribute("role", "listitem");
        tile.setAttribute("aria-posinset", String(index + 1));
        tile.setAttribute("aria-setsize", String(layout.length));
        cell.append(tile);
        cell.addEventListener("dragover", function(event) {
            const source = draggingId ? findBookmark(draggingId) : null;
            if (!source || source.id === item.id) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            updateCarouselDragAutoScroll(event.clientX, event.clientY);
            clearDragIndicators();
            const sequencePosition = getOrbitalDropPosition(event, cell);
            const isFolderTarget = Array.isArray(bookmark.children) && !folderContains(source, bookmark.id);
            const action = getStableDropAction("dashboard", bookmark.id, isFolderTarget, sequencePosition);
            if (action === "inside") {
                if (dragPreviewIntent?.key !== `dashboard:${bookmark.id}:inside`) clearSortPreview();
                cell.classList.add("drag-over");
            } else {
                showInsertionPreview("dashboard", bookmark.id, action === "after");
            }
            setDragPreviewAction("dashboard", bookmark.id, action);
        });
        cell.addEventListener("dragleave", function(event) {
            if (!cell.contains(event.relatedTarget)) cell.classList.remove("drag-over");
        });
        cell.addEventListener("drop", async function(event) {
            event.preventDefault();
            event.stopPropagation();
            const sourceId = draggingId;
            const source = sourceId ? findBookmark(sourceId) : null;
            const sequencePosition = getOrbitalDropPosition(event, cell);
            const isFolderTarget = source && Array.isArray(bookmark.children) &&
                sourceId !== bookmark.id && !folderContains(source, bookmark.id);
            const action = dragPreviewIntent?.containerId === "dashboard" &&
                dragPreviewIntent?.targetId === bookmark.id ? dragPreviewIntent.action :
                getStableDropAction("dashboard", bookmark.id, isFolderTarget, sequencePosition);
            finishDragSession();
            if (!source || source.id === bookmark.id) return;
            if (action === "inside") {
                await moveItemIntoFolder(sourceId, bookmark.id);
            } else if (!layout.some(layoutItem => layoutItem.id === sourceId)) {
                await moveItemToDashboard(sourceId, bookmark.id, undefined, undefined, action === "after");
            } else {
                await moveBookmark(sourceId, bookmark.id, undefined, undefined, action === "after");
            }
        });
        fragment.append(cell);
    });
    bookmarkGrid.append(fragment);
    positionDashboardTiles();
    bookmarkGrid.ondragover = function(event) {
        if (event.target !== bookmarkGrid || !draggingId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        updateCarouselDragAutoScroll(event.clientX, event.clientY);
        const occupiedKeys = new Set(layout.filter(item => item.id !== draggingId)
            .map(item => getDashboardSlotKey(item.arc, item.slot)));
        const target = getFirstAvailableDashboardSlot(occupiedKeys);
        dragPreviewIntent = {
            key: `dashboard:auto:${target.arc}:${target.slot}`,
            containerId: "dashboard",
            targetId: null,
            action: "slot",
            arc: target.arc,
            slot: target.slot
        };
    };
    bookmarkGrid.ondrop = async function(event) {
        if (event.target !== bookmarkGrid || !draggingId) return;
        event.preventDefault();
        const sourceId = draggingId;
        await commitInsertionPreview();
    };
    if (previousPositions.size) {
        requestAnimationFrame(() => bookmarkGrid.querySelectorAll(".tile").forEach(tile => {
            const previous = previousPositions.get(tile.dataset.id);
            if (!previous) return;
            const current = tile.getBoundingClientRect();
            const offsetX = previous.left - current.left;
            const offsetY = previous.top - current.top;
            if (Math.abs(offsetX) < 1 && Math.abs(offsetY) < 1) return;
            const animation = tile.animate([
                { transform: `translate(${offsetX}px, ${offsetY}px)` },
                { transform: "translate(0, 0)" }
            ], { duration: 190, easing: "cubic-bezier(.2, .7, .2, 1)" });
            animation.addEventListener("finish", () => animation.cancel(), { once: true });
        }));
    }
    updateBookmarkCount();
}

function updateBookmarkCount() {
    const count = bookmarks.length;
    emptyState.hidden = count !== 0;
}

// создаем закладку или папку
function updateCreationFields() {
    const isFolder = getSelectedItemType() === "folder";
    bookmarkTitleInput.required = isFolder;
    bookmarkTitleInput.placeholder = isFolder ? translate("folderType") : "YouTube";
    bookmarkUrlInput.hidden = isFolder;
    bookmarkUrlInput.required = !isFolder;
    document.querySelector('label[for="add-url"]').hidden = isFolder;
}

function getSelectedItemType() {
    return bookmarkKindInput.value;
}

function positionCreationChoice() {
    if (!creationAnchor) return;
    const anchorRect = creationAnchor.getBoundingClientRect();
    const dialogRect = addDialog.getBoundingClientRect();
    const gap = 10;
    let left = anchorRect.left - dialogRect.width - gap;
    if (left < 12) left = Math.min(window.innerWidth - dialogRect.width - 12, anchorRect.right + gap);
    const top = Math.max(12, Math.min(window.innerHeight - dialogRect.height - 12,
        anchorRect.top + anchorRect.height / 2 - dialogRect.height / 2));
    addDialog.style.left = `${Math.round(left)}px`;
    addDialog.style.top = `${Math.round(top)}px`;
}

function openCreationChoice() {
    addDialog.classList.add("add-dialog--choice");
    if (folderDialog.open) {
        addDialog.showModal();
    } else {
        addDialog.show();
    }
    positionCreationChoice();
}

function showCreationChoice() {
    bookmarkKindInput.value = "";
    creationHeading.dataset.i18n = "chooseWhat";
    creationHeading.textContent = translate("chooseWhat");
    creationOptions.hidden = false;
    creationDetails.hidden = true;
    creationBackButton.hidden = true;
    if (addDialog.open) {
        pendingCreationView = "choice";
        addDialog.close();
    } else {
        openCreationChoice();
    }
}

function showCreationDetails(kind) {
    bookmarkKindInput.value = kind;
    const headingKey = kind === "folder" ? "addFolderHeading" : "addBookmarkHeading";
    creationHeading.dataset.i18n = headingKey;
    creationHeading.textContent = translate(headingKey);
    creationOptions.hidden = true;
    creationDetails.hidden = false;
    creationBackButton.hidden = false;
    updateCreationFields();
    if (addDialog.open) {
        pendingCreationView = "details";
        addDialog.close();
    } else {
        addDialog.classList.remove("add-dialog--choice");
        addDialog.style.removeProperty("left");
        addDialog.style.removeProperty("top");
        addDialog.showModal();
        bookmarkTitleInput.focus();
    }
}

async function openCreationDialog(position = null, anchor = null) {
    try {
        const tree = await chrome.bookmarks.getTree();
        bookmarkParentSelect.replaceChildren();

        function appendFolderOptions(nodes, ancestors = []) {
            for (const node of nodes) {
                if (node.url || node.unmodifiable) {
                    continue;
                }
                const names = [...ancestors, node.title || translate("folderType")];
                const option = document.createElement("option");
                option.value = node.id;
                option.textContent = names.join(" / ");
                bookmarkParentSelect.append(option);
                appendFolderOptions(node.children || [], names);
            }
        }

        appendFolderOptions(tree[0]?.children || []);
        addForm.reset();
        creationPosition = position;
        creationAnchor = anchor;
        if (folderDialog.open && folderPath.length) {
            bookmarkParentSelect.value = folderPath.at(-1);
        }
        showCreationChoice();
    } catch (error) {
        console.error(error);
        showNotification(translate("bookmarkError"));
    }
}

async function createBookmark(title, urlValue) {
    const options = {
        title: title,
        parentId: bookmarkParentSelect.value
    };
    if (!options.parentId) {
        return;
    }
    if (getSelectedItemType() === "bookmark") {
        const url = normalizeWebsiteUrl(urlValue);
        if (!url) {
            showNotification(translate("invalidUrl"));
            return;
        }
        options.url = url;
    }
    const submitButton = addForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
        const position = creationPosition;
        const created = await chrome.bookmarks.create(options);
        addDialog.close();
        addForm.reset();
        await loadBookmarks();
        if (position && bookmarks.some(function(bookmark) {
                return bookmark.id === created.id;
            })) {
            const arc = Number.isInteger(position.arc) ? position.arc : position.y;
            const slot = Number.isInteger(position.slot) ? position.slot : position.x;
            moveDashboardLayoutItemToSlot(created.id, arc, slot);
            renderBookmarks(true);
            await saveDashboardSettings();
        }
    } catch (error) {
        console.error(error);
        showNotification(translate("addError"));
    } finally {
        submitButton.disabled = false;
    }
}

chrome.bookmarks.onMoved.addListener(loadBookmarks);

chrome.bookmarks.onChildrenReordered?.addListener(loadBookmarks);

chrome.bookmarks.onImportEnded?.addListener(loadBookmarks);

function initBookmarkButtons() {
    bookmarkKindButtons.forEach(function(button) {
        button.addEventListener("click", function() {
            showCreationDetails(button.dataset.kind);
        });
    });
    creationBackButton.addEventListener("click", showCreationChoice);
    addDialog.addEventListener("close", () => {
        if (pendingCreationView) {
            const view = pendingCreationView;
            pendingCreationView = null;
            if (view === "choice") {
                openCreationChoice();
            } else {
                addDialog.classList.remove("add-dialog--choice");
                addDialog.style.removeProperty("left");
                addDialog.style.removeProperty("top");
                addDialog.showModal();
                bookmarkTitleInput.focus();
            }
            return;
        }
        creationPosition = null;
        creationAnchor = null;
    });
    document.addEventListener("pointerdown", function(event) {
        if (!addDialog.open || !addDialog.classList.contains("add-dialog--choice")) return;
        const bounds = addDialog.getBoundingClientRect();
        const outside = event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom;
        if (outside && !creationAnchor?.contains(event.target)) {
            addDialog.close();
        }
    });
    window.addEventListener("resize", function() {
        if (addDialog.open && addDialog.classList.contains("add-dialog--choice")) {
            positionCreationChoice();
        }
    });
    addForm.addEventListener("submit", function(event) {
        event.preventDefault();
        const title = bookmarkTitleInput.value.trim();
        const url = bookmarkUrlInput.value.trim();
        if ((getSelectedItemType() === "folder" && !title) || (getSelectedItemType() === "bookmark" && !url)) {
            return;
        }
        createBookmark(title, url);
    });
    editBookmarkButton.addEventListener("click", openEditBookmarkDialog);
    editBookmarkForm.addEventListener("submit", function(event) {
        event.preventDefault();
        updateBookmark();
    });
    editBookmarkDialog.addEventListener("close", () => {
        editingBookmarkId = null;
    });
    chrome.bookmarks.onCreated.addListener(loadBookmarks);
    chrome.bookmarks.onRemoved.addListener(loadBookmarks);
    chrome.bookmarks.onChanged.addListener(loadBookmarks);
}
