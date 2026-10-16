// 종 도감, 통계, 참여하기, 자료 안내 화면
App.views = (() => {
  const { $, esc, fmt, seqColor, toCSV, download } = App.util;
  const S = App.state;
  const R = () => App.geo.regions;
  const SRC = () => App.sources;

  const ALL = { verified: true, pending: true, gbif: true };
  const allFilters = (sources = ALL) => ({
    groups: new Set(Object.keys(window.TAXON_GROUPS)), species: null, yearFrom: null, yearTo: null, sources,
  });

  const groupBadge = (sp) => {
    const g = App.data.group(sp);
    return `<span class="badge" style="background:${g.color}1a;color:${g.color}">${esc(g.label)}</span>`;
  };
  const short = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const fmtDate = (d) => (d ? `${String(d).slice(0, 4)}.${Number(String(d).slice(4, 6))}.${Number(String(d).slice(6, 8))}` : "날짜 미상");
  const daysAgo = (n) => {
    const d = new Date(Date.now() - n * 86400000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  };

  const barList = (rows, { color, onClickAttr } = {}) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return `<div class="bars">${rows.map((r) => `
      <div class="bar-row ${onClickAttr ? "clickable" : ""}" ${onClickAttr ? `${onClickAttr}="${esc(r.key)}"` : ""} title="${esc(r.label)}: ${fmt(r.value)}">
        <span class="bar-label">${esc(r.label)}</span>
        <span class="bar-track"><span class="bar-fill" style="display:block;width:${(r.value / max) * 100}%;background:${r.color || color || "var(--primary)"}"></span></span>
        <span class="bar-val">${fmt(r.value)}</span>
      </div>`).join("")}</div>`;
  };

  const vbars = (labels, vals, tickEvery = 2) => {
    const max = Math.max(1, ...vals);
    return `<div class="vbars">${labels.map((lab, i) => `
      <div class="vbar" title="${esc(lab)}: ${fmt(vals[i])}건">
        <span class="vval">${vals[i] ? short(vals[i]) : ""}</span>
        <span class="vfill" style="height:${(vals[i] / max) * 100}%"></span>
        <span class="vlab">${(labels.length - 1 - i) % tickEvery === 0 ? esc(lab) : ""}</span>
      </div>`).join("")}</div>`;
  };

  const yearBars = (yearMap, span = 20) => {
    const now = new Date().getFullYear();
    const years = Array.from({ length: span }, (_, i) => now - span + 1 + i);
    return vbars(years.map((y) => String(y).slice(2)), years.map((y) => yearMap.get(y) || 0));
  };

  const kpi = (label, value, sub = "") =>
    `<div class="kpi"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ""}</div>`;

  // 관찰 사진 카드 (CC 라이선스 사진만 저장되어 있음)
  const photoThumb = (spId, o) => {
    const sp = S.spById.get(spId) || { name: "" };
    const st = App.data.SOURCES[o.q ? "verified" : "pending"];
    const where = (o.pl || "").replace(/대한민국|South Korea|,/g, " ").trim().split(/\s+/).slice(0, 3).join(" ");
    return `<a class="obs-card" href="${SRC().obsUrl(o.id)}" target="_blank" rel="noopener" title="${esc(sp.name)} · ${esc(o.u)}">
      <span class="obs-img"><img src="${SRC().photoUrl(o.ph, "small")}" alt="${esc(sp.name)} 관찰 사진" loading="lazy">
        <span class="badge ${st.badge} obs-badge">${st.short}</span></span>
      <span class="obs-meta"><b>${esc(sp.name)}</b><span>${fmtDate(o.date)}${where ? ` · ${esc(where)}` : ""}</span>
        <span class="obs-credit">© ${esc(o.u)} · ${esc(SRC().licenseLabel(o.lic))}</span></span>
    </a>`;
  };

  // ================= 종 도감 =================
  const catalogState = { q: "", group: null, sort: "group" };

  const renderSpecies = () => {
    const stats = App.data.bySpecies({ filters: allFilters() });
    const q = catalogState.q.trim().toLowerCase();
    const groupOrder = Object.keys(window.TAXON_GROUPS);
    const empty = { total: 0, verified: 0, pending: 0, gbif: 0, regions: new Int32Array(17) };
    const st = (s) => stats.get(s.id) || empty;
    const regCount = (s) => st(s).regions.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
    let list = S.species.filter((s) => (!catalogState.group || s.group === catalogState.group) &&
      (!q || [s.name, s.sci, s.origin, s.habitat].some((v) => (v || "").toLowerCase().includes(q))));
    const sorters = {
      group: (a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || (a.year || 0) - (b.year || 0),
      citizen: (a, b) => (st(b).verified + st(b).pending) - (st(a).verified + st(a).pending),
      records: (a, b) => st(b).total - st(a).total,
      regions: (a, b) => regCount(b) - regCount(a) || st(b).total - st(a).total,
      year: (a, b) => (a.year || 9999) - (b.year || 9999),
      name: (a, b) => a.name.localeCompare(b.name, "ko"),
    };
    list = list.sort(sorters[catalogState.sort]);

    $("#species-sub").textContent = `지정 생물 ${S.species.length}개 분류군 · 사진은 iNaturalist 참여자가 CC 라이선스로 공개한 것입니다.`;
    $("#catalog-groups").innerHTML = [`<button class="chip ${!catalogState.group ? "on" : ""}" data-g="">전체</button>`,
      ...Object.entries(window.TAXON_GROUPS).map(([k, g]) =>
        `<button class="chip ${catalogState.group === k ? "on" : ""}" data-g="${k}"><span class="dot" style="background:${g.color}"></span>${g.label}</button>`)].join("");

    $("#catalog-grid").innerHTML = list.length ? list.map((s) => {
      const c = App.data.group(s).color;
      const x = st(s);
      const max = Math.max(1, ...x.regions);
      const strip = R().map((r, i) => {
        const v = x.regions[i];
        return `<span title="${esc(r.short)} ${fmt(v)}건" style="${v ? `background:${c};opacity:${0.25 + 0.75 * (Math.log1p(v) / Math.log1p(max))}` : ""}"></span>`;
      }).join("");
      const t = S.inatTaxa[s.id] || {};
      return `<article class="sp-card" style="--c:${c}" data-id="${esc(s.id)}" tabindex="0">
        <div class="sp-photo">${t.photo
          ? `<img src="${SRC().photoUrl(t.photo, "small")}" alt="${esc(s.name)}" loading="lazy" title="${esc(t.by || "")}">`
          : `<span class="sp-photo-empty">사진 없음</span>`}
          <span class="sp-photo-group">${esc(App.data.group(s).label)}</span>
        </div>
        <div class="sp-card-body">
          <h4>${esc(s.name)}</h4>
          <div class="sci">${esc(s.sci || "")}</div>
          <div class="meta">
            ${s.year ? `<span class="badge badge-gray">${s.year}년 지정</span>` : ""}
            ${s.origin ? `<span class="badge badge-gray">원산 ${esc(s.origin)}</span>` : ""}
          </div>
          <p class="desc">${esc(s.impact || s.habitat || "")}</p>
          <div class="mini-regions" title="시·도별 분포 (서울→제주)">${strip}</div>
          <div class="nums">
            <span><b>${fmt(x.verified)}</b> 검증된 시민 관찰</span>
            <span><b>${regCount(s)}</b>/17 시·도</span>
            <span><b>${fmt(x.total)}</b> 전체</span>
          </div>
        </div>
      </article>`;
    }).join("") : `<div class="empty-state"><p>검색 결과가 없습니다.</p></div>`;
  };

  const speciesDetail = (id) => {
    const s = S.spById.get(id);
    if (!s) return;
    const x = App.data.bySpecies({ filters: { ...allFilters(), species: new Set([id]) } }).get(id) ||
      { total: 0, verified: 0, pending: 0, gbif: 0, regions: new Int32Array(17), years: new Map() };
    const regionRows = R().map((r, i) => ({ key: i, label: r.name, value: x.regions[i] }))
      .filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
    const color = App.data.group(s).color;
    const t = S.inatTaxa[id] || {};
    const recent = App.data.recentInat({ spId: id, withPhoto: true, limit: 8 });
    const html = `
      <div class="detail-grid">
        <div class="detail-info">
          ${t.photo ? `<figure class="detail-photo"><img src="${SRC().photoUrl(t.photo, "medium")}" alt="${esc(s.name)}"><figcaption>${esc(t.by || "")}</figcaption></figure>` : ""}
          <p style="margin-top:0">${groupBadge(s)} <i class="muted">${esc(s.sci || "")}</i></p>
          <dl>
            <dt>지정 연도</dt><dd>${s.year ? `${s.year}년` : "-"}</dd>
            <dt>원산지</dt><dd>${esc(s.origin || "-")}</dd>
            <dt>주요 서식지</dt><dd>${esc(s.habitat || "-")}</dd>
            <dt>피해·영향</dt><dd>${esc(s.impact || "-")}</dd>
            <dt>관리 방법</dt><dd>${esc(s.control || "-")}</dd>
            <dt>기록</dt><dd>시민 관찰 검증됨 ${fmt(x.verified)} · 확인 중 ${fmt(x.pending)} · 기관 ${fmt(x.gbif)}</dd>
          </dl>
          <div class="actions" style="margin-top:16px">
            <button class="btn btn-primary" id="d-map">지도에서 보기</button>
            ${s.inat ? `<a class="btn btn-light" href="${SRC().taxonUrl(s.inat)}" target="_blank" rel="noopener">iNaturalist 종 정보 ↗</a>` : ""}
            ${s.inat && x.pending ? `<a class="btn btn-light" href="${SRC().identifyUrl([s.inat])}" target="_blank" rel="noopener">확인 돕기 (${fmt(x.pending)}건) ↗</a>` : ""}
          </div>
        </div>
        <div>
          <h3>시·도별 기록 <small class="muted">${regionRows.length}/17곳</small></h3>
          ${regionRows.length ? barList(regionRows, { color }) : `<p class="muted">기록이 없습니다.</p>`}
          <h3 style="margin-top:18px">연도별 기록 <small class="muted">(최근 20년)</small></h3>
          ${yearBars(x.years)}
          ${recent.length ? `<h3 style="margin-top:18px">최근 시민 관찰</h3><div class="obs-grid compact">${recent.map(({ spId, o }) => photoThumb(spId, o)).join("")}</div>` : ""}
        </div>
      </div>`;
    App.ui.openModal(s.name, html, (body) => {
      body.querySelector("#d-map").onclick = () => { App.ui.closeModal(); App.ui.selectOnlySpecies(id); };
    });
  };

  // ================= 통계 =================
  let statsSource = "all";
  const STATS_SOURCES = {
    all: ALL,
    citizen: { verified: true, pending: true, gbif: false },
    verified: { verified: true, pending: false, gbif: false },
    gbif: { verified: false, pending: false, gbif: true },
  };

  const citizenStats = () => {
    const users = new Set();
    let verified = 0, pending = 0, last30 = 0;
    const since = daysAgo(30);
    for (const id in S.inat) for (const o of S.inat[id]) {
      users.add(o.u);
      if (o.q) verified++; else pending++;
      if (o.date >= since) last30++;
    }
    return { users: users.size, verified, pending, last30 };
  };

  const renderStats = () => {
    const filters = allFilters(STATS_SOURCES[statsSource]);
    const reg = App.data.byRegion({ filters });
    const sps = App.data.bySpecies({ filters });
    const total = reg.records.reduce((a, v) => a + v, 0) + reg.unknown;
    const cs = citizenStats();
    let widest = null;
    sps.forEach((s, id) => {
      const n = s.regions.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
      if (!widest || n > widest.n || (n === widest.n && s.total > widest.total)) widest = { id, n, total: s.total };
    });

    $("#stats-kpis").innerHTML = [
      kpi("선택한 자료의 기록", `${fmt(total)}<small>건</small>`, `기록 있는 종 ${sps.size}개`),
      kpi("시민 관찰", `${fmt(cs.verified + cs.pending)}<small>건</small>`, `검증됨 ${fmt(cs.verified)} · 확인 중 ${fmt(cs.pending)}`),
      kpi("참여자", `${fmt(cs.users)}<small>명</small>`, "iNaturalist 관찰자"),
      kpi("최근 30일 새 관찰", `${fmt(cs.last30)}<small>건</small>`),
      kpi("가장 넓게 분포", widest ? esc(S.spById.get(widest.id).name) : "-", widest ? `${widest.n}개 시·도` : ""),
    ].join("");

    const regionRows = R().map((r, i) => ({ key: i, label: r.name, value: reg.records[i] })).sort((a, b) => b.value - a.value);
    $("#chart-region").innerHTML = barList(regionRows, { onClickAttr: "data-region" });
    const regionSpRows = R().map((r, i) => ({ key: i, label: r.name, value: reg.species[i].size })).sort((a, b) => b.value - a.value);
    $("#chart-region-species").innerHTML = barList(regionSpRows, { color: "#1c7ed6", onClickAttr: "data-region" });

    const groupRows = Object.entries(window.TAXON_GROUPS).map(([k, g]) => {
      let v = 0, n = 0;
      sps.forEach((s, id) => { if (S.spById.get(id).group === k) { v += s.total; n++; } });
      return { key: k, label: `${g.label} (${n}종)`, value: v, color: g.color };
    }).sort((a, b) => b.value - a.value);
    $("#chart-group").innerHTML = barList(groupRows);

    const years = new Map();
    sps.forEach((s) => s.years.forEach((v, y) => years.set(y, (years.get(y) || 0) + v)));
    $("#chart-year").innerHTML = yearBars(years);

    // 월별 시민 관찰 (최근 24개월)
    const now = new Date();
    const months = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 23 + i, 1);
      return d.getFullYear() * 100 + d.getMonth() + 1;
    });
    const mcount = new Map(months.map((m) => [m, 0]));
    for (const id in S.inat) for (const o of S.inat[id]) {
      const m = Math.floor(o.date / 100);
      if (mcount.has(m)) mcount.set(m, mcount.get(m) + 1);
    }
    $("#chart-month").innerHTML = vbars(months.map((m) => `${m % 100}월`), months.map((m) => mcount.get(m)), 3);

    renderMatrix(sps);
  };

  let lastMatrix = null;
  const renderMatrix = (sps) => {
    const order = Object.keys(window.TAXON_GROUPS);
    const rows = S.species.map((s) => ({ s, x: sps.get(s.id) }))
      .sort((a, b) => order.indexOf(a.s.group) - order.indexOf(b.s.group) || (b.x ? b.x.total : 0) - (a.x ? a.x.total : 0));
    lastMatrix = rows;
    let max = 1;
    rows.forEach(({ x }) => x && x.regions.forEach((v) => { if (v > max) max = v; }));
    const head = `<thead><tr><th>종 \\ 시·도</th>${R().map((r) => `<th title="${esc(r.name)}">${esc(r.short)}</th>`).join("")}<th class="tot">시·도 수</th><th class="tot">합계</th></tr></thead>`;
    const body = rows.map(({ s, x }) => {
      const cells = R().map((r, i) => {
        const v = x ? x.regions[i] : 0;
        if (!v) return "<td></td>";
        const t = Math.log1p(v) / Math.log1p(max);
        return `<td style="background:${seqColor(t)};color:${t > 0.55 ? "#fff" : "#1d2a20"}" title="${esc(s.name)} · ${esc(r.name)}: ${fmt(v)}건">${short(v)}</td>`;
      }).join("");
      const nReg = x ? x.regions.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) : 0;
      return `<tr><th data-sp="${esc(s.id)}" style="cursor:pointer"><span class="dot" style="background:${App.data.colorOf(s.id)}"></span>${esc(s.name)}</th>${cells}
        <td class="tot">${nReg}</td><td class="tot">${x ? short(x.total) : 0}</td></tr>`;
    }).join("");
    $("#matrix").innerHTML = `<table class="matrix">${head}<tbody>${body}</tbody></table>`;
  };

  const matrixCSV = () => {
    if (!lastMatrix) return;
    const head = ["종", "학명", ...R().map((r) => r.name), "출현 시도 수", "합계"];
    const rows = lastMatrix.map(({ s, x }) => {
      const regs = R().map((r, i) => (x ? x.regions[i] : 0));
      return [s.name, s.sci, ...regs, regs.filter((v) => v > 0).length, x ? x.total : 0];
    });
    download(`시도별_교란생물_분포현황_${App.util.today()}.csv`, toCSV([head, ...rows]), "text/csv;charset=utf-8");
  };

  const setStatsSource = (src) => { statsSource = src; renderStats(); };

  // ================= 참여하기 =================
  const renderJoin = () => {
    const cs = citizenStats();
    const since7 = daysAgo(7);
    let last7 = 0;
    for (const id in S.inat) for (const o of S.inat[id]) if (o.date >= since7) last7++;
    $("#join-kpis").innerHTML = [
      kpi("지금까지 시민 관찰", `${fmt(cs.verified + cs.pending)}<small>건</small>`, `참여자 ${fmt(cs.users)}명`),
      kpi("최근 7일 새 관찰", `${fmt(last7)}<small>건</small>`, `최근 30일 ${fmt(cs.last30)}건`),
      kpi("확인을 기다리는 관찰", `${fmt(cs.pending)}<small>건</small>`, "종 이름을 아시면 도와주세요"),
    ].join("");
    $("#join-identify").href = SRC().identifyUrl(S.species.filter((s) => s.inat).map((s) => s.inat));

    // 한 사람이 같은 종을 몰아서 올린 경우 2장까지만 보여 다양하게
    const seen = new Map();
    const recent = App.data.recentInat({ withPhoto: true, limit: 400 }).filter(({ spId, o }) => {
      const k = `${o.u}|${spId}`;
      seen.set(k, (seen.get(k) || 0) + 1);
      return seen.get(k) <= 2;
    }).slice(0, 24);
    $("#join-recent").innerHTML = recent.length ? recent.map(({ spId, o }) => photoThumb(spId, o)).join("")
      : `<p class="muted">아직 불러온 관찰이 없습니다.</p>`;

    // 최근 1년 많이 기록한 참여자
    const since = daysAgo(365);
    const byUser = new Map();
    for (const id in S.inat) for (const o of S.inat[id]) if (o.date >= since) byUser.set(o.u, (byUser.get(o.u) || 0) + 1);
    const top = [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    $("#join-top").innerHTML = top.length ? `<ol class="rank">${top.map(([u, n]) =>
      `<li><a href="https://www.inaturalist.org/people/${encodeURIComponent(u)}" target="_blank" rel="noopener">${esc(u)}</a><span>${fmt(n)}건</span></li>`).join("")}</ol>`
      : `<p class="muted">최근 1년 기록이 없습니다.</p>`;
  };

  // ================= 자료 안내 =================
  const renderAbout = () => {
    const cs = citizenStats();
    let gbifN = 0;
    const byOrg = new Map();
    for (const id in S.gbif) {
      const e = S.gbif[id];
      gbifN += e.n;
      for (let i = 0; i < e.n; i++) {
        const ds = S.gbifDatasets[e.ds[i]];
        const org = SRC().orgLabel(ds ? ds[2] : "") || "기타";
        byOrg.set(org, (byOrg.get(org) || 0) + 1);
      }
    }
    const when = (iso) => (iso ? new Date(iso).toLocaleString("ko-KR") : "-");
    $("#about-status").innerHTML = `
      <div><b>시민 관찰(iNaturalist)</b> ${fmt(cs.verified + cs.pending)}건 — 검증됨 ${fmt(cs.verified)}, 확인 중 ${fmt(cs.pending)}</div>
      <div class="muted">기본 자료 ${when(S.inatSnapshotAt)} · 마지막 실시간 갱신 ${S.inatSyncedAt ? S.inatSyncedAt.toLocaleString("ko-KR") : "아직 없음"}</div>
      <div style="margin-top:8px"><b>기관·타 플랫폼 기록(GBIF)</b> ${fmt(gbifN)}건 · 자료 기준 ${when(S.gbifAt)}</div>
      <div class="muted">${[...byOrg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([o, n]) => `${esc(o)} ${fmt(n)}건`).join(" · ")}</div>`;
  };

  return {
    catalogState, renderSpecies, speciesDetail, renderStats, setStatsSource, matrixCSV, renderJoin, renderAbout,
  };
})();
