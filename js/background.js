// космический фон и движение планет

"use strict";

function getOrbitalViewportLength(value, axis = "height", fallback = 0) {
    const number = parseFloat(value);
    if (!Number.isFinite(number)) return fallback;
    const unit = String(value).trim().toLowerCase();
    if (unit.endsWith("vw")) return window.innerWidth * number / 100;
    if (unit.endsWith("vh")) return window.innerHeight * number / 100;
    if (unit.endsWith("rem")) {
        return parseFloat(getComputedStyle(document.documentElement).fontSize) * number;
    }
    if (unit.endsWith("%")) {
        return (axis === "width" ? window.innerWidth : window.innerHeight) * number / 100;
    }
    return number;
}

// общая геометрия орбит
globalThis.orbitalSystem = Object.freeze({
    readGeometry() {
        const scene = document.querySelector(".space-scene");
        const orbit = document.querySelector(".space-scene__orbit--bookmarks");
        const styles = getComputedStyle(orbit || scene);
        const centerX = getOrbitalViewportLength(styles.getPropertyValue("--orbit-x"),
            "width", window.innerWidth / 2);
        const centerY = getOrbitalViewportLength(styles.getPropertyValue("--orbit-y"),
            "height", window.innerHeight * 1.24);
        const tiltDegrees = parseFloat(styles.getPropertyValue("--orbit-tilt"));
        const perspective = parseFloat(styles.getPropertyValue("--orbit-perspective"));
        return {
            scene,
            centerX,
            centerY,
            tilt: (Number.isFinite(tiltDegrees) ? tiltDegrees : 0) * Math.PI / 180,
            perspective: Number.isFinite(perspective) ? perspective : .92,
            bookmarkBaseRadius: getOrbitalViewportLength(
                styles.getPropertyValue("--bookmark-orbit-radius"), "height", window.innerHeight * .46),
            bookmarkStep: getOrbitalViewportLength(
                styles.getPropertyValue("--bookmark-orbit-step"), "height", window.innerHeight * .09),
            planetMinimumRadius: getOrbitalViewportLength(
                styles.getPropertyValue("--mercury-orbit-min-radius"), "height", window.innerHeight * .72),
            planetOrbitStep: getOrbitalViewportLength(
                styles.getPropertyValue("--planet-orbit-step"), "height", window.innerHeight * .095)
        };
    },

    getPoint(radius, angle, geometry, centerX = geometry.centerX, centerY = geometry.centerY) {
        const radiusY = radius * geometry.perspective;
        const unrotatedX = radius * Math.sin(angle);
        const unrotatedY = -radiusY * Math.cos(angle);
        const cosTilt = Math.cos(geometry.tilt);
        const sinTilt = Math.sin(geometry.tilt);
        const tangentX = radius * Math.cos(angle) * cosTilt - radiusY * Math.sin(angle) * sinTilt;
        const tangentY = radius * Math.cos(angle) * sinTilt + radiusY * Math.sin(angle) * cosTilt;
        return {
            x: centerX + unrotatedX * cosTilt - unrotatedY * sinTilt,
            y: centerY + unrotatedX * sinTilt + unrotatedY * cosTilt,
            unrotatedX,
            unrotatedY,
            radiusY,
            tangent: Math.atan2(tangentY, tangentX)
        };
    },

    setCenterY(centerY, geometry) {
        if (!Number.isFinite(centerY)) return geometry.centerY;
        geometry.centerY = centerY;
        geometry.scene?.style.setProperty("--orbit-y", `${centerY.toFixed(2)}px`);
        return centerY;
    },

    reserveBookmarkBand(_outerRadius, _clearance, geometry) {
        return geometry.planetMinimumRadius;
    }
});

const planetOrbitLayer = document.querySelector(".space-scene__planets");
const PLANET_ORBIT_BASE_LIFT_RATIO = .018;
const getPlanetOrbitBaseLift = () =>
    Math.min(window.innerWidth, window.innerHeight) * PLANET_ORBIT_BASE_LIFT_RATIO;
let planetOrbitShiftY = -getPlanetOrbitBaseLift();
let planetOrbitRefreshTimer = 0;

function getOrbitVerticalExtent(radius, geometry) {
    const radiusY = radius * geometry.perspective;
    return Math.hypot(radius * Math.sin(geometry.tilt),
        radiusY * Math.cos(geometry.tilt));
}

function alignPlanetOrbitsAbove(bookmarkTop, gap = 20, freeSpaceDrop = 0) {
    const geometry = orbitalSystem.readGeometry();
    const firstOrbitTop = geometry.centerY -
        getOrbitVerticalExtent(geometry.planetMinimumRadius, geometry);
    const requestedShift = Number.isFinite(bookmarkTop) ?
        bookmarkTop - gap - firstOrbitTop : 0;
    const layoutShift = Number.isFinite(bookmarkTop) ? Math.min(0, requestedShift) :
        Math.max(0, Number(freeSpaceDrop) || 0);
    const nextShift = Math.round((layoutShift - getPlanetOrbitBaseLift()) * 100) / 100;
    if (Math.abs(nextShift - planetOrbitShiftY) < .25) return planetOrbitShiftY;
    planetOrbitShiftY = nextShift;
    planetOrbitLayer?.style.setProperty("--planet-orbit-shift-y", `${nextShift}px`);
    window.clearTimeout(planetOrbitRefreshTimer);
    planetOrbitRefreshTimer = window.setTimeout(() => {
        planetOrbitRefreshTimer = 0;
        globalThis.planetWrapSystem?.refresh();
    }, 230);
    return nextShift;
}

globalThis.planetOrbitLayout = Object.freeze({
    alignAbove: alignPlanetOrbitsAbove,
    getShift: () => planetOrbitShiftY
});

const planetWrapAnimations = new Map();
const planetWrapStates = new Map();
const planetWrapReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const PLANET_TIME_ORIGIN = Date.UTC(2024, 0, 1);
const PLANET_HIDDEN_DURATION = 30_000;
const PLANET_CLOCK_SYNC_INTERVAL = 30_000;
const PLANET_VISIBLE_ORBIT_RATIOS = Object.freeze([
    .411, .42, .454, .38, .339, .313, .264, .243
]);
let earthMoonTiming = null;
let planetClockSyncTimer = 0;

function getPositiveRemainder(value, divisor) {
    return (value % divisor + divisor) % divisor;
}

function getPlanetCycleTime(now, visibleDuration, phaseOffset) {
    return getPositiveRemainder(now - PLANET_TIME_ORIGIN + phaseOffset,
        visibleDuration + PLANET_HIDDEN_DURATION);
}

function getCssTimeMilliseconds(value) {
    const text = String(value || "").trim();
    const number = parseFloat(text);
    if (!Number.isFinite(number)) return 0;
    return text.endsWith("ms") ? number : number * 1000;
}

function synchronizeEarthMoon(now = Date.now()) {
    const moonSystem = document.querySelector(".space-scene__earth-moon-system");
    if (!moonSystem) return;
    if (!earthMoonTiming) {
        const style = getComputedStyle(moonSystem);
        earthMoonTiming = {
            duration: getCssTimeMilliseconds(style.animationDuration),
            phaseOffset: Math.max(0, -getCssTimeMilliseconds(style.animationDelay))
        };
    }
    if (!earthMoonTiming.duration) return;
    const elapsed = getPositiveRemainder(now - PLANET_TIME_ORIGIN +
        earthMoonTiming.phaseOffset, earthMoonTiming.duration);
    moonSystem.style.animationDelay = `${-elapsed}ms`;
}

function getPlanetVisualExtent(planet, planetHalf) {
    const moonSystem = planet.querySelector(".space-scene__earth-moon-system");
    const moon = moonSystem?.querySelector(".space-scene__earth-moon");
    if (!moonSystem || !moon) return planetHalf;
    const moonStyle = getComputedStyle(moon);
    const moonRadius = parseFloat(moonStyle.left) || 0;
    const moonHalf = parseFloat(moonStyle.width) / 2 || 0;
    return Math.max(planetHalf, moonRadius + moonHalf);
}

function getPlanetOrbitArc(radius, extent, geometry) {
    const radiusY = radius * geometry.perspective;
    const leftDistance = geometry.centerX + extent;
    const rightDistance = innerWidth + extent - geometry.centerX;
    const bottomRatio = (geometry.centerY - innerHeight - extent) / radiusY;
    const bottomLimit = bottomRatio <= -1 ? Math.PI :
        bottomRatio >= 1 ? 0 : Math.acos(bottomRatio);
    const leftLimit = leftDistance < radius ? Math.asin(leftDistance / radius) : Math.PI;
    const rightLimit = rightDistance < radius ? Math.asin(rightDistance / radius) : Math.PI;

    return {
        start: -Math.min(leftLimit, bottomLimit),
        end: Math.min(rightLimit, bottomLimit)
    };
}

function createPlanetOrbitFrames(radius, planetHalf, geometry, arc, direction, visibleRatio) {
    const frames = [];
    const samples = 360;
    const fromAngle = direction === "reverse" ? arc.end : arc.start;
    const toAngle = direction === "reverse" ? arc.start : arc.end;
    for (let index = 0; index <= samples; index++) {
        const progress = index / samples;
        const angle = fromAngle + (toAngle - fromAngle) * progress;
        const point = orbitalSystem.getPoint(radius, angle, geometry);
        frames.push({
            offset: progress * visibleRatio,
            transform: `translate3d(${(point.x - planetHalf).toFixed(2)}px, ${(point.y - planetHalf).toFixed(2)}px, 0)`
        });
    }
    frames.at(-1).easing = "steps(1, end)";
    const firstPoint = orbitalSystem.getPoint(radius, fromAngle, geometry);
    frames.push({
        offset: 1,
        transform: `translate3d(${(firstPoint.x - planetHalf).toFixed(2)}px, ${(firstPoint.y - planetHalf).toFixed(2)}px, 0)`
    });
    return frames;
}

function configurePlanetWrapping() {
    const now = Date.now();
    const geometry = orbitalSystem.readGeometry();
    const visualGeometry = { ...geometry, centerY: geometry.centerY + planetOrbitShiftY };
    const planets = [...document.querySelectorAll(".space-scene__planet")];
    planets.forEach((planet, index) => {
        const previousAnimation = planetWrapAnimations.get(planet);
        previousAnimation?.cancel();

        const style = getComputedStyle(planet);
        const planetHalf = parseFloat(style.width) / 2;
        const extent = getPlanetVisualExtent(planet, planetHalf);
        const radius = geometry.planetMinimumRadius + geometry.planetOrbitStep * index;
        const fullDuration = parseFloat(style.getPropertyValue("--planet-duration")) * 1000;
        const direction = style.getPropertyValue("--planet-direction").trim() === "reverse" ?
            "reverse" : "normal";
        const configuredPhase = parseFloat(style.getPropertyValue("--planet-phase"));
        const phase = Number.isFinite(configuredPhase) ? configuredPhase : 0;
        const arc = getPlanetOrbitArc(radius, extent, visualGeometry);
        // сохраняем фазу при изменении окна
        const visibleDuration = fullDuration * PLANET_VISIBLE_ORBIT_RATIOS[index];
        const cycleDuration = visibleDuration + PLANET_HIDDEN_DURATION;
        const phaseOffset = visibleDuration * (direction === "reverse" ? 1 - phase : phase);
        const visibleRatio = visibleDuration / cycleDuration;
        const frames = createPlanetOrbitFrames(radius, planetHalf, geometry, arc,
            direction, visibleRatio);

        planet.classList.add("is-screen-wrapped");
        const animation = planet.animate(frames, {
            duration: cycleDuration,
            iterations: Infinity,
            easing: "linear",
            fill: "both"
        });
        animation.currentTime = getPlanetCycleTime(now, visibleDuration, phaseOffset);
        if (planetWrapReducedMotion.matches) animation.pause();
        planetWrapAnimations.set(planet, animation);
        planetWrapStates.set(planet, {
            animation, cycleDuration, direction, extent, phaseOffset, visibleDuration
        });
    });
    synchronizeEarthMoon(now);
}

let planetWrapResizeTimer = 0;
window.addEventListener("resize", function() {
    window.clearTimeout(planetWrapResizeTimer);
    planetWrapResizeTimer = window.setTimeout(() => {
        configurePlanetWrapping();
    }, 120);
});
function synchronizePlanetWrapping(now = Date.now()) {
    const planets = [...document.querySelectorAll(".space-scene__planet")];
    const ready = planets.length === 8 && planets.every(planet => {
        const animation = planetWrapStates.get(planet)?.animation;
        return planet.classList.contains("is-screen-wrapped") &&
            animation && animation.playState !== "idle";
    });
    if (!ready) {
        configurePlanetWrapping();
        return;
    }
    planetWrapStates.forEach(state => {
        state.animation.currentTime = getPlanetCycleTime(now,
            state.visibleDuration, state.phaseOffset);
    });
    synchronizeEarthMoon(now);
}

function schedulePlanetClockSync() {
    window.clearTimeout(planetClockSyncTimer);
    planetClockSyncTimer = window.setTimeout(() => {
        if (!document.hidden) synchronizePlanetWrapping();
        schedulePlanetClockSync();
    }, PLANET_CLOCK_SYNC_INTERVAL);
}

window.addEventListener("pageshow", () => {
    synchronizePlanetWrapping();
    schedulePlanetClockSync();
});
window.addEventListener("pagehide", () => window.clearTimeout(planetClockSyncTimer));
window.addEventListener("focus", () => synchronizePlanetWrapping());
document.addEventListener("visibilitychange", function() {
    if (!document.hidden) synchronizePlanetWrapping();
});
planetWrapReducedMotion.addEventListener("change", function(event) {
    if (!event.matches) synchronizePlanetWrapping();
    planetWrapAnimations.forEach(animation => event.matches ? animation.pause() : animation.play());
});

// запускаем движение планет
configurePlanetWrapping();
schedulePlanetClockSync();
globalThis.planetWrapSystem = Object.freeze({
    refresh: configurePlanetWrapping,
    synchronize: synchronizePlanetWrapping,
    getStates: () => [...planetWrapStates.values()].map(state => ({ ...state })),
    getAnimations: () => [...planetWrapAnimations.values()]
});

(() => {
    const starField = document.querySelector(".space-scene__stars");
    if (!starField) return;

    const canvas = document.createElement("canvas");
    const width = Math.min(1600, Math.max(640, Math.round(window.innerWidth)));
    const height = Math.min(1000, Math.max(480, Math.round(window.innerHeight)));
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    canvas.width = width;
    canvas.height = height;
    canvas.className = "space-scene__static-stars";
    canvas.setAttribute("aria-hidden", "true");

    let seed = 0x51a7f00d;
    const random = () => {
        seed = Math.imul(seed ^ seed >>> 15, 1 | seed);
        seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed);
        return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
    };
    const starCount = Math.round(210 + width * height / 11500);

    // создаем поле звезд
    for (let index = 0; index < starCount; index += 1) {
        const clustered = random() < .28;
        const x = clustered
            ? Math.max(0, Math.min(1, .5 + (random() + random() - 1) * .48))
            : random();
        const bandY = .18 + x * .54;
        const y = clustered
            ? Math.max(0, Math.min(1, bandY + (random() + random() - 1) * .2))
            : random();
        const near = random() < .08;
        const warm = random() < .08;
        const radius = near ? .8 + random() * 1.15 : .28 + random() * .58;
        const alpha = near ? .72 + random() * .25 : .25 + random() * .54;

        context.globalAlpha = alpha;
        context.fillStyle = warm ? "#f7e6c8" : near ? "#f6f9ff" : "#c9d9f6";
        context.beginPath();
        context.arc(x * width, y * height, radius, 0, Math.PI * 2);
        context.fill();
    }

    context.globalAlpha = 1;
    starField.append(canvas);
})();
