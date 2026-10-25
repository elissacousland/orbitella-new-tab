// погода

"use strict";
(() => {

    const weatherLink = document.querySelector(".weather-widget");
    const weatherCity = document.querySelector(".weather-city");
    const weatherIcon = document.querySelector(".weather-now span");
    const weatherTemperature = document.querySelector(".weather-now strong");

    const weatherTexts = {
        ru: {
            near: "Рядом с вами",
            loading: "Загружаем погоду…",
            locating: "Определяем местоположение…",
            denied: "Геолокация запрещена",
            error: "Не удалось получить погоду",
            stale: "Не удалось обновить · ",
            updated: "Обновлено",
            clear: "Ясно",
            cloudy: "Переменная облачность",
            overcast: "Пасмурно",
            fog: "Туман",
            rain: "Дождь",
            snow: "Снег",
            storm: "Гроза",
            unknown: "Текущая погода"
        },
        en: {
            near: "Near you",
            loading: "Loading weather…",
            locating: "Finding your location…",
            denied: "Location access denied",
            error: "Couldn’t load weather",
            stale: "Could not update · ",
            updated: "Updated",
            clear: "Clear",
            cloudy: "Partly cloudy",
            overcast: "Overcast",
            fog: "Fog",
            rain: "Rain",
            snow: "Snow",
            storm: "Thunderstorm",
            unknown: "Current weather"
        }
    };

    function getLanguage() {
        return document.documentElement.lang === "en" ? "en" : "ru";
    }

    function getWeatherText(key) {
        return weatherTexts[getLanguage()][key];
    }

    function isValidWeatherLocation(value) {
        return value &&
            Number.isFinite(value.latitude) &&
            Math.abs(value.latitude) <= 90 &&
            Number.isFinite(value.longitude) &&
            Math.abs(value.longitude) <= 180;
    }

    function isValidWeatherCache(value) {
        return value?.place?.auto === true &&
            isValidWeatherLocation(value.place) &&
            Number.isFinite(value.temperature) &&
            Number.isInteger(value.code) &&
            Number.isFinite(value.fetchedAt) &&
            value.fetchedAt <= Date.now();
    }

    const weatherUpdateInterval = 30 * 60 * 1000;
    const gismeteoUrl = "https://www.gismeteo.ru/";
    let weatherLocation = null,
        currentWeather = null,
        weatherStatus = "locating",
        weatherRequestNumber = 0,
        locationDenied = false;

    function getWeatherCondition(code, day) {
        if (code === 0) {
            return [day ? "☀️" : "🌙", "clear"];
        }
        if (code === 1 || code === 2) {
            return [day ? "🌤️" : "☁️", "cloudy"];
        }
        if (code === 3) {
            return ["☁️", "overcast"];
        }
        if ([45, 48].includes(code)) {
            return ["🌫️", "fog"];
        }
        if ([71, 73, 75, 77, 85, 86].includes(code)) {
            return ["🌨️", "snow"];
        }
        if ([95, 96, 99].includes(code)) {
            return ["⛈️", "storm"];
        }
        if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
            return ["🌧️", "rain"];
        }
        return ["🌡️", "unknown"];
    }

    // показываем погоду
    function renderWeather() {
        const locationName = currentWeather?.place.name || weatherLocation?.name || "";
        let cityText = locationName || getWeatherText("near");
        if (weatherStatus === "locating" || weatherStatus === "loading") {
            cityText = getWeatherText(weatherStatus);
        } else if (weatherStatus === "denied") {
            cityText = getWeatherText("denied");
        } else if (weatherStatus === "error") {
            cityText = currentWeather ? getWeatherText("stale") + cityText : getWeatherText("error");
        }
        weatherLink.href = gismeteoUrl;
        weatherLink.title = getLanguage() === "ru" ? "Открыть прогноз погоды" :
            "Open weather forecast";
        weatherCity.textContent = cityText;
        weatherIcon.textContent = currentWeather ? getWeatherCondition(currentWeather.code, currentWeather.day)[0] : "◌";
        weatherTemperature.textContent = currentWeather ? `${Math.round(currentWeather.temperature)}°` : "—";
        weatherTemperature.title = currentWeather ?
            `${getWeatherText("updated")}: ${new Date(currentWeather.fetchedAt).toLocaleString(getLanguage())} · °C` : "";

        document.dispatchEvent(new CustomEvent("dashboard-weather-change", {
            detail: {
                location: weatherLocation || currentWeather?.place || null,
                weather: currentWeather,
                status: weatherStatus
            }
        }));
    }

    async function loadWeatherJson(url) {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) {
            throw new Error(`Weather service: ${response.status}`);
        }
        return response.json();
    }

    async function saveWeatherCache(values) {
        try {
            await chrome.storage.local.set(values);
        } catch {}
    }

    function getCurrentLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                return reject(new Error("No geolocation"));
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                timeout: 12000,
                maximumAge: 300000,
                enableHighAccuracy: false
            });
        });
    }

    // загружаем погоду
    async function loadWeather(refreshLocation = false) {
        const requestNumber = ++weatherRequestNumber;
        weatherStatus = refreshLocation || !weatherLocation ? "locating" : "loading";
        renderWeather();
        try {
            let requestedLocation = weatherLocation;
            if (refreshLocation || !requestedLocation || requestedLocation.auto) {
                let position;
                try {
                    position = await getCurrentLocation();
                } catch (error) {
                    if (requestNumber !== weatherRequestNumber) {
                        return;
                    }
                    locationDenied = error?.code === 1;
                    weatherStatus = locationDenied ? "denied" : "error";
                    renderWeather();
                    return;
                }
                if (requestNumber !== weatherRequestNumber) {
                    return;
                }
                locationDenied = false;
                requestedLocation = {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    auto: true,
                    name: ""
                };
            }
            const weatherParams = new URLSearchParams({
                latitude: requestedLocation.latitude,
                longitude: requestedLocation.longitude,
                current: "temperature_2m,weather_code,is_day,precipitation,rain,showers",
                timezone: "auto",
                forecast_days: "1"
            });
            const cityPromise = requestedLocation.auto ? loadWeatherJson(
                "https://api.bigdatacloud.net/data/reverse-geocode-client?" +
                new URLSearchParams({
                    latitude: requestedLocation.latitude,
                    longitude: requestedLocation.longitude,
                    localityLanguage: getLanguage()
                })).catch(() => null) : Promise.resolve(null);
            const [forecast, city] = await Promise.all([loadWeatherJson(
                "https://api.open-meteo.com/v1/forecast?" + weatherParams), cityPromise]);
            if (requestNumber !== weatherRequestNumber) {
                return;
            }
            if (!Number.isFinite(forecast.current?.temperature_2m) || !Number.isInteger(forecast
                    .current?.weather_code)) {
                throw new Error("Invalid weather");
            }
            if (city) {
                requestedLocation.name = city.city || city.locality || city.principalSubdivision || "";
            }
            weatherLocation = requestedLocation;
            currentWeather = {
                temperature: forecast.current.temperature_2m,
                code: forecast.current.weather_code,
                day: forecast.current.is_day === 1,
                precipitation: Number.isFinite(forecast.current.precipitation) ?
                    forecast.current.precipitation : 0,
                place: requestedLocation,
                fetchedAt: Date.now()
            };
            weatherStatus = "ready";
            renderWeather();
            await saveWeatherCache({
                weatherPlace: weatherLocation,
                weatherCache: currentWeather
            });
        } catch {
            if (requestNumber === weatherRequestNumber) {
                weatherStatus = "error";
                renderWeather();
            }
        }
    }
    new MutationObserver(renderWeather).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["lang"]
    });

    // запускаем погоду
    async function initWeather() {
        try {
            const saved = await chrome.storage.local.get(["weatherPlace", "weatherCache"]);
            if (saved.weatherPlace?.auto === true && isValidWeatherLocation(saved.weatherPlace)) {
                weatherLocation = saved.weatherPlace;
            }
            const savedWeather = saved.weatherCache;
            if (isValidWeatherCache(savedWeather)) {
                currentWeather = savedWeather;
            }
            if (currentWeather && Date.now() - currentWeather.fetchedAt < weatherUpdateInterval) {
                weatherStatus = "ready";
                renderWeather();
            } else {
                await loadWeather();
            }
        } catch {
            await loadWeather();
        }
        setInterval(() => {
            if (!document.hidden && !locationDenied) {
                loadWeather();
            }
        }, weatherUpdateInterval);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && !locationDenied && (!currentWeather || Date.now() - currentWeather.fetchedAt >=
                    weatherUpdateInterval)) {
                loadWeather();
            }
        });
    }
    renderWeather();
    initWeather();
})();
