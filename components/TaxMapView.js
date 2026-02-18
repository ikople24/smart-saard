import { useEffect, useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';

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
  { key: 'agriculture', label: 'เกษตรกรรม', icon: '🌾', color: '#22c55e', fillColor: '#86efac' },
  { key: 'residential', label: 'ที่อยู่อาศัย', icon: '🏠', color: '#3b82f6', fillColor: '#93c5fd' },
  { key: 'commercial', label: 'พาณิชยกรรม', icon: '🏪', color: '#f59e0b', fillColor: '#fcd34d' },
  { key: 'industrial', label: 'อุตสาหกรรม', icon: '🏭', color: '#8b5cf6', fillColor: '#c4b5fd' },
  { key: 'government', label: 'สถานที่ราชการ', icon: '🏛️', color: '#06b6d4', fillColor: '#67e8f9' },
  { key: 'religious', label: 'ศาสนสถาน', icon: '⛪', color: '#ec4899', fillColor: '#f9a8d4' },
  { key: 'vacant', label: 'รกร้างว่างเปล่า', icon: '🏜️', color: '#9ca3af', fillColor: '#d1d5db' },
  { key: 'other', label: 'อื่นๆ', icon: '📌', color: '#78716c', fillColor: '#d6d3d1' },
];

const LAND_USE_MAP = Object.fromEntries(LAND_USE_TYPES.map((t) => [t.key, t]));

/* ─── Area helpers (ไร่-งาน-ตารางวา) ─── */

const parseAreaToWah = (str) => {
  if (!str || typeof str !== 'string') return 0;
  const parts = str.split('-').map((s) => parseFloat(s) || 0);
  const rai = parts[0] || 0;
  const ngan = parts[1] || 0;
  const wah = parts[2] || 0;
  return rai * 400 + ngan * 100 + wah;
};

const wahToAreaStr = (totalWah) => {
  if (!totalWah || totalWah <= 0) return '0-0-0';
  const rai = Math.floor(totalWah / 400);
  const remain = totalWah - rai * 400;
  const ngan = Math.floor(remain / 100);
  const wah = Math.round((remain - ngan * 100) * 100) / 100;
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

/**
 * Normalize assignment value from any old/new format → { types: string[], areas: Record<string,string> }
 * Supports: string, array, { types, areas }
 */
const normalizeLUFull = (val) => {
  if (!val) return { types: [], areas: {} };
  if (typeof val === 'string') return { types: [val], areas: {} };
  if (Array.isArray(val)) return { types: val, areas: {} };
  if (val.types) return { types: val.types || [], areas: val.areas || {} };
  return { types: [], areas: {} };
};

const normalizeLU = (val) => normalizeLUFull(val).types;

const PAGE_SIZE = 50;

/* ─── Map utilities ─── */

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

/* ─── Single-Feature Geometry Editor (leaflet-geoman) ─── */

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

/* ─── Draw New Feature (leaflet-geoman) ─── */

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

/* ─── New Feature Properties Form ─── */

const NewFeaturePropsForm = ({ onSave, onCancel }) => {
  const [parcelCode, setParcelCode] = useState('');
  const [area, setArea] = useState('');

  return (
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 bg-white rounded-xl shadow-2xl border border-green-300 w-80 overflow-hidden">
      <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex items-center gap-2">
        <span className="text-green-600 text-lg">📝</span>
        <div>
          <p className="text-sm font-semibold text-green-800">กรอกข้อมูลแปลงใหม่</p>
          <p className="text-[10px] text-green-600">กรอกรหัสแปลงและเนื้อที่ (ถ้ามี)</p>
        </div>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">รหัสแปลง (parcel_cod)</label>
          <input type="text" value={parcelCode} onChange={(e) => setParcelCode(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            placeholder="เช่น 1234-56-789" autoFocus />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">เนื้อที่ (ไร่-งาน-ตร.วา)</label>
          <input type="text" value={area} onChange={(e) => setArea(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
            placeholder="เช่น 12-2-41" />
        </div>
      </div>
      <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 bg-gray-50">
        <button onClick={() => onSave({ parcel_cod: parcelCode || undefined, Area: area || undefined })}
          className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors shadow">
          💾 บันทึกแปลงใหม่
        </button>
        <button onClick={onCancel}
          className="px-4 py-2 bg-gray-400 text-white text-sm font-medium rounded-lg hover:bg-gray-500 transition-colors shadow">
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

  const inputCls = "w-12 text-center text-[11px] border border-gray-200 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-green-400";

  return (
    <div className="flex items-center gap-1 py-1">
      <span className="text-[11px] w-16 truncate flex-shrink-0" style={{ color }} title={label}>{icon} {label}</span>
      <input type="text" inputMode="numeric" value={localRai} onChange={(e) => handleChange('rai', e.target.value)} placeholder="ไร่" className={inputCls} />
      <span className="text-gray-400 text-[10px]">-</span>
      <input type="text" inputMode="numeric" value={localNgan} onChange={(e) => handleChange('ngan', e.target.value)} placeholder="งาน" className="w-10 text-center text-[11px] border border-gray-200 rounded py-0.5 focus:outline-none focus:ring-1 focus:ring-green-400" />
      <span className="text-gray-400 text-[10px]">-</span>
      <input type="text" inputMode="decimal" value={localWah} onChange={(e) => handleChange('wah', e.target.value)} placeholder="วา" className={inputCls} />
      {onAutoFill && remainWah > 0 && (
        <button onClick={onAutoFill} className="ml-0.5 px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] rounded hover:bg-green-200 transition-colors flex-shrink-0 font-medium" title="เติมเนื้อที่คงเหลือ">
          Auto
        </button>
      )}
    </div>
  );
};

/* ─────────────── Land Use Assign Popup ─────────────── */

const LandUsePopup = ({ parcelCode, currentTypes, currentAreas, totalArea, position, onAssign, onClose }) => {
  const [selected, setSelected] = useState(currentTypes || []);
  const [areas, setAreas] = useState(currentAreas || {});

  useEffect(() => {
    setSelected(currentTypes || []);
    setAreas(currentAreas || {});
  }, [currentTypes, currentAreas]);

  if (!position) return null;

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
    <div
      className="absolute z-30 bg-white rounded-xl shadow-2xl border border-gray-200 w-80 max-h-[80vh] overflow-y-auto"
      style={{ top: position.y, left: position.x, transform: 'translate(-50%, 8px)' }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-xl z-10">
        <div>
          <p className="text-xs text-gray-500">แปลง</p>
          <p className="text-sm font-bold text-gray-800">{parcelCode || '—'}</p>
          {totalArea && <p className="text-[10px] text-gray-400">เนื้อที่รวม: {totalArea} (ไร่-งาน-วา)</p>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>

      {/* Primary badges */}
      {selected.length > 0 && (
        <div className="px-3 py-1.5 border-b border-gray-100 bg-gray-50">
          <p className="text-[10px] text-gray-500 mb-1">ประเภทหลัก (สีแผนที่) — คลิกเพื่อเปลี่ยน</p>
          <div className="flex flex-wrap gap-1">
            {selected.map((key, i) => {
              const t = LAND_USE_MAP[key];
              if (!t) return null;
              return (
                <button key={key} onClick={() => setPrimary(key)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all ${i === 0 ? 'ring-2 ring-offset-1' : 'opacity-70 hover:opacity-100'}`}
                  style={{ backgroundColor: t.fillColor, color: t.color, ringColor: i === 0 ? t.color : undefined }}
                  title={i === 0 ? 'ประเภทหลัก' : 'คลิกเพื่อตั้งเป็นหลัก'}>
                  {t.icon} {t.label}{i === 0 && <span className="text-[8px]">★</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Type selection grid */}
      <div className="p-2 grid grid-cols-2 gap-1">
        {LAND_USE_TYPES.map((type) => {
          const isSelected = selected.includes(type.key);
          return (
            <button key={type.key} onClick={() => toggle(type.key)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium transition-all border ${isSelected ? 'border-current shadow-sm' : 'border-transparent hover:bg-gray-50'}`}
              style={{ backgroundColor: isSelected ? type.fillColor : undefined, color: isSelected ? type.color : undefined }}>
              <span>{type.icon}</span>
              <span className="truncate">{type.label}</span>
              {isSelected && <span className="ml-auto text-[10px]">✓</span>}
            </button>
          );
        })}
      </div>

      {/* Area allocation */}
      {selected.length > 0 && (
        <div className="px-3 py-2 border-t border-gray-100">
          <p className="text-[10px] text-gray-500 mb-1 font-medium">เนื้อที่แต่ละประเภท (ไร่-งาน-ตร.วา)</p>
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

          {/* Summary bar */}
          {totalWah > 0 && (
            <div className={`mt-1 p-1.5 rounded text-[10px] ${isOverLimit ? 'bg-red-50 text-red-600' : 'bg-gray-50 text-gray-600'}`}>
              <div className="flex justify-between">
                <span>ใช้ไป: <b>{wahToAreaStr(usedWah)}</b></span>
                <span>คงเหลือ: <b className={isOverLimit ? 'text-red-600' : 'text-green-600'}>{wahToAreaStr(Math.max(0, remainWah))}</b></span>
              </div>
              {isOverLimit && <p className="mt-0.5 font-medium">⚠️ เกินเนื้อที่รวม {wahToAreaStr(usedWah - totalWah)}</p>}
              <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (usedWah / totalWah) * 100)}%`, backgroundColor: isOverLimit ? '#ef4444' : '#22c55e' }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-2 sticky bottom-0 bg-white rounded-b-xl">
        <button onClick={handleSave} disabled={isOverLimit}
          className="flex-1 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
          {primaryType ? `บันทึก (${primaryType.icon} ${selected.length > 1 ? `+${selected.length - 1}` : primaryType.label})` : 'บันทึก'}
        </button>
        {selected.length > 0 && (
          <button onClick={handleClear} className="px-2 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors">ล้าง</button>
        )}
      </div>
    </div>
  );
};

/* ─────────────── Legend Panel ─────────────── */

const LandUseLegend = ({ assignments, allParcelCodes, onClose, onBulkAssign }) => {
  const [bulkType, setBulkType] = useState('agriculture');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showBatch, setShowBatch] = useState(false);

  const stats = useMemo(() => {
    const counts = {};
    const areaWah = {};
    LAND_USE_TYPES.forEach((t) => { counts[t.key] = 0; areaWah[t.key] = 0; });
    let assigned = 0;
    Object.values(assignments).forEach((val) => {
      const { types, areas } = normalizeLUFull(val);
      if (types.length > 0) {
        assigned++;
        types.forEach((v) => {
          if (counts[v] !== undefined) {
            counts[v]++;
            areaWah[v] += parseAreaToWah(areas[v]);
          }
        });
      }
    });
    const total = allParcelCodes.length;
    const unassigned = allParcelCodes.filter((c) => !assignments[c] || normalizeLUFull(assignments[c]).types.length === 0);
    return { counts, areaWah, assigned, total, unassigned };
  }, [assignments, allParcelCodes]);

  const handleBulk = async (targetCodes) => {
    if (targetCodes.length === 0) return;
    const t = LAND_USE_MAP[bulkType];
    const label = t ? `${t.icon} ${t.label}` : bulkType;
    if (!window.confirm(`กำหนด "${label}" ให้ ${targetCodes.length} แปลง ที่เลือก?`)) return;
    setBulkBusy(true);
    try {
      await onBulkAssign(targetCodes, bulkType);
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="absolute bottom-4 right-4 z-10 bg-white rounded-lg shadow-lg border border-gray-200 w-72 max-h-[80vh] overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10 rounded-t-lg">
        <h4 className="text-xs font-semibold text-gray-700">สำรวจการใช้ที่ดิน</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm">&times;</button>
      </div>

      <div className="p-2 space-y-1">
        {LAND_USE_TYPES.map((type) => (
          <div key={type.key} className="flex items-center gap-2 text-xs">
            <div className="w-4 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: type.fillColor, border: `1.5px solid ${type.color}` }} />
            <span className="flex-1 truncate">{type.icon} {type.label}</span>
            <span className="font-mono text-gray-500 text-[10px] w-12 text-right">{stats.counts[type.key]} แปลง</span>
            {stats.areaWah[type.key] > 0 && (
              <span className="font-mono text-gray-400 text-[10px] w-16 text-right">{wahToAreaStr(stats.areaWah[type.key])}</span>
            )}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-gray-100 text-xs text-gray-500">
        สำรวจแล้ว <span className="font-semibold text-gray-700">{stats.assigned}</span> / {stats.total} แปลง
        {stats.unassigned.length > 0 && (
          <span className="ml-1 text-amber-600 font-medium">(เหลือ {stats.unassigned.length})</span>
        )}
      </div>

      {/* Batch tools */}
      <div className="px-3 py-2 border-t border-gray-200">
        <button onClick={() => setShowBatch(!showBatch)}
          className="w-full text-xs text-left font-semibold text-gray-700 flex items-center justify-between hover:text-blue-600 transition-colors">
          <span>⚡ เครื่องมือกำหนดเป็นชุด</span>
          <span className="text-[10px]">{showBatch ? '▲' : '▼'}</span>
        </button>

        {showBatch && (
          <div className="mt-2 space-y-2">
            <div>
              <label className="block text-[10px] text-gray-500 mb-1">ประเภทที่ต้องการกำหนด</label>
              <select value={bulkType} onChange={(e) => setBulkType(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded-lg py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-green-500">
                {LAND_USE_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>

            <button onClick={() => handleBulk(stats.unassigned)} disabled={bulkBusy || stats.unassigned.length === 0}
              className="w-full px-3 py-2 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm">
              {bulkBusy ? '⏳ กำลังดำเนินการ...' : `🌾 กำหนดแปลงที่เหลือ (${stats.unassigned.length} แปลง)`}
            </button>

            <div className="flex gap-1.5">
              {LAND_USE_TYPES.slice(0, 4).map((fromType) => {
                const codesOfType = allParcelCodes.filter((c) => {
                  const arr = normalizeLU(assignments[c]);
                  return arr.length > 0 && arr[0] === fromType.key;
                });
                if (codesOfType.length === 0 || fromType.key === bulkType) return null;
                return (
                  <button key={fromType.key}
                    onClick={() => {
                      const t = LAND_USE_MAP[bulkType];
                      const label = t ? `${t.icon} ${t.label}` : bulkType;
                      if (!window.confirm(`เปลี่ยน "${fromType.icon} ${fromType.label}" (${codesOfType.length} แปลง) → "${label}"?`)) return;
                      setBulkBusy(true);
                      onBulkAssign(codesOfType, bulkType).finally(() => setBulkBusy(false));
                    }}
                    disabled={bulkBusy}
                    className="flex-1 px-1 py-1.5 text-[10px] rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors disabled:opacity-40 text-center"
                    title={`เปลี่ยน ${fromType.label} → ${LAND_USE_MAP[bulkType]?.label}`}>
                    {fromType.icon}→{LAND_USE_MAP[bulkType]?.icon}<br /><span className="text-gray-400">{codesOfType.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─────────────── Attribute Table ─────────────── */

const AttributeTable = ({ layer, onClose, onZoomToFeature, surveyMode, landUseAssignments, onUpdateFeature, onDeleteFeature }) => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedRow, setSelectedRow] = useState(null);
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filterLandUse, setFilterLandUse] = useState('all');
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState('');

  const features = useMemo(() => layer?.data?.features || [], [layer]);

  const columns = useMemo(() => {
    const colSet = new Set();
    features.forEach((f) => { if (f.properties) Object.keys(f.properties).forEach((k) => colSet.add(k)); });
    return Array.from(colSet);
  }, [features]);

  const filtered = useMemo(() => {
    let result = features;
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
  }, [features, search, surveyMode, filterLandUse, landUseAssignments]);

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

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => { setPage(0); setSelectedRow(null); }, [search, sortCol, sortAsc, filterLandUse]);

  const handleSort = (col) => {
    if (sortCol === col) setSortAsc((prev) => !prev);
    else { setSortCol(col); setSortAsc(true); }
  };

  const handleRowClick = (feature, idx) => {
    setSelectedRow(page * PAGE_SIZE + idx);
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

  if (!layer) return null;

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between flex-shrink-0 bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: layer.color }} />
            <h3 className="text-sm font-semibold text-gray-800 truncate max-w-[200px]" title={layer.name}>{layer.name}</h3>
          </div>
          <span className="text-xs text-gray-500">{sorted.length === features.length ? `${features.length} แถว` : `${sorted.length} / ${features.length} แถว`}</span>
          {onUpdateFeature && <span className="text-[10px] text-blue-400">ดับเบิลคลิกเพื่อแก้ไข</span>}
        </div>
        <div className="flex items-center gap-2">
          {surveyMode && (
            <select value={filterLandUse} onChange={(e) => setFilterLandUse(e.target.value)} className="text-xs border border-gray-300 rounded-md py-1 px-2 focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="all">ทั้งหมด</option>
              <option value="unassigned">ยังไม่สำรวจ</option>
              {LAND_USE_TYPES.map((t) => (<option key={t.key} value={t.key}>{t.icon} {t.label}</option>))}
            </select>
          )}
          <div className="relative">
            <input type="text" placeholder="ค้นหา..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 pr-3 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 w-40" />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
          </div>
          <button onClick={onClose} className="px-2 py-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded text-sm" title="ปิดตาราง">✕</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {columns.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">ไม่มีข้อมูล properties</div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-100">
                <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-r border-gray-200 w-10">#</th>
                {surveyMode && <th className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-r border-gray-200 min-w-[180px]">การใช้ที่ดิน / เนื้อที่</th>}
                {columns.map((col) => (
                  <th key={col} onClick={() => handleSort(col)} className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-r border-gray-200 cursor-pointer hover:bg-gray-200 whitespace-nowrap select-none">
                    {col}{sortCol === col && <span className="ml-1 text-blue-500">{sortAsc ? '▲' : '▼'}</span>}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b border-r border-gray-200 w-10">📍</th>
                {onDeleteFeature && <th className="px-3 py-2 text-center font-semibold text-gray-600 border-b border-gray-200 w-10">🗑️</th>}
              </tr>
            </thead>
            <tbody>
              {paged.map((feature, idx) => {
                const globalIdx = page * PAGE_SIZE + idx;
                const isSelected = selectedRow === globalIdx;
                const code = getParcelCode(feature.properties);
                const luData = normalizeLUFull(code ? landUseAssignments[code] : null);

                return (
                  <tr key={globalIdx} onClick={() => handleRowClick(feature, idx)}
                    className={`cursor-pointer transition-colors ${isSelected ? 'bg-blue-100' : idx % 2 === 0 ? 'bg-white hover:bg-gray-50' : 'bg-gray-50/50 hover:bg-gray-100'}`}>
                    <td className="px-3 py-1.5 text-gray-400 border-r border-gray-100 font-mono">{globalIdx + 1}</td>
                    {surveyMode && (
                      <td className="px-1.5 py-1 border-r border-gray-100" onClick={(e) => e.stopPropagation()}>
                        {luData.types.length === 0 ? (
                          <span className="text-gray-300 text-[10px]">— ยังไม่สำรวจ</span>
                        ) : (
                          <div className="flex flex-wrap gap-0.5">
                            {luData.types.map((key, i) => {
                              const t = LAND_USE_MAP[key];
                              if (!t) return null;
                              const areaStr = luData.areas[key];
                              return (
                                <span key={key}
                                  className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-medium ${i === 0 ? 'ring-1 ring-offset-0' : 'opacity-80'}`}
                                  style={{ backgroundColor: t.fillColor, color: t.color, ringColor: i === 0 ? t.color : undefined }}
                                  title={`${t.label}${areaStr ? ` (${areaStr})` : ''}${i === 0 ? ' (หลัก)' : ''}`}>
                                  {t.icon}{i === 0 && '★'}{areaStr && <span className="ml-0.5 opacity-80">{areaStr}</span>}
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
                        <td key={col} className="px-3 py-1.5 border-r border-gray-100 max-w-[200px]"
                          title={!isEditing ? (val != null ? String(val) : '') : undefined}
                          onDoubleClick={(e) => onUpdateFeature && startCellEdit(realIdx, col, val, e)}>
                          {isEditing ? (
                            <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                              onBlur={commitCellEdit} onKeyDown={handleEditKeyDown} autoFocus
                              className="w-full px-1 py-0.5 text-xs border border-blue-400 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 bg-blue-50" />
                          ) : (
                            <span className={`block truncate ${onUpdateFeature ? 'cursor-text' : ''}`}>
                              {val != null ? String(val) : <span className="text-gray-300">—</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-center border-r border-gray-100">
                      <button onClick={(e) => { e.stopPropagation(); handleRowClick(feature, idx); }} className="text-blue-500 hover:text-blue-700" title="ซูมไปที่ feature">📍</button>
                    </td>
                    {onDeleteFeature && (
                      <td className="px-3 py-1.5 text-center">
                        <button onClick={(e) => {
                          e.stopPropagation();
                          const realIdx = features.indexOf(feature);
                          const code = getParcelCode(feature.properties);
                          const label = code || `แปลง #${realIdx + 1}`;
                          if (window.confirm(`ต้องการลบ "${label}" ใช่หรือไม่?`)) {
                            onDeleteFeature(realIdx);
                            setSelectedRow(null);
                          }
                        }} className="text-gray-400 hover:text-red-600 transition-colors" title="ลบแปลงนี้">🗑️</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="px-4 py-2 border-t border-gray-200 flex items-center justify-between flex-shrink-0 bg-gray-50 text-xs">
          <span className="text-gray-500">หน้า {page + 1} / {totalPages}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0} className={`px-2 py-1 rounded ${page === 0 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-200'}`}>«</button>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className={`px-2 py-1 rounded ${page === 0 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-200'}`}>‹</button>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className={`px-2 py-1 rounded ${page >= totalPages - 1 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-200'}`}>›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1} className={`px-2 py-1 rounded ${page >= totalPages - 1 ? 'text-gray-300' : 'text-gray-600 hover:bg-gray-200'}`}>»</button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─────────────── TaxMapView ─────────────── */

const TaxMapView = forwardRef(({ onLayerCountChange, surveyMode }, ref) => {
  const [mapKey, setMapKey] = useState(0);
  const [mapInstance, setMapInstance] = useState(null);
  const [geojsonLayers, setGeojsonLayers] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [showPanel, setShowPanel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [initialBounds, setInitialBounds] = useState(null);
  const [fitTarget, setFitTarget] = useState(null);
  const [tableLayerId, setTableLayerId] = useState(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [highlightKey, setHighlightKey] = useState(0);

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

  const defaultCenter = [13.7563, 100.5018];
  const defaultZoom = 12;
  const tableLayer = geojsonLayers.find((l) => l.id === tableLayerId) || null;

  useEffect(() => { onLayerCountChange?.(geojsonLayers.length); }, [geojsonLayers.length, onLayerCountChange]);
  useEffect(() => { loadLandUseData(); }, []);
  useEffect(() => { if (surveyMode) setShowLegend(true); else { setShowLegend(false); setPopupInfo(null); } }, [surveyMode]);

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
      const res = await fetch('/api/geojson');
      if (!res.ok) return;
      const files = await res.json();
      if (files.length === 0) { setLoadingFiles(false); return; }
      const layers = [];
      for (let i = 0; i < files.length; i++) {
        try {
          const dataRes = await fetch(files[i].url);
          if (!dataRes.ok) continue;
          const data = await dataRes.json();
          layers.push({ id: Date.now() + i, name: files[i].filename, data, color: LAYER_COLORS[i % LAYER_COLORS.length], visible: true, featureCount: data.features?.length || 1, savedOnServer: true });
        } catch { /* skip */ }
      }
      if (layers.length > 0) {
        setGeojsonLayers(layers); setShowPanel(true);
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

  useImperativeHandle(ref, () => ({
    handleFileUpload: async (file) => {
      if (!file) return;
      setUploadError(null);
      if (!file.name.toLowerCase().endsWith('.geojson') && !file.name.toLowerCase().endsWith('.json')) { showToast('กรุณาเลือกไฟล์ .geojson หรือ .json', 'error'); return; }
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (!parsed.type || !['FeatureCollection','Feature','Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon','GeometryCollection'].includes(parsed.type)) { showToast('ไฟล์ไม่ใช่ GeoJSON ที่ถูกต้อง', 'error'); return; }
          setSaving(true);
          try {
            const saveRes = await fetch('/api/geojson', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, data: parsed }) });
            const saveData = await saveRes.json();
            if (!saveRes.ok) { showToast(`บันทึกไม่สำเร็จ: ${saveData.error}`, 'error'); return; }
            setGeojsonLayers((prev) => [...prev, { id: Date.now(), name: saveData.filename, data: parsed, color: LAYER_COLORS[prev.length % LAYER_COLORS.length], visible: true, featureCount: parsed.features?.length || 1, savedOnServer: true }]);
            setShowPanel(true); setFitTarget(parsed); setMapKey((prev) => prev + 1);
            showToast(`บันทึก "${saveData.filename}" สำเร็จ`, 'success');
          } catch { showToast('เกิดข้อผิดพลาดในการบันทึก', 'error'); } finally { setSaving(false); }
        } catch { showToast('ไม่สามารถอ่านไฟล์ได้', 'error'); }
      };
      reader.readAsText(file);
    },
    saving,
  }));

  const removeLayer = async (id) => {
    const ly = geojsonLayers.find((l) => l.id === id);
    if (ly?.savedOnServer) { try { await fetch('/api/geojson', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: ly.name }) }); } catch { /* ignore */ } }
    if (tableLayerId === id) { setTableLayerId(null); setSelectedFeature(null); }
    setGeojsonLayers((prev) => prev.filter((l) => l.id !== id)); setMapKey((prev) => prev + 1);
  };

  const toggleLayerVisibility = (id) => {
    setGeojsonLayers((prev) => prev.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))); setMapKey((prev) => prev + 1);
  };

  const moveLayer = (id, direction) => {
    setGeojsonLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id); if (idx === -1) return prev;
      const ti = direction === 'up' ? idx - 1 : idx + 1;
      if (ti < 0 || ti >= prev.length) return prev;
      const copy = [...prev]; [copy[idx], copy[ti]] = [copy[ti], copy[idx]]; return copy;
    }); setMapKey((prev) => prev + 1);
  };

  const removeAllLayers = async () => {
    for (const ly of geojsonLayers) { if (ly.savedOnServer) { try { await fetch('/api/geojson', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: ly.name }) }); } catch { /* ignore */ } } }
    setTableLayerId(null); setSelectedFeature(null); setGeojsonLayers([]); setMapKey((prev) => prev + 1);
  };

  const getLandUseStyle = useCallback((feature) => {
    const code = getParcelCode(feature.properties);
    const arr = normalizeLU(code ? landUseAssignments[code] : null);
    const luType = arr[0] ? LAND_USE_MAP[arr[0]] : null;
    if (luType) return { color: luType.color, weight: 2, fillColor: luType.fillColor, fillOpacity: 0.5 };
    return { color: '#6b7280', weight: 1, fillColor: '#e5e7eb', fillOpacity: 0.15 };
  }, [landUseAssignments]);

  const geoJsonStyle = useCallback((color) => () => ({ color, weight: 2, fillColor: color, fillOpacity: 0.2 }), []);
  const editSelectStyle = useCallback(() => ({ color: '#f59e0b', weight: 2, fillColor: '#fef3c7', fillOpacity: 0.15, dashArray: '4,4' }), []);
  const highlightStyle = { color: '#ef4444', weight: 4, fillColor: '#fbbf24', fillOpacity: 0.45 };

  const editingLayerRef = useRef(null);
  editingLayerRef.current = geojsonLayers.find((l) => l.id === editingLayerId) || null;

  const onEachFeature = useCallback((feature, layer) => {
    if (feature.properties) {
      const entries = Object.entries(feature.properties).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (entries.length > 0) { layer.bindPopup(`<div class="text-xs leading-relaxed">${entries.slice(0, 10).map(([k, v]) => `<b>${k}:</b> ${v}`).join('<br/>')}</div>`, { maxWidth: 300 }); }
    }
  }, []);

  const onEachFeatureEditSelect = useCallback((feature, layer) => {
    const code = getParcelCode(feature.properties);
    const label = code || 'ไม่ทราบรหัส';
    layer.bindTooltip(`คลิกเพื่อแก้ไข: ${label}`, { sticky: true, className: 'text-xs' });

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
      layer.setStyle({ weight: 2, fillOpacity: 0.15, fillColor: '#fef3c7', dashArray: '4,4' });
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
          return t ? `<span style="background:${t.fillColor};color:${t.color};padding:1px 4px;border-radius:3px;font-size:10px;">${t.icon} ${t.label}${areaStr}${i === 0 ? ' ★' : ''}</span>` : key;
        }).join(' ');
        html = `<div style="margin-bottom:4px;">${badges}</div>${html}`;
      }
      if (html) layer.bindPopup(`<div class="text-xs leading-relaxed">${html}</div>`, { maxWidth: 360 });

      layer.on('click', (e) => {
        if (!code) return;
        const cp = e.containerPoint || { x: 200, y: 200 };
        setPopupInfo({
          parcelCode: code,
          currentTypes: luData.types,
          currentAreas: luData.areas,
          totalArea: getParcelArea(feature.properties),
          position: { x: cp.x, y: cp.y },
        });
      });
    }
  }, [landUseAssignments]);

  const showTable = tableLayerId !== null;

  return (
    <div className="relative w-full h-full flex flex-col">
      <div className={`relative w-full ${showTable ? 'h-1/2' : 'h-full'} transition-all duration-300`}>
        <MapContainer key={mapKey} center={defaultCenter} zoom={defaultZoom} className="w-full rounded-t-lg" style={{ zIndex: 1, height: '100%' }} scrollWheelZoom zoomControl>
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

          {selectedFeature && (
            <SafeGeoJSON key={`highlight-${highlightKey}`} data={selectedFeature} style={() => highlightStyle} onEachFeature={() => {}}
              pointToLayer={(f, ll) => L.circleMarker(ll, { radius: 10, fillColor: '#fbbf24', color: '#ef4444', weight: 3, fillOpacity: 0.8 })} />
          )}
        </MapContainer>

        {(loadingFiles || saving || editSaving) && (
          <div className="absolute inset-0 bg-white/60 z-20 flex items-center justify-center rounded-lg">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              <span className="text-sm text-gray-600">{editSaving ? 'กำลังบันทึกรูปแปลง...' : saving ? 'กำลังบันทึก...' : 'กำลังโหลด...'}</span>
            </div>
          </div>
        )}

        {editingLayerId && editFeatureIdx === null && !isDrawing && !drawnFeature && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-amber-50 border-2 border-amber-400 rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-amber-600 text-lg">✏️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800">เลือกแปลงที่ต้องการแก้ไข</p>
                <p className="text-[10px] text-amber-600">คลิกที่แปลงบนแผนที่ หรือวาดแปลงใหม่</p>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-2">
              <button onClick={startDrawing}
                className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors shadow">
                ➕ วาดแปลงใหม่
              </button>
              <button onClick={exitEditMode}
                className="px-4 py-1.5 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600 transition-colors shadow">
                ✕ ออก
              </button>
            </div>
          </div>
        )}

        {editingLayerId && isDrawing && !drawnFeature && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-green-50 border-2 border-green-400 rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-green-600 text-lg">📐</span>
              <div>
                <p className="text-sm font-semibold text-green-800">วาดรูปแปลงใหม่</p>
                <p className="text-[10px] text-green-600">คลิกเพื่อวางจุดมุม — ดับเบิลคลิกเพื่อจบ</p>
              </div>
            </div>
            <button onClick={() => { setIsDrawing(false); setMapKey((prev) => prev + 1); }}
              className="px-4 py-1.5 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600 transition-colors shadow ml-2">
              ✕ ยกเลิก
            </button>
          </div>
        )}

        {editingLayerId && editFeatureIdx !== null && (() => {
          const editLy = geojsonLayers.find((l) => l.id === editingLayerId);
          const feat = editLy?.data?.features?.[editFeatureIdx];
          const code = feat ? getParcelCode(feat.properties) : null;
          return (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-amber-50 border-2 border-amber-400 rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-amber-600 text-lg">✏️</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800">กำลังแก้ไข{code ? `: ${code}` : ` แปลง #${editFeatureIdx + 1}`}</p>
                  <p className="text-[10px] text-amber-600">ลากจุดมุมเพื่อแก้ไข — คลิกเส้นเพื่อเพิ่มจุด</p>
                </div>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <button onClick={saveEditFeature} disabled={editSaving}
                  className="px-4 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 shadow">
                  {editSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึก'}
                </button>
                <button onClick={cancelEditFeature} disabled={editSaving}
                  className="px-4 py-1.5 bg-white text-amber-700 text-sm font-medium rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50 shadow border border-amber-300">
                  ↩ เลือกแปลงอื่น
                </button>
                <button onClick={exitEditMode} disabled={editSaving}
                  className="px-4 py-1.5 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600 transition-colors disabled:opacity-50 shadow">
                  ✕ ออก
                </button>
              </div>
            </div>
          );
        })()}

        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
          {!editingLayerId && <button onClick={handleResetView} className="px-3 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg shadow-lg hover:bg-gray-50 transition-colors border border-gray-200">🗺️ จัดกึ่งกลาง</button>}
          {!editingLayerId && geojsonLayers.length > 0 && <button onClick={() => setShowPanel(!showPanel)} className="px-3 py-2 bg-white text-gray-700 text-sm font-medium rounded-lg shadow-lg hover:bg-gray-50 transition-colors border border-gray-200">📋 เลเยอร์ ({geojsonLayers.length})</button>}
          {!editingLayerId && surveyMode && <button onClick={() => setShowLegend(!showLegend)} className="px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg shadow-lg hover:bg-green-700 transition-colors">📊 สรุปสำรวจ</button>}
        </div>

        {uploadSuccess && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">✅ {uploadSuccess}</div>}
        {uploadError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-red-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2">
            <span>⚠️ {uploadError}</span>
            <button onClick={() => setUploadError(null)} className="ml-2 font-bold hover:text-red-200">✕</button>
          </div>
        )}

        {surveyMode && popupInfo && (
          <LandUsePopup
            parcelCode={popupInfo.parcelCode}
            currentTypes={popupInfo.currentTypes}
            currentAreas={popupInfo.currentAreas}
            totalArea={popupInfo.totalArea}
            position={popupInfo.position}
            onAssign={(luData) => assignLandUse(popupInfo.parcelCode, luData)}
            onClose={() => setPopupInfo(null)}
          />
        )}

        {surveyMode && showLegend && (
          <LandUseLegend
            assignments={landUseAssignments}
            allParcelCodes={allParcelCodes}
            onClose={() => setShowLegend(false)}
            onBulkAssign={bulkAssignLandUse}
          />
        )}

        {drawnFeature && (
          <NewFeaturePropsForm
            onSave={saveNewFeature}
            onCancel={cancelNewFeature}
          />
        )}

        {showPanel && geojsonLayers.length > 0 && (
          <div className="absolute top-20 left-2 z-10 bg-white rounded-lg shadow-lg border border-gray-200 w-72 max-h-[50vh] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-semibold text-gray-800">📋 เลเยอร์ GeoJSON</h3>
              <button onClick={() => setShowPanel(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-1">
              {geojsonLayers.map((ly, index) => (
                <div key={ly.id} className={`flex items-center gap-1.5 p-2 rounded-lg text-xs transition-colors ${tableLayerId === ly.id ? 'bg-blue-50 ring-1 ring-blue-300' : ly.visible ? 'bg-gray-50' : 'bg-gray-100 opacity-60'}`}>
                  <div className="flex flex-col flex-shrink-0">
                    <button onClick={() => moveLayer(ly.id, 'up')} disabled={index === 0} className={`text-[10px] leading-none px-0.5 ${index === 0 ? 'text-gray-300' : 'text-gray-500 hover:text-blue-600'}`} title="ย้ายขึ้น">▲</button>
                    <button onClick={() => moveLayer(ly.id, 'down')} disabled={index === geojsonLayers.length - 1} className={`text-[10px] leading-none px-0.5 ${index === geojsonLayers.length - 1 ? 'text-gray-300' : 'text-gray-500 hover:text-blue-600'}`} title="ย้ายลง">▼</button>
                  </div>
                  <div className="w-3 h-3 rounded-sm flex-shrink-0 border border-white shadow-sm" style={{ backgroundColor: ly.color }} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800 truncate" title={ly.name}>{ly.name}</p>
                    <p className="text-gray-500">{ly.featureCount} features{ly.savedOnServer && <span className="ml-1 text-green-600">• บันทึกแล้ว</span>}</p>
                  </div>
                  <button onClick={() => { setTableLayerId((prev) => (prev === ly.id ? null : ly.id)); setSelectedFeature(null); setHighlightKey((k) => k + 1); }} className={`flex-shrink-0 ${tableLayerId === ly.id ? 'text-blue-600' : 'text-gray-400 hover:text-blue-600'}`} title="ตาราง">📊</button>
                  <button onClick={() => startEdit(ly.id)} className={`flex-shrink-0 ${editingLayerId === ly.id ? 'text-amber-600' : 'text-gray-400 hover:text-amber-600'}`} title="แก้ไขรูปแปลง" disabled={!!editingLayerId}>✏️</button>
                  <button onClick={() => toggleLayerVisibility(ly.id)} className="text-gray-400 hover:text-blue-600 flex-shrink-0" title={ly.visible ? 'ซ่อน' : 'แสดง'}>{ly.visible ? '👁️' : '🙈'}</button>
                  <button onClick={() => removeLayer(ly.id)} className="text-gray-400 hover:text-red-600 flex-shrink-0" title="ลบ" disabled={!!editingLayerId}>🗑️</button>
                </div>
              ))}
            </div>
            {geojsonLayers.length > 1 && (
              <div className="px-3 py-2 border-t border-gray-200 flex-shrink-0">
                <button onClick={removeAllLayers} className="w-full px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100 transition-colors">🗑️ ลบทั้งหมด</button>
              </div>
            )}
          </div>
        )}
      </div>

      {showTable && (
        <div className="h-1/2 border-t-2 border-gray-300">
          <AttributeTable layer={tableLayer}
            onClose={() => { setTableLayerId(null); setSelectedFeature(null); setHighlightKey((k) => k + 1); }}
            onZoomToFeature={zoomToFeature} surveyMode={surveyMode}
            landUseAssignments={landUseAssignments}
            onUpdateFeature={updateFeatureProperty}
            onDeleteFeature={deleteFeature} />
        </div>
      )}
    </div>
  );
});

TaxMapView.displayName = 'TaxMapView';
export default TaxMapView;
