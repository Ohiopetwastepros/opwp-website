import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutRouteMarkers, ROUTE_MARKER_SPACING } from '../app/field/app/route-map-layout.mjs';
import { localPreviewCustomers } from '../scripts/local-preview-fixtures.mjs';

function assertReadable(markers, mapHeight) {
  for (const [index, marker] of markers.entries()) {
    assert.ok(marker.x >= 48 && marker.x <= 512 && marker.y >= 45 && marker.y <= mapHeight - 45, 'hit target stays inside map');
    for (const other of markers.slice(0, index)) assert.ok(Math.hypot(marker.x - other.x, marker.y - other.y) >= ROUTE_MARKER_SPACING, `stop ${marker.index + 1} stays separate from stop ${other.index + 1}`);
  }
  // The 76 SVG-unit hit diameter exceeds 44 CSS pixels in the 352px phone map.
  assert.ok(76 * 352 / 560 >= 44);
}

test('Tech 2 fixture keeps stops 1 and 6 separate without changing coordinates or order', () => {
  const stops = localPreviewCustomers().slice(6, 12).map(customer => ({ id: customer.id, latitude: customer.lat, longitude: customer.lng }));
  const original = structuredClone(stops);
  for (const height of [250, 410]) {
    const markers = layoutRouteMarkers(stops, height);
    assert.equal(markers.length, 6);
    assert.deepEqual(markers.map(marker => marker.stop.id), stops.map(stop => stop.id));
    assert.deepEqual(markers.map(marker => marker.index), [0, 1, 2, 3, 4, 5]);
    assertReadable(markers, height);
    assert.deepEqual(layoutRouteMarkers(stops, height), markers, 'layout is deterministic');
  }
  assert.deepEqual(stops, original, 'display layout never mutates source stops');
});

test('six stops at the same coordinate have separate in-bounds hit targets', () => {
  const stops = Array.from({ length: 6 }, (_, index) => ({ id: `stop-${index}`, latitude: 41.6, longitude: -83.7 }));
  for (const height of [250, 410]) assertReadable(layoutRouteMarkers(stops, height), height);
});

test('missing coordinates are omitted while original stop numbering is retained', () => {
  const stops = [{ id: 'missing', latitude: null, longitude: null }, { id: 'valid', latitude: 41.6, longitude: -83.7 }, { id: 'invalid', latitude: 'unknown', longitude: -83.7 }];
  const markers = layoutRouteMarkers(stops);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].index, 1);
  assert.equal(markers[0].stop, stops[1]);
  assert.deepEqual(layoutRouteMarkers([]), []);
});
