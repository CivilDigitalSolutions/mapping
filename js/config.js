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

// Saved interactive map files use this street map in place of OpenStreetMap's.
// OpenStreetMap's tile servers refuse requests that don't say which website they
// come from (no Referer header), and a map file opened from disk or an email
// attachment never sends one, so every tile shows "Access blocked".
// Same id, so the file opens on the street map whenever the app was showing it.
export const FILE_STREET_MAP = {
  id: 'osm',
  name: 'Street map',
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  options: {
    maxZoom: 19,
    attribution: 'Tiles &copy; Esri &mdash; Sources: Esri, HERE, Garmin, USGS, &copy; OpenStreetMap contributors, and the GIS User Community',
  },
};

export const DEFAULT_VIEW = { center: [20, 0], zoom: 2 };

// Visitor counting with GoatCounter (free, no cookies, no personal data).
// Put your GoatCounter code here, e.g. 'datamapper' for datamapper.goatcounter.com.
// Leave it empty ('') to turn counting off.
export const GOATCOUNTER_CODE = 'civildigital';
