// 시·도 경계와 좌표 → 시·도 판별
App.geo = (() => {
  const features = window.KR_PROVINCES.features;

  const regions = features.map((f, i) => ({
    idx: i,
    code: f.properties.code,
    name: f.properties.name,
    short: f.properties.short,
    gadm: f.properties.gadm,
  }));
  const byGadm = new Map(regions.map((r) => [r.gadm, r.idx]));
  const byCode = new Map(regions.map((r) => [r.code, r.idx]));

  // 다각형별 경계상자를 미리 계산
  const shapes = features.map((f) => f.geometry.coordinates.map((poly) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    poly[0].forEach(([x, y]) => {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    });
    return { rings: poly, bbox: [minX, minY, maxX, maxY] };
  }));

  const inRing = (x, y, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  const segDist2 = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    return ex * ex + ey * ey;
  };

  const NEAR = 0.25; // 경계 밖이어도 약 25km 이내면 가장 가까운 시·도로 배정(해안·섬 지점)

  const regionOf = (lat, lng) => {
    if (!(lat >= 32.8 && lat <= 39 && lng >= 124 && lng <= 132.2)) return -1;
    for (let r = 0; r < shapes.length; r++) {
      for (const s of shapes[r]) {
        const b = s.bbox;
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
        let inside = false;
        for (const ring of s.rings) if (inRing(lng, lat, ring)) inside = !inside;
        if (inside) return r;
      }
    }
    let best = -1, bestD = NEAR * NEAR;
    for (let r = 0; r < shapes.length; r++) {
      for (const s of shapes[r]) {
        const b = s.bbox;
        if (lng < b[0] - NEAR || lng > b[2] + NEAR || lat < b[1] - NEAR || lat > b[3] + NEAR) continue;
        const ring = s.rings[0];
        for (let i = 1; i < ring.length; i++) {
          const d = segDist2(lng, lat, ring[i - 1][0], ring[i - 1][1], ring[i][0], ring[i][1]);
          if (d < bestD) { bestD = d; best = r; }
        }
      }
    }
    return best;
  };

  const regionIdxFromGadm = (gid) => (byGadm.has(gid) ? byGadm.get(gid) : -1);

  return { regions, byCode, regionOf, regionIdxFromGadm, features };
})();
