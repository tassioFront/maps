import type { Coordinates, MapMarker, MapViewState, SelectionBounds } from '@/types/map'
import maplibregl from 'maplibre-gl'
import Supercluster from 'supercluster'
import type { Ref } from 'vue'
import { readonly, ref, unref, watch } from 'vue'

export interface BuildingTag {
  id: string
  position: Coordinates
  color?: string
  size?: number
  label?: string
}

const VECTOR_SOURCE_ID = 'openmaptiles'

function getVectorSourceId(map: maplibregl.Map): string | null {
  if (map.getSource(VECTOR_SOURCE_ID)) return VECTOR_SOURCE_ID
  const style = map.getStyle()
  if (!style?.sources) return null
  for (const [id, source] of Object.entries(style.sources)) {
    if (source.type === 'vector' && ('url' in source || 'tiles' in source)) return id
  }
  return null
}

export function useMapLibreNavigation(mapInstance: Ref<maplibregl.Map | null>) {
  const viewState = ref<MapViewState>({
    center: { lat: 0, lng: 0 },
    zoom: 10,
  })
  const is3DEnabled = ref(false)

  watch(
    mapInstance,
    (map) => {
      if (!map) return
      const updateViewState = () => {
        const center = map.getCenter()
        viewState.value = {
          center: { lat: center.lat, lng: center.lng },
          zoom: map.getZoom(),
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        }
      }
      map.on('move', updateViewState)
      map.on('zoom', updateViewState)
      map.on('rotate', updateViewState)
      map.on('pitch', updateViewState)
      updateViewState()
    },
    { immediate: true }
  )

  function zoomIn() {
    mapInstance.value?.zoomIn()
  }
  function zoomOut() {
    mapInstance.value?.zoomOut()
  }
  function panTo(coords: Coordinates) {
    mapInstance.value?.panTo([coords.lng, coords.lat])
  }
  function fitBounds(bounds: SelectionBounds) {
    mapInstance.value?.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      { padding: 50 }
    )
  }
  function setZoom(zoom: number) {
    mapInstance.value?.zoomTo(zoom)
  }
  function add3DBuildings() {
    const map = mapInstance.value
    if (!map || map.getLayer('3d-buildings')) return
    const sourceId = getVectorSourceId(map)
    if (!sourceId) return
    const layers = map.getStyle()?.layers ?? []
    let labelLayerId: string | undefined
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i]
      if (layer?.type === 'symbol' && layer?.id) {
        labelLayerId = layer.id
        break
      }
    }
    map.addLayer(
      {
        id: '3d-buildings',
        source: sourceId,
        'source-layer': 'building',
        filter: ['==', 'extrude', 'true'],
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#aaa',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.05, ['get', 'height']],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.05, ['get', 'min_height']],
          'fill-extrusion-opacity': 0.6,
        },
      },
      labelLayerId
    )
  }
  function remove3DBuildings() {
    const map = mapInstance.value
    if (map?.getLayer('3d-buildings')) map.removeLayer('3d-buildings')
  }
  function toggle3D() {
    const map = mapInstance.value
    if (!map) return
    is3DEnabled.value = !is3DEnabled.value
    if (is3DEnabled.value) {
      add3DBuildings()
      const currentZoom = map.getZoom()
      const targetZoom = Math.max(currentZoom, 14)
      map.easeTo({ pitch: 60, bearing: 0, zoom: targetZoom, duration: 1000 })
    } else {
      remove3DBuildings()
      map.easeTo({ pitch: 0, bearing: 0, duration: 1000 })
    }
  }
  return {
    viewState,
    is3DEnabled,
    zoomIn,
    zoomOut,
    panTo,
    fitBounds,
    setZoom,
    toggle3D,
  }
}

function pointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ri = ring[i]
    const rj = ring[j]
    if (!ri || !rj || ri.length < 2 || rj.length < 2) continue
    const xi = ri[0] ?? 0, yi = ri[1] ?? 0
    const xj = rj[0] ?? 0, yj = rj[1] ?? 0
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const LASSO_SOURCE_ID = 'lasso-source'
const LASSO_FILL_LAYER_ID = 'lasso-fill'
const LASSO_LINE_LAYER_ID = 'lasso-line'

export function useMapLibreLasso(mapInstance: Ref<maplibregl.Map | null>) {
  const isLassoActive = ref(false)
  const selectedBounds = ref<SelectionBounds | null>(null)
  const selectedMarkers = ref<string[]>([])
  const polygonRing = ref<number[][] | null>(null)
  let lassoPoints: number[][] = []
  let overlayEl: HTMLDivElement | null = null
  let onOverlayClick: (e: MouseEvent) => void = () => {}
  let onOverlayDblClick: (e: MouseEvent) => void = () => {}
  let onMapMove: () => void = () => {}
  const hiddenExtrusionLayerIds: string[] = []

  function enableLasso() {
    const map = mapInstance.value
    if (!map) return
    const m = map as maplibregl.Map
    isLassoActive.value = true
    lassoPoints = []

    function finishPolygon(ring: number[][]) {
      if (ring.length < 3) return
      const first = ring[0]
      if (!first || first.length < 2) return
      const closed = [...ring, first]
      polygonRing.value = closed
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
      closed.forEach((pt) => {
        if (!pt || pt.length < 2) return
        const lng = pt[0] ?? 0, lat = pt[1] ?? 0
        minLat = Math.min(minLat, lat)
        maxLat = Math.max(maxLat, lat)
        minLng = Math.min(minLng, lng)
        maxLng = Math.max(maxLng, lng)
      })
      selectedBounds.value = { north: maxLat, south: minLat, east: maxLng, west: minLng }
    }

    function addDraw() {
      m.boxZoom.disable()
      m.dragPan.disable()
      m.dragRotate.disable()
      m.doubleClickZoom.disable()
      const style = m.getStyle?.()
      if (style?.layers) {
        hiddenExtrusionLayerIds.length = 0
        for (const layer of style.layers) {
          if ((layer as { type?: string }).type === 'fill-extrusion') {
            try {
              m.setLayoutProperty(layer.id, 'visibility', 'none')
              hiddenExtrusionLayerIds.push(layer.id)
            } catch {
              // ignore
            }
          }
        }
      }
      const container = m.getContainer()
      container.style.position = 'relative'
      const overlay = document.createElement('div')
      overlay.className = 'lasso-overlay'
      overlay.setAttribute('style', 'position:absolute;inset:0;pointer-events:auto;cursor:crosshair;z-index:1;')
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', '100%')
      svg.setAttribute('style', 'display:block;pointer-events:none;')
      overlay.appendChild(svg)
      container.appendChild(overlay)
      overlayEl = overlay

      function projectRing(ring: number[][]): string {
        return ring
          .filter((pt): pt is number[] => Array.isArray(pt) && pt.length >= 2)
          .map(([lng, lat]) => {
            const p = m.project([lng ?? 0, lat ?? 0])
            return `${p.x},${p.y}`
          })
          .join(' ')
      }

      function redraw() {
        const pointsToDraw = polygonRing.value ?? lassoPoints
        const closed = !!polygonRing.value || (lassoPoints.length >= 3 && pointsToDraw.length >= 3)
        const rawRing = closed && !polygonRing.value && lassoPoints.length >= 3 ? [...lassoPoints, lassoPoints[0]] : pointsToDraw
        const ring = rawRing.filter((p): p is number[] => Array.isArray(p) && p.length >= 2)
        svg.innerHTML = ''
        if (ring.length < 2) return
        const pointsStr = projectRing(ring)
        if (closed && ring.length >= 4) {
          const fill = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
          fill.setAttribute('points', pointsStr)
          fill.setAttribute('fill', '#3b82f6')
          fill.setAttribute('fill-opacity', '0.35')
          fill.setAttribute('stroke', 'none')
          svg.appendChild(fill)
        }
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline')
        line.setAttribute('points', pointsStr)
        line.setAttribute('fill', 'none')
        line.setAttribute('stroke', '#2563eb')
        line.setAttribute('stroke-width', '4')
        line.setAttribute('stroke-linecap', 'round')
        line.setAttribute('stroke-linejoin', 'round')
        svg.appendChild(line)
      }

      onMapMove = redraw
      onOverlayClick = (e: MouseEvent) => {
        const rect = container.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        const lngLat = m.unproject([x, y])
        lassoPoints.push([lngLat.lng, lngLat.lat] as [number, number])
        redraw()
      }
      onOverlayDblClick = (e: MouseEvent) => {
        e.preventDefault()
        if (lassoPoints.length >= 3) {
          finishPolygon(lassoPoints as number[][])
          lassoPoints = []
          redraw()
        }
      }
      overlay.addEventListener('click', onOverlayClick)
      overlay.addEventListener('dblclick', onOverlayDblClick, { capture: true })
      m.on('move', onMapMove)
      m.on('zoom', onMapMove)
      m.on('resize', onMapMove)
      redraw()
    }

    if (m.isStyleLoaded?.()) addDraw()
    else m.once('load', addDraw)
  }

  function disableLasso() {
    const map = mapInstance.value
    if (!map) return
    isLassoActive.value = false
    map.boxZoom.enable()
    map.dragPan.enable()
    map.dragRotate.enable()
    map.doubleClickZoom.enable()
    if (overlayEl) {
      overlayEl.removeEventListener('click', onOverlayClick)
      overlayEl.removeEventListener('dblclick', onOverlayDblClick, { capture: true })
      map.off('move', onMapMove)
      map.off('zoom', onMapMove)
      map.off('resize', onMapMove)
      overlayEl.remove()
      overlayEl = null
    }
    for (const layerId of hiddenExtrusionLayerIds) {
      try {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', 'visible')
      } catch {
        // ignore
      }
    }
    hiddenExtrusionLayerIds.length = 0
    if (map.getLayer(LASSO_LINE_LAYER_ID)) map.removeLayer(LASSO_LINE_LAYER_ID)
    if (map.getLayer(LASSO_FILL_LAYER_ID)) map.removeLayer(LASSO_FILL_LAYER_ID)
    if (map.getSource(LASSO_SOURCE_ID)) map.removeSource(LASSO_SOURCE_ID)
    selectedBounds.value = null
    polygonRing.value = null
    selectedMarkers.value = []
    lassoPoints = []
  }

  function clearSelection() {
    const map = mapInstance.value
    if (map?.getSource(LASSO_SOURCE_ID)) {
      (map.getSource(LASSO_SOURCE_ID) as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] })
    }
    selectedBounds.value = null
    polygonRing.value = null
    selectedMarkers.value = []
    lassoPoints = []
    if (overlayEl) {
      const svg = overlayEl.querySelector('svg')
      if (svg) svg.innerHTML = ''
    }
  }

  function getMarkersInBounds(markers: MapMarker[]): string[] {
    const ring = polygonRing.value
    const bounds = selectedBounds.value
    if (!ring && !bounds) return []
    return markers
      .filter((m) => {
        const { lng, lat } = m.position
        if (ring && ring.length >= 3) return pointInPolygon(lng, lat, ring.filter((p): p is number[] => Array.isArray(p) && p.length >= 2))
        if (bounds) return lat >= bounds.south && lat <= bounds.north && lng >= bounds.west && lng <= bounds.east
        return false
      })
      .map((m) => m.id)
  }

  return {
    isLassoActive,
    selectedBounds,
    selectedMarkers,
    enableLasso,
    disableLasso,
    clearSelection,
    getMarkersInBounds,
  }
}

const DEFAULT_MARKER_COLOR = '#4285F4'
const HIGHLIGHTED_MARKER_COLOR = '#ea4335'
const MARKER_SIZE_PX = 32
const MARKERS_OVERLAY_CLASS = 'markers-overlay'

export type MarkerDisplayItem =
  | { type: 'marker'; id: string; position: Coordinates; marker: MapMarker }
  | { type: 'cluster'; id: string; position: Coordinates; count: number; clusterId: number }

export interface UseMapLibreMarkersOptions {
  onMarkerClick?: (marker: MapMarker) => void
  onSyncOverlayComplete?: () => void
  viewportPadding?: number
  maxVisibleAtLowZoom?: number
  lowZoomThreshold?: number
  enableClustering?: boolean | Ref<boolean>
  clusterRadius?: number
  clusterMaxZoom?: number
}

const CLUSTER_PREFIX = 'cluster-'
const CLUSTER_SIZE_PX = 40
const CLUSTER_COLOR = '#5a7fd4'
const HIGHLIGHTED_CLUSTER_COLOR = '#ea4335'

export function useMapLibreMarkers(mapInstance: Ref<maplibregl.Map | null>, options: UseMapLibreMarkersOptions = {}) {
  const {
    onMarkerClick,
    onSyncOverlayComplete,
    viewportPadding = 80,
    maxVisibleAtLowZoom = 500,
    lowZoomThreshold = 10,
    enableClustering = false,
    clusterRadius = 30,
    clusterMaxZoom = 16,
  } = options
  const markersData = ref<MapMarker[]>([])
  const visibleMarkerCount = ref(0)
  const highlightedIds = ref<Set<string>>(new Set())
  const popup = ref<maplibregl.Popup | null>(null)
  let overlayEl: HTMLDivElement | null = null
  const markerEls = new Map<string, HTMLDivElement>()
  let updatePositions: (() => void) | null = null
  let mapRef: maplibregl.Map | null = null
  let superclusterInstance: InstanceType<typeof Supercluster> | null = null
  let markerById = new Map<string, MapMarker>()

  function buildSupercluster(markers: MapMarker[]): void {
    markerById = new Map(markers.map((m) => [m.id, m]))
    const points = markers.map((m) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [m.position.lng, m.position.lat] },
      properties: { id: m.id },
    }))
    superclusterInstance = new Supercluster({ radius: clusterRadius, maxZoom: clusterMaxZoom })
    superclusterInstance.load(points)
  }

  function getVisibleMarkers(map: maplibregl.Map, all: MapMarker[]): MapMarker[] {
    const bounds = map.getBounds()
    if (!bounds) return all
    const padding = viewportPadding
    const sw = map.project(bounds.getSouthWest())
    const ne = map.project(bounds.getNorthEast())
    const minX = Math.min(sw.x, ne.x) - padding
    const maxX = Math.max(sw.x, ne.x) + padding
    const minY = Math.min(sw.y, ne.y) - padding
    const maxY = Math.max(sw.y, ne.y) + padding
    const visible: MapMarker[] = []
    for (const m of all) {
      const point = map.project([m.position.lng, m.position.lat])
      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) visible.push(m)
    }
    const zoom = map.getZoom()
    const cap = zoom < lowZoomThreshold ? maxVisibleAtLowZoom : Infinity
    if (visible.length > cap) {
      const center = map.getCenter()
      visible.sort((a, b) => {
        const da = (a.position.lat - center.lat) ** 2 + (a.position.lng - center.lng) ** 2
        const db = (b.position.lat - center.lat) ** 2 + (b.position.lng - center.lng) ** 2
        return da - db
      })
      visible.length = cap
    }
    return visible
  }

  function getDisplayItems(map: maplibregl.Map, all: MapMarker[]): MarkerDisplayItem[] {
    if (!unref(enableClustering) || !superclusterInstance) {
      const visible = getVisibleMarkers(map, all)
      return visible.map((m) => ({ type: 'marker' as const, id: m.id, position: m.position, marker: m }))
    }
    const bounds = map.getBounds()
    if (!bounds) return []
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ]
    const zoom = Math.floor(map.getZoom())
    const features = superclusterInstance.getClusters(bbox, zoom)
    const items: MarkerDisplayItem[] = []
    for (const f of features) {
      const coords = f.geometry?.type === 'Point' ? f.geometry.coordinates : null
      if (!coords || coords.length < 2) continue
      const lng = coords[0] ?? 0
      const lat = coords[1] ?? 0
      const position: Coordinates = { lat, lng }
      const props = f.properties as { cluster?: boolean; cluster_id?: number; point_count?: number; id?: string }
      if (props.cluster && props.cluster_id != null && (props.point_count ?? 0) > 0) {
        items.push({
          type: 'cluster',
          id: `${CLUSTER_PREFIX}${props.cluster_id}`,
          position,
          count: props.point_count ?? 0,
          clusterId: props.cluster_id ?? 0,
        })
      } else if (props.id) {
        const marker = markerById.get(props.id)
        if (marker) items.push({ type: 'marker', id: marker.id, position: marker.position, marker })
      }
    }
    return items
  }

  function createPopupContent(markerData: MapMarker): string {
    const title = markerData.title || `Marker ${markerData.id}`
    let content = `<div style="padding: 8px;"><strong>${title}</strong>`
    if (markerData.data) {
      content += "<ul style='margin: 8px 0; padding-left: 20px;'>"
      for (const [key, value] of Object.entries(markerData.data)) {
        content += `<li><strong>${key}:</strong> ${String(value)}</li>`
      }
      content += '</ul>'
    }
    content += '</div>'
    return content
  }

  function ensureOverlay(map: maplibregl.Map): HTMLDivElement {
    const container = map.getContainer()
    let el = container.querySelector<HTMLDivElement>(`.${MARKERS_OVERLAY_CLASS}`)
    if (el) return el
    el = document.createElement('div')
    el.className = MARKERS_OVERLAY_CLASS
    el.setAttribute('style', 'position:absolute;inset:0;pointer-events:none;z-index:2;')
    container.style.position = 'relative'
    container.appendChild(el)
    overlayEl = el
    return el
  }

  function refreshVisibleMarkers(): void {
    const map = mapRef
    if (!map || !overlayEl) return
    const all = markersData.value
    if (unref(enableClustering) && superclusterInstance === null && all.length > 0) buildSupercluster(all)
    if (!unref(enableClustering)) superclusterInstance = null
    const items = getDisplayItems(map, all)
    visibleMarkerCount.value = items.length
    const highlightedList = Array.from(highlightedIds.value)
    syncOverlay(map, items, highlightedList)
    onSyncOverlayComplete?.()
  }

  function syncOverlay(map: maplibregl.Map, items: MarkerDisplayItem[], highlighted: string[]): void {
    const set = new Set(highlighted)
    highlightedIds.value = set
    ensureOverlay(map)
    if (!overlayEl) return
    const itemIds = new Set(items.map((i) => i.id))
    markerEls.forEach((el, id) => {
      if (!itemIds.has(id)) {
        el.remove()
        markerEls.delete(id)
      }
    })
    items.forEach((item) => {
      const point = map.project([item.position.lng, item.position.lat])
      if (item.type === 'cluster') {
        const clusterHasHighlightedMarker =
          superclusterInstance &&
          superclusterInstance
            .getLeaves(item.clusterId, Infinity)
            .some((leaf) => (leaf.properties as { id?: string })?.id && set.has((leaf.properties as { id: string }).id))
        const clusterColor = clusterHasHighlightedMarker ? HIGHLIGHTED_CLUSTER_COLOR : CLUSTER_COLOR
        let div = markerEls.get(item.id)
        if (!div) {
          div = document.createElement('div')
          div.setAttribute(
            'style',
            `position:absolute;width:${CLUSTER_SIZE_PX}px;height:${CLUSTER_SIZE_PX}px;border-radius:50%;background-color:${clusterColor};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);pointer-events:auto;cursor:pointer;margin-left:-${CLUSTER_SIZE_PX / 2}px;margin-top:-${CLUSTER_SIZE_PX / 2}px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;`
          )
          div.setAttribute('data-marker-id', item.id)
          div.classList.add('marker', 'cluster')
          div.textContent = String(item.count)
          div.addEventListener('click', (e) => {
            e.stopPropagation()
            if (!superclusterInstance) return
            const expansionZoom = superclusterInstance.getClusterExpansionZoom(item.clusterId)
            map.flyTo({ center: [item.position.lng, item.position.lat], zoom: expansionZoom })
          })
          overlayEl!.appendChild(div)
          markerEls.set(item.id, div)
        } else {
          div.textContent = String(item.count)
          div.style.backgroundColor = clusterColor
        }
        div.style.left = `${point.x}px`
        div.style.top = `${point.y}px`
      } else {
        const m = item.marker
        let div = markerEls.get(item.id)
        const isHighlighted = set.has(m.id)
        const color = isHighlighted ? HIGHLIGHTED_MARKER_COLOR : DEFAULT_MARKER_COLOR
        if (!div) {
          div = document.createElement('div')
          div.setAttribute(
            'style',
            `position:absolute;width:${MARKER_SIZE_PX}px;height:${MARKER_SIZE_PX}px;border-radius:50%;background-color:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);pointer-events:auto;cursor:pointer;margin-left:-${MARKER_SIZE_PX / 2}px;margin-top:-${MARKER_SIZE_PX / 2}px;`
          )
          div.setAttribute('data-marker-id', m.id)
          div.classList.add('marker')
          div.addEventListener('click', (e) => {
            e.stopPropagation()
            if (popup.value) {
              popup.value.setHTML(createPopupContent(m)).setLngLat([m.position.lng, m.position.lat]).addTo(map)
            }
            onMarkerClick?.(m)
          })
          overlayEl!.appendChild(div)
          markerEls.set(m.id, div)
        } else {
          div.style.backgroundColor = color
        }
        div.style.left = `${point.x}px`
        div.style.top = `${point.y}px`
      }
    })
  }

  function setMarkersData(markers: MapMarker[], highlightedIdsList: string[], map?: maplibregl.Map | null): void {
    const m = map ?? mapInstance.value
    if (!m) return
    mapRef = m
    markersData.value = markers
    highlightedIds.value = new Set(highlightedIdsList)
    if (unref(enableClustering) && markers.length > 0) buildSupercluster(markers)
    else superclusterInstance = null
    if (!overlayEl) {
      ensureOverlay(m)
      updatePositions = () => refreshVisibleMarkers()
      m.on('move', updatePositions)
      m.on('zoom', updatePositions)
      m.on('resize', updatePositions)
    }
    refreshVisibleMarkers()
    if (!popup.value) popup.value = new maplibregl.Popup({ offset: 25, closeButton: true })
  }

  function setHighlightedMarkerIds(ids: string[]): void {
    const map = mapRef ?? mapInstance.value
    if (!map || !markersData.value.length) return
    setMarkersData(markersData.value, ids, map)
  }

  function clearAllMarkers(): void {
    markersData.value = []
    visibleMarkerCount.value = 0
    superclusterInstance = null
    markerById = new Map()
    highlightedIds.value = new Set()
    markerEls.forEach((el) => el.remove())
    markerEls.clear()
    if (mapRef && updatePositions) {
      mapRef.off('move', updatePositions)
      mapRef.off('zoom', updatePositions)
      mapRef.off('resize', updatePositions)
    }
    mapRef = null
    updatePositions = null
    overlayEl?.remove()
    overlayEl = null
    popup.value?.remove()
  }

  return {
    visibleMarkerCount: readonly(visibleMarkerCount),
    setHighlightedMarkerIds,
    setMarkersData,
    clearAllMarkers,
  }
}

export function useMapLibreBuildingTags(mapInstance: Ref<maplibregl.Map | null>) {
  const tags = ref<Map<string, unknown>>(new Map())

  function addBuildingTag(tag: BuildingTag) {
    const map = mapInstance.value
    if (!map) return
    removeBuildingTag(tag.id)
    const el = document.createElement('div')
    el.className = 'building-tag'
    el.style.width = `${tag.size ?? 20}px`
    el.style.height = `${tag.size ?? 20}px`
    el.style.borderRadius = '50%'
    el.style.backgroundColor = tag.color ?? '#FF6B6B'
    el.style.border = '3px solid white'
    el.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'
    el.style.cursor = 'pointer'
    el.style.display = 'flex'
    el.style.alignItems = 'center'
    el.style.justifyContent = 'center'
    el.style.fontSize = '10px'
    el.style.fontWeight = 'bold'
    el.style.color = 'white'
    el.style.textShadow = '0 1px 2px rgba(0,0,0,0.5)'
    if (tag.label) el.textContent = tag.label
    const lng = tag.position.lng
    const lat = tag.position.lat
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
    marker.setLngLat([lng, lat])
    marker.addTo(map)
    tags.value.set(tag.id, marker)
  }

  function removeBuildingTag(id: string) {
    const tag = tags.value.get(id) as maplibregl.Marker | undefined
    if (tag) {
      tag.remove()
      tags.value.delete(id)
    }
  }

  function clearAllBuildingTags() {
    tags.value.forEach((t) => (t as maplibregl.Marker).remove())
    tags.value.clear()
  }

  return {
    tags: readonly(tags),
    addBuildingTag,
    removeBuildingTag,
    clearAllBuildingTags,
  }
}
