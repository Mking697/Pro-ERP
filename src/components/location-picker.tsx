"use client";

import dynamic from "next/dynamic";
import { useT } from "@/components/preferences-provider";

export interface LatLng { lat: number; lng: number }
export interface LocationPickerProps {
  value: LatLng | null;
  onChange: (coords: LatLng) => void;
  autoLocate?: boolean;
}

// Leaflet touches window during module evaluation, including Client Component SSR.
const ClientMap = dynamic(() => import("./field-service/location-map"), { ssr: false });

export default function LocationPicker(props: LocationPickerProps) {
  const t = useT();
  return <div aria-label={t("Location")} className="min-h-[260px]"><ClientMap {...props} /></div>;
}
