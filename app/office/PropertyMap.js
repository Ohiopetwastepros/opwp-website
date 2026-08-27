"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./call-guide.module.css";

const TIERS = [
  { id: "tiny", label: "Up to 1/8 acre", maximum: 5445 },
  { id: "small", label: "1/8 – 1/4 acre", maximum: 10890 },
  { id: "medium", label: "1/4 – 1/2 acre", maximum: 21780 },
  { id: "large", label: "1/2 – 3/4 acre", maximum: 32670 },
  { id: "xlarge", label: "Over 3/4 acre", maximum: Infinity },
];

let googleMapsLoader;

function measuredTier(squareFeet) {
  return TIERS.find((tier) => squareFeet <= tier.maximum) || TIERS.at(-1);
}

function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.geometry?.spherical) return Promise.resolve(window.google.maps);
  if (!apiKey) return Promise.reject(new Error("Google property mapping is not configured."));
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = "__opwpGoogleMapsReady";
    const timeout = window.setTimeout(() => {
      delete window[callbackName];
      googleMapsLoader = undefined;
      reject(new Error("Google Maps took too long to load. Check the connection and try again."));
    }, 20000);

    window[callbackName] = () => {
      window.clearTimeout(timeout);
      delete window[callbackName];
      if (window.google?.maps?.geometry?.spherical) resolve(window.google.maps);
      else reject(new Error("Google Maps loaded without the measuring tools."));
    };

    const params = new URLSearchParams({
      key: apiKey,
      libraries: "geometry",
      loading: "async",
      callback: callbackName,
      v: "weekly",
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.defer = true;
    script.dataset.opwpGoogleMaps = "true";
    script.onerror = () => {
      window.clearTimeout(timeout);
      delete window[callbackName];
      googleMapsLoader = undefined;
      reject(new Error("Google Maps could not load. Confirm the API key restrictions and try again."));
    };
    document.head.appendChild(script);
  });

  return googleMapsLoader;
}

function geocodeAddress(maps, address) {
  return new Promise((resolve, reject) => {
    const geocoder = new maps.Geocoder();
    geocoder.geocode(
      { address, componentRestrictions: { country: "US" }, region: "US" },
      (results, status) => {
        if (status === "OK" && results?.[0]) resolve(results[0]);
        else if (status === "ZERO_RESULTS") reject(new Error("Google could not find that complete address. Check the house number, city, and ZIP."));
        else reject(new Error("Google could not map that address right now. Please try again."));
      },
    );
  });
}

export default function PropertyMap({ address, ready, selectedTier, onTierSelected, googleMapsKey }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const addressMarkerRef = useRef(null);
  const shapeRef = useRef(null);
  const markersRef = useRef([]);
  const measuringRef = useRef(false);
  const touchModeRef = useRef(false);
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [measuring, setMeasuring] = useState(false);
  const [touchMode, setTouchMode] = useState(false);
  const [points, setPoints] = useState([]);
  const [squareFeet, setSquareFeet] = useState(0);

  function clearMapMeasurement() {
    if (shapeRef.current) {
      shapeRef.current.setMap(null);
      shapeRef.current = null;
    }
    markersRef.current.forEach((marker) => {
      mapsRef.current?.event.clearInstanceListeners(marker);
      marker.setMap(null);
    });
    markersRef.current = [];
  }

  function renderMeasurement(nextPoints, canDrag) {
    const maps = mapsRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;
    clearMapMeasurement();

    if (nextPoints.length > 1) {
      shapeRef.current = nextPoints.length > 2
        ? new maps.Polygon({
          map,
          paths: nextPoints,
          strokeColor: "#d8ff67",
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: "#8dbd4a",
          fillOpacity: 0.3,
          clickable: false,
        })
        : new maps.Polyline({
          map,
          path: nextPoints,
          strokeColor: "#d8ff67",
          strokeOpacity: 1,
          strokeWeight: 3,
          clickable: false,
        });
    }

    markersRef.current = nextPoints.map((point, index) => {
      const marker = new maps.Marker({
        map,
        position: point,
        label: { text: String(index + 1), color: "#ffffff", fontSize: "11px", fontWeight: "800" },
        draggable: canDrag,
        optimized: false,
        title: canDrag ? `Drag corner ${index + 1} to adjust it` : `Corner ${index + 1}`,
      });
      marker.addListener("dragend", (event) => {
        if (!event.latLng) return;
        setPoints((current) => current.map((currentPoint, pointIndex) => (
          pointIndex === index ? { lat: event.latLng.lat(), lng: event.latLng.lng() } : currentPoint
        )));
      });
      return marker;
    });
  }

  useEffect(() => {
    renderMeasurement(points, measuring);
    const maps = mapsRef.current;
    if (maps?.geometry?.spherical && points.length >= 3) {
      setSquareFeet(maps.geometry.spherical.computeArea(points) * 10.7639104167);
    } else {
      setSquareFeet(0);
    }
  }, [points, measuring]);

  useEffect(() => {
    if (!ready) {
      setLocation(null);
      setError("");
      setLoading(false);
      return undefined;
    }

    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const maps = await loadGoogleMaps(googleMapsKey);
        const result = await geocodeAddress(maps, address);
        if (!active || !containerRef.current) return;

        mapsRef.current = maps;
        touchModeRef.current = window.matchMedia?.("(pointer: coarse)")?.matches || false;
        setTouchMode(touchModeRef.current);
        const center = result.geometry.location;

        if (!mapRef.current) {
          const map = new maps.Map(containerRef.current, {
            center,
            zoom: 21,
            mapTypeId: maps.MapTypeId.HYBRID,
            tilt: 0,
            clickableIcons: false,
            fullscreenControl: true,
            streetViewControl: false,
            mapTypeControl: true,
            mapTypeControlOptions: {
              mapTypeIds: [maps.MapTypeId.HYBRID, maps.MapTypeId.SATELLITE],
              style: maps.MapTypeControlStyle.HORIZONTAL_BAR,
            },
            gestureHandling: "cooperative",
          });
          map.addListener("click", (event) => {
            if (!measuringRef.current || touchModeRef.current || !event.latLng) return;
            setPoints((current) => [...current, { lat: event.latLng.lat(), lng: event.latLng.lng() }]);
          });
          mapRef.current = map;
        } else {
          mapRef.current.setCenter(center);
          mapRef.current.setZoom(21);
        }

        if (addressMarkerRef.current) {
          maps.event.clearInstanceListeners(addressMarkerRef.current);
          addressMarkerRef.current.setMap(null);
        }
        addressMarkerRef.current = new maps.Marker({
          map: mapRef.current,
          position: center,
          title: "Google address match",
        });
        clearMeasurement();
        setPoints([]);
        setMeasuring(false);
        measuringRef.current = false;
        setLocation({
          formattedAddress: result.formatted_address,
          accuracy: result.geometry.location_type,
          partialMatch: Boolean(result.partial_match),
        });
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : "The property could not be mapped.");
      } finally {
        if (active) setLoading(false);
      }
    }, 650);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [address, ready, googleMapsKey]);

  useEffect(() => () => {
    clearMapMeasurement();
    if (addressMarkerRef.current) {
      mapsRef.current?.event.clearInstanceListeners(addressMarkerRef.current);
      addressMarkerRef.current.setMap(null);
    }
    if (mapsRef.current && mapRef.current) mapsRef.current.event.clearInstanceListeners(mapRef.current);
    mapRef.current = null;
  }, []);

  function startMeasurement() {
    measuringRef.current = true;
    setMeasuring(true);
    setError("");
    mapRef.current?.setOptions({ gestureHandling: touchModeRef.current ? "greedy" : "cooperative" });
  }

  function addCenterPoint() {
    const center = mapRef.current?.getCenter();
    if (!center) return;
    setPoints((current) => [...current, { lat: center.lat(), lng: center.lng() }]);
  }

  function undoPoint() {
    setPoints((current) => current.slice(0, -1));
    setError("");
  }

  function finishMeasurement() {
    if (points.length < 3) {
      setError(`Add ${3 - points.length} more corner${points.length === 2 ? "" : "s"} before finishing.`);
      return;
    }
    measuringRef.current = false;
    setMeasuring(false);
    setError("");
    mapRef.current?.setOptions({ gestureHandling: "cooperative" });
  }

  function clearMeasurement() {
    measuringRef.current = false;
    setMeasuring(false);
    setPoints([]);
    setSquareFeet(0);
    setError("");
    mapRef.current?.setOptions({ gestureHandling: "cooperative" });
  }

  const tier = squareFeet ? measuredTier(squareFeet) : null;
  const approximateMatch = location && (location.partialMatch || !["ROOFTOP", "RANGE_INTERPOLATED"].includes(location.accuracy));

  return <div className={styles.propertyMapTool}>
    <div className={styles.propertyMapHead}>
      <div>
        <span>Google satellite property check</span>
        <strong>{location?.formattedAddress || (ready ? "Locating property…" : "Enter the complete address above")}</strong>
      </div>
      {loading ? <i /> : location ? <b className={styles.mapStatusBadge}>{location.accuracy === "ROOFTOP" ? "Rooftop match" : "Confirm visually"}</b> : null}
    </div>

    {!ready
      ? <div className={styles.mapPlaceholder}>The Google aerial map will open automatically after the street address, city, and ZIP are entered.</div>
      : <div className={styles.mapFrame}>
        <div ref={containerRef} className={styles.mapCanvas} />
        {measuring && touchMode ? <div className={styles.mapCrosshair} aria-hidden="true"><span /><span /></div> : null}
        {loading ? <div className={styles.mapLoading}>Loading Google aerial property view…</div> : null}
      </div>}

    {location ? <>
      {approximateMatch ? <div className={styles.mapMatchWarning}>Google returned an approximate address match. Use the road labels and visible house outline to confirm the correct property before measuring.</div> : null}
      <div className={styles.measureToolbar}>
        {!measuring
          ? <button type="button" onClick={startMeasurement}>{points.length ? "Adjust corners" : "Start measuring yard"}</button>
          : <button type="button" className={styles.finishMeasure} onClick={finishMeasurement}>Finish measurement</button>}
        {measuring && touchMode ? <button type="button" className={styles.addCorner} onClick={addCenterPoint}>Add corner</button> : null}
        <button type="button" className={styles.undoMeasure} disabled={!points.length} onClick={undoPoint}>Undo corner</button>
        <button type="button" className={styles.clearMeasure} disabled={!points.length} onClick={clearMeasurement}>Clear</button>
        <span>{measuring
          ? touchMode
            ? `Move the crosshair to each yard corner, then tap Add corner · ${points.length} point${points.length === 1 ? "" : "s"}`
            : `Click each yard corner; drag numbered points to correct them · ${points.length} point${points.length === 1 ? "" : "s"}`
          : points.length
            ? "Measurement finished. Choose Adjust corners to make corrections."
            : "Pan and zoom as needed, then trace only the yard being serviced."}</span>
      </div>
      {tier ? <div className={styles.measureResult}>
        <div>
          <span>{measuring ? "Live measured service area" : "Measured service area"}</span>
          <strong>{Math.round(squareFeet).toLocaleString()} sq ft</strong>
          <small>{(squareFeet / 43560).toFixed(2)} acre · suggested tier: {tier.label}</small>
        </div>
        <button type="button" className={selectedTier === tier.id ? styles.tierApplied : ""} onClick={() => onTierSelected(tier.id)}>
          {selectedTier === tier.id ? "Pricing tier applied" : "Use this pricing tier"}
        </button>
      </div> : null}
    </> : null}

    {error ? <div className={styles.alert}>{error}</div> : null}
    <small className={styles.mapDisclaimer}>Google imagery and boundary tracing provide an operational estimate, not a survey. Confirm the visible house and trace only the area OPWP will service.</small>
  </div>;
}
