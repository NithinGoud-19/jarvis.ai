/**
 * Weather from Open-Meteo: free, no API key, no sign-up. https://open-meteo.com
 *
 *   1. Geocoding: "Hyderabad" → latitude/longitude   (done once, when you save the city)
 *   2. Forecast:  latitude/longitude → temperature, sky, chance of rain
 *
 * 📘 LESSON: Caching
 * The weather doesn't change every second, so we keep the last answer for 15 minutes
 * (an "in-memory cache"). Faster for you, and polite to a free service.
 */
const TIMEOUT_MS = 10_000;
const CACHE_MS = 15 * 60_000;

export type Place = { name: string; lat: number; lon: number };

export type Weather = {
  place: string;
  temperature: number; // °C now
  feelsLike: number;
  sky: string; // "partly cloudy"
  icon: string; // "⛅"
  high: number;
  low: number;
  rainChance: number; // % today
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Weather service error ${res.status}`);
  return (await res.json()) as T;
}

/** "Hyderabad" → { name: "Hyderabad, Telangana", lat, lon }. Indian places are preferred. */
export async function findPlace(city: string): Promise<Place | null> {
  type R = { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
  const search = (extra: string) =>
    getJson<R>(
      `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: city, count: "1", language: "en", format: "json" })}${extra}`,
    );
  // First look in India ("Hyderabad" also exists in Pakistan!), then worldwide.
  const hit = (await search("&countryCode=IN")).results?.[0] ?? (await search("")).results?.[0];
  if (!hit) return null;
  const name = [hit.name, hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : null, hit.country === "India" ? null : hit.country]
    .filter(Boolean)
    .join(", ");
  return { name, lat: hit.latitude, lon: hit.longitude };
}

// WMO weather codes (what Open-Meteo returns) → words + emoji
function describeSky(code: number): { sky: string; icon: string } {
  if (code === 0) return { sky: "clear skies", icon: "☀️" };
  if (code <= 2) return { sky: "partly cloudy", icon: "⛅" };
  if (code === 3) return { sky: "overcast", icon: "☁️" };
  if (code <= 48) return { sky: "foggy", icon: "🌫️" };
  if (code <= 57) return { sky: "drizzle", icon: "🌦️" };
  if (code <= 67) return { sky: "rain", icon: "🌧️" };
  if (code <= 77) return { sky: "snow", icon: "❄️" };
  if (code <= 82) return { sky: "rain showers", icon: "🌦️" };
  return { sky: "thunderstorms", icon: "⛈️" };
}

let cache: { key: string; at: number; value: Weather } | null = null;

export async function getWeather(place: Place): Promise<Weather> {
  const key = `${place.lat},${place.lon}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;

  type R = {
    current: { temperature_2m: number; apparent_temperature: number; weather_code: number };
    daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[] };
  };
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: "temperature_2m,apparent_temperature,weather_code",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "1",
  });
  const d = await getJson<R>(`https://api.open-meteo.com/v1/forecast?${params}`);
  const value: Weather = {
    place: place.name,
    temperature: Math.round(d.current.temperature_2m),
    feelsLike: Math.round(d.current.apparent_temperature),
    ...describeSky(d.current.weather_code),
    high: Math.round(d.daily.temperature_2m_max[0]),
    low: Math.round(d.daily.temperature_2m_min[0]),
    rainChance: d.daily.precipitation_probability_max[0] ?? 0,
  };
  cache = { key, at: Date.now(), value };
  return value;
}
