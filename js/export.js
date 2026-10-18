// 연구용 자료 내려받기: 엑셀(여러 시트), CSV(원자료), GeoJSON(GIS)
App.exporter = (() => {
  const { $, esc, fmt, toCSV, download, toast } = App.util;
  const S = App.state;
  const XLSX_URL = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
  const SITE = "https://invasive.biogrideia.com/";

  // 엑셀 도구는 내려받을 때만 불러옴(약 0.9 MB)
  let xlsxP = null;
  const loadXLSX = () => xlsxP || (xlsxP = new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s = document.createElement("script");
    s.src = XLSX_URL;
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => { xlsxP = null; reject(new Error("엑셀 도구를 불러오지 못했습니다.")); };
    document.head.appendChild(s);
  }));

  const SOURCE_LABEL = { verified: "시민 관찰·검증됨", pending: "시민 관찰·확인 중", gbif: "기관·타 플랫폼" };
  const INAT_LICENSE = {
    cc0: "CC0", "cc-by": "CC BY", "cc-by-nc": "CC BY-NC", "cc-by-sa": "CC BY-SA", "cc-by-nd": "CC BY-ND",
    "cc-by-nc-sa": "CC BY-NC-SA", "cc-by-nc-nd": "CC BY-NC-ND",
  };
  const round5 = (v) => Math.round(v * 1e5) / 1e5;
  const dateStr = (d) => {
    if (!d) return "";
    const y = Math.floor(d / 10000), m = Math.floor(d / 100) % 100, day = d % 100;
    return m ? (day ? `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` : `${y}-${String(m).padStart(2, "0")}`) : String(y);
  };

  // ---------- 원자료 열 정의: [키, 한글 이름, 영문(Darwin Core 용어), 설명] ----------
  const COLUMNS = [
    ["speciesId", "종 ID", "speciesID", "이 지도에서 쓰는 종 식별자"],
    ["name", "국명", "vernacularName", "환경부 지정 국명"],
    ["sci", "학명", "scientificName", "지정 목록 기준 학명(원자료 분류와 다를 수 있음)"],
    ["group", "분류군", "taxonGroup", "포유류·양서파충류·어류·갑각류·곤충·식물"],
    ["year_designated", "지정 연도", "designationYear", "생태계교란 생물로 지정된 연도"],
    ["category", "자료 종류", "recordCategory", "시민 관찰·검증됨 / 시민 관찰·확인 중 / 기관·타 플랫폼"],
    ["platform", "플랫폼", "platform", "iNaturalist 또는 GBIF"],
    ["publisher", "자료 기관", "publisher", "GBIF 자료를 낸 기관(iNaturalist는 'iNaturalist')"],
    ["dataset", "자료 묶음", "datasetName", "GBIF 자료 묶음 이름"],
    ["eventDate", "관찰일", "eventDate", "YYYY-MM-DD (모르는 월·일은 생략)"],
    ["yr", "연도", "year", "관찰 연도"],
    ["mo", "월", "month", "관찰 월(모르면 빈칸)"],
    ["lat", "위도", "decimalLatitude", "WGS84, 소수점 5자리"],
    ["lng", "경도", "decimalLongitude", "WGS84, 소수점 5자리"],
    ["unc", "위치 오차(m)", "coordinateUncertaintyInMeters", "원자료에 적힌 위치 오차(없으면 빈칸)"],
    ["obsc", "위치 흐림", "coordinatesObscured", "관찰자가 위치를 흐리게 설정했으면 '예'(실제 위치와 수 km 다를 수 있음)"],
    ["provCode", "시도 코드", "provinceCode", "통계청 시·도 코드"],
    ["prov", "시도", "stateProvince", "좌표 기준 시·도"],
    ["locality", "장소 설명", "locality", "iNaturalist 관찰자가 적은 장소"],
    ["recordedBy", "관찰자", "recordedBy", "iNaturalist 사용자 이름"],
    ["basis", "기록 유형", "basisOfRecord", "관찰·표본 등"],
    ["license", "라이선스", "license", "기록별 이용 조건(빈칸은 모든 권리 보유)"],
    ["occurrenceId", "원본 ID", "occurrenceID", "iNaturalist 관찰 번호 또는 GBIF 기록 번호"],
    ["url", "원본 주소", "references", "원래 기록 웹 주소"],
  ];

  // ---------- 원자료 행 만들기 ----------
  const collect = ({ scope, sources }) => {
    const filters = scope === "map"
      ? S.filters
      : { groups: new Set(Object.keys(window.TAXON_GROUPS)), species: null, yearFrom: null, yearTo: null, sources };
    const src = scope === "map" ? S.filters.sources : sources;
    const rows = [];
    const regions = App.geo.regions;
    App.data.each((spId, lat, lng, y, reg, source, ref) => {
      const sp = S.spById.get(spId);
      const g = App.data.group(sp);
      const r = regions[reg] || {};
      const base = {
        speciesId: spId, name: sp.name, sci: sp.sci, group: g.label, year_designated: sp.year || "",
        category: SOURCE_LABEL[source], source, lat: round5(lat), lng: round5(lng), reg,
        provCode: r.code || "", prov: r.name || "",
      };
      if (source === "gbif") {
        const e = S.gbif[spId];
        const ds = S.gbifDatasets[e.ds[ref]] || [];
        const d = e.date[ref];
        rows.push({
          ...base, platform: "GBIF", publisher: App.sources.orgLabel(ds[2]) || "", dataset: ds[1] || "",
          date: d || y * 10000, eventDate: d ? dateStr(d) : (y ? String(y) : ""), yr: y || "", mo: d ? (Math.floor(d / 100) % 100 || "") : "",
          unc: e.unc[ref] >= 0 ? e.unc[ref] : "", obsc: "아니오", locality: "", recordedBy: "",
          basis: App.sources.basisLabel(e.basis[ref]), license: (S.gbifLicenses || [])[e.lic[ref]] || "",
          occurrenceId: String(e.key[ref]), url: App.sources.gbifOccUrl(e.key[ref]), user: "",
        });
      } else {
        const o = ref;
        rows.push({
          ...base, platform: "iNaturalist", publisher: "iNaturalist", dataset: "iNaturalist 관찰",
          date: o.date, eventDate: dateStr(o.date), yr: o.y || "", mo: o.date ? (Math.floor(o.date / 100) % 100 || "") : "",
          unc: o.acc >= 0 ? o.acc : "", obsc: o.obsc ? "예" : "아니오", locality: o.pl || "", recordedBy: o.u || "",
          basis: "관찰", license: INAT_LICENSE[o.olic] || "",
          occurrenceId: String(o.id), url: App.sources.obsUrl(o.id), user: o.u || "",
        });
      }
    }, { filters, sources: src });
    return rows;
  };

  // ---------- 집계 시트 ----------
  const speciesOrder = () => {
    const order = Object.keys(window.TAXON_GROUPS);
    return S.species.slice().sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (a.year || 0) - (b.year || 0));
  };

  const sheetSpecies = (rows) => {
    const nowY = new Date().getFullYear();
    const m = new Map();
    rows.forEach((r) => {
      let s = m.get(r.speciesId);
      if (!s) { s = { total: 0, verified: 0, pending: 0, gbif: 0, regs: new Set(), minY: Infinity, maxY: 0, recent: 0, users: new Set() }; m.set(r.speciesId, s); }
      s.total++; s[r.source]++;
      if (r.reg >= 0) s.regs.add(r.reg);
      if (r.yr) { s.minY = Math.min(s.minY, r.yr); s.maxY = Math.max(s.maxY, r.yr); if (r.yr > nowY - 5) s.recent++; }
      if (r.user) s.users.add(r.user);
    });
    const head = ["종 ID", "국명", "학명", "분류군", "지정 연도", "전체 기록", "시민 관찰·검증됨", "시민 관찰·확인 중", "기관·타 플랫폼",
      "출현 시도 수", "최초 기록 연도", "최근 기록 연도", "최근 5년 기록", "시민 관찰자 수"];
    const body = speciesOrder().map((sp) => {
      const s = m.get(sp.id);
      return [sp.id, sp.name, sp.sci, App.data.group(sp).label, sp.year || "", s ? s.total : 0, s ? s.verified : 0, s ? s.pending : 0, s ? s.gbif : 0,
        s ? s.regs.size : 0, s && s.minY !== Infinity ? s.minY : "", s && s.maxY ? s.maxY : "", s ? s.recent : 0, s ? s.users.size : 0];
    });
    return [head, ...body];
  };

  const sheetRegions = (rows) => {
    const n = App.geo.regions.length;
    const agg = Array.from({ length: n }, () => ({ total: 0, verified: 0, pending: 0, gbif: 0, sp: new Map() }));
    rows.forEach((r) => {
      if (r.reg < 0) return;
      const a = agg[r.reg];
      a.total++; a[r.source]++;
      a.sp.set(r.speciesId, (a.sp.get(r.speciesId) || 0) + 1);
    });
    const head = ["시도 코드", "시도", "전체 기록", "시민 관찰·검증됨", "시민 관찰·확인 중", "기관·타 플랫폼", "출현 종 수", "가장 많이 기록된 종", "그 종의 기록 수"];
    const body = App.geo.regions.map((r, i) => {
      const a = agg[i];
      const top = [...a.sp.entries()].sort((x, y) => y[1] - x[1])[0];
      return [r.code, r.name, a.total, a.verified, a.pending, a.gbif, a.sp.size, top ? S.spById.get(top[0]).name : "", top ? top[1] : 0];
    });
    return [head, ...body];
  };

  const sheetRegionSpecies = (rows, presence) => {
    const idx = new Map();
    rows.forEach((r) => {
      if (r.reg < 0) return;
      const k = `${r.speciesId}|${r.reg}`;
      idx.set(k, (idx.get(k) || 0) + 1);
    });
    const regs = App.geo.regions;
    const head = ["종 ID", "국명", "학명", ...regs.map((r) => r.name), presence ? "출현 시도 수" : "합계"];
    const body = speciesOrder().map((sp) => {
      const vals = regs.map((r, i) => idx.get(`${sp.id}|${i}`) || 0);
      const cells = presence ? vals.map((v) => (v ? 1 : 0)) : vals;
      return [sp.id, sp.name, sp.sci, ...cells, cells.reduce((a, v) => a + v, 0)];
    });
    return [head, ...body];
  };

  const yearSpan = (rows) => {
    let min = Infinity, max = 0;
    rows.forEach((r) => { if (r.yr) { min = Math.min(min, r.yr); max = Math.max(max, r.yr); } });
    if (min === Infinity) return [];
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  };

  const sheetYearSpecies = (rows) => {
    const years = yearSpan(rows);
    const sps = speciesOrder();
    const idx = new Map();
    rows.forEach((r) => { if (r.yr) { const k = `${r.yr}|${r.speciesId}`; idx.set(k, (idx.get(k) || 0) + 1); } });
    const head = ["연도", ...sps.map((s) => s.name), "합계"];
    const body = years.map((y) => {
      const vals = sps.map((s) => idx.get(`${y}|${s.id}`) || 0);
      return [y, ...vals, vals.reduce((a, v) => a + v, 0)];
    });
    return [head, ...body];
  };

  const sheetRegionYear = (rows) => {
    const years = yearSpan(rows);
    const idx = new Map();
    rows.forEach((r) => { if (r.yr && r.reg >= 0) { const k = `${r.reg}|${r.yr}`; idx.set(k, (idx.get(k) || 0) + 1); } });
    const head = ["시도 코드", "시도", ...years, "합계"];
    const body = App.geo.regions.map((reg, i) => {
      const vals = years.map((y) => idx.get(`${i}|${y}`) || 0);
      return [reg.code, reg.name, ...vals, vals.reduce((a, v) => a + v, 0)];
    });
    return [head, ...body];
  };

  const sheetMonthly = (rows) => {
    const m = new Map();
    rows.forEach((r) => {
      if (!r.yr || !r.mo) return;
      const k = `${r.yr}-${String(r.mo).padStart(2, "0")}`;
      let a = m.get(k);
      if (!a) { a = { verified: 0, pending: 0, gbif: 0, sp: new Set() }; m.set(k, a); }
      a[r.source]++;
      a.sp.add(r.speciesId);
    });
    const head = ["연월", "시민 관찰·검증됨", "시민 관찰·확인 중", "기관·타 플랫폼", "합계", "기록된 종 수"];
    const body = [...m.keys()].sort().map((k) => {
      const a = m.get(k);
      return [k, a.verified, a.pending, a.gbif, a.verified + a.pending + a.gbif, a.sp.size];
    });
    return [head, ...body];
  };

  const sheetGroups = (rows) => {
    const m = new Map();
    rows.forEach((r) => {
      let a = m.get(r.group);
      if (!a) { a = { total: 0, verified: 0, pending: 0, gbif: 0, sp: new Set(), regs: new Set() }; m.set(r.group, a); }
      a.total++; a[r.source]++; a.sp.add(r.speciesId); if (r.reg >= 0) a.regs.add(r.reg);
    });
    const head = ["분류군", "지정 종 수", "기록 있는 종 수", "전체 기록", "시민 관찰·검증됨", "시민 관찰·확인 중", "기관·타 플랫폼", "출현 시도 수"];
    const body = Object.values(window.TAXON_GROUPS).map((g) => {
      const a = m.get(g.label) || { total: 0, verified: 0, pending: 0, gbif: 0, sp: new Set(), regs: new Set() };
      const designated = S.species.filter((s) => App.data.group(s).label === g.label).length;
      return [g.label, designated, a.sp.size, a.total, a.verified, a.pending, a.gbif, a.regs.size];
    });
    return [head, ...body];
  };

  const sheetSources = (rows) => {
    const m = new Map();
    rows.forEach((r) => {
      const k = [r.platform, r.publisher, r.dataset, r.license].join("|");
      m.set(k, (m.get(k) || 0) + 1);
    });
    const head = ["플랫폼", "자료 기관", "자료 묶음", "라이선스", "기록 수"];
    const body = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [...k.split("|"), n]);
    return [head, ...body];
  };

  // 0.1도 격자(약 9×11 km)별 종 기록 — 분포 모형 등에 바로 쓰기 좋은 긴 형식
  const sheetGrid = (rows) => {
    const m = new Map();
    rows.forEach((r) => {
      const gy = Math.floor(r.lat * 10), gx = Math.floor(r.lng * 10);
      const k = `${gy}|${gx}|${r.speciesId}`;
      let a = m.get(k);
      if (!a) { a = { n: 0, v: 0, minY: Infinity, maxY: 0 }; m.set(k, a); }
      a.n++; if (r.source === "verified") a.v++;
      if (r.yr) { a.minY = Math.min(a.minY, r.yr); a.maxY = Math.max(a.maxY, r.yr); }
    });
    const head = ["격자 ID", "격자 남쪽 위도", "격자 서쪽 경도", "중심 위도", "중심 경도", "종 ID", "국명", "기록 수", "검증된 시민 관찰 수", "최초 연도", "최근 연도"];
    const body = [...m.entries()].map(([k, a]) => {
      const [gy, gx, spId] = k.split("|");
      const lat0 = Number(gy) / 10, lng0 = Number(gx) / 10;
      return [`${lat0.toFixed(1)}_${lng0.toFixed(1)}`, lat0, lng0, round5(lat0 + 0.05), round5(lng0 + 0.05), spId, S.spById.get(spId).name,
        a.n, a.v, a.minY === Infinity ? "" : a.minY, a.maxY || ""];
    }).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || (a[5] < b[5] ? -1 : 1));
    return [head, ...body];
  };

  const gbifSearchUrl = () => {
    const keys = S.species.filter((s) => s.gbif).map((s) => `taxon_key=${s.gbif}`).join("&");
    return `https://www.gbif.org/occurrence/search?country=KR&${keys}&has_coordinate=true`;
  };

  const sheetReadme = (rows, opts) => {
    const cnt = { verified: 0, pending: 0, gbif: 0 };
    rows.forEach((r) => { cnt[r.source]++; });
    const when = (v) => (v ? new Date(v).toLocaleString("ko-KR") : "-");
    const f = S.filters;
    const scopeText = opts.scope === "map"
      ? `지도 필터 적용 — 분류군 ${f.groups.size}개, 종 ${f.species ? f.species.size + "개 선택" : "전체"}, 연도 ${f.yearFrom || "처음"}~${f.yearTo || "현재"}`
      : "전체 자료(필터 없음)";
    return [
      ["교란생물 종합관리 · 시민 분포지도 — 연구용 자료"],
      [],
      ["만든 시각", new Date().toLocaleString("ko-KR")],
      ["지도 주소", SITE],
      ["범위", scopeText],
      ["기록 수", rows.length, `시민 관찰·검증됨 ${cnt.verified} · 시민 관찰·확인 중 ${cnt.pending} · 기관·타 플랫폼 ${cnt.gbif}`],
      ["iNaturalist 자료 기준", when(S.inatSnapshotAt), `마지막 실시간 갱신 ${S.inatSyncedAt ? S.inatSyncedAt.toLocaleString("ko-KR") : "-"}`],
      ["GBIF 자료 기준", when(S.gbifAt)],
      ["좌표계", "WGS84 (EPSG:4326)"],
      [],
      ["시트 안내"],
      ...opts.sheets.map((k) => [SHEETS[k].name, SHEETS[k].desc]),
      [],
      ["자료 출처와 인용"],
      ["시민 관찰", "iNaturalist (https://www.inaturalist.org) — 국내(place_id=6891) 관찰. 관찰마다 라이선스가 다르므로 '라이선스' 열을 확인하세요. CC BY-NC는 비영리 목적에만 쓸 수 있고, 빈칸(모든 권리 보유)은 관찰자 허락 없이 재사용할 수 없습니다."],
      ["기관·타 플랫폼", "GBIF.org (https://www.gbif.org) — 국립생태원, 네이처링, 국립중앙과학관, 국립수목원 등. GBIF에 이미 들어 있는 iNaturalist 기록은 중복을 막기 위해 뺐습니다."],
      ["논문 인용", "GBIF 자료를 논문에 쓰려면 아래 주소에서 같은 조건으로 직접 내려받아 DOI를 인용하세요."],
      ["GBIF 같은 조건 검색", gbifSearchUrl()],
      ["이 지도", `교란생물 종합관리 시민 분포지도, ${SITE} (내려받은 날짜 함께 적기)`],
      [],
      ["유의할 점"],
      ["", "기록은 조사·관찰이 많은 곳에 몰립니다. 기록이 없다고 그 지역에 없다는 뜻은 아닙니다(출현 자료, 부재 자료 아님)."],
      ["", "‘시민 관찰·확인 중’은 종이 틀렸을 수 있습니다. 분석에는 ‘검증됨’과 ‘기관·타 플랫폼’만 쓰는 것을 권합니다."],
      ["", "‘위치 흐림 = 예’인 기록은 실제 위치와 수 km 다를 수 있습니다. ‘위치 오차(m)’도 함께 확인하세요."],
      ["", "지정 목록은 위키백과·언론 보도를 종합한 것이며, 법적 기준은 「생태계교란 생물 지정 고시」입니다."],
    ];
  };

  const sheetColumns = () => [["열 이름(한글)", "열 이름(영문, Darwin Core 용어)", "설명"], ...COLUMNS.map(([, ko, en, desc]) => [ko, en, desc])];

  const rawTable = (rows, lang) => {
    const head = COLUMNS.map(([, ko, en]) => (lang === "en" ? en : ko));
    return [head, ...rows.map((r) => COLUMNS.map(([k]) => r[k] ?? ""))];
  };

  const SHEETS = {
    raw: { name: "원자료", desc: "기록 한 건이 한 줄인 원자료(위치·날짜·출처·라이선스·원본 주소 포함)" },
    species: { name: "종별 요약", desc: "종별 기록 수, 자료 종류별 수, 출현 시도 수, 최초·최근 기록 연도, 시민 관찰자 수" },
    regions: { name: "시도별 요약", desc: "시·도별 기록 수, 출현 종 수, 가장 많이 기록된 종" },
    regionSpecies: { name: "시도×종 기록수", desc: "종(행) × 시·도(열) 기록 수 표" },
    presence: { name: "시도×종 출현여부", desc: "종(행) × 시·도(열) 출현 1 / 기록 없음 0" },
    yearSpecies: { name: "연도×종", desc: "연도(행) × 종(열) 기록 수 — 시계열 분석용" },
    regionYear: { name: "시도×연도", desc: "시·도(행) × 연도(열) 기록 수" },
    monthly: { name: "연월별 추이", desc: "연월별 자료 종류별 기록 수와 기록된 종 수" },
    groups: { name: "분류군별 요약", desc: "분류군별 지정 종 수, 기록 수, 출현 시도 수" },
    sources: { name: "자료 출처", desc: "플랫폼·기관·자료 묶음·라이선스별 기록 수" },
    grid: { name: "0.1도 격자", desc: "0.1° 격자(약 9×11 km)별·종별 기록 수(긴 형식) — 분포 모형용" },
    columns: { name: "열 설명", desc: "원자료 열 이름(한글·영문)과 설명" },
  };
  const BUILDERS = {
    species: sheetSpecies, regions: sheetRegions, regionSpecies: (r) => sheetRegionSpecies(r, false),
    presence: (r) => sheetRegionSpecies(r, true), yearSpecies: sheetYearSpecies, regionYear: sheetRegionYear,
    monthly: sheetMonthly, groups: sheetGroups, sources: sheetSources, grid: sheetGrid, columns: sheetColumns,
  };

  // ---------- 파일 만들기 ----------
  const stamp = () => App.util.today().replace(/-/g, "");

  const toSheet = (XLSX, aoa, { autofilter = true } = {}) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const widths = (aoa[0] || []).map((_, c) => {
      let w = 6;
      for (let r = 0; r < Math.min(aoa.length, 200); r++) {
        const v = aoa[r][c];
        if (v != null) w = Math.max(w, Math.min(50, String(v).length * (/[가-힣]/.test(String(v)) ? 2 : 1.1) + 2));
      }
      return { wch: Math.round(w) };
    });
    ws["!cols"] = widths;
    if (autofilter && aoa.length > 1 && ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
    return ws;
  };

  const buildXlsx = async (rows, opts) => {
    const XLSX = await loadXLSX();
    const wb = XLSX.utils.book_new();
    wb.Props = { Title: "교란생물 연구용 자료", Author: "교란생물 종합관리 시민 분포지도", CreatedDate: new Date() };
    XLSX.utils.book_append_sheet(wb, toSheet(XLSX, sheetReadme(rows, opts), { autofilter: false }), "안내");
    for (const key of opts.sheets) {
      const aoa = key === "raw" ? rawTable(rows, opts.lang) : BUILDERS[key](rows);
      XLSX.utils.book_append_sheet(wb, toSheet(XLSX, aoa), SHEETS[key].name);
    }
    // bookSST: 반복되는 글자(기관명·주소 등)를 한 번만 저장해 파일 크기를 줄임
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true, bookSST: true });
    return { filename: `교란생물_연구자료_${stamp()}.xlsx`, blob: new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) };
  };

  const buildCsv = (rows, opts) => ({
    filename: `교란생물_원자료_${stamp()}.csv`,
    blob: new Blob([toCSV(rawTable(rows, opts.lang))], { type: "text/csv;charset=utf-8" }),
  });

  const buildGeoJSON = (rows, opts) => {
    const feats = rows.map((r) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
      properties: Object.fromEntries(COLUMNS.filter(([k]) => k !== "lat" && k !== "lng")
        .map(([k, ko, en]) => [opts.lang === "en" ? en : ko, r[k] ?? ""])),
    }));
    return {
      filename: `교란생물_지점_${stamp()}.geojson`,
      blob: new Blob([JSON.stringify({ type: "FeatureCollection", features: feats })], { type: "application/geo+json" }),
    };
  };

  // 파일을 만들기만 함(저장은 호출한 쪽에서)
  const makeFile = async (opts) => {
    const rows = collect(opts);
    const file = opts.format === "xlsx" ? await buildXlsx(rows, opts)
      : opts.format === "csv" ? buildCsv(rows, opts) : buildGeoJSON(rows, opts);
    return { ...file, count: rows.length };
  };

  // ---------- 내려받기 창 ----------
  const openDialog = (presetScope = "all") => {
    const cnt = { verified: 0, pending: 0, gbif: 0 };
    App.data.each((id, lat, lng, y, reg, source) => { cnt[source]++; },
      { ignoreSpeciesFilter: true, filters: { groups: new Set(Object.keys(window.TAXON_GROUPS)), species: null, yearFrom: null, yearTo: null, sources: {} },
        sources: { verified: true, pending: true, gbif: true } });
    const sheetChecks = Object.entries(SHEETS).map(([k, s]) => `
      <label class="check sheet-check"><input type="checkbox" name="sheet" value="${k}" checked>
        <span><b>${esc(s.name)}</b><small>${esc(s.desc)}</small></span></label>`).join("");
    const html = `
      <form class="export-form" id="export-form" novalidate>
        <fieldset>
          <legend>범위</legend>
          <label class="check"><input type="radio" name="scope" value="all" ${presetScope === "all" ? "checked" : ""}> 모든 자료</label>
          <label class="check"><input type="radio" name="scope" value="map" ${presetScope === "map" ? "checked" : ""}> 지금 지도에 걸어 둔 조건 그대로(분류군·종·연도·기록 종류)</label>
        </fieldset>
        <fieldset id="export-sources">
          <legend>기록 종류</legend>
          <label class="check"><input type="checkbox" name="src" value="verified" checked> 시민 관찰·검증됨 <span class="muted">${fmt(cnt.verified)}건</span></label>
          <label class="check"><input type="checkbox" name="src" value="pending" checked> 시민 관찰·확인 중 <span class="muted">${fmt(cnt.pending)}건 · 종이 틀렸을 수 있음</span></label>
          <label class="check"><input type="checkbox" name="src" value="gbif" checked> 기관·타 플랫폼(GBIF) <span class="muted">${fmt(cnt.gbif)}건</span></label>
        </fieldset>
        <fieldset>
          <legend>형식</legend>
          <label class="check"><input type="radio" name="format" value="xlsx" checked> 엑셀(.xlsx) — 원자료와 집계표를 시트별로</label>
          <label class="check"><input type="radio" name="format" value="csv"> CSV — 원자료 한 표(R·Python·엑셀)</label>
          <label class="check"><input type="radio" name="format" value="geojson"> GeoJSON — 지점 자료(QGIS 등 GIS 프로그램)</label>
        </fieldset>
        <fieldset>
          <legend>열 이름</legend>
          <label class="check"><input type="radio" name="lang" value="ko" checked> 한글</label>
          <label class="check"><input type="radio" name="lang" value="en"> 영문(Darwin Core 용어 — 분석 프로그램용)</label>
        </fieldset>
        <fieldset id="export-sheets">
          <legend>엑셀에 넣을 시트 <span class="muted">(‘안내’ 시트는 항상 포함)</span></legend>
          <div class="sheet-grid">${sheetChecks}</div>
          <p class="muted small" style="margin:8px 0 0">‘원자료’ 시트가 파일 크기의 대부분을 차지합니다. 집계표만 필요하면 원자료를 빼면 1~2 MB로 가벼워집니다.</p>
        </fieldset>
        <div class="export-foot">
          <span class="muted" id="export-count"></span>
          <button type="submit" class="btn btn-primary" id="export-go">내려받기</button>
        </div>
        <p class="muted small">논문 등에 쓸 때는 ‘안내’ 시트의 인용 방법을 따라 주세요. 기록마다 라이선스가 다릅니다.</p>
      </form>`;
    App.ui.openModal("연구용 자료 내려받기", html, (body) => {
      const form = body.querySelector("form");
      const readOpts = () => {
        const fd = new FormData(form);
        const sources = { verified: false, pending: false, gbif: false };
        fd.getAll("src").forEach((k) => { sources[k] = true; });
        return { scope: fd.get("scope"), format: fd.get("format"), lang: fd.get("lang"), sources, sheets: fd.getAll("sheet") };
      };
      const update = () => {
        const o = readOpts();
        body.querySelector("#export-sources").disabled = o.scope === "map";
        body.querySelector("#export-sheets").hidden = o.format !== "xlsx";
        const n = collect(o).length;
        // 대략적인 파일 크기(기록 한 건당 바이트, 실측 기준)
        const perRow = o.format === "geojson" ? 700 : o.format === "csv" ? 285 : (o.sheets.includes("raw") ? 285 : 30);
        const mb = (n * perRow) / 1e6;
        body.querySelector("#export-count").textContent = `${fmt(n)}건 · 약 ${mb < 1 ? "1 MB 미만" : `${Math.round(mb)} MB`}`;
        body.querySelector("#export-go").disabled = !n;
      };
      form.addEventListener("change", update);
      update();
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = body.querySelector("#export-go");
        const o = readOpts();
        btn.disabled = true;
        btn.textContent = "파일 만드는 중…";
        await new Promise((r) => setTimeout(r, 30));
        try {
          const file = await makeFile(o);
          download(file.filename, file.blob);
          toast(`${fmt(file.count)}건을 파일로 저장했습니다.`);
        } catch (err) {
          console.warn(err);
          toast(err.message || "파일을 만들지 못했습니다.", 5000);
        } finally {
          btn.disabled = false;
          btn.textContent = "내려받기";
        }
      });
    });
  };

  return { openDialog, collect, makeFile, loadXLSX, SHEETS, COLUMNS };
})();
