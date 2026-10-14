"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import marker from "leaflet/dist/images/marker-icon.png";
import retina from "leaflet/dist/images/marker-icon-2x.png";
import shadow from "leaflet/dist/images/marker-shadow.png";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";
import type { LocationPickerProps } from "@/components/location-picker";
import { useDeviceLocation } from "./use-device-location";

const DEFAULT_CENTER: [number, number] = [22.9734, 78.6569];
const icon = new L.Icon({
  iconUrl: marker.src, iconRetinaUrl: retina.src, shadowUrl: shadow.src,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
});

function MapControls({ value, onChange, autoLocate }: LocationPickerProps) {
  const t = useT();
  const map = useMap();
  const [initialAutoLocate] = useState(() => Boolean(autoLocate && !value));
  const { coords, locating, error, locate } = useDeviceLocation(initialAutoLocate);
  const controlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!controlRef.current) return;
    L.DomEvent.disableClickPropagation(controlRef.current);
    L.DomEvent.disableScrollPropagation(controlRef.current);
  }, []);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { if (coords) onChangeRef.current(coords); }, [coords]);
  useEffect(() => {
    if (value) map.setView([value.lat, value.lng], 16);
    else map.setView(DEFAULT_CENTER, 5);
    map.invalidateSize();
  }, [map, value?.lat, value?.lng, value]);
  useMapEvents({ click: (e) => onChange({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return <div className="leaflet-top leaflet-right" style={{ margin: 10 }}>
    <div ref={controlRef} className="leaflet-control">
      <Button type="button" size="sm" variant="outline" disabled={locating} onClick={locate}>
        {locating ? t("Location le rahe hain...") : t("Live Location")}
      </Button>
      {error && <p role="alert" className="max-w-48 bg-background p-2 text-xs text-destructive">{t("Location nahi mili — permission allow karein.")}</p>}
    </div>
  </div>;
}

export default function LocationMap({ autoLocate = true, ...props }: LocationPickerProps) {
  return <div className="overflow-hidden rounded-lg border">
    <MapContainer center={props.value ? [props.value.lat, props.value.lng] : DEFAULT_CENTER} zoom={props.value ? 16 : 5} scrollWheelZoom style={{ height: 260, width: "100%" }}>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapControls {...props} autoLocate={autoLocate} />
      {props.value && <Marker position={[props.value.lat, props.value.lng]} icon={icon} />}
    </MapContainer>
  </div>;
}
