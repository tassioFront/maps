export interface Coordinates {
  lat: number
  lng: number
}

export interface MapViewState {
  center: Coordinates
  zoom: number
  bearing?: number
  pitch?: number
}

export interface MapMarker {
  id: string
  position: Coordinates
  title?: string
  data?: Record<string, unknown>
}

export interface SelectionBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface MapConfig {
  initialCenter?: Coordinates
  initialZoom?: number
  enable3D?: boolean
  mapStyle?: string | object
  enableClustering?: boolean
}
