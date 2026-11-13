/**
 *   GET  /api/briefing              → today's briefing (+ shouldAutoPlay)
 *   POST /api/briefing/autoplayed   → "it was played automatically today" (204)
 *   GET  /api/briefing/settings     → { city, place, autoplay }
 *   PUT  /api/briefing/settings     → body { city?, autoplay? }; the city is checked with the geocoder
 */
import { Router } from "express";
import { z } from "zod";
import { buildBriefing, markAutoPlayed } from "../services/briefing.js";
import { getSetting, setSetting } from "../database/settings.js";
import { findPlace, type Place } from "../integrations/weather.js";

export const briefingRouter = Router();

briefingRouter.get("/", async (_req, res) => {
  res.json(await buildBriefing());
});

briefingRouter.post("/autoplayed", (_req, res) => {
  markAutoPlayed();
  res.status(204).end();
});

function currentSettings() {
  const place = getSetting("weather_place");
  return {
    city: getSetting("weather_city"),
    place: place ? (JSON.parse(place) as Place) : null,
    autoplay: getSetting("briefing_autoplay") === "1",
  };
}

briefingRouter.get("/settings", (_req, res) => {
  res.json(currentSettings());
});

briefingRouter.put("/settings", async (req, res) => {
  const body = z
    .object({ city: z.string().trim().min(2).max(80).optional(), autoplay: z.boolean().optional() })
    .safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "Invalid settings" });

  if (body.data.city !== undefined) {
    // 📘 Validate against the real world before saving: a typo like "Hydrabad" is caught HERE,
    // not tomorrow morning when the briefing silently has no weather.
    const place = await findPlace(body.data.city);
    if (!place) return void res.status(400).json({ error: `I couldn't find a place called "${body.data.city}".` });
    setSetting("weather_city", body.data.city);
    setSetting("weather_place", JSON.stringify(place));
  }
  if (body.data.autoplay !== undefined) setSetting("briefing_autoplay", body.data.autoplay ? "1" : "0");
  res.json(currentSettings());
});
