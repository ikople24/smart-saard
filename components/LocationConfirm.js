import { useEffect, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  LayersControl,
} from "react-leaflet";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});

const LocationConfirm = ({
  useCurrent,
  onToggle,
  location,
  setLocation,
  formSubmitted,
}) => {
  const [loading, setLoading] = useState(false);
  const [mapError, setMapError] = useState(false);
  const { BaseLayer } = LayersControl;

  useEffect(() => {
    if (useCurrent) {
      setLoading(true);
      setMapError(false); // Reset map error when getting new location
      console.log("🌍 Getting current location...");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          console.log("📍 Location obtained:", { lat: latitude, lng: longitude });
          setLocation({ lat: latitude, lng: longitude });
          setLoading(false);
        },
        (err) => {
          console.error("❌ Geolocation error:", err);
          alert("ไม่สามารถเข้าถึงตำแหน่งของคุณได้");
          setLoading(false);
          onToggle(false); // ปิด toggle กลับ
        }
      );
    }
  }, [useCurrent, onToggle, setLocation]);

  useEffect(() => {
    if (useCurrent && location) {
      console.log("🗺️ Map should be rendering with location:", location);
    }
  }, [useCurrent, location]);

  return (
    <div className="space-y-2">
      <div className="form-control bg-blue-50 p-3 rounded-md border border-blue-200">
        <label className="flex items-center gap-2 cursor-pointer w-full justify-between">
          <span className="label-text text-base font-medium text-gray-700">
            กดปุ่มเพื่อใช้ตำแหน่งปัจจุบันของคุณ
          </span>
          <input
            id="toggle-location"
            type="checkbox"
            className={`toggle ${
              useCurrent
                ? "toggle-success"
                : formSubmitted
                ? "toggle-error"
                : ""
            }`}
            checked={useCurrent}
            onChange={() => onToggle(!useCurrent)}
          />
        </label>
      </div>

      {loading && <p className="text-sm text-gray-500">กำลังดึงตำแหน่ง...</p>}
      
      {useCurrent && !location && !loading && (
        <p className="text-sm text-red-500">ไม่สามารถดึงตำแหน่งได้ กรุณาลองใหม่อีกครั้ง</p>
      )}

      {useCurrent && location && (
        <div className="rounded-lg overflow-hidden border border-blue-200 shadow-sm bg-blue-50">
          <div className="h-64 rounded overflow-hidden border relative">
            {mapError ? (
              <div className="h-full flex items-center justify-center bg-gray-100">
                <div className="text-center">
                  <p className="text-gray-600 mb-2">ไม่สามารถโหลดแผนที่ได้</p>
                  <button 
                    onClick={() => setMapError(false)}
                    className="btn btn-sm btn-primary"
                  >
                    ลองใหม่
                  </button>
                </div>
              </div>
            ) : (
              <MapContainer
                center={[location.lat, location.lng]}
                zoom={17}
                scrollWheelZoom={false}
                style={{ height: "100%", width: "100%" }}
                className="z-0"
              >
              {/* 🧭 Layers Control */}
              <LayersControl
                position="bottomleft"
                className="custom-layers-control"
              >
                {/* 🗺️ แผนที่ถนน */}
                <BaseLayer checked name="แผนที่ถนน">
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap contributors"
                  />
                </BaseLayer>

                {/* 🛰️ แผนที่ดาวเทียม */}
                <BaseLayer name="แผนที่ดาวเทียม">
                  <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution="Tiles &copy; Esri"
                  />
                </BaseLayer>
              </LayersControl>

              {/* 📍 Marker ตำแหน่งผู้ใช้ */}
              <Marker
                position={[location.lat, location.lng]}
                draggable={true}
                eventHandlers={{
                  dragend: (e) => {
                    const marker = e.target;
                    const position = marker.getLatLng();
                    setLocation({ lat: position.lat, lng: position.lng });
                  },
                }}
              >
                <Popup>
                  📍 <strong>ตำแหน่งของคุณ</strong>
                  <br />
                  ละติจูด: {location.lat.toFixed(6)}
                  <br />
                  ลองจิจูด: {location.lng.toFixed(6)}
                </Popup>
              </Marker>
            </MapContainer>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationConfirm;
