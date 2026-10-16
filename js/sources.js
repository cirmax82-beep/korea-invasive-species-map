// 자료 출처: iNaturalist(시민 관찰, 실시간)와 GBIF(기관·타 플랫폼 기록, 스냅샷)
App.sources = (() => {
  const INAT_API = "https://api.inaturalist.org/v2/observations";
  const PLACE_KOREA = 6891;
  const FIELDS = "id,quality_grade,observed_on,location,place_guess,obscured,positional_accuracy," +
    "user.login,photos.url,photos.license_code,license_code,taxon.id,taxon.ancestor_ids";
  const BASIS = ["기타", "관찰", "표본", "기계 관측", "시료", "기록", "생체 표본"];
  const LICENSES = {
    cc0: "CC0", "cc-by": "CC BY", "cc-by-nc": "CC BY-NC", "cc-by-sa": "CC BY-SA", "cc-by-nd": "CC BY-ND",
    "cc-by-nc-sa": "CC BY-NC-SA", "cc-by-nc-nd": "CC BY-NC-ND",
  };

  // ---------- 사진 ----------
  // 스냅샷은 사진을 'o123.jpg'(open-data 저장소) / 's123.jpeg'(iNaturalist 서버)로 줄여 저장
  const photoUrl = (code, size = "small") => {
    if (!code) return "";
    const m = /^([os])(\d+)\.(\w+)$/.exec(code);
    if (!m) return "";
    const host = m[1] === "o" ? "https://inaturalist-open-data.s3.amazonaws.com" : "https://static.inaturalist.org";
    return `${host}/photos/${m[2]}/${size}.${m[3]}`;
  };
  const shortPhoto = (photos) => {
    for (const p of photos || []) {
      const m = /\/\/(inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)\/photos\/(\d+)\/square\.(\w+)/.exec(p.url || "");
      if (p.license_code && m) return [`${m[1].startsWith("inaturalist-open-data") ? "o" : "s"}${m[2]}.${m[3]}`, p.license_code];
    }
    return ["", ""];
  };
  const licenseLabel = (code) => LICENSES[code] || "";

  const obsUrl = (id) => `https://www.inaturalist.org/observations/${id}`;
  const taxonUrl = (id) => `https://www.inaturalist.org/taxa/${id}`;
  const identifyUrl = (taxonIds) =>
    `https://www.inaturalist.org/observations/identify?place_id=${PLACE_KOREA}&quality_grade=needs_id&taxon_ids=${taxonIds.join(",")}`;
  const gbifOccUrl = (key) => `https://www.gbif.org/occurrence/${key}`;
  const gbifSpeciesUrl = (key) => `https://www.gbif.org/species/${key}`;
  const basisLabel = (code) => BASIS[code] || BASIS[0];
  // GBIF 자료를 낸 기관 이름(영문) → 한글
  const ORGS = {
    "National Institute of Ecology": "국립생태원",
    "NATURING": "네이처링(시민 관찰)",
    "National Science Museum of Korea": "국립중앙과학관",
    "Korea National Arboretum (Korea Forest Service)": "국립수목원",
    "Seongnam City Hall": "성남시청",
    "National Institute of Biological Resources": "국립생물자원관",
    "DMZ Botanic Garden": "DMZ자생식물원",
    "The International Barcode of Life Consortium": "국제생명바코드(BOLD)",
  };
  const orgLabel = (name) => ORGS[name] || name || "";

  // ---------- iNaturalist ----------
  const toObs = (row) => {
    const [id, lat, lng, date, q, acc, obsc, u, pl, ph, lic, np, olic] = row;
    return { id, lat, lng, date, y: Math.floor(date / 10000) || 0, q, acc, obsc, u, pl, ph, lic, np, olic: olic || "", reg: App.geo.regionOf(lat, lng) };
  };

  const loadInatSnapshot = async (url) => {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = await res.json();
    const obs = {};
    Object.entries(snap.obs || {}).forEach(([spId, rows]) => { obs[spId] = rows.map(toObs); });
    return { obs, taxa: snap.taxa || {}, at: snap.generatedAt };
  };

  const fromApi = (o) => {
    const [lat, lng] = String(o.location).split(",").map(Number);
    const [ph, lic] = shortPhoto(o.photos);
    return toObs([o.id, lat, lng, Number(String(o.observed_on || "0").replace(/-/g, "")) || 0,
      o.quality_grade === "research" ? 1 : 0, o.positional_accuracy == null ? -1 : o.positional_accuracy,
      o.obscured ? 1 : 0, (o.user || {}).login || "", (o.place_guess || "").slice(0, 60), ph, lic, (o.photos || []).length, o.license_code || ""]);
  };

  // 지정 종의 iNaturalist 분류 ID → 앱의 종 ID
  const taxonIndex = () => {
    const m = new Map();
    App.state.species.forEach((s) => { if (s.inat) m.set(s.inat, s.id); });
    return m;
  };
  const speciesOf = (o, idx) => {
    const ids = (o.taxon && o.taxon.ancestor_ids) || [];
    for (let i = ids.length - 1; i >= 0; i--) if (idx.has(ids[i])) return idx.get(ids[i]);
    return null;
  };

  const getJSON = async (url, signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  /**
   * since 이후 새로 올라오거나 바뀐 관찰을 받음.
   * 결과: { upserts: [{spId, obs}], removed: [id] }  — 검증 대상에서 빠진 관찰(casual)은 removed
   */
  const inatChangesSince = async (sinceISO, { maxPages = 10, signal } = {}) => {
    const idx = taxonIndex();
    const upserts = [], removed = [];
    let last = 0;
    for (let page = 0; page < maxPages; page++) {
      const qs = new URLSearchParams({
        place_id: PLACE_KOREA, taxon_id: [...idx.keys()].join(","), updated_since: sinceISO,
        per_page: 200, order_by: "id", order: "asc", id_above: last, fields: FIELDS,
      });
      const d = await getJSON(`${INAT_API}?${qs}`, signal);
      const res = d.results || [];
      for (const o of res) {
        const spId = speciesOf(o, idx);
        if (!spId || !o.location || o.quality_grade === "casual") { removed.push(o.id); continue; }
        upserts.push({ spId, obs: fromApi(o) });
      }
      if (res.length < 200) break;
      last = res[res.length - 1].id;
    }
    return { upserts, removed };
  };

  // 스냅샷이 없을 때: 종별로 전부 받음(느림, 비상용)
  const inatFullLoad = async (onProgress) => {
    const out = {};
    const list = App.state.species.filter((s) => s.inat);
    let done = 0;
    for (const sp of list) {
      out[sp.id] = [];
      let last = 0;
      for (;;) {
        const qs = new URLSearchParams({
          place_id: PLACE_KOREA, taxon_id: sp.inat, verifiable: "true", per_page: 200,
          order_by: "id", order: "asc", id_above: last, fields: FIELDS,
        });
        const d = await getJSON(`${INAT_API}?${qs}`);
        const res = d.results || [];
        res.forEach((o) => { if (o.location) out[sp.id].push(fromApi(o)); });
        if (res.length < 200) break;
        last = res[res.length - 1].id;
        await new Promise((r) => setTimeout(r, 1000));
      }
      onProgress && onProgress(++done, list.length, sp);
    }
    return out;
  };

  // ---------- GBIF ----------
  const loadGbifSnapshot = async (url) => {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const snap = await res.json();
    const entries = {};
    Object.entries(snap.species || {}).forEach(([speciesId, s]) => {
      const n = s.key.length;
      const e = {
        speciesId, taxonKey: s.taxonKey, total: s.total, n,
        lat: Float32Array.from(s.lat), lng: Float32Array.from(s.lng), year: Int16Array.from(s.year),
        region: Int8Array.from(s.region), key: Float64Array.from(s.key), basis: Uint8Array.from(s.basis),
        ds: Int16Array.from(s.ds || []),
        date: Int32Array.from(s.date || new Array(n).fill(0)),
        unc: Int32Array.from(s.unc || new Array(n).fill(-1)),
        lic: Uint8Array.from(s.lic || new Array(n).fill(0)),
      };
      for (let i = 0; i < n; i++) if (e.region[i] < 0) e.region[i] = App.geo.regionOf(e.lat[i], e.lng[i]);
      entries[speciesId] = e;
    });
    return { entries, datasets: snap.datasets || [], licenses: snap.licenses || ["", "CC0", "CC BY", "CC BY-NC"], at: snap.generatedAt };
  };

  return {
    PLACE_KOREA, photoUrl, licenseLabel, obsUrl, taxonUrl, identifyUrl, gbifOccUrl, gbifSpeciesUrl, basisLabel, orgLabel,
    loadInatSnapshot, inatChangesSince, inatFullLoad, loadGbifSnapshot,
  };
})();
