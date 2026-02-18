import { useEffect, useRef, useState } from "react";
import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import { MapPinIcon } from "@heroicons/react/24/outline";

const TaxMapWithNoSSR = dynamic(() => import("@/components/TaxMapView"), {
  ssr: false,
  loading: () => (
    <div className="h-full bg-gray-100 animate-pulse rounded-lg flex items-center justify-center">
      กำลังโหลดแผนที่...
    </div>
  ),
});

export default function TaxMapPage() {
  const { userId, isLoaded } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const mapRef = useRef(null);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [layerCount, setLayerCount] = useState(0);
  const [surveyMode, setSurveyMode] = useState(false);

  useEffect(() => {
    if (isLoaded && !userId) router.replace("/");
  }, [isLoaded, userId, router]);

  useEffect(() => {
    if (isLoaded && user) {
      const role = user?.publicMetadata?.role;
      if (role !== "admin" && role !== "superadmin") router.replace("/");
    }
  }, [isLoaded, user, router]);

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (mapRef.current?.handleFileUpload) {
      setUploading(true);
      mapRef.current.handleFileUpload(file).finally(() => setUploading(false));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!isLoaded || !userId) {
    return <div className="text-center p-8">กำลังโหลด...</div>;
  }

  const role = user?.publicMetadata?.role;
  if (role !== "admin" && role !== "superadmin") {
    return <div className="text-center p-8">ไม่มีสิทธิ์เข้าถึงหน้านี้</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center">
          <MapPinIcon className="h-6 w-6 text-blue-600 mr-2" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">แผนที่ภาษี</h1>
            <p className="text-sm text-gray-500">
              แผนที่สำหรับจัดการข้อมูลภาษีในพื้นที่
              {layerCount > 0 && (
                <span className="ml-2 text-blue-600 font-medium">• {layerCount} เลเยอร์</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Survey Mode Toggle */}
          <button
            onClick={() => setSurveyMode(!surveyMode)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              surveyMode
                ? "bg-green-600 text-white shadow-md ring-2 ring-green-300"
                : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
            }`}
          >
            {surveyMode ? "🌍 โหมดสำรวจ: เปิด" : "🌍 สำรวจการใช้ที่ดิน"}
          </button>

          <button
            onClick={handleUploadClick}
            disabled={uploading}
            className={`px-4 py-2 text-white text-sm font-medium rounded-lg transition-colors ${
              uploading ? "bg-blue-400 cursor-wait" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {uploading ? "⏳ กำลังบันทึก..." : "📂 อัปโหลด GeoJSON"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json"
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />

          <button
            onClick={() => router.push("/admin")}
            className="px-4 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 transition-colors"
          >
            กลับหน้าหลัก
          </button>
        </div>
      </div>

      {/* Survey mode instruction bar */}
      {surveyMode && (
        <div className="px-4 py-2 bg-green-50 border-b border-green-200 flex items-center gap-3 flex-shrink-0">
          <span className="text-green-700 text-sm font-medium">🌍 โหมดสำรวจการใช้ประโยชน์ที่ดิน</span>
          <span className="text-green-600 text-xs">คลิกที่แปลงบนแผนที่เพื่อกำหนดประเภทการใช้ที่ดิน หรือใช้ตารางข้อมูลเพื่อกำหนดทีละหลายแปลง</span>
        </div>
      )}

      {/* Map Area */}
      <div className="flex-1 p-4 bg-gray-50">
        <div className="w-full h-full rounded-lg overflow-hidden shadow-lg border border-gray-200">
          <TaxMapWithNoSSR
            ref={mapRef}
            onLayerCountChange={setLayerCount}
            surveyMode={surveyMode}
          />
        </div>
      </div>
    </div>
  );
}
