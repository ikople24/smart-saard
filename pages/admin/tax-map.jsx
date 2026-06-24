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
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-500 font-medium">กำลังตรวจสอบสิทธิ์...</p>
        </div>
      </div>
    );
  }

  const role = user?.publicMetadata?.role;
  if (role !== "admin" && role !== "superadmin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full border border-gray-100">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">ไม่มีสิทธิ์เข้าถึง</h2>
          <p className="text-sm text-gray-500 mb-6">บัญชีของคุณไม่มีสิทธิ์ในการจัดการแผนที่ภาษี</p>
          <button
            onClick={() => router.replace("/")}
            className="w-full py-2.5 bg-gray-900 text-white text-sm font-semibold rounded-xl hover:bg-gray-800 transition-colors"
          >
            กลับหน้าหลัก
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-gray-50 overflow-hidden flex flex-col">
      <TaxMapWithNoSSR />
    </div>
  );
}
