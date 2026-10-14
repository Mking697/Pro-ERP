"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LatLng } from "@/components/location-picker";

/** Device-only evidence: no editable pin, late callbacks ignored after cleanup/retry. */
export function useDeviceLocation(enabled: boolean) {
  const [coords, setCoords] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const locate = useCallback(() => {
    const token = ++request.current;
    setError(false);
    setCoords(null);
    if (!navigator.geolocation) { setError(true); setLocating(false); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords: next }) => {
        if (request.current !== token) return;
        setCoords({ lat: next.latitude, lng: next.longitude });
        setLocating(false);
      },
      () => {
        if (request.current !== token) return;
        setError(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);
  useEffect(() => {
    const generation = request;
    if (enabled) {
      // Keep effect setup synchronous and state changes in the async request.
      const timer = setTimeout(locate, 0);
      return () => { clearTimeout(timer); generation.current++; };
    }
    return () => { generation.current++; };
  }, [enabled, locate]);
  return { coords, locating, error, locate };
}
