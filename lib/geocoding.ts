export interface Coordinates {
  lat: number;
  lon: number;
}

const freightHubCentroids: Record<string, Coordinates> = {
  "chicago,il": { lat: 41.8781, lon: -87.6298 },
  "dallas,tx": { lat: 32.7767, lon: -96.797 },
  "houston,tx": { lat: 29.7604, lon: -95.3698 },
  "atlanta,ga": { lat: 33.749, lon: -84.388 },
  "memphis,tn": { lat: 35.1495, lon: -90.049 },
  "nashville,tn": { lat: 36.1627, lon: -86.7816 },
  "indianapolis,in": { lat: 39.7684, lon: -86.1581 },
  "columbus,oh": { lat: 39.9612, lon: -82.9988 },
  "kansas city,mo": { lat: 39.0997, lon: -94.5786 },
  "phoenix,az": { lat: 33.4484, lon: -112.074 },
  "los angeles,ca": { lat: 34.0522, lon: -118.2437 },
  "ontario,ca": { lat: 34.0633, lon: -117.6509 },
  "louisville,ky": { lat: 38.2527, lon: -85.7585 },
  "st. louis,mo": { lat: 38.627, lon: -90.1994 },
  "charlotte,nc": { lat: 35.2271, lon: -80.8431 }
};

export function resolveLocation(city: string, state: string, supplied?: Partial<Coordinates>): Coordinates | null {
  if (typeof supplied?.lat === "number" && typeof supplied?.lon === "number") {
    if (supplied.lat >= -90 && supplied.lat <= 90 && supplied.lon >= -180 && supplied.lon <= 180) {
      return { lat: supplied.lat, lon: supplied.lon };
    }
  }

  return freightHubCentroids[`${city.trim().toLowerCase()},${state.trim().toLowerCase()}`] ?? null;
}

export function supportedDemoLocations(): string[] {
  return Object.keys(freightHubCentroids).map((key) => key.split(",").map((part, index) => index === 1 ? part.toUpperCase() : part.replace(/\b\w/g, (letter) => letter.toUpperCase())).join(", "));
}
