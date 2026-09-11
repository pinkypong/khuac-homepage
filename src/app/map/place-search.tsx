"use client";

import { useEffect, useRef } from "react";
import { useMapsLibrary } from "@vis.gl/react-google-maps";

export interface PlaceResult {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

/**
 * Google's own place search, so a mountain can be found by name instead of
 * hunting for it on a zoomed-out map.
 *
 * Uses PlaceAutocompleteElement (Places API New). The older Autocomplete
 * widget isn't available to projects created after March 2025, and this one
 * handles the dropdown and session tokens itself.
 */
export function PlaceSearch({ onSelect }: { onSelect: (place: PlaceResult) => void }) {
  const places = useMapsLibrary("places");
  const containerRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!places || !container) return;

    const element = new places.PlaceAutocompleteElement();
    element.style.width = "100%";
    container.replaceChildren(element);

    async function handleSelect(event: Event) {
      const prediction = (event as unknown as { placePrediction?: google.maps.places.PlacePrediction })
        .placePrediction;
      if (!prediction) return;

      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["location", "displayName", "formattedAddress"] });
      const location = place.location;
      if (!location) return;

      onSelectRef.current({
        name: place.displayName ?? "",
        address: place.formattedAddress ?? null,
        lat: location.lat(),
        lng: location.lng(),
      });
    }

    element.addEventListener("gmp-select", handleSelect);
    return () => {
      element.removeEventListener("gmp-select", handleSelect);
      container.replaceChildren();
    };
  }, [places]);

  // Google styles its own element, so the size is forced from outside. 16px
  // below md: a smaller field makes iOS zoom the page the moment it is tapped.
  return <div ref={containerRef} className="[&_*]:text-base md:[&_*]:text-sm" />;
}
