import { resolveLocation, type Coordinates } from "./geocoding";

export interface RouteEstimate {
  miles: number;
  origin: Coordinates;
  destination: Coordinates;
  source: "ROAD_ROUTE" | "GEOGRAPHIC_ESTIMATE";
}

const toRadians = (degrees: number) => degrees * Math.PI / 180;

function haversineMiles(origin: Coordinates, destination: Coordinates): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(destination.lat - origin.lat);
  const dLon = toRadians(destination.lon - origin.lon);
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeCity(city: string, state: string): Promise<Coordinates | null> {
  const builtIn = resolveLocation(city, state);
  if (builtIn) return builtIn;

  const query = new URLSearchParams({
    city: city.trim(),
    state: state.trim(),
    countrycodes: "us",
    format: "jsonv2",
    limit: "1"
  });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query.toString()}`, {
      headers: {
        "User-Agent": "ArborlineLogistics/1.0",
        "Accept-Language": "en-US,en;q=0.9"
      },
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) return null;
    const results = await response.json() as Array<{ lat?: string; lon?: string }>;
    const lat = Number(results[0]?.lat);
    const lon = Number(results[0]?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

async function roadMiles(origin: Coordinates, destination: Coordinates): Promise<number | null> {
  try {
    const coordinates = `${origin.lon},${origin.lat};${destination.lon},${destination.lat}`;
    const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=false&alternatives=false&steps=false`, {
      signal: AbortSignal.timeout(7_000)
    });
    if (!response.ok) return null;
    const data = await response.json() as { routes?: Array<{ distance?: number }> };
    const meters = Number(data.routes?.[0]?.distance);
    if (!Number.isFinite(meters) || meters <= 0) return null;
    return meters / 1609.344;
  } catch {
    return null;
  }
}

export async function estimateRouteMiles(originCity: string, originState: string, destinationCity: string, destinationState: string): Promise<RouteEstimate | null> {
  const [origin, destination] = await Promise.all([
    geocodeCity(originCity, originState),
    geocodeCity(destinationCity, destinationState)
  ]);

  if (!origin || !destination) return null;

  const routed = await roadMiles(origin, destination);
  if (routed) {
    return {
      miles: Math.max(1, Math.round(routed)),
      origin,
      destination,
      source: "ROAD_ROUTE"
    };
  }

  // Road distance is normally longer than straight-line distance. This fallback
  // keeps quoting usable during a routing-provider outage without pretending it
  // is turn-by-turn mileage.
  const estimated = haversineMiles(origin, destination) * 1.15;
  return {
    miles: Math.max(1, Math.round(estimated)),
    origin,
    destination,
    source: "GEOGRAPHIC_ESTIMATE"
  };
}
