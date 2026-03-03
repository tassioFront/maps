import type { MapMarker } from '@/types/map'

const LIECHTENSTEIN_CENTER = { lat: 47.139, lng: 9.524 }

/** Generate N markers in a bounding box. Deterministic spread (golden-ratio). */
function generateMarkers(
  count: number,
  center: { lat: number; lng: number },
  radiusLat = 0.02,
  radiusLng = 0.03
): MapMarker[] {
  const out: MapMarker[] = []
  for (let i = 0; i < count; i++) {
    const lat = center.lat + (((i * 0.618033989) % 1) * 2 - 1) * radiusLat
    const lng = center.lng + (((i * 0.381966011) % 1) * 2 - 1) * radiusLng
    out.push({
      id: `marker-${i + 1}`,
      position: { lat, lng },
      title: `Marker ${i + 1}`,
      data: { value: i + 1 },
    })
  }
  return out
}

/** 50 markers spread around Vaduz / Liechtenstein (matches local vector tiles). */
export const mockMarkers50: MapMarker[] = generateMarkers(
  50,
  LIECHTENSTEIN_CENTER,
  0.02,
  0.025
)
