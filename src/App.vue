<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import MapLibreView from "@/components/MapLibreView.vue";
import type { MapConfig, MapMarker } from "@/types/map";
import { mockMarkers50 } from "@/mocks/mapData";

const params = new URLSearchParams(window.location.search);

const markersFromQuery = (): number => {
  const n = params.get("m");
  const parsed = n != null ? Number(n) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
};

const clusteringFromQuery = (): boolean => {
  const c = params.get("c");
  if (c == null) return true;
  const lower = c.toLowerCase();
  return lower !== "0" && lower !== "false" && lower !== "no";
};

const VECTOR_STYLE_URL =
  "https://olymapstilesprod.blob.core.windows.net/teste/style.json";

const styleOptions = [
  { value: "vector", label: "Local vector (3D)", url: VECTOR_STYLE_URL },
  { value: "raster", label: "OSM Raster", url: "" },
] as const;

const selectedStyle = ref<"vector" | "raster">("vector");

// Default view: Liechtenstein (matches oly-ui-template default tile region: europe/liechtenstein)
const DEFAULT_CENTER = { lat: 47.141, lng: 9.521 };

const mapConfig = ref<MapConfig>({
  initialCenter: DEFAULT_CENTER,
  initialZoom: 12,
  enable3D: false,
  enableClustering: clusteringFromQuery(),
  mapStyle: VECTOR_STYLE_URL,
});

// Keep mapStyle in sync with dropdown; empty string = use OSM raster in MapLibreView
function onStyleChange() {
  const opt = styleOptions.find((o) => o.value === selectedStyle.value);
  mapConfig.value = {
    ...mapConfig.value,
    mapStyle: opt?.url ?? "",
  };
}

const sampleMarkers = ref<MapMarker[]>(mockMarkers50(markersFromQuery()));

const mapRef = ref<InstanceType<typeof MapLibreView> | null>(null);
const selectedCount = ref(0);

function onSelectionChange(payload: { ids: string[]; markers: MapMarker[] }) {
  selectedCount.value = payload.ids.length;
}

function zoomIn() {
  mapRef.value?.zoomIn();
}
function zoomOut() {
  mapRef.value?.zoomOut();
}
function toggle3D() {
  mapRef.value?.toggle3D();
}
function enableLasso() {
  mapRef.value?.enableLasso();
}
function disableLasso() {
  mapRef.value?.disableLasso();
}
function clearSelection() {
  mapRef.value?.clearSelection();
}
function toggleClustering() {
  mapConfig.value = {
    ...mapConfig.value,
    enableClustering: !mapConfig.value.enableClustering,
  };
}

const isLassoActive = computed(
  () => mapRef.value?.lasso?.isLassoActive?.value ?? false,
);
const isClusteringEnabled = computed(
  () => mapConfig.value.enableClustering ?? false,
);
const totalMarkers = computed(() => sampleMarkers.value.length);
const renderedCount = ref(0);
const renderTimeMs = ref<number | null>(null);
let renderStartTime: number | null = null;

onMounted(() => {
  renderStartTime = performance.now();
});

watch(
  [() => totalMarkers.value, selectedStyle],
  () => {
    renderTimeMs.value = null;
    renderStartTime = performance.now();
  }
);

function onRenderComplete() {
  if (renderStartTime !== null) {
    renderTimeMs.value = Math.round(performance.now() - renderStartTime);
  }
}
</script>

<template>
  <div class="app">
    <div class="toolbar">
      <label class="toolbar-label">
        Style
        <select v-model="selectedStyle" @change="onStyleChange">
          <option
            v-for="opt in styleOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>
      <button type="button" @click="zoomIn">Zoom +</button>
      <button type="button" @click="zoomOut">Zoom −</button>
      <button type="button" @click="toggle3D">3D</button>
      <button
        type="button"
        :class="{ active: isClusteringEnabled }"
        @click="toggleClustering"
      >
        Clustering
      </button>
      <button
        type="button"
        :class="{ active: isLassoActive }"
        @click="isLassoActive ? disableLasso() : enableLasso()"
      >
        Lasso
      </button>
      <button type="button" @click="clearSelection">Clear selection</button>
      <span class="toolbar-info"
        >Markers: {{ renderedCount }} / {{ totalMarkers }} rendered
        <template v-if="renderTimeMs !== null"> in {{ renderTimeMs }} ms</template></span
      >
      <span class="toolbar-info">Selected: {{ selectedCount }}</span>
    </div>
    <div class="map-area">
      <MapLibreView
        :key="selectedStyle"
        ref="mapRef"
        :config="mapConfig"
        :markers="sampleMarkers"
        @selection-change="onSelectionChange"
        @render-complete="onRenderComplete"
        @rendered-count-change="renderedCount = $event"
      />
    </div>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}
html,
body,
#app {
  height: 100%;
  margin: 0;
}
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.toolbar {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  background: #f0f0f0;
  border-bottom: 1px solid #ccc;
}
.toolbar-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
}
.toolbar-label select {
  padding: 4px 8px;
  border: 1px solid #999;
  border-radius: 4px;
  background: #fff;
}
.toolbar button {
  padding: 6px 12px;
  cursor: pointer;
  border: 1px solid #999;
  border-radius: 4px;
  background: #fff;
}
.toolbar button:hover {
  background: #e8e8e8;
}
.toolbar button.active {
  background: #4285f4;
  color: #fff;
  border-color: #3367d6;
}
.toolbar-info {
  margin-left: 12px;
  font-size: 14px;
  color: #555;
}
.map-area {
  flex: 1;
  min-height: 0;
}
</style>
