<script setup lang="ts">
import type { Ref } from 'vue'
import { computed, ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import maplibregl from 'maplibre-gl'
import { useMapLibreNavigation, useMapLibreLasso, useMapLibreMarkers, useMapLibreBuildingTags } from '@/composables/useMapLibre'
import type { MapConfig, MapMarker } from '@/types/map'

const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
    },
  },
  layers: [
    {
      id: 'osm-layer',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
} as const

interface Props {
  config: MapConfig
  markers?: MapMarker[]
}

const props = withDefaults(defineProps<Props>(), {
  markers: () => [],
})

const emit = defineEmits<{
  mapReady: [map: maplibregl.Map]
  markerClick: [marker: MapMarker]
  selectionChange: [payload: { ids: string[]; markers: MapMarker[] }]
  renderComplete: []
  renderedCountChange: [count: number]
}>()

const mapContainer = ref<HTMLDivElement>()
const mapInstance = ref<maplibregl.Map | null>(null) as Ref<maplibregl.Map | null>
const isLoading = ref(true)
const error = ref<string | null>(null)

const navigation = useMapLibreNavigation(mapInstance as Ref<maplibregl.Map | null>)
const lasso = useMapLibreLasso(mapInstance as Ref<maplibregl.Map | null>)
const enableClusteringRef = computed(() => props.config.enableClustering ?? false)
const markerManager = useMapLibreMarkers(mapInstance as Ref<maplibregl.Map | null>, {
  onMarkerClick: (marker) => emit('markerClick', marker),
  onSyncOverlayComplete: () => emit('renderComplete'),
  enableClustering: enableClusteringRef,
})
const buildingTags = useMapLibreBuildingTags(mapInstance as Ref<maplibregl.Map | null>)

onMounted(async () => {
  await nextTick()
  if (!mapContainer.value) {
    error.value = 'Map container not found'
    isLoading.value = false
    return
  }
  try {
    const style =
      typeof props.config.mapStyle === 'object' && props.config.mapStyle != null
        ? props.config.mapStyle
        : typeof props.config.mapStyle === 'string' && props.config.mapStyle.length > 0
          ? props.config.mapStyle
          : { ...OSM_RASTER_STYLE, sources: { ...OSM_RASTER_STYLE.sources }, layers: [...OSM_RASTER_STYLE.layers] }
    const map = new maplibregl.Map({
      container: mapContainer.value,
      style: style as maplibregl.StyleSpecification | string,
      center: props.config.initialCenter
        ? [props.config.initialCenter.lng, props.config.initialCenter.lat]
        : [-0.09478, 51.52145],
      zoom: props.config.initialZoom ?? 12,
      pitch: props.config.enable3D ? 60 : 0,
      dragRotate: true,
    })

    map.on('error', (e: { error?: Error }) => {
      error.value = e.error?.message ?? 'Failed to load MapLibre'
      isLoading.value = false
    })

    map.on('load', () => {
      if (map.getLayer('background')) {
        map.setPaintProperty('background', 'background-color', 'hsl(47, 26%, 88%)')
      }
      mapInstance.value = map
      isLoading.value = false
      map.addControl(
        new maplibregl.NavigationControl({
          showCompass: true,
          showZoom: true,
          visualizePitch: true,
        }),
        'top-right'
      )
      if (props.config.enable3D) {
        navigation.toggle3D()
      }
      markerManager.setMarkersData(props.markers, [], map)
      map.once('idle', () => {
        markerManager.setMarkersData(props.markers, [], map)
      })
      emit('mapReady', map)
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to initialize MapLibre'
    isLoading.value = false
  }
})

watch(
  () => mapInstance.value,
  (map) => {
    if (map && props.markers.length > 0) {
      markerManager.setMarkersData(props.markers, [])
    }
  }
)

watch(
  () => props.markers,
  (newMarkers) => {
    if (!mapInstance.value) return
    markerManager.setMarkersData(newMarkers, [])
  },
  { deep: true }
)

watch(
  () => markerManager.visibleMarkerCount.value,
  (count) => emit('renderedCountChange', count),
  { immediate: true }
)

watch(
  () => lasso.selectedBounds.value,
  (bounds) => {
    if (bounds && props.markers.length > 0) {
      const selectedIds = lasso.getMarkersInBounds(props.markers)
      lasso.selectedMarkers.value = selectedIds
      const selectedMarkersList = props.markers.filter((m) => selectedIds.includes(m.id))
      markerManager.setHighlightedMarkerIds(selectedIds)
      emit('selectionChange', { ids: selectedIds, markers: selectedMarkersList })
    } else {
      markerManager.setHighlightedMarkerIds([])
      emit('selectionChange', { ids: [], markers: [] })
    }
  }
)

defineExpose({
  mapInstance,
  navigation,
  lasso,
  markers: markerManager,
  visibleMarkerCount: markerManager.visibleMarkerCount,
  buildingTags,
  zoomIn: navigation.zoomIn,
  zoomOut: navigation.zoomOut,
  panTo: navigation.panTo,
  fitBounds: navigation.fitBounds,
  toggle3D: navigation.toggle3D,
  enableLasso: lasso.enableLasso,
  disableLasso: lasso.disableLasso,
  clearSelection: lasso.clearSelection,
  addBuildingTag: buildingTags.addBuildingTag,
  removeBuildingTag: buildingTags.removeBuildingTag,
  clearAllBuildingTags: buildingTags.clearAllBuildingTags,
})

onBeforeUnmount(() => {
  lasso.disableLasso()
  markerManager.setHighlightedMarkerIds([])
  markerManager.clearAllMarkers()
  mapInstance.value?.remove()
})
</script>

<template>
  <div class="map-wrapper">
    <div ref="mapContainer" class="map-container"></div>
    <div v-if="isLoading" class="map-loading">
      <div class="map-loading-content">
        <div class="map-loading-text">Loading map...</div>
        <div v-if="error" class="map-error">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-wrapper {
  position: relative;
  height: 100%;
  width: 100%;
}
.map-container {
  height: 100%;
  width: 100%;
  background-color: hsl(47, 26%, 88%);
}
.map-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(240, 240, 240, 0.85);
}
.map-loading-content {
  text-align: center;
}
.map-loading-text {
  margin-bottom: 0.5rem;
}
.map-error {
  color: #c00;
}
</style>
