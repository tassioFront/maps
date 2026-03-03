# map-poc

Vue 3 + MapLibre POC. Single page with map, markers, lasso selection, and 3D buildings.

## 3D buildings (vector tiles)

3D only works when the map uses **vector** tiles with a building layer. This POC can use tiles served by `oly-ui-template`:

1. In **oly-ui-template**: generate tiles (if needed) and start the tile server:
   ```sh
   cd oly-ui-template
   pnpm map-tiles:serve
   ```
   This serves `http://localhost:8080/style.json` and `http://localhost:8080/tiles/{z}/{x}/{y}.pbf`.

2. In this app: choose **"Local vector (3D)"** in the Style dropdown. Zoom in and click **3D** to see buildings.

The default tile set in oly-ui-template is **Liechtenstein**; the map opens there so tiles load. If you see 404s, you're viewing outside the generated region. To get tiles for another area (e.g. London), run `pnpm map-tiles:generate [area]` in oly-ui-template (e.g. `europe/great-britain`) then serve again.

If the tile server is not running, use **"OSM Raster"** in the Style dropdown (no 3D).

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```
