import { useEffect, useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import area from '@turf/area';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, MapPin, Wrench, ChevronLeft, ChevronRight, UploadCloud,
  Trash2, Eye, EyeOff, Table, Info, Save, X, CheckCircle2, AlertTriangle, ArrowUpDown, ChevronDown, ChevronUp
} from 'lucide-react';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

const { BaseLayer } = LayersControl;

const LAYER_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const LAND_USE_TYPES = [
  { key: 'agriculture', label: 'เกษตรกรรม', icon: '🌾', color: '#22c55e', fillColor: '#dcfce7' },
  { key: 'residential', label: 'ที่อยู่อาศัย', icon: '🏠', color: '#3b82f6', fillColor: '#dbeafe' },
  { key: 'commercial', label: 'พาณิชยกรรม', icon: '🏪', color: '#f59e0b', fillColor: '#fef3c7' },
  { key: 'industrial', label: 'อุตสาหกรรม', icon: '🏭', color: '#8b5cf6', fillColor: '#f3e8ff' },
  { key: 'government', label: 'สถานที่ราชการ', icon: '🏛️', color: '#06b6d4', fillColor: '#ecfeff' },
  { key: 'religious', label: 'ศาสนสถาน', icon: '⛪', color: '#ec4899', fillColor: '#fce7f3' },
  { key: 'vacant', label: 'รกร้างว่างเปล่า', icon: '🏜️', color: '#9ca3af', fillColor: '#f3f4f6' },
  { key: 'other', label: 'อื่นๆ', icon: '📌', color: '#78716c', fillColor: '#f5f5f4' },
];

const LAND_USE_MAP = Object.fromEntries(LAND_USE_TYPES.map((t) => [t.key, t]));

/* ─── Thai land units (1 ตร.วา = 4 ตร.ม.) ─── */
const SQM_PER_WAH = 4;
const WAH_PER_NGAN = 100;
const WAH_PER_RAI = 400;

/* ─── Area helpers ─── */
const parseAreaToWah = (str) => {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.split('-').map((s) => parseFloat(s) || 0);
  const rai = parts[0] || 0;
  const ngan = parts[1] || 0;
  const wah = parts[2] || 0;
  return rai * WAH_PER_RAI + ngan * WAH_PER_NGAN + wah;
};

const wahToAreaStr = (totalWah) => {
  if (!totalWah || totalWah <= 0) return '0-0-0';
  const rai = Math.floor(totalWah / WAH_PER_RAI);
  const remain = totalWah - rai * WAH_PER_RAI;
  const ngan = Math.floor(remain / WAH_PER_NGAN);
  const wah = Math.round((remain - ngan * WAH_PER_NGAN) * 100) / 100;
  return `${rai}-${ngan}-${wah}`;
};

const parseAreaParts = (str) => {
  if (!str || typeof str !== 'string') return { rai: '', ngan: '', wah: '' };
  const parts = str.split('-');
  return {
    rai: parts[0] !== undefined && parts[0] !== '0' ? parts[0] : parts[0] === '0' ? '0' : '',
    ngan: parts[1] !== undefined && parts[1] !== '0' ? parts[1] : parts[1] === '0' ? '0' : '',
    wah: parts[2] !== undefined && parts[2] !== '0' ? parts[2] : parts[2] === '0' ? '0' : '',
  };
};

const partsToStr = (rai, ngan, wah) => {
  const r = rai === '' ? '' : rai;
  const n = ngan === '' ? '' : ngan;
  const w = wah === '' ? '' : wah;
  return `${r}-${n}-${w}`;
};

const normalizeAreaStr = (str) => {
  if (!str) return '';
  const parts = str.split('-');
  const r = parseFloat(parts[0]) || 0;
  const n = parseFloat(parts[1]) || 0;
  const w = parseFloat(parts[2]) || 0;
  if (r === 0 && n === 0 && w === 0) return '';
  return `${r}-${n}-${w}`;
};

const normalizeLUFull = (val) => {
  if (!val) return { types: [], areas: {} };
  if (typeof val === 'string') return { types: [val], areas: {} };
  if (Array.isArray(val)) return { types: val, areas: {} };
  if (val.types) return { types: val.types || [], areas: val.areas || {} };
  return { types: [], areas: {} };
};

const normalizeLU = (val) => normalizeLUFull(val).types;

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

const geodesicArea = (latLngs) => {
  if (!latLngs || latLngs.length < 3) return 0;
  const ring = latLngs.map((p) => [p.lng, p.lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  try {
    return Math.abs(area({ type: 'Polygon', coordinates: [ring] }));
  } catch {
    return 0;
  }
};

const MapController = ({ onMapReady }) => {
  const map = useMap();
  useEffect(() => {
    if (map) {
      const checkMapReady = () => {
        if (map && !map._removed && map._loaded !== false) onMapReady(map);
        else setTimeout(checkMapReady, 50);
      };
      setTimeout(checkMapReady, 100);
    }
  }, [map, onMapReady]);
  return null;
};

const FitBoundsToGeoJSON = ({ geojsonData }) => {
  const map = useMap();
  useEffect(() => {
    if (geojsonData && map) {
      try {
        const geoLayer = L.geoJSON(geojsonData);
        const bounds = geoLayer.getBounds();
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], animate: true, duration: 1 });
      } catch (err) { console.warn('Could not fit bounds:', err); }
    }
  }, [geojsonData, map]);
  return null;
};

const buildCombinedGeoJSON = (layers) => {
  if (layers.length === 0) return null;
  return { type: 'FeatureCollection', features: layers.flatMap((l) => l.data.features || [l.data]) };
};

/* ─── Single-Feature Geometry Editor ─── */
const SingleFeatureEditor = ({ feature, featureIndex, onCollect }) => {
  const map = useMap();
  const editLayerRef = useRef(null);

  useEffect(() => {
    if (!map || !feature) return;

    const fg = L.featureGroup().addTo(map);
    editLayerRef.current = fg;

    const geoLayer = L.geoJSON(feature, {
      style: () => ({
        color: '#f59e0b',
        weight: 3,
        fillColor: '#fef3c7',
        fillOpacity: 0.35,
      }),
      pointToLayer: (f, ll) => L.circleMarker(ll, {
        radius: 8, fillColor: '#f59e0b', color: '#fff', weight: 2, fillOpacity: 0.8,
      }),
    });

    geoLayer.eachLayer((l) => fg.addLayer(l));

    fg.eachLayer((l) => {
      if (l.pm) l.pm.enable({ allowSelfIntersection: false });
    });

    map.pm.setGlobalOptions({
      allowSelfIntersection: false,
      snappable: true,
      snapDistance: 15,
    });

    try {
      const b = fg.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [80, 80], maxZoom: 19, animate: true });
    } catch { /* ignore */ }

    return () => {
      fg.eachLayer((l) => { if (l.pm) l.pm.disable(); });
      map.removeLayer(fg);
      editLayerRef.current = null;
    };
  }, [map, feature]);

  const collectGeo = useCallback(() => {
    const fg = editLayerRef.current;
    if (!fg) return null;
    let edited = null;
    fg.eachLayer((l) => {
      const geo = l.toGeoJSON();
      edited = { ...geo, properties: { ...feature.properties, ...geo.properties } };
    });
    return { featureIndex, feature: edited };
  }, [feature, featureIndex]);

  useEffect(() => {
    if (onCollect) onCollect.current = collectGeo;
  }, [collectGeo, onCollect]);

  return null;
};

/* ─── Draw New Feature ─── */
const DrawNewFeature = ({ onCreated }) => {
  const map = useMap();
  const createdRef = useRef(null);

  useEffect(() => {
    if (!map) return;

    map.pm.setGlobalOptions({
      allowSelfIntersection: false,
      snappable: true,
      snapDistance: 15,
      templineStyle: { color: '#16a34a', weight: 3 },
      hintlineStyle: { color: '#16a34a', dashArray: '5,5', weight: 2 },
      pathOptions: { color: '#16a34a', weight: 3, fillColor: '#bbf7d0', fillOpacity: 0.35 },
    });

    map.pm.enableDraw('Polygon', {
      finishOn: 'dblclick',
    });

    const handleCreate = (e) => {
      createdRef.current = e.layer;
      const geo = e.layer.toGeoJSON();
      map.pm.disableDraw();
      onCreated(geo);
    };

    map.on('pm:create', handleCreate);

    return () => {
      map.pm.disableDraw();
      map.off('pm:create', handleCreate);
      if (createdRef.current) {
        try { map.removeLayer(createdRef.current); } catch { /* ignore */ }
        createdRef.current = null;
      }
    };
  }, [map, onCreated]);

  return null;
};

/* ─── Measure Area Tool ─── */
const MeasureAreaTool = ({ onUpdate }) => {
  const map = useMap();
  const pointsRef = useRef([]);
  const closedRef = useRef(false);
  const lgRef = useRef(null);
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  const redraw = useCallback(() => {
    const lg = lgRef.current;
    if (!lg) return;
    lg.clearLayers();
    const pts = pointsRef.current;
    const isClosed = closedRef.current;

    if (pts.length === 0) {
      cbRef.current?.({ pointCount: 0, closed: false, sqm: 0, areaStr: '0-0-0' });
      return;
    }

    pts.forEach((p, i) => {
      L.circleMarker(p, {
        radius: i === 0 && pts.length > 1 ? 8 : 5,
        color: i === 0 && pts.length > 1 ? '#dc2626' : '#e11d48',
        fillColor: i === 0 && pts.length > 1 ? '#fecaca' : '#fff',
        fillOpacity: 1, weight: 2,
      }).addTo(lg);
    });

    if (pts.length >= 3) {
      const poly = L.polygon(pts, {
        color: '#e11d48', weight: 2,
        fillColor: '#fda4af', fillOpacity: 0.3,
        dashArray: isClosed ? null : '5,5',
      });
      poly.addTo(lg);

      const sqm = geodesicArea(pts);
      const wah = sqm / SQM_PER_WAH;
      const areaStr = wahToAreaStr(wah);
      const center = poly.getBounds().getCenter();

      L.marker(center, {
        icon: L.divIcon({
          className: '',
          html: `<div class="bg-white border-2 border-rose-500 rounded-xl px-3 py-1.5 shadow-xl text-rose-700 font-bold text-xs whitespace-nowrap -translate-x-1/2 -translate-y-1/2 text-center leading-normal">
                  <div>${areaStr} ไร่-งาน-วา</div>
                  <div class="text-[10px] text-gray-500 font-normal">${Math.round(sqm).toLocaleString('th-TH')} ตร.ม.</div>
                 </div>`,
          iconSize: [0, 0],
        }),
        interactive: false,
      }).addTo(lg);

      let geoJson = null;
      if (isClosed) {
        const ring = pts.map((p) => [p.lng, p.lat]);
        ring.push([pts[0].lng, pts[0].lat]);
        geoJson = {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: {
            Area: areaStr,
            area_sqm: Math.round(sqm * 100) / 100,
            measured_at: new Date().toISOString(),
          },
        };
      }
      cbRef.current?.({ pointCount: pts.length, closed: isClosed, sqm, areaStr, geoJson });
    } else {
      if (pts.length === 2) {
        L.polyline(pts, { color: '#e11d48', weight: 2, dashArray: '5,5' }).addTo(lg);
      }
      cbRef.current?.({ pointCount: pts.length, closed: false, sqm: 0, areaStr: '0-0-0' });
    }
  }, []);

  useEffect(() => {
    map.closePopup();
    const lg = L.layerGroup().addTo(map);
    lgRef.current = lg;

    const container = map.getContainer();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;z-index:9999;cursor:crosshair;pointer-events:auto';
    container.style.position = 'relative';
    container.appendChild(overlay);

    const handleClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (closedRef.current) return;
      const pts = pointsRef.current;
      const cp = map.mouseEventToContainerPoint(e);
      const latlng = map.containerPointToLatLng(cp);
      if (pts.length >= 3) {
        const pxFirst = map.latLngToContainerPoint(pts[0]);
        if (cp.distanceTo(pxFirst) < 20) {
          closedRef.current = true;
          redraw();
          return;
        }
      }
      pointsRef.current = [...pts, latlng];
      redraw();
    };

    const handleDblClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (pointsRef.current.length >= 3 && !closedRef.current) {
        closedRef.current = true;
        redraw();
      }
    };

    overlay.addEventListener('click', handleClick);
    overlay.addEventListener('dblclick', handleDblClick);
    map.doubleClickZoom.disable();
    redraw();

    return () => {
      overlay.removeEventListener('click', handleClick);
      overlay.removeEventListener('dblclick', handleDblClick);
      overlay.remove();
      map.doubleClickZoom.enable();
      map.removeLayer(lg);
    };
  }, [map, redraw]);

  return null;
};

/* ─── New Feature Properties Form ─── */
const NewFeaturePropsForm = ({ onSave, onCancel }) => {
  const [parcelCode, setParcelCode] = useState('');
  const [area, setArea] = useState('');

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-white rounded-2xl shadow-2xl border border-green-200 w-80 overflow-hidden animate-fade-in">
      <div className="px-4 py-3.5 bg-green-50 border-b border-green-100 flex items-center gap-2">
        <span className="text-green-600 text-lg">📝</span>
        <div>
          <p className="text-sm font-bold text-green-800">กรอกข้อมูลแปลงใหม่</p>
          <p className="text-[10px] text-green-600">กรอกรหัสแปลงและเนื้อที่ (ไร่-งาน-วา)</p>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">รหัสแปลง (parcel_cod)</label>
          <input type="text" value={parcelCode} onChange={(e) => setParcelCode(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            placeholder="เช่น 1234-56-789" autoFocus />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">เนื้อที่ (ไร่-งาน-ตร.วา)</label>
          <input type="text" value={area} onChange={(e) => setArea(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            placeholder="เช่น 12-2-41" />
        </div>
      </div>
      <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 bg-gray-50/50">
        <button onClick={() => onSave({ parcel_cod: parcelCode || undefined, Area: area || undefined })}
          className="flex-1 px-4 py-2 bg-green-600 text-white text-xs font-semibold rounded-xl hover:bg-green-700 transition-colors shadow-md">
          บันทึกแปลงใหม่
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-gray-200 text-gray-700 text-xs font-semibold rounded-xl hover:bg-gray-300 transition-colors">
          ยกเลิก
        </button>
      </div>
    </div>
  );
};

const getParcelCode = (props) =>
  props?.parcel_cod || props?.PARCEL_COD || props?.Parcel_cod || null;

const getParcelArea = (props) =>
  props?.Area || props?.area || props?.AREA || null;

const VALID_GEOM_TYPES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString',
  'Polygon', 'MultiPolygon', 'GeometryCollection',
]);

const sanitizeGeoJSON = (data) => {
  if (!data) return null;
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    const valid = data.features.filter((f) => f && f.geometry && VALID_GEOM_TYPES.has(f.geometry.type));
    if (valid.length === 0) return null;
    if (valid.length === data.features.length) return data;
    return { ...data, features: valid };
  }
  if (data.type === 'Feature') {
    if (!data.geometry || !VALID_GEOM_TYPES.has(data.geometry.type)) return null;
    return data;
  }
  if (VALID_GEOM_TYPES.has(data.type)) return data;
  return null;
};

const SafeGeoJSON = (props) => {
  const { data, ...rest } = props;
  const safeData = sanitizeGeoJSON(data);
  if (!safeData) return null;
  return <GeoJSON data={safeData} {...rest} />;
};

/* ─────────────── Area Input Row ─────────────── */
const AreaInput = ({ label, icon, color, value, onChange, onAutoFill, remainWah }) => {
  const [localRai, setLocalRai] = useState(() => parseAreaParts(value).rai);
  const [localNgan, setLocalNgan] = useState(() => parseAreaParts(value).ngan);
  const [localWah, setLocalWah] = useState(() => parseAreaParts(value).wah);
  const committedRef = useRef(value);

  useEffect(() => {
    if (value !== committedRef.current) {
      const p = parseAreaParts(value);
      setLocalRai(p.rai);
      setLocalNgan(p.ngan);
      setLocalWah(p.wah);
      committedRef.current = value;
    }
  }, [value]);

  const commit = (rai, ngan, wah) => {
    const v = partsToStr(rai, ngan, wah);
    committedRef.current = v;
    onChange(v);
  };

  const handleChange = (field, raw) => {
    const isWah = field === 'wah';
    const cleaned = isWah ? raw.replace(/[^0-9.]/g, '') : raw.replace(/[^0-9]/g, '');

    if (isWah) {
      const dotIdx = cleaned.indexOf('.');
      let final = cleaned;
      if (dotIdx !== -1) {
        final = cleaned.slice(0, dotIdx + 1) + cleaned.slice(dotIdx + 1).replace(/\./g, '').slice(0, 2);
      }
      setLocalWah(final);
      commit(localRai, localNgan, final);
    } else if (field === 'rai') {
      setLocalRai(cleaned);
      commit(cleaned, localNgan, localWah);
    } else {
      setLocalNgan(cleaned);
      commit(localRai, cleaned, localWah);
    }
  };

  const inputCls = "w-11 text-center text-xs border border-gray-200 rounded-lg py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-green-400";

  return (
    <div className="flex items-center gap-1.5 py-1.5 justify-between">
      <span className="text-xs font-medium flex items-center gap-1 w-28 truncate" style={{ color }} title={label}>
        <span>{icon}</span> <span>{label}</span>
      </span>
      <div className="flex items-center gap-1 flex-1 justify-end">
        <input type="text" inputMode="numeric" value={localRai} onChange={(e) => handleChange('rai', e.target.value)} placeholder="ไร่" className={inputCls} />
        <span className="text-gray-300 text-[10px]">-</span>
        <input type="text" inputMode="numeric" value={localNgan} onChange={(e) => handleChange('ngan', e.target.value)} placeholder="งาน" className="w-10 text-center text-xs border border-gray-200 rounded-lg py-1 px-1.5 focus:outline-none focus:ring-1 focus:ring-green-400" />
        <span className="text-gray-300 text-[10px]">-</span>
        <input type="text" inputMode="decimal" value={localWah} onChange={(e) => handleChange('wah', e.target.value)} placeholder="วา" className={inputCls} />
        {onAutoFill && remainWah > 0 && (
          <button onClick={onAutoFill} className="ml-1 px-2 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-lg hover:bg-green-100 transition-colors flex-shrink-0" title="เติมเนื้อที่คงเหลือ">
            Auto
          </button>
        )}
      </div>
    </div>
  );
};

/* ─────────────── Attribute Table ─────────────── */
const AttributeTable = ({ layer, onClose, onZoomToFeature, surveyMode, landUseAssignments, onUpdateFeature, onDeleteFeature, onBulkAssign }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filterLandUse, setFilterLandUse] = useState('all');
  const [filterBlockId, setFilterBlockId] = useState('all');
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [checkedCodes, setCheckedCodes] = useState(new Set());
  const [bulkType, setBulkType] = useState('agriculture');
  const [pageSize, setPageSize] = useState(50);

  const features = useMemo(() => layer?.data?.features || [], [layer]);

  const columns = useMemo(() => {
    const colSet = new Set();
    features.forEach((f) => { if (f.properties) Object.keys(f.properties).forEach((k) => colSet.add(k)); });
    return Array.from(colSet);
  }, [features]);

  const blockIdOptions = useMemo(() => {
    const ids = new Set();
    features.forEach((f) => {
      const v = f.properties?.block_id ?? f.properties?.Block_id ?? f.properties?.BLOCK_ID;
      if (v !== null && v !== undefined && v !== '') ids.add(String(v));
    });
    return Array.from(ids).sort((a, b) => a.localeCompare(b, 'th', { numeric: true }));
  }, [features]);

  const filtered = useMemo(() => {
    let result = features;
    if (filterBlockId !== 'all') {
      result = result.filter((f) => {
        const v = f.properties?.block_id ?? f.properties?.Block_id ?? f.properties?.BLOCK_ID;
        return String(v ?? '') === filterBlockId;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((f) => {
        if (!f.properties) return false;
        return Object.values(f.properties).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q));
      });
    }
    if (surveyMode && filterLandUse !== 'all') {
      result = result.filter((f) => {
        const code = getParcelCode(f.properties);
        const arr = normalizeLU(code ? landUseAssignments[code] : null);
        if (filterLandUse === 'unassigned') return arr.length === 0;
        return arr.includes(filterLandUse);
      });
    }
    return result;
  }, [features, search, filterBlockId, surveyMode, filterLandUse, landUseAssignments]);

  const sorted = useMemo(() => {
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const va = a.properties?.[sortCol] ?? '';
      const vb = b.properties?.[sortCol] ?? '';
      const na = Number(va); const nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) return sortAsc ? na - nb : nb - na;
      return sortAsc ? String(va).localeCompare(String(vb), 'th') : String(vb).localeCompare(String(va), 'th');
    });
  }, [filtered, sortCol, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => { setPage(0); setSelectedRow(null); }, [search, sortCol, sortAsc, filterLandUse, filterBlockId]);

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc((prev) => !prev);
    else { setSortCol(col); setSortAsc(true); }
  };

  const handleRowClick = (feature, idx) => {
    setSelectedRow(page * pageSize + idx);
    onZoomToFeature?.(feature);
  };

  const startCellEdit = (featureIdx, col, currentVal, e) => {
    e.stopPropagation();
    setEditCell({ featureIdx, col });
    setEditValue(currentVal != null ? String(currentVal) : '');
  };

  const commitCellEdit = () => {
    if (!editCell) return;
    const { featureIdx, col } = editCell;
    const feature = features[featureIdx];
    if (!feature) { setEditCell(null); return; }

    const oldVal = feature.properties?.[col];
    const newVal = editValue;

    if (String(oldVal ?? '') !== newVal) {
      onUpdateFeature?.(featureIdx, col, newVal);
    }
    setEditCell(null);
  };

  const cancelCellEdit = () => {
    setEditCell(null);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Enter') commitCellEdit();
    else if (e.key === 'Escape') cancelCellEdit();
  };

  const pagedCodes = useMemo(() =>
    paged.map((f) => getParcelCode(f.properties)).filter(Boolean),
  [paged]);

  const allFilteredCodes = useMemo(() =>
    sorted.map((f) => getParcelCode(f.properties)).filter(Boolean),
  [sorted]);

  const allPageChecked = pagedCodes.length > 0 && pagedCodes.every((c) => checkedCodes.has(c));
  const somePageChecked = pagedCodes.some((c) => checkedCodes.has(c));

  const toggleCheck = (code, e) => {
    e.stopPropagation();
    setCheckedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const togglePageAll = () => {
    setCheckedCodes((prev) => {
      const next = new Set(prev);
      if (allPageChecked) { pagedCodes.forEach((c) => next.delete(c)); }
      else { pagedCodes.forEach((c) => next.add(c)); }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setCheckedCodes(new Set(allFilteredCodes));
  };

  const clearChecked = () => setCheckedCodes(new Set());

  const handleBulkAssign = async () => {
    const codes = Array.from(checkedCodes);
    if (codes.length === 0) return;
    const t = LAND_USE_MAP[bulkType];
    const label = t ? `${t.icon} ${t.label}` : bulkType;
    if (!window.confirm(`กำหนด "${label}" ให้ ${codes.length} แปลงที่เลือก?`)) return;
    await onBulkAssign(codes, bulkType);
    setCheckedCodes(new Set());
  };

  if (!layer) return null;

  return (
    <div className="relative h-full bg-white flex flex-col">
      {/* Control Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-gray-50/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full shadow-sm" style={{ backgroundColor: layer.color }} />
            <h3 className="text-sm font-bold text-gray-800 truncate max-w-[200px]" title={layer.name}>{layer.name}</h3>
          </div>
          <span className="text-xs text-gray-500 font-medium">
            {sorted.length === features.length ? `${features.length} รายการ` : `${sorted.length} จาก ${features.length} รายการ`}
          </span>
          {onUpdateFeature && <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-semibold">ดับเบิลคลิกช่องเพื่อแก้ไข</span>}
        </div>
        
        <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
          {blockIdOptions.length > 0 && (
            <select value={filterBlockId} onChange={(e) => setFilterBlockId(e.target.value)} className="select select-bordered select-xs text-xs font-semibold focus:outline-none">
              <option value="all">บล็อกทั้งหมด</option>
              {blockIdOptions.map((id) => (<option key={id} value={id}>{id}</option>))}
            </select>
          )}
          {surveyMode && (
            <select value={filterLandUse} onChange={(e) => setFilterLandUse(e.target.value)} className="select select-bordered select-xs text-xs font-semibold focus:outline-none">
              <option value="all">การใช้ประโยชน์ทั้งหมด</option>
              <option value="unassigned">ยังไม่สำรวจ</option>
              {LAND_USE_TYPES.map((t) => (<option key={t.key} value={t.key}>{t.icon} {t.label}</option>))}
            </select>
          )}
          <div className="relative">
            <input type="text" placeholder="ค้นหา..." value={search} onChange={(e) => setSearch(e.target.value)} className="input input-bordered input-xs pl-7 pr-3 text-xs w-40 focus:outline-none" />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          </div>
          <button onClick={onClose} className="btn btn-circle btn-ghost btn-xs text-gray-400 hover:text-gray-600" title="ปิดตาราง">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto">
        {columns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <Info size={32} className="stroke-current opacity-40" />
            <span className="text-xs font-semibold">ไม่พบข้อมูลคุณสมบัติ (Properties)</span>
          </div>
        ) : (
          <table className="table table-xs table-pin-rows table-pin-cols w-full border-collapse">
            <thead>
              <tr className="bg-gray-100/80">
                {surveyMode && onBulkAssign && (
                  <th className="text-center w-10">
                    <input type="checkbox" checked={allPageChecked} ref={(el) => { if (el) el.indeterminate = somePageChecked && !allPageChecked; }}
                      onChange={togglePageAll} className="checkbox checkbox-xs checkbox-primary" title="เลือกทั้งหน้า" />
                  </th>
                )}
                <th className="w-12 text-center text-[10px] uppercase font-bold text-gray-500">#</th>
                {surveyMode && <th className="min-w-[160px] text-left text-[10px] uppercase font-bold text-gray-500">การใช้ที่ดิน / สัดส่วนเนื้อที่</th>}
                {columns.map((col) => (
                  <th key={col} onClick={() => handleSort(col)} className="cursor-pointer hover:bg-gray-200 select-none whitespace-nowrap text-[10px] uppercase font-bold text-gray-500 group">
                    <div className="flex items-center gap-1">
                      <span>{col}</span>
                      {sortCol === col ? (
                        <span className="text-blue-600">{sortAsc ? '▲' : '▼'}</span>
                      ) : (
                        <span className="opacity-0 group-hover:opacity-100 text-gray-400"><ArrowUpDown size={10} /></span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="text-center w-12 text-[10px] font-bold text-gray-500">ซูม</th>
                {onDeleteFeature && <th className="text-center w-12 text-[10px] font-bold text-gray-500">ลบ</th>}
              </tr>
            </thead>
            <tbody>
              {paged.map((feature, idx) => {
                const globalIdx = page * pageSize + idx;
                const isSelected = selectedRow === globalIdx;
                const code = getParcelCode(feature.properties);
                const luData = normalizeLUFull(code ? landUseAssignments[code] : null);

                return (
                  <tr key={globalIdx} onClick={() => handleRowClick(feature, idx)}
                    className={`cursor-pointer transition-colors border-b border-gray-100 hover:bg-gray-50 ${checkedCodes.has(code) ? 'bg-green-50/50 hover:bg-green-100/50' : isSelected ? 'bg-blue-50 hover:bg-blue-100/70' : ''}`}>
                    {surveyMode && onBulkAssign && (
                      <td className="text-center">
                        {code ? (
                          <input type="checkbox" checked={checkedCodes.has(code)} onChange={(e) => toggleCheck(code, e)}
                            className="checkbox checkbox-xs checkbox-primary" />
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    )}
                    <td className="text-center text-gray-400 font-mono text-[10px] font-semibold">{globalIdx + 1}</td>
                    {surveyMode && (
                      <td onClick={(e) => e.stopPropagation()}>
                        {luData.types.length === 0 ? (
                          <span className="text-gray-400 text-[10px] italic">ยังไม่สำรวจ</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {luData.types.map((key, i) => {
                              const t = LAND_USE_MAP[key];
                              if (!t) return null;
                              const areaStr = luData.areas[key];
                              return (
                                <span key={key}
                                  className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${i === 0 ? 'ring-1 ring-offset-0' : 'opacity-85'}`}
                                  style={{ backgroundColor: t.fillColor, color: t.color, ringColor: i === 0 ? t.color : undefined }}
                                  title={`${t.label}${areaStr ? ` (${areaStr})` : ''}${i === 0 ? ' (หลัก)' : ''}`}>
                                  <span>{t.icon}</span>
                                  <span>{t.label}</span>
                                  {areaStr && <span className="ml-1 opacity-70 font-semibold">{areaStr}</span>}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>
                    )}
                    {columns.map((col) => {
                      const realIdx = features.indexOf(feature);
                      const val = feature.properties?.[col];
                      const isEditing = editCell && editCell.featureIdx === realIdx && editCell.col === col;

                      return (
                        <td key={col} className="max-w-[200px]"
                          title={!isEditing ? (val != null ? String(val) : '') : undefined}
                          onDoubleClick={(e) => onUpdateFeature && startCellEdit(realIdx, col, val, e)}>
                          {isEditing ? (
                            <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitCellEdit} onKeyDown={handleEditKeyDown} autoFocus
                              className="input input-bordered input-xs w-full text-xs font-semibold focus:outline-none bg-blue-50/50" />
                          ) : (
                            <span className={`block truncate ${onUpdateFeature ? 'cursor-text font-medium text-gray-700' : 'text-gray-600'}`}>
                              {val != null ? String(val) : <span className="text-gray-300">—</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center">
                      <button onClick={(e) => { e.stopPropagation(); handleRowClick(feature, idx); }} className="btn btn-ghost btn-xs btn-circle text-blue-500 hover:bg-blue-50" title="ซูมไปที่ feature">📍</button>
                    </td>
                    {onDeleteFeature && (
                      <td className="text-center">
                        <button onClick={(e) => {
                          e.stopPropagation();
                          const realIdx = features.indexOf(feature);
                          const code = getParcelCode(feature.properties);
                          const label = code || `แปลง #${realIdx + 1}`;
                          if (window.confirm(`ต้องการลบ "${label}" ใช่หรือไม่?`)) {
                            onDeleteFeature(realIdx);
                            setSelectedRow(null);
                          }
                        }} className="btn btn-ghost btn-xs btn-circle text-gray-400 hover:text-red-600 hover:bg-red-50" title="ลบแปลงนี้">
                          <Trash2 size={12} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bulk Edit Actions */}
      {surveyMode && onBulkAssign && checkedCodes.size > 0 && (
        <div className="px-4 py-3 border-t-2 border-green-500 bg-green-50/80 flex items-center justify-between flex-shrink-0 animate-fade-in gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-600" />
            <span className="text-xs font-bold text-green-800">เลือกทั้งหมด {checkedCodes.size} แปลง</span>
            {allFilteredCodes.length > checkedCodes.size && (
              <button onClick={selectAllFiltered} className="text-[10px] font-bold text-green-700 underline hover:text-green-900 ml-1">
                เลือกทั้งหมดในตัวกรอง ({allFilteredCodes.length} แปลง)
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <select value={bulkType} onChange={(e) => setBulkType(e.target.value)}
              className="select select-bordered select-xs text-xs font-semibold bg-white focus:outline-none">
              {LAND_USE_TYPES.map((t) => (
                <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
              ))}
            </select>
            <button onClick={handleBulkAssign}
              className="btn btn-success btn-xs text-white font-bold shadow-sm">
              กำหนดประเภทที่ดิน
            </button>
            <button onClick={clearChecked} className="btn btn-ghost btn-xs text-xs text-gray-500">ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Pagination Footer */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between flex-shrink-0 bg-gray-50/50 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-gray-500 font-medium">แสดง {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} จาก {sorted.length} แถว</span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="select select-bordered select-xs h-7 text-xs font-semibold focus:outline-none">
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} แถว/หน้า</option>
            ))}
          </select>
        </div>
        {totalPages > 1 && (() => {
          const pages = [];
          const maxButtons = 5;
          let start = Math.max(0, page - Math.floor(maxButtons / 2));
          let end = Math.min(totalPages, start + maxButtons);
          if (end - start < maxButtons) start = Math.max(0, end - maxButtons);

          for (let i = start; i < end; i++) pages.push(i);

          return (
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(0)} disabled={page === 0}
                className="btn btn-xs btn-outline px-1.5 h-7 min-h-0 disabled:opacity-30">«</button>
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="btn btn-xs btn-outline px-1.5 h-7 min-h-0 disabled:opacity-30">‹</button>

              {start > 0 && <span className="px-1 text-gray-400">...</span>}

              {pages.map((i) => (
                <button key={i} onClick={() => setPage(i)}
                  className={`btn btn-xs min-w-[28px] h-7 min-h-0 font-bold ${i === page ? 'btn-primary text-white shadow-sm' : 'btn-ghost text-gray-600 hover:bg-gray-200'}`}>
                  {i + 1}
                </button>
              ))}

              {end < totalPages && <span className="px-1 text-gray-400">...</span>}

              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="btn btn-xs btn-outline px-1.5 h-7 min-h-0 disabled:opacity-30">›</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                className="btn btn-xs btn-outline px-1.5 h-7 min-h-0 disabled:opacity-30">»</button>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

/* ─────────────── Parcel Inspector Panel ─────────────── */
const ParcelInspectorPanel = ({ parcelCode, currentTypes, currentAreas, totalArea, properties, onAssign, onClose }) => {
  const [selected, setSelected] = useState(currentTypes || []);
  const [areas, setAreas] = useState(currentAreas || {});
  const [showMetadata, setShowMetadata] = useState(false);

  useEffect(() => {
    setSelected(currentTypes || []);
    setAreas(currentAreas || {});
  }, [currentTypes, currentAreas]);

  const totalWah = parseAreaToWah(totalArea);
  const usedWah = selected.reduce((sum, key) => sum + parseAreaToWah(areas[key]), 0);
  const remainWah = totalWah - usedWah;
  const isOverLimit = totalWah > 0 && usedWah > totalWah;

  const toggle = (key) => {
    setSelected((prev) => {
      if (prev.includes(key)) {
        const next = prev.filter((k) => k !== key);
        setAreas((a) => { const copy = { ...a }; delete copy[key]; return copy; });
        return next;
      }
      return [...prev, key];
    });
  };

  const setPrimary = (key) => {
    setSelected((prev) => {
      if (!prev.includes(key)) return [key, ...prev];
      return [key, ...prev.filter((k) => k !== key)];
    });
  };

  const handleAreaChange = (key, val) => {
    setAreas((prev) => ({ ...prev, [key]: val }));
  };

  const autoFillRemain = (key) => {
    const otherUsed = selected.reduce((sum, k) => k === key ? sum : sum + parseAreaToWah(areas[k]), 0);
    const remaining = totalWah - otherUsed;
    if (remaining > 0) {
      setAreas((prev) => ({ ...prev, [key]: wahToAreaStr(remaining) }));
    }
  };

  const handleSave = () => {
    const cleanAreas = {};
    Object.entries(areas).forEach(([k, v]) => {
      const n = normalizeAreaStr(v);
      if (n) cleanAreas[k] = n;
    });
    onAssign({ types: selected, areas: cleanAreas });
  };

  const handleClear = () => {
    onAssign({ types: [], areas: {} });
  };

  const primary = selected[0] || null;
  const primaryType = primary ? LAND_USE_MAP[primary] : null;

  return (
    <motion.div
      initial={{ x: 100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 100, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="absolute top-4 right-4 z-[900] w-80 md:w-96 bg-white/95 backdrop-blur-md rounded-2xl border border-gray-200/80 shadow-2xl flex flex-col max-h-[calc(100vh-32px)] overflow-hidden font-sans"
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
        <div>
          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">แผงรายละเอียดแปลงที่ดิน</span>
          <h4 className="text-sm font-bold text-gray-800 truncate" title={parcelCode || 'ไม่ทราบรหัสแปลง'}>
            📍 {parcelCode || '—'}
          </h4>
        </div>
        <button onClick={onClose} className="btn btn-circle btn-ghost btn-xs text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Total Area Card */}
        {totalArea ? (
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-3.5 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-blue-600 font-bold uppercase">เนื้อที่ตามโฉนด</span>
              <p className="text-lg font-extrabold text-blue-900 font-mono tracking-tight">{totalArea}</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-gray-400 font-medium">คำนวณตร.ม.</span>
              <p className="text-xs font-bold text-gray-600 font-mono">{(parseAreaToWah(totalArea) * SQM_PER_WAH).toLocaleString('th-TH')} ตร.ม.</p>
            </div>
          </div>
        ) : (
          <div className="alert alert-warning p-2.5 rounded-xl text-xs gap-1">
            <AlertTriangle size={14} />
            <span>แปลงนี้ไม่มีข้อมูลระบุเนื้อที่รวม</span>
          </div>
        )}

        {/* Collapsible Metadata attributes */}
        {properties && (
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <button onClick={() => setShowMetadata(!showMetadata)}
              className="w-full px-3 py-2 bg-gray-50 flex items-center justify-between text-xs font-bold text-gray-600 hover:bg-gray-100 transition-colors">
              <span>📋 ข้อมูลคุณสมบัติอื่น ๆ ({Object.keys(properties).length})</span>
              <span>{showMetadata ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</span>
            </button>
            <AnimatePresence>
              {showMetadata && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  className="overflow-hidden bg-white text-xs"
                >
                  <div className="p-2.5 max-h-48 overflow-y-auto divide-y divide-gray-50">
                    {Object.entries(properties).map(([k, v]) => (
                      <div key={k} className="flex justify-between py-1">
                        <span className="text-gray-400 font-medium">{k}</span>
                        <span className="text-gray-800 font-semibold text-right max-w-[60%] truncate" title={String(v)}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Land Use Assignment Selection */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-gray-700 block">🌾 เลือกประเภทการใช้ประโยชน์ที่ดิน:</span>
          
          <div className="grid grid-cols-2 gap-1.5">
            {LAND_USE_TYPES.map((type) => {
              const isSelected = selected.includes(type.key);
              return (
                <button key={type.key} onClick={() => toggle(type.key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all border ${isSelected ? 'shadow-sm border-current font-bold' : 'border-gray-200/60 hover:bg-gray-50 text-gray-600'}`}
                  style={{ backgroundColor: isSelected ? type.fillColor : undefined, color: isSelected ? type.color : undefined }}>
                  <span className="text-sm">{type.icon}</span>
                  <span className="truncate">{type.label}</span>
                  {isSelected && <span className="ml-auto text-[10px] font-bold">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Areas allocation inputs */}
        {selected.length > 0 && (
          <div className="border border-gray-100 rounded-2xl p-3.5 bg-gray-50/50 space-y-2.5 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700">📏 แบ่งสัดส่วนสถิติการใช้งาน:</span>
              {selected.length > 1 && (
                <span className="text-[9px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold">หลายประเภท (ประเภทแรกคือหลัก)</span>
              )}
            </div>
            
            {/* Primary badge tags indicator */}
            {selected.length > 1 && (
              <div className="flex flex-wrap gap-1 py-1.5 border-b border-gray-100">
                {selected.map((key, i) => {
                  const t = LAND_USE_MAP[key];
                  if (!t) return null;
                  return (
                    <button key={key} onClick={() => setPrimary(key)}
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold transition-all border ${i === 0 ? 'border-current shadow-sm' : 'border-gray-200 opacity-60 hover:opacity-100'}`}
                      style={{ backgroundColor: t.fillColor, color: t.color }}>
                      {t.icon} {t.label} {i === 0 && '★'}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="divide-y divide-gray-100/50">
              {selected.map((key) => {
                const t = LAND_USE_MAP[key];
                if (!t) return null;
                const otherUsed = selected.reduce((sum, k) => k === key ? sum : sum + parseAreaToWah(areas[k]), 0);
                return (
                  <AreaInput key={key} label={t.label} icon={t.icon} color={t.color}
                    value={areas[key] || ''} onChange={(v) => handleAreaChange(key, v)}
                    onAutoFill={totalWah > 0 ? () => autoFillRemain(key) : undefined}
                    remainWah={totalWah > 0 ? totalWah - otherUsed : 0} />
                );
              })}
            </div>

            {/* Allocation calculator summary */}
            {totalWah > 0 && (
              <div className={`p-2.5 rounded-xl border text-xs space-y-1.5 transition-colors ${isOverLimit ? 'bg-red-50/70 border-red-200 text-red-700' : 'bg-white border-gray-100 text-gray-600'}`}>
                <div className="flex justify-between font-semibold font-mono text-[11px]">
                  <span>ใช้ไป: <b>{wahToAreaStr(usedWah)}</b></span>
                  <span>คงเหลือ: <b className={isOverLimit ? 'text-red-600' : remainWah > 0 ? 'text-green-600' : 'text-gray-600'}>{wahToAreaStr(Math.max(0, remainWah))}</b></span>
                </div>
                {isOverLimit && (
                  <div className="flex items-center gap-1 text-[10px] font-bold text-red-600">
                    <AlertTriangle size={12} />
                    <span>เนื้อที่เกินขนาดรวม {wahToAreaStr(usedWah - totalWah)}!</span>
                  </div>
                )}
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, (usedWah / totalWah) * 100)}%`, backgroundColor: isOverLimit ? '#ef4444' : '#22c55e' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 bg-gray-50/80">
        <button onClick={handleSave} disabled={isOverLimit}
          className="flex-1 btn btn-success text-white font-bold shadow-md hover:shadow-lg disabled:opacity-40">
          <Save size={14} />
          {primaryType ? `บันทึก (${primaryType.icon} ${selected.length > 1 ? `+${selected.length - 1}` : primaryType.label})` : 'บันทึกข้อมูล'}
        </button>
        {selected.length > 0 && (
          <button onClick={handleClear} className="btn btn-outline btn-error font-bold">ล้าง</button>
        )}
      </div>
    </motion.div>
  );
};

/* ─────────────── Step-by-Step Upload Assistant ─────────────── */
const GeoJSONUploadAssistant = ({ file, onSave, onCancel, loading }) => {
  const [layerName, setLayerName] = useState('');
  const [selectedColor, setSelectedColor] = useState(LAYER_COLORS[0]);
  const [featureCount, setFeatureCount] = useState(0);

  useEffect(() => {
    if (!file) return;
    const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    setLayerName(nameWithoutExt);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        const count = parsed.features?.length || (parsed.type === 'Feature' ? 1 : 0);
        setFeatureCount(count);
      } catch {
        setFeatureCount(0);
      }
    };
    reader.readAsText(file);
  }, [file]);

  if (!file) return null;

  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-xs font-sans px-4">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-md w-full overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center gap-2">
          <UploadCloud size={20} />
          <div>
            <h3 className="font-bold text-sm">ตัวช่วยอัปโหลดเลเยอร์ GeoJSON</h3>
            <p className="text-[10px] text-white/80">ตั้งค่าสไตล์ข้อมูลแผนที่ก่อนเริ่มนำเข้า</p>
          </div>
        </div>

        {/* File Detail Body */}
        <div className="p-5 space-y-4">
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5 space-y-2.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">ข้อมูลไฟล์ที่ตรวจพบ</span>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">ชื่อไฟล์เดิม:</span>
              <span className="font-semibold text-gray-800 truncate max-w-[200px]" title={file.name}>{file.name}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">ขนาดไฟล์:</span>
              <span className="font-mono font-semibold text-gray-800">{fileSizeMB} MB</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">จำนวนรูปแปลง:</span>
              <span className="badge badge-indigo badge-sm font-bold">{featureCount} แปลง (Features)</span>
            </div>
          </div>

          {/* Name input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-600">🏷️ ตั้งชื่อเลเยอร์ที่ดิน:</label>
            <input type="text" value={layerName} onChange={(e) => setLayerName(e.target.value)}
              className="input input-bordered input-sm w-full text-xs font-semibold focus:outline-none"
              placeholder="ตั้งชื่อเลเยอร์ เช่น แปลงที่ดินหมู่ 4" />
          </div>

          {/* Color palette selector */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-600">🎨 เลือกจานสีแผนที่ (Layer Color):</label>
            <div className="flex flex-wrap gap-2.5 pt-1">
              {LAYER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-all shadow-sm hover:scale-110 ${selectedColor === c ? 'border-gray-800 ring-2 ring-blue-300' : 'border-white'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 bg-gray-50/50 border-t border-gray-100 flex items-center gap-2.5 justify-end">
          <button onClick={onCancel} disabled={loading} className="btn btn-ghost btn-sm text-xs font-bold">
            ยกเลิก
          </button>
          <button
            onClick={() => onSave(layerName, selectedColor)}
            disabled={loading || !layerName.trim()}
            className="btn btn-primary btn-sm text-white font-bold min-w-[100px] shadow-md">
            {loading ? (
              <span className="loading loading-spinner loading-xs"></span>
            ) : (
              <>นำเข้าเลเยอร์</>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

/* ─────────────── Main Component (TaxMapView) ─────────────── */
const TaxMapView = forwardRef(({}, ref) => {
  const [mapKey, setMapKey] = useState(0);
  const [mapInstance, setMapInstance] = useState(null);
  const [geojsonLayers, setGeojsonLayers] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [initialBounds, setInitialBounds] = useState(null);
  const [fitTarget, setFitTarget] = useState(null);
  const [tableLayerId, setTableLayerId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [highlightKey, setHighlightKey] = useState(0);

  const [surveyMode, setSurveyMode] = useState(false);
  const [activeTab, setActiveTab] = useState('layers'); // 'layers', 'survey', 'tools'
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [uploadAssistantFile, setUploadAssistantFile] = useState(null);
  const fileInputRef = useRef(null);

  const [landUseAssignments, setLandUseAssignments] = useState({});
  const [landUseVersion, setLandUseVersion] = useState(0);
  const [showLegend, setShowLegend] = useState(false);
  const [popupInfo, setPopupInfo] = useState(null);

  const [editingLayerId, setEditingLayerId] = useState(null);
  const [editFeatureIdx, setEditFeatureIdx] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const editCollectRef = useRef(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnFeature, setDrawnFeature] = useState(null);

  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureResult, setMeasureResult] = useState(null);
  const [measureKey, setMeasureKey] = useState(0);
  const [measureNote, setMeasureNote] = useState('');
  const [bulkType, setBulkType] = useState('agriculture');
  const [measureSaving, setMeasureSaving] = useState(false);
  const [colorPickerLayerId, setColorPickerLayerId] = useState(null);
  const [layerToDelete, setLayerToDelete] = useState(null);
  const measuringRef = useRef(false);

  const MEASUREMENTS_FILENAME = 'measurements.geojson';
  const defaultCenter = [13.7563, 100.5018];
  const defaultZoom = 12;
  const tableLayer = geojsonLayers.find((l) => l.id === tableLayerId) || null;

  // Invalidate map size on sidebar toggle and table display toggle
  useEffect(() => {
    if (mapInstance && !mapInstance._removed) {
      const t = setTimeout(() => {
        if (mapInstance && !mapInstance._removed && mapInstance._loaded && mapInstance._mapPane) {
          try {
            mapInstance.invalidateSize({ animate: true });
          } catch (err) {
            console.warn('Failed to invalidate map size:', err);
          }
        }
      }, 350);
      return () => clearTimeout(t);
    }
  }, [sidebarOpen, tableLayerId, mapInstance]);

  useEffect(() => { loadLandUseData(); }, []);
  useEffect(() => { if (surveyMode) setShowLegend(true); else { setShowLegend(false); setPopupInfo(null); } }, [surveyMode]);
  useEffect(() => { measuringRef.current = isMeasuring; }, [isMeasuring]);

  useEffect(() => {
    if (!colorPickerLayerId) return;
    const close = () => setColorPickerLayerId(null);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [colorPickerLayerId]);

  const loadLandUseData = async () => {
    try {
      const res = await fetch('/api/land-use');
      if (!res.ok) return;
      const data = await res.json();
      setLandUseAssignments(data.assignments || {});
    } catch { /* ignore */ }
  };

  const assignLandUse = async (parcelCode, luData) => {
    const normalized = (typeof luData === 'object' && !Array.isArray(luData) && luData.types)
      ? luData
      : { types: Array.isArray(luData) ? luData : luData ? [luData] : [], areas: {} };

    setLandUseAssignments((prev) => {
      const copy = { ...prev };
      if (normalized.types.length === 0) delete copy[parcelCode];
      else copy[parcelCode] = normalized;
      return copy;
    });

    try {
      await fetch('/api/land-use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parcelCode, landUse: normalized.types.length === 0 ? '' : normalized }),
      });
    } catch { /* ignore */ }

    setPopupInfo(null);
    setSelectedFeature(null);
    setLandUseVersion((prev) => prev + 1);
  };

  const allParcelCodes = useMemo(() => {
    const codes = new Set();
    geojsonLayers.forEach((ly) => {
      (ly.data?.features || []).forEach((f) => {
        const code = getParcelCode(f.properties);
        if (code) codes.add(code);
      });
    });
    return Array.from(codes);
  }, [geojsonLayers]);

  const parcelAreaMap = useMemo(() => {
    const map = {};
    geojsonLayers.forEach((ly) => {
      (ly.data?.features || []).forEach((f) => {
        const code = getParcelCode(f.properties);
        const area = getParcelArea(f.properties);
        if (code && area && !map[code]) map[code] = area;
      });
    });
    return map;
  }, [geojsonLayers]);

  const bulkAssignLandUse = useCallback(async (parcelCodes, typeKey) => {
    const bulkAssignments = {};
    parcelCodes.forEach((code) => {
      bulkAssignments[code] = { types: [typeKey], areas: {} };
    });

    setLandUseAssignments((prev) => ({ ...prev, ...bulkAssignments }));
    setLandUseVersion((prev) => prev + 1);

    try {
      await fetch('/api/land-use', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: bulkAssignments }),
      });
    } catch { /* ignore */ }
  }, []);

  const handleMapReady = useCallback((map) => {
    setTimeout(() => { if (map && !map._removed) { map._loaded = true; setMapInstance(map); } }, 100);
  }, []);

  useEffect(() => { loadSavedFiles(); }, []);

  const loadSavedFiles = async () => {
    try {
      setLoadingFiles(true);
      const [filesRes, configRes] = await Promise.all([fetch('/api/geojson'), fetch('/api/geojson-config')]);
      if (!filesRes.ok) return;
      const files = await filesRes.json();
      const colorConfig = configRes.ok ? await configRes.json() : {};
      if (files.length === 0) { setLoadingFiles(false); return; }
      const layers = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const dataRes = await fetch(files[i].url);
          if (!dataRes.ok) continue;
          const data = await dataRes.json();
          const savedColor = colorConfig[files[i].filename];
          const color = savedColor && LAYER_COLORS.includes(savedColor) ? savedColor : LAYER_COLORS[i % LAYER_COLORS.length];
          layers.push({ id: Date.now() + i, name: files[i].filename, data, color, visible: true, featureCount: data.features?.length || 1, savedOnServer: true });
        } catch { /* skip */ }
      }
      if (layers.length > 0) {
        setGeojsonLayers(layers);
        const combined = buildCombinedGeoJSON(layers);
        if (combined) setInitialBounds(combined);
        setMapKey((prev) => prev + 1);
      }
    } catch (err) { console.error('Error loading saved files:', err); } finally { setLoadingFiles(false); }
  };

  const startEdit = (layerId) => {
    setEditingLayerId(layerId);
    setEditFeatureIdx(null);
    setTableLayerId(null);
    setSelectedFeature(null);
    setPopupInfo(null);
  };

  const selectFeatureForEdit = (featureIdx) => {
    setEditFeatureIdx(featureIdx);
  };

  const cancelEditFeature = () => {
    setEditFeatureIdx(null);
    editCollectRef.current = null;
  };

  const exitEditMode = () => {
    setEditingLayerId(null);
    setEditFeatureIdx(null);
    setIsDrawing(false);
    setDrawnFeature(null);
    editCollectRef.current = null;
    setMapKey((prev) => prev + 1);
  };

  const startDrawing = () => {
    setEditFeatureIdx(null);
    setIsDrawing(true);
    setDrawnFeature(null);
  };

  const handleDrawCreated = useCallback((geoFeature) => {
    setIsDrawing(false);
    setDrawnFeature(geoFeature);
  }, []);

  const saveNewFeature = async (props) => {
    const ly = geojsonLayers.find((l) => l.id === editingLayerId);
    if (!ly || !drawnFeature) { setDrawnFeature(null); return; }

    const cleanProps = {};
    Object.entries(props).forEach(([k, v]) => { if (v !== undefined && v !== '') cleanProps[k] = v; });

    const newFeature = { ...drawnFeature, properties: cleanProps };
    const updatedData = {
      ...ly.data,
      features: [...(ly.data.features || []), newFeature],
    };

    setEditSaving(true);
    try {
      const saveRes = await fetch('/api/geojson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: ly.name, data: updatedData }),
      });
      if (!saveRes.ok) {
        showToast('บันทึกไม่สำเร็จ', 'error');
        setEditSaving(false);
        return;
      }
      setGeojsonLayers((prev) =>
        prev.map((l) => l.id === editingLayerId
          ? { ...l, data: updatedData, featureCount: updatedData.features?.length || 1 }
          : l
        )
      );
      setDrawnFeature(null);
      setMapKey((prev) => prev + 1);
      showToast('เพิ่มแปลงใหม่สำเร็จ', 'success');
    } catch {
      showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const cancelNewFeature = () => {
    setDrawnFeature(null);
    setMapKey((prev) => prev + 1);
  };

  const saveEditFeature = async () => {
    if (!editCollectRef.current) return;
    const result = editCollectRef.current();
    if (!result || !result.feature) { cancelEditFeature(); return; }

    const ly = geojsonLayers.find((l) => l.id === editingLayerId);
    if (!ly) { cancelEditFeature(); return; }

    const updatedFeatures = [...(ly.data.features || [])];
    updatedFeatures[result.featureIndex] = result.feature;
    const updatedData = { ...ly.data, features: updatedFeatures };

    setEditSaving(true);
    try {
      const saveRes = await fetch('/api/geojson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: ly.name, data: updatedData }),
      });
      if (!saveRes.ok) {
        showToast('บันทึกไม่สำเร็จ', 'error');
        setEditSaving(false);
        return;
      }
      setGeojsonLayers((prev) =>
        prev.map((l) => l.id === editingLayerId
          ? { ...l, data: updatedData, featureCount: updatedData.features?.length || 1 }
          : l
        )
      );
      setEditFeatureIdx(null);
      editCollectRef.current = null;
      setMapKey((prev) => prev + 1);
      showToast('บันทึกรูปแปลงสำเร็จ', 'success');
    } catch {
      showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetView = () => {
    if (mapInstance && !mapInstance._removed) {
      const combined = buildCombinedGeoJSON(geojsonLayers);
      if (combined) {
        try { const gl = L.geoJSON(combined); const b = gl.getBounds(); if (b.isValid()) { mapInstance.fitBounds(b, { padding: [40, 40], animate: true, duration: 1 }); return; } } catch { /* ignore */ }
      }
      mapInstance.setView(defaultCenter, defaultZoom, { animate: true, duration: 1 });
    }
  };

  const showToast = (msg, type) => {
    if (type === 'success') { setUploadSuccess(msg); setTimeout(() => setUploadSuccess(null), 3000); }
    else setUploadError(msg);
  };

  const savePropTimerRef = useRef(null);

  const updateFeatureProperty = useCallback((featureIdx, col, newValue) => {
    const ly = geojsonLayers.find((l) => l.id === tableLayerId);
    if (!ly) return;

    const updatedFeatures = [...(ly.data.features || [])];
    const feat = updatedFeatures[featureIdx];
    if (!feat) return;

    const numVal = Number(newValue);
    const finalVal = newValue === '' ? null : (!isNaN(numVal) && newValue.trim() !== '' && !/^0\d/.test(newValue.trim())) ? numVal : newValue;

    updatedFeatures[featureIdx] = {
      ...feat,
      properties: { ...feat.properties, [col]: finalVal },
    };
    const updatedData = { ...ly.data, features: updatedFeatures };

    setGeojsonLayers((prev) =>
      prev.map((l) => l.id === tableLayerId ? { ...l, data: updatedData } : l)
    );

    if (savePropTimerRef.current) clearTimeout(savePropTimerRef.current);
    savePropTimerRef.current = setTimeout(async () => {
      try {
        const freshLy = geojsonLayers.find((l) => l.id === tableLayerId);
        const dataToSave = freshLy ? { ...freshLy.data, features: updatedFeatures } : updatedData;
        await fetch('/api/geojson', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: ly.name, data: dataToSave }),
        });
      } catch { /* ignore */ }
    }, 1500);
  }, [geojsonLayers, tableLayerId]);

  const deleteFeature = useCallback(async (featureIdx) => {
    const ly = geojsonLayers.find((l) => l.id === tableLayerId);
    if (!ly) return;

    const updatedFeatures = [...(ly.data.features || [])];
    if (featureIdx < 0 || featureIdx >= updatedFeatures.length) return;

    updatedFeatures.splice(featureIdx, 1);
    const updatedData = { ...ly.data, features: updatedFeatures };

    setGeojsonLayers((prev) =>
      prev.map((l) => l.id === tableLayerId
        ? { ...l, data: updatedData, featureCount: updatedFeatures.length }
        : l
      )
    );
    setSelectedFeature(null);
    setHighlightKey((k) => k + 1);
    setMapKey((prev) => prev + 1);

    try {
      await fetch('/api/geojson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: ly.name, data: updatedData }),
      });
      showToast('ลบแปลงสำเร็จ', 'success');
    } catch {
      showToast('เกิดข้อผิดพลาดในการลบ', 'error');
    }
  }, [geojsonLayers, tableLayerId]);

  const zoomToFeature = useCallback((feature) => {
    setSelectedFeature(feature); setHighlightKey((k) => k + 1);
    if (!mapInstance || mapInstance._removed) return;
    try { const gl = L.geoJSON(feature); const b = gl.getBounds(); if (b.isValid()) mapInstance.fitBounds(b, { padding: [60, 60], maxZoom: 19, animate: true, duration: 0.8 }); } catch { /* ignore */ }
  }, [mapInstance]);

  // Expose upload logic to the file input ref
  useImperativeHandle(ref, () => ({
    handleFileUpload: async (file) => {
      triggerUploadAssistant(file);
    },
    saving,
  }));

  const triggerUploadAssistant = (file) => {
    if (!file) return;
    setUploadError(null);
    if (!file.name.toLowerCase().endsWith('.geojson') && !file.name.toLowerCase().endsWith('.json')) {
      showToast('กรุณาเลือกไฟล์ .geojson หรือ .json', 'error');
      return;
    }
    setUploadAssistantFile(file);
  };

  const handleUploadAssistantSave = async (layerName, color) => {
    if (!uploadAssistantFile) return;
    setSaving(true);

    const file = uploadAssistantFile;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed.type || !['FeatureCollection','Feature','Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'].includes(parsed.type)) {
          showToast('ไฟล์ไม่ใช่ GeoJSON ที่ถูกต้อง', 'error');
          setSaving(false);
          return;
        }

        const safeFilename = layerName.trim().endsWith('.geojson') ? layerName.trim() : `${layerName.trim()}.geojson`;

        try {
          const saveRes = await fetch('/api/geojson', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: safeFilename, data: parsed })
          });
          const saveData = await saveRes.json();
          if (!saveRes.ok) {
            showToast(`บันทึกไม่สำเร็จ: ${saveData.error}`, 'error');
            return;
          }

          // Save color configuration to server
          const config = {};
          geojsonLayers.forEach((l) => { config[l.name] = l.color; });
          config[saveData.filename] = color;
          try {
            await fetch('/api/geojson-config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ config }),
            });
          } catch { /* ignore */ }

          setGeojsonLayers((prev) => [...prev, {
            id: Date.now(),
            name: saveData.filename,
            data: parsed,
            color: color,
            visible: true,
            featureCount: parsed.features?.length || 1,
            savedOnServer: true
          }]);

          setFitTarget(parsed);
          setMapKey((prev) => prev + 1);
          showToast(`บันทึก "${saveData.filename}" สำเร็จ`, 'success');
          setUploadAssistantFile(null);
        } catch {
          showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
        } finally {
          setSaving(false);
        }
      } catch {
        showToast('ไม่สามารถอ่านไฟล์ได้', 'error');
        setSaving(false);
      }
    };
    reader.readAsText(file);
  };

  const confirmRemoveLayer = async () => {
    if (!layerToDelete) return;
    const id = layerToDelete.id;
    setLayerToDelete(null);
    const ly = geojsonLayers.find((l) => l.id === id);
    if (!ly) return;
    if (ly.savedOnServer) { try { await fetch('/api/geojson', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: ly.name }) }); } catch { /* ignore */ } }
    const remaining = geojsonLayers.filter((l) => l.id !== id);
    const config = {};
    remaining.forEach((l) => { config[l.name] = l.color; });
    try { await fetch('/api/geojson-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config }) }); } catch { /* ignore */ }
    if (tableLayerId === id) { setTableLayerId(null); setSelectedFeature(null); }
    setGeojsonLayers(remaining); setMapKey((prev) => prev + 1);
  };

  const toggleLayerVisibility = (id) => {
    setGeojsonLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))); setMapKey((prev) => prev + 1);
  };

  const updateLayerColor = useCallback(async (id, color) => {
    const ly = geojsonLayers.find((l) => l.id === id);
    if (!ly) return;
    setGeojsonLayers((prev) => prev.map((l) => (l.id === id ? { ...l, color } : l)));
    setColorPickerLayerId(null);
    setMapKey((prev) => prev + 1);
    try {
      const config = {};
      geojsonLayers.forEach((l) => { config[l.name] = l.id === id ? color : l.color; });
      await fetch('/api/geojson-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
    } catch { /* ignore */ }
  }, [geojsonLayers]);

  const moveLayer = (id, direction) => {
    setGeojsonLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id); if (idx === -1) return prev;
      const ti = direction === 'up' ? idx - 1 : idx + 1;
      if (ti < 0 || ti >= prev.length) return prev;
      const copy = [...prev]; [copy[idx], copy[ti]] = [copy[ti], copy[idx]]; return copy;
    }); setMapKey((prev) => prev + 1);
  };

  const saveMeasurement = useCallback(async () => {
    const geo = measureResult?.geoJson;
    if (!geo) return;
    setMeasureSaving(true);
    try {
      const feature = {
        ...geo,
        properties: { ...geo.properties, ...(measureNote.trim() ? { note: measureNote.trim() } : {}) },
      };
      const existingLy = geojsonLayers.find((l) => l.name === MEASUREMENTS_FILENAME);
      let data;
      if (existingLy?.data?.features) {
        data = { type: 'FeatureCollection', features: [...existingLy.data.features, feature] };
      } else {
        data = { type: 'FeatureCollection', features: [feature] };
      }
      const res = await fetch('/api/geojson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: MEASUREMENTS_FILENAME, data }),
      });
      const saveData = await res.json();
      if (!res.ok) { showToast(`บันทึกไม่สำเร็จ: ${saveData.error || ''}`, 'error'); return; }
      if (existingLy) {
        setGeojsonLayers((prev) =>
          prev.map((l) => l.name === MEASUREMENTS_FILENAME ? { ...l, data, featureCount: data.features.length } : l)
        );
      } else {
        const color = LAYER_COLORS[geojsonLayers.length % LAYER_COLORS.length];
        setGeojsonLayers((prev) => [...prev, { id: Date.now(), name: MEASUREMENTS_FILENAME, data, color, visible: true, featureCount: 1, savedOnServer: true }]);
      }
      setMeasureKey((k) => k + 1);
      setMeasureResult(null);
      setMeasureNote('');
      showToast('บันทึกการวัดสำเร็จ', 'success');
    } catch {
      showToast('เกิดข้อผิดพลาดในการบันทึก', 'error');
    } finally {
      setMeasureSaving(false);
    }
  }, [measureResult, measureNote, geojsonLayers]);

  const getLandUseStyle = useCallback((feature) => {
    const code = getParcelCode(feature.properties);
    const arr = normalizeLU(code ? landUseAssignments[code] : null);
    const luType = arr[0] ? LAND_USE_MAP[arr[0]] : null;
    if (luType) return { color: luType.color, weight: 2.5, fillColor: luType.fillColor, fillOpacity: 0.5 };
    return { color: '#9ca3af', weight: 1.5, fillColor: '#f3f4f6', fillOpacity: 0.15 };
  }, [landUseAssignments]);

  const geoJsonStyle = useCallback((color) => () => ({ color, weight: 2, fillColor: color, fillOpacity: 0.2 }), []);
  const editSelectStyle = useCallback(() => ({ color: '#f59e0b', weight: 2.5, fillColor: '#fef3c7', fillOpacity: 0.15, dashArray: '4,4' }), []);
  const highlightStyle = { color: '#ef4444', weight: 4, fillColor: '#fbbf24', fillOpacity: 0.45 };

  const editingLayerRef = useRef(null);
  editingLayerRef.current = geojsonLayers.find((l) => l.id === editingLayerId) || null;

  const onEachFeature = useCallback((feature, layer) => {
    if (feature.properties) {
      const entries = Object.entries(feature.properties).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (entries.length > 0) { layer.bindPopup(`<div class="text-xs leading-relaxed font-sans">${entries.slice(0, 10).map(([k, v]) => `<b>${k}:</b> ${v}`).join('<br/>')}</div>`, { maxWidth: 300 }); }
    }
  }, []);

  const onEachFeatureEditSelect = useCallback((feature, layer) => {
    const code = getParcelCode(feature.properties);
    const label = code || 'ไม่ทราบรหัส';
    layer.bindTooltip(`คลิกเพื่อแก้ไขรูปแปลง: ${label}`, { sticky: true, className: 'text-xs font-sans' });

    layer.on('click', () => {
      const ly = editingLayerRef.current;
      if (!ly?.data?.features) return;
      const idx = ly.data.features.findIndex((f) => f === feature);
      if (idx !== -1) selectFeatureForEdit(idx);
    });

    layer.on('mouseover', () => {
      layer.setStyle({ weight: 4, fillOpacity: 0.4, fillColor: '#fbbf24' });
    });
    layer.on('mouseout', () => {
      layer.setStyle({ weight: 2.5, fillOpacity: 0.15, fillColor: '#fef3c7', dashArray: '4,4' });
    });
  }, []);

  const onEachFeatureSurvey = useCallback((feature, layer) => {
    if (feature.properties) {
      const code = getParcelCode(feature.properties);
      const luData = normalizeLUFull(code ? landUseAssignments[code] : null);

      const entries = Object.entries(feature.properties).filter(([, v]) => v !== null && v !== undefined && v !== '');
      let html = entries.length > 0 ? entries.slice(0, 8).map(([k, v]) => `<b>${k}:</b> ${v}`).join('<br/>') : '';
      if (luData.types.length > 0) {
        const badges = luData.types.map((key, i) => {
          const t = LAND_USE_MAP[key];
          const areaStr = luData.areas[key] ? ` (${luData.areas[key]})` : '';
          return t ? `<span style="background:${t.fillColor};color:${t.color};padding:2px 6px;border-radius:99px;font-size:9px;font-weight:bold;margin-right:2px;display:inline-block;">${t.icon} ${t.label}${areaStr}${i === 0 ? ' ★' : ''}</span>` : key;
        }).join(' ');
        html = `<div style="margin-bottom:6px;border-bottom:1px solid #f3f4f6;padding-bottom:6px;">${badges}</div>${html}`;
      }
      if (html) layer.bindPopup(`<div class="text-xs leading-relaxed font-sans">${html}</div>`, { maxWidth: 360 });

      layer.on('click', (e) => {
        if (measuringRef.current) return;
        if (!code) return;
        const cp = e.containerPoint || { x: 200, y: 200 };
        setPopupInfo({
          parcelCode: code,
          currentTypes: luData.types,
          currentAreas: luData.areas,
          totalArea: getParcelArea(feature.properties),
          properties: feature.properties,
          position: { x: cp.x, y: cp.y },
        });
      });
    }
  }, [landUseAssignments]);

  const showTable = tableLayerId !== null;

  // Compute Land Use Stats for Dashboard in Sidebar
  const stats = useMemo(() => {
    const counts = {};
    const areaWah = {};
    LAND_USE_TYPES.forEach((t) => { counts[t.key] = 0; areaWah[t.key] = 0; });
    let assigned = 0;

    Object.entries(landUseAssignments).forEach(([code, val]) => {
      const { types, areas } = normalizeLUFull(val);
      if (types.length === 0) return;
      assigned++;

      const hasExplicitArea = Object.values(areas).some((a) => parseAreaToWah(a) > 0);
      const parcelTotalArea = parcelAreaMap?.[code] || null;

      types.forEach((v, i) => {
        if (counts[v] === undefined) return;
        counts[v]++;

        if (hasExplicitArea) {
          areaWah[v] += parseAreaToWah(areas[v]);
        } else if (i === 0 && parcelTotalArea) {
          areaWah[v] += parseAreaToWah(parcelTotalArea);
        }
      });
    });

    const unassigned = allParcelCodes.filter((c) => !landUseAssignments[c] || normalizeLUFull(landUseAssignments[c]).types.length === 0);
    return { counts, areaWah, assigned, total: allParcelCodes.length, unassigned };
  }, [landUseAssignments, allParcelCodes, parcelAreaMap]);

  // Drag and Drop support
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) triggerUploadAssistant(file);
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="relative w-full h-full flex bg-gray-50 overflow-hidden font-sans select-none">
      
      {/* 1. Left Sidebar */}
      <div className={`flex flex-col bg-white border-r border-gray-200 transition-all duration-300 relative z-30 ${sidebarOpen ? 'w-80 md:w-[350px]' : 'w-0 overflow-hidden border-r-0'}`}>
        
        {/* Sidebar Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="bg-blue-100 p-1.5 rounded-lg text-blue-600">
              <Layers size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-800">เครื่องมือแผนที่ภาษี</h2>
              <p className="text-[10px] text-gray-400 font-medium">Smart Saard Workspace</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="btn btn-circle btn-ghost btn-xs text-gray-400 hover:text-gray-600">
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-gray-100 bg-gray-50/20 text-xs">
          <button onClick={() => setActiveTab('layers')}
            className={`flex-1 py-3 text-center font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'layers' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <Layers size={14} />
            <span>เลเยอร์ ({geojsonLayers.length})</span>
          </button>
          <button onClick={() => { setActiveTab('survey'); setSurveyMode(true); }}
            className={`flex-1 py-3 text-center font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'survey' ? 'border-green-600 text-green-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <MapPin size={14} />
            <span>สำรวจที่ดิน</span>
          </button>
          <button onClick={() => setActiveTab('tools')}
            className={`flex-1 py-3 text-center font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'tools' ? 'border-amber-600 text-amber-600 bg-white' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            <Wrench size={14} />
            <span>เครื่องมือ</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* TAB 1: LAYERS */}
          {activeTab === 'layers' && (
            <div className="space-y-4 animate-fade-in">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={triggerFileSelect}
                className="border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50/20 rounded-2xl p-5 text-center cursor-pointer transition-all duration-200 group flex flex-col items-center justify-center gap-2"
              >
                <div className="bg-blue-50 p-2.5 rounded-full text-blue-500 group-hover:scale-110 transition-transform">
                  <UploadCloud size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-700">อัปโหลดไฟล์ GeoJSON</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อค้นหา</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".geojson,.json"
                  onChange={(e) => triggerUploadAssistant(e.target.files?.[0])}
                  className="hidden"
                />
              </div>

              {/* Layer list */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">รายชื่อเลเยอร์</span>
                {geojsonLayers.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">ยังไม่มีเลเยอร์แผนที่นำเข้า</p>
                ) : (
                  <div className="space-y-1.5">
                    {geojsonLayers.map((ly, index) => (
                      <div key={ly.id} className={`flex items-center gap-2 p-2.5 rounded-xl border transition-all ${tableLayerId === ly.id ? 'bg-blue-50/40 border-blue-200' : 'bg-white border-gray-100 hover:border-gray-200'}`}>
                        {/* Layer order arrows */}
                        <div className="flex flex-col flex-shrink-0 text-gray-400">
                          <button onClick={() => moveLayer(ly.id, 'up')} disabled={index === 0} className={`text-[10px] p-0.5 disabled:opacity-30 ${index === 0 ? '' : 'hover:text-blue-500'}`}>▲</button>
                          <button onClick={() => moveLayer(ly.id, 'down')} disabled={index === geojsonLayers.length - 1} className={`text-[10px] p-0.5 disabled:opacity-30 ${index === geojsonLayers.length - 1 ? '' : 'hover:text-blue-500'}`}>▼</button>
                        </div>
                        {/* Color bubble */}
                        <div className="relative flex-shrink-0">
                          <button
                            onClick={() => setColorPickerLayerId((prev) => (prev === ly.id ? null : ly.id))}
                            className="w-4 h-4 rounded-full border-2 border-white shadow hover:scale-105 transition-all"
                            style={{ backgroundColor: ly.color }}
                            title="เปลี่ยนสีเลเยอร์"
                          />
                          {colorPickerLayerId === ly.id && (
                            <div className="absolute left-0 top-6 z-[1000] bg-white rounded-xl shadow-2xl border border-gray-100 p-2 flex flex-wrap gap-1.5 w-36">
                              {LAYER_COLORS.map((c) => (
                                <button
                                  key={c}
                                  onClick={() => updateLayerColor(ly.id, c)}
                                  className={`w-5 h-5 rounded-full border-2 transition-all hover:scale-110 ${ly.color === c ? 'border-gray-800 scale-105' : 'border-white'}`}
                                  style={{ backgroundColor: c }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        {/* Title details */}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-gray-800 truncate" title={ly.name}>{ly.name}</p>
                          <p className="text-[10px] text-gray-400 font-semibold">{ly.featureCount} แปลง • {ly.savedOnServer ? 'เซิร์ฟเวอร์' : 'ชั่วคราว'}</p>
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setTableLayerId((prev) => (prev === ly.id ? null : ly.id)); setSelectedFeature(null); setHighlightKey((k) => k + 1); }}
                            className={`btn btn-ghost btn-xs btn-circle ${tableLayerId === ly.id ? 'text-blue-600' : 'text-gray-400 hover:text-blue-600'}`} title="เปิดตารางแอตทริบิวต์">
                            <Table size={13} />
                          </button>
                          <button onClick={() => startEdit(ly.id)} disabled={!!editingLayerId}
                            className={`btn btn-ghost btn-xs btn-circle ${editingLayerId === ly.id ? 'text-amber-600' : 'text-gray-400 hover:text-amber-600'}`} title="แก้ไขพิกัดรูปแปลง">
                            ✏️
                          </button>
                          <button onClick={() => toggleLayerVisibility(ly.id)} className="btn btn-ghost btn-xs btn-circle text-gray-400 hover:text-blue-500" title={ly.visible ? 'ซ่อนเลเยอร์' : 'แสดงเลเยอร์'}>
                            {ly.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setLayerToDelete({ id: ly.id, name: ly.name }); }} disabled={!!editingLayerId}
                            className="btn btn-ghost btn-xs btn-circle text-gray-400 hover:text-red-500" title="ลบเลเยอร์">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SURVEY MODE */}
          {activeTab === 'survey' && (
            <div className="space-y-4 animate-fade-in">
              {/* Toggle switch */}
              <div className="bg-green-50/50 border border-green-100 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🌍</span>
                  <div>
                    <span className="text-xs font-bold text-green-800 block">สำรวจการใช้ประโยชน์ที่ดิน</span>
                    <span className="text-[10px] text-green-600 font-semibold">{surveyMode ? 'กำลังทำงาน...' : 'ปิดการแสดงผล'}</span>
                  </div>
                </div>
                <input type="checkbox" checked={surveyMode} onChange={(e) => setSurveyMode(e.target.checked)} className="toggle toggle-success toggle-sm" />
              </div>

              {surveyMode && (
                <>
                  {/* Progress dashboard card */}
                  <div className="bg-white border border-gray-100 shadow-sm rounded-2xl p-4 space-y-3">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">ความคืบหน้าการสำรวจ</span>
                    <div className="flex justify-between items-end">
                      <div>
                        <span className="text-2xl font-black text-gray-800 font-mono">{stats.assigned}</span>
                        <span className="text-xs text-gray-400 font-semibold"> / {stats.total} แปลง</span>
                      </div>
                      <span className="text-sm font-black text-green-600 font-mono">{Math.round((stats.assigned / (stats.total || 1)) * 100)}%</span>
                    </div>
                    {/* Completion bar */}
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${(stats.assigned / (stats.total || 1)) * 100}%` }} />
                    </div>
                    {stats.unassigned.length > 0 && (
                      <p className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5">
                        <AlertTriangle size={10} />
                        <span>เหลือแปลงที่ดินที่ยังไม่ได้สำรวจอีก {stats.unassigned.length} แปลง</span>
                      </p>
                    )}
                  </div>

                  {/* Distribution break downs */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">สรุปประเภทการใช้งาน</span>
                    <div className="space-y-1">
                      {LAND_USE_TYPES.map((type) => (
                        <div key={type.key} className="flex items-center gap-2 text-xs p-1.5 rounded-lg hover:bg-gray-50 transition-colors">
                          <div className="w-4 h-3 rounded shadow-sm flex-shrink-0" style={{ backgroundColor: type.fillColor, border: `1.5px solid ${type.color}` }} />
                          <span className="flex-1 truncate text-gray-700 font-medium">{type.icon} {type.label}</span>
                          <span className="font-bold text-gray-800 font-mono w-12 text-right">{stats.counts[type.key]} แปลง</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Batch Tools Panel */}
                  <div className="border border-gray-100 rounded-2xl p-4 space-y-3 bg-gray-50/50">
                    <span className="text-xs font-bold text-gray-700 block">⚡ เครื่องมือกำหนดค่าแปลงจำนวนมาก</span>
                    
                    <div className="space-y-1.5">
                      <label className="block text-[10px] font-bold text-gray-400 uppercase">ประเภทเป้าหมาย:</label>
                      <select value={bulkType} onChange={(e) => setBulkType(e.target.value)}
                        className="select select-bordered select-sm w-full text-xs font-semibold focus:outline-none bg-white">
                        {LAND_USE_TYPES.map((t) => (
                          <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
                        ))}
                      </select>
                    </div>

                    <button onClick={() => bulkAssignLandUse(stats.unassigned, bulkType)} disabled={saving || stats.unassigned.length === 0}
                      className="btn btn-success btn-sm w-full text-white font-bold shadow-sm disabled:opacity-40">
                      🌿 กำหนดให้แปลงที่เหลือทั้งหมด ({stats.unassigned.length})
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* TAB 3: TOOLS */}
          {activeTab === 'tools' && (
            <div className="space-y-4 animate-fade-in">
              {/* Measurement tool toggle */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-rose-500"><Wrench size={18} /></span>
                    <div>
                      <span className="text-xs font-bold text-gray-800 block">เครื่องมือวัดระยะและพื้นที่</span>
                      <span className="text-[10px] text-gray-400 font-medium">คำนวณพื้นที่แบบ Ellipsoid WGS84</span>
                    </div>
                  </div>
                  <input type="checkbox" checked={isMeasuring} onChange={(e) => {
                    if (e.target.checked) { setIsMeasuring(true); setMeasureKey((k) => k + 1); setMeasureResult(null); }
                    else { setIsMeasuring(false); setMeasureResult(null); }
                  }} className="toggle toggle-error toggle-sm" />
                </div>

                {isMeasuring && (
                  <div className="bg-rose-50/50 border border-rose-100 rounded-xl p-3 text-[11px] text-rose-800 space-y-1">
                    <p className="font-bold flex items-center gap-0.5">💡 วิธีการใช้งาน:</p>
                    <p>1. คลิกบนจุดต่าง ๆ ในแผนที่เพื่อเริ่มลากรูปเหลี่ยม</p>
                    <p>2. ดับเบิลคลิก หรือคลิกจุดแรก เพื่อบรรจบรูปเพื่อวัดขนาด</p>
                    <p>3. คุณสามารถกดล้างจุดเพื่อเริ่มการวัดใหม่ได้</p>
                  </div>
                )}
              </div>

              {/* Editing geometries mode explanation */}
              <div className="bg-white border border-gray-100 shadow-sm rounded-2xl p-4 space-y-3">
                <span className="text-xs font-bold text-gray-800 block">✏️ แก้ไขพิกัดแปลงแปลงที่ดิน</span>
                <p className="text-[10px] text-gray-400 leading-normal">
                  กดปุ่มแก้ไข (✏️) ที่รายการเลเยอร์ในแท็บ &quot;เลเยอร์&quot; เพื่อเข้าสู่โหมดปรับแต่งพิกัดรูปแปลงที่ดิน ซึ่งรองรับการวาดเส้น ลากจุดมุม ดึงเส้น และสร้างแปลงพิกัดใหม่ขึ้นเซิร์ฟเวอร์
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Back Button */}
        <div className="p-4 border-t border-gray-100 bg-gray-50/50">
          <Link href="/admin" className="btn btn-outline btn-sm w-full font-bold">
            กลับหน้าแดชบอร์ดหลัก
          </Link>
        </div>
      </div>

      {/* Sidebar toggle button (floating edge) */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute bottom-20 left-4 md:left-[350px] z-[800] btn btn-circle btn-sm bg-white hover:bg-gray-100 shadow-xl border border-gray-200 transition-all duration-300 transform -translate-x-1/2"
        style={{ left: sidebarOpen ? undefined : '16px' }}
      >
        {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      {/* 2. Main Workspace Block */}
      <div className="flex-1 h-full flex flex-col relative min-w-0">
        
        {/* Map Container Viewport */}
        <div className={`relative w-full ${showTable ? 'h-1/2' : 'h-full'} transition-all duration-300`}>
          
          <MapContainer key={mapKey} center={defaultCenter} zoom={defaultZoom} className="w-full h-full z-1" scrollWheelZoom zoomControl>
            <MapController onMapReady={handleMapReady} />
            {initialBounds && <FitBoundsToGeoJSON geojsonData={initialBounds} />}
            {fitTarget && <FitBoundsToGeoJSON geojsonData={fitTarget} />}
            
            <LayersControl position="bottomleft">
              <BaseLayer checked name="🗺️ แผนที่ถนน"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" /></BaseLayer>
              <BaseLayer name="🛰️ ภาพถ่ายทางอากาศ"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution="Tiles &copy; Esri" /></BaseLayer>
            </LayersControl>

            {geojsonLayers.filter((l) => l.visible && (l.id !== editingLayerId || editFeatureIdx !== null)).map((ly) => {
              const isEditLayer = ly.id === editingLayerId && editFeatureIdx !== null;
              return (
                <SafeGeoJSON key={`geojson-${ly.id}-${mapKey}-${surveyMode ? `survey-${landUseVersion}` : 'normal'}`}
                  data={ly.data}
                  style={isEditLayer ? () => ({ color: '#9ca3af', weight: 1, fillColor: '#e5e7eb', fillOpacity: 0.1 })
                    : surveyMode ? getLandUseStyle : geoJsonStyle(ly.color)}
                  onEachFeature={isEditLayer ? () => {} : surveyMode ? onEachFeatureSurvey : onEachFeature}
                  pointToLayer={(f, ll) => L.circleMarker(ll, { radius: 6, fillColor: ly.color, color: '#fff', weight: 2, fillOpacity: 0.8 })} />
              );
            })}

            {editingLayerId && editFeatureIdx === null && (() => {
              const editLy = geojsonLayers.find((l) => l.id === editingLayerId);
              if (!editLy) return null;
              return (
                <SafeGeoJSON key={`edit-select-${editingLayerId}-${mapKey}`}
                  data={editLy.data} style={editSelectStyle}
                  onEachFeature={onEachFeatureEditSelect}
                  pointToLayer={(f, ll) => L.circleMarker(ll, { radius: 8, fillColor: '#f59e0b', color: '#fff', weight: 2, fillOpacity: 0.8 })} />
              );
            })()}

            {editingLayerId && editFeatureIdx !== null && !isDrawing && (() => {
              const editLy = geojsonLayers.find((l) => l.id === editingLayerId);
              const feat = editLy?.data?.features?.[editFeatureIdx];
              if (!feat) return null;
              return <SingleFeatureEditor feature={feat} featureIndex={editFeatureIdx} onCollect={editCollectRef} />;
            })()}

            {editingLayerId && isDrawing && !drawnFeature && (
              <DrawNewFeature onCreated={handleDrawCreated} />
            )}

            {isMeasuring && <MeasureAreaTool key={`measure-${measureKey}`} onUpdate={setMeasureResult} />}

            {selectedFeature && (
              <SafeGeoJSON key={`highlight-${highlightKey}`} data={selectedFeature} style={() => highlightStyle} onEachFeature={() => {}}
                pointToLayer={(f, ll) => L.circleMarker(ll, { radius: 10, fillColor: '#fbbf24', color: '#ef4444', weight: 3, fillOpacity: 0.8 })} />
            )}
          </MapContainer>

          {/* Loading Overlays */}
          {(loadingFiles || saving || editSaving) && (
            <div className="absolute inset-0 bg-white/60 z-[1000] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 bg-white p-6 rounded-2xl shadow-2xl border border-gray-100">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                <span className="text-xs text-gray-500 font-bold tracking-tight">{editSaving ? 'กำลังบันทึกรูปแปลง...' : saving ? 'กำลังประมวลผลข้อมูล...' : 'กำลังดึงฐานข้อมูล...'}</span>
              </div>
            </div>
          )}

          {/* Map floating panels - Center View & Measure Tool indicator */}
          <div className="absolute top-4 right-4 z-[800] flex flex-col gap-2">
            <button onClick={handleResetView} className="btn btn-sm bg-white hover:bg-gray-100 text-gray-700 font-bold shadow-lg border border-gray-200/50">
              🗺️ จัดกึ่งกลาง
            </button>
          </div>

          {/* Geoman toolbar mode active header overlays */}
          {editingLayerId && editFeatureIdx === null && !isDrawing && !drawnFeature && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[800] bg-amber-50 border border-amber-300 rounded-2xl shadow-xl px-5 py-3.5 flex items-center gap-4 animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="text-amber-500 text-xl">✏️</span>
                <div>
                  <p className="text-xs font-bold text-amber-800">โหมดปรับแต่งพิกัดรูปแปลง</p>
                  <p className="text-[10px] text-amber-600">คลิกที่แปลงบนแผนที่ หรือสร้างวาดแปลงพิกัดรูปขึ้นใหม่</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={startDrawing} className="btn btn-success btn-xs text-white font-bold shadow-sm">
                  วาดแปลงใหม่
                </button>
                <button onClick={exitEditMode} className="btn btn-ghost btn-xs text-xs text-gray-500">
                  ออกโหมดแก้ไข
                </button>
              </div>
            </div>
          )}

          {editingLayerId && isDrawing && !drawnFeature && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[800] bg-green-50 border border-green-300 rounded-2xl shadow-xl px-5 py-3.5 flex items-center gap-4 animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="text-green-500 text-xl">📐</span>
                <div>
                  <p className="text-xs font-bold text-green-800">กำลังวาดพิกัดรูปแปลงใหม่</p>
                  <p className="text-[10px] text-green-600">คลิกเพื่อวางมุมกล้อง — ดับเบิลคลิกเพื่อปิดรูปทรง</p>
                </div>
              </div>
              <button onClick={() => { setIsDrawing(false); setMapKey((prev) => prev + 1); }} className="btn btn-outline btn-xs font-bold">
                ยกเลิกวาด
              </button>
            </div>
          )}

          {editingLayerId && editFeatureIdx !== null && (() => {
            const editLy = geojsonLayers.find((l) => l.id === editingLayerId);
            const feat = editLy?.data?.features?.[editFeatureIdx];
            const code = feat ? getParcelCode(feat.properties) : null;
            return (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[800] bg-amber-50 border border-amber-300 rounded-2xl shadow-xl px-5 py-3.5 flex items-center gap-4 animate-fade-in">
                <div className="flex items-center gap-2">
                  <span className="text-amber-500 text-xl">✏️</span>
                  <div>
                    <p className="text-xs font-bold text-amber-800">แก้ไขพิกัด{code ? `: ${code}` : ` แปลง #${editFeatureIdx + 1}`}</p>
                    <p className="text-[10px] text-amber-600">ลากจุดมุมเพื่อย้ายเส้น — ดับเบิลคลิกบนเส้นเพื่อเพิ่มพิกัดมุมใหม่</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={saveEditFeature} disabled={editSaving} className="btn btn-success btn-xs text-white font-bold shadow-sm">
                    {editSaving ? 'กำลังบันทึก...' : 'บันทึกรูปทรง'}
                  </button>
                  <button onClick={cancelEditFeature} disabled={editSaving} className="btn btn-outline btn-xs font-bold">
                    เลือกแปลงอื่น
                  </button>
                  <button onClick={exitEditMode} disabled={editSaving} className="btn btn-ghost btn-xs text-xs text-gray-500">
                    ออก
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Measuring Mode Dialog */}
          {isMeasuring && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[800] bg-rose-50 border border-rose-300 rounded-2xl shadow-xl px-5 py-3.5 flex flex-wrap items-center gap-3 animate-fade-in max-w-xl">
              <span className="text-rose-500 text-xl">📐</span>
              <div className="min-w-[120px]">
                {measureResult?.closed ? (
                  <>
                    <p className="text-sm font-extrabold text-rose-800 font-mono leading-tight">{measureResult.areaStr} ไร่</p>
                    <p className="text-[10px] text-rose-600 font-semibold">{Number(measureResult.sqm).toLocaleString('th-TH')} ตร.ม.</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-bold text-rose-800">
                      {(measureResult?.pointCount || 0) >= 3 ? 'พร้อมคำนวณเนื้อที่' : 'วัดระยะทาง / พื้นที่'}
                    </p>
                    <p className="text-[10px] text-rose-600 font-medium">
                      {(measureResult?.pointCount || 0) >= 3 ? 'คลิกจุดแรกเพื่อคำนวณพื้นที่' : 'วางจุดบนแผนที่อย่างน้อย 3 จุด'}
                    </p>
                  </>
                )}
              </div>
              {measureResult?.closed && (
                <>
                  <input
                    type="text"
                    placeholder="หมายเหตุ (ถ้ามี)"
                    value={measureNote}
                    onChange={(e) => setMeasureNote(e.target.value)}
                    className="input input-bordered input-sm text-xs font-semibold w-36 focus:outline-none"
                  />
                  <button
                    onClick={saveMeasurement}
                    disabled={measureSaving}
                    className="btn btn-success btn-sm text-white font-bold shadow-sm"
                  >
                    บันทึกการวัด
                  </button>
                </>
              )}
              <button onClick={() => { setMeasureKey((k) => k + 1); setMeasureResult(null); setMeasureNote(''); }} className="btn btn-outline btn-sm font-bold">
                ล้างจุด
              </button>
              <button onClick={() => { setIsMeasuring(false); setMeasureResult(null); setMeasureNote(''); }} className="btn btn-ghost btn-sm text-gray-500 font-bold">
                ปิด
              </button>
            </div>
          )}

          {/* Toast notifications */}
          {uploadSuccess && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-green-600 text-white font-bold px-4 py-2.5 rounded-xl shadow-2xl text-xs animate-bounce">✅ {uploadSuccess}</div>}
          {uploadError && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-red-600 text-white font-bold px-4 py-2.5 rounded-xl shadow-2xl text-xs flex items-center gap-2 animate-fade-in">
              <span>⚠️ {uploadError}</span>
              <button onClick={() => setUploadError(null)} className="btn btn-xs btn-circle btn-ghost text-white">✕</button>
            </div>
          )}

          {/* Land Use Settings Popup drawer (Slide from Right) */}
          <AnimatePresence>
            {surveyMode && popupInfo && (
              <ParcelInspectorPanel
                parcelCode={popupInfo.parcelCode}
                currentTypes={popupInfo.currentTypes}
                currentAreas={popupInfo.currentAreas}
                totalArea={popupInfo.totalArea}
                properties={popupInfo.properties}
                onAssign={(luData) => assignLandUse(popupInfo.parcelCode, luData)}
                onClose={() => setPopupInfo(null)}
              />
            )}
          </AnimatePresence>

          {/* New Shape Props form */}
          {drawnFeature && (
            <NewFeaturePropsForm
              onSave={saveNewFeature}
              onCancel={cancelNewFeature}
            />
          )}

          {/* Mini Legend Overlay on bottom-right of Map (Compact indicator) */}
          {surveyMode && showLegend && (
            <div className="absolute bottom-4 right-4 z-[800] bg-white/95 backdrop-blur-sm px-3.5 py-2.5 rounded-2xl shadow-xl border border-gray-200/50 text-[10px] space-y-1.5 w-40 animate-fade-in">
              <span className="font-bold text-gray-700 block border-b border-gray-100 pb-1">🎨 ประเภทที่ดิน</span>
              <div className="space-y-1 max-h-40 overflow-y-auto font-semibold">
                {LAND_USE_TYPES.map((t) => (
                  <div key={t.key} className="flex items-center gap-1.5">
                    <div className="w-3 h-2.5 rounded-sm" style={{ backgroundColor: t.fillColor, border: `1px solid ${t.color}` }} />
                    <span className="text-gray-600 truncate">{t.icon} {t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3. Bottom Table Drawer */}
        {showTable && (
          <div className="h-1/2 border-t border-gray-200 flex flex-col overflow-hidden bg-white z-20">
            <AttributeTable
              layer={tableLayer}
              onClose={() => { setTableLayerId(null); setSelectedFeature(null); setHighlightKey((k) => k + 1); }}
              onZoomToFeature={zoomToFeature}
              surveyMode={surveyMode}
              landUseAssignments={landUseAssignments}
              onUpdateFeature={updateFeatureProperty}
              onDeleteFeature={deleteFeature}
              onBulkAssign={bulkAssignLandUse}
            />
          </div>
        )}

      </div>

      {/* Popups & Modals */}
      <AnimatePresence>
        {uploadAssistantFile && (
          <GeoJSONUploadAssistant
            file={uploadAssistantFile}
            loading={saving}
            onSave={handleUploadAssistantSave}
            onCancel={() => setUploadAssistantFile(null)}
          />
        )}
      </AnimatePresence>

      {layerToDelete && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/50 backdrop-blur-xs px-4" onClick={() => setLayerToDelete(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-100" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-extrabold text-gray-800 mb-2">🗑️ ยืนยันการลบเลเยอร์</h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              ต้องการลบเลเยอร์ <strong>{layerToDelete.name}</strong> ใช่หรือไม่? การกระทำนี้จะลบไฟล์ต้นฉบับออกจากเซิร์ฟเวอร์อย่างถาวรและไม่สามารถกู้คืนได้
            </p>
            <div className="flex gap-2.5 justify-end">
              <button onClick={() => setLayerToDelete(null)} className="btn btn-sm btn-ghost text-xs font-bold">
                ยกเลิก
              </button>
              <button onClick={confirmRemoveLayer} className="btn btn-sm btn-error text-white font-bold px-4">
                ยืนยันการลบ
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
});

TaxMapView.displayName = 'TaxMapView';
export default TaxMapView;
