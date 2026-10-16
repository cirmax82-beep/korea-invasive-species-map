// 앱 상태와 통합 조회
// 출처 세 가지: verified(시민 관찰·검증됨) / pending(시민 관찰·확인 중) / gbif(기관·타 플랫폼 기록)
App.state = {
  species: [],
  spById: new Map(),
  inat: {},              // speciesId → [관찰 객체]
  inatTaxa: {},          // speciesId → { id, photo, lic, by }
  inatSnapshotAt: null,
  inatSyncedAt: null,    // 마지막 실시간 갱신 시각(Date)
  gbif: {},              // speciesId → 압축 엔트리
  gbifDatasets: [],
  gbifAt: null,
  filters: {
    groups: new Set(Object.keys(window.TAXON_GROUPS)),
    species: null,       // null = 전체
    yearFrom: null,
    yearTo: null,
    sources: { verified: true, pending: true, gbif: true },
  },
  mapMode: "cluster",
  choroMetric: "records",
};

App.data = (() => {
  const S = App.state;

  const SOURCES = {
    verified: { label: "시민 관찰 · 검증됨", short: "검증됨", badge: "badge-green" },
    pending: { label: "시민 관찰 · 확인 중", short: "확인 중", badge: "badge-orange" },
    gbif: { label: "기관·타 플랫폼 기록", short: "기관·타 플랫폼", badge: "badge-gray" },
  };

  const rebuildSpecies = () => {
    S.species = [...window.SPECIES_CATALOG];
    S.spById = new Map(S.species.map((s) => [s.id, s]));
  };

  const group = (sp) => window.TAXON_GROUPS[sp && sp.group] || { label: "기타", color: "#868e96" };
  const colorOf = (spId) => group(S.spById.get(spId)).color;

  const speciesVisible = (spId, f = S.filters) => {
    const sp = S.spById.get(spId);
    if (!sp || !f.groups.has(sp.group)) return false;
    return !f.species || f.species.has(spId);
  };

  const yearOk = (y, f) => {
    if (f.yearFrom == null && f.yearTo == null) return true;
    if (!y) return false;
    if (f.yearFrom != null && y < f.yearFrom) return false;
    if (f.yearTo != null && y > f.yearTo) return false;
    return true;
  };

  /**
   * 조건에 맞는 모든 기록을 순회: cb(spId, lat, lng, year, region, source, ref)
   * ref — 시민 관찰은 관찰 객체, GBIF는 엔트리 안의 순번
   */
  const each = (cb, opts = {}) => {
    const f = opts.filters || S.filters;
    const src = opts.sources || f.sources;
    const spOk = opts.ignoreSpeciesFilter ? (id) => S.spById.has(id) : (id) => speciesVisible(id, f);
    if (src.verified || src.pending) {
      for (const id in S.inat) {
        if (!spOk(id)) continue;
        for (const o of S.inat[id]) {
          const source = o.q ? "verified" : "pending";
          if (!src[source] || !yearOk(o.y, f)) continue;
          cb(id, o.lat, o.lng, o.y, o.reg, source, o);
        }
      }
    }
    if (src.gbif) {
      for (const id in S.gbif) {
        if (!spOk(id)) continue;
        const e = S.gbif[id];
        for (let i = 0; i < e.n; i++) {
          const y = e.year[i];
          if (!yearOk(y, f)) continue;
          cb(id, e.lat[i], e.lng[i], y, e.region[i], "gbif", i);
        }
      }
    }
  };

  const byRegion = (opts) => {
    const n = App.geo.regions.length;
    const records = new Array(n).fill(0);
    const species = Array.from({ length: n }, () => new Map());
    const bySource = Array.from({ length: n }, () => ({ verified: 0, pending: 0, gbif: 0 }));
    let unknown = 0;
    each((spId, lat, lng, y, reg, source) => {
      if (reg < 0 || reg >= n) { unknown++; return; }
      records[reg]++;
      bySource[reg][source]++;
      const m = species[reg];
      m.set(spId, (m.get(spId) || 0) + 1);
    }, opts);
    return { records, species, bySource, unknown };
  };

  const bySpecies = (opts) => {
    const out = new Map();
    const n = App.geo.regions.length;
    each((spId, lat, lng, y, reg, source) => {
      let s = out.get(spId);
      if (!s) { s = { total: 0, verified: 0, pending: 0, gbif: 0, regions: new Int32Array(n), years: new Map() }; out.set(spId, s); }
      s.total++;
      s[source]++;
      if (reg >= 0 && reg < n) s.regions[reg]++;
      if (y) s.years.set(y, (s.years.get(y) || 0) + 1);
    }, opts);
    return out;
  };

  // 시민 관찰 전체 목록(최근순) — 참여하기 화면, 종 상세에 사용
  const recentInat = ({ spId = null, withPhoto = false, limit = 24, pendingOnly = false } = {}) => {
    const all = [];
    for (const id in S.inat) {
      if (spId && id !== spId) continue;
      for (const o of S.inat[id]) {
        if (withPhoto && !o.ph) continue;
        if (pendingOnly && o.q) continue;
        all.push({ spId: id, o });
      }
    }
    all.sort((a, b) => (b.o.date - a.o.date) || (b.o.id - a.o.id));
    return limit ? all.slice(0, limit) : all;
  };

  const yearRange = () => {
    let min = Infinity, max = -Infinity;
    const take = (y) => { if (y > 0) { if (y < min) min = y; if (y > max) max = y; } };
    for (const id in S.gbif) { const e = S.gbif[id]; for (let i = 0; i < e.n; i++) take(e.year[i]); }
    for (const id in S.inat) S.inat[id].forEach((o) => take(o.y));
    return min === Infinity ? null : [min, max];
  };

  // 실시간 변경분 반영 (같은 관찰 ID는 교체, 검증 대상에서 빠진 것은 삭제)
  const applyInatChanges = ({ upserts, removed }) => {
    const remove = new Set(removed);
    upserts.forEach(({ obs }) => remove.add(obs.id));
    let added = 0;
    const known = new Set();
    for (const id in S.inat) S.inat[id].forEach((o) => known.add(o.id));
    for (const id in S.inat) {
      const before = S.inat[id].length;
      S.inat[id] = S.inat[id].filter((o) => !remove.has(o.id));
      if (S.inat[id].length !== before) S.inat[id] = S.inat[id].slice();
    }
    upserts.forEach(({ spId, obs }) => {
      if (!known.has(obs.id)) added++;
      (S.inat[spId] = S.inat[spId] || []).push(obs);
    });
    return { added, changed: upserts.length - added, removed: removed.filter((id) => known.has(id)).length };
  };

  return { SOURCES, rebuildSpecies, group, colorOf, speciesVisible, each, byRegion, bySpecies, recentInat, yearRange, applyInatChanges };
})();
