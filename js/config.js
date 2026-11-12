// Map background layers. All are free to use with no API key and no billing account.
// Swap or add providers here if your organisation has its own tile server.
//
// Please keep within each provider's usage policy:
//  - OpenStreetMap: https://operations.osmfoundation.org/policies/tiles/
//  - OpenTopoMap:   https://opentopomap.org/about
//  - Esri imagery:  https://www.esri.com/en-us/legal/terms/full-master-agreement
export const BASEMAPS = [
  {
    id: 'osm',
    name: 'Street map',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  {
    id: 'topo',
    name: 'Topographic',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 17,
      attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
  {
    id: 'imagery',
    name: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  },
];

export const DEFAULT_VIEW = { center: [20, 0], zoom: 2 };
