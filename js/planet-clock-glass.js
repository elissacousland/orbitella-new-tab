// блюр планет за часами

"use strict";

(() => {
    const clockWeather = document.querySelector(".clock-weather");
    const glassAreas = [...(clockWeather?.querySelectorAll(".clock-glass-line") || [])];
    const planets = [...document.querySelectorAll(".space-scene__planet")];
    if (!clockWeather || !glassAreas.length || !planets.length) return;

    const horizontalMargin = 10;
    const verticalMargin = 4;
    const checkInterval = 64;
    let animationFrame = 0;
    let previousCheck = 0;

    function rectanglesOverlap(first, second) {
        return first.left < second.right && first.right > second.left &&
            first.top < second.bottom && first.bottom > second.top;
    }

    // проверяем пересечение
    function checkPlanetIntersection() {
        const planetBounds = planets.map(planet => planet.getBoundingClientRect());
        let activeAreas = 0;
        glassAreas.forEach(area => {
            const bounds = area.getBoundingClientRect();
            const activeZone = {
                left: bounds.left - horizontalMargin,
                right: bounds.right + horizontalMargin,
                top: bounds.top - verticalMargin,
                bottom: bounds.bottom + verticalMargin
            };
            const planetBehind = planetBounds.some(bounds =>
                rectanglesOverlap(bounds, activeZone));
            area.classList.toggle("is-planet-behind", planetBehind);
            if (planetBehind) activeAreas += 1;
        });
        return activeAreas;
    }

    function monitorPlanets(timestamp) {
        if (timestamp - previousCheck >= checkInterval) {
            previousCheck = timestamp;
            checkPlanetIntersection();
        }
        animationFrame = requestAnimationFrame(monitorPlanets);
    }

    function startMonitoring() {
        if (animationFrame || document.hidden) return;
        previousCheck = 0;
        checkPlanetIntersection();
        animationFrame = requestAnimationFrame(monitorPlanets);
    }

    function stopMonitoring() {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = 0;
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) stopMonitoring();
        else startMonitoring();
    });
    window.addEventListener("pagehide", stopMonitoring);
    window.addEventListener("pageshow", startMonitoring);

    globalThis.planetClockGlass = Object.freeze({ refresh: checkPlanetIntersection });

    startMonitoring();
})();
