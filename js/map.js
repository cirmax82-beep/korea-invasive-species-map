// 분포지도 (Leaflet + OpenStreetMap)
App.map = (() => {
  const { esc, fmt, seqColor, SEQ } = App.util;
  const S = App.state;
  const SRC = () => App.sources;

  let map, cluster, heat, choro;
  let openRegion = null;
  let lastRegionStats = null;
  let clusterKey = "";
  const inatMarkers = new WeakMap();   // 관찰 객체 → 마커
  const gbifMarkers = new WeakMap();   // GBIF 엔트리 → 마커 배열
  const icons = {};

  // 출처별 모양: 검증됨 ● / 확인 중 ○ / 기관·타 플랫폼 ■
  const icon = (source, color) => {
    const k = source + color;
    if (!icons[k]) {
      const size = source === "gbif" ? 8 : 11;
      icons[k] = L.divIcon({
        className: "",
        html: `<div class="pt pt-${source}" style="--c:${color}"></div>`,
        iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      });
    }
    return icons[k];
  };

  const regionName = (idx) => (idx >= 0 && App.geo.regions[idx] ? App.geo.regions[idx].name : "미상");
  const fmtDate = (d) => (d ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}` : "날짜 미상");

  const init = () => {
    map = L.map("map", { minZoom: 6, maxZoom: 18, maxBounds: [[30.5, 121], [40.5, 134.5]], zoomSnap: 0.5 })
      .setView([36.0, 127.8], 7);
    const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
    const osm = (cls) => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: osmAttr, className: cls });
    const base = {
      "밝은 지도": osm("tiles-muted"),
      "일반 지도": osm(""),
      "위성 영상": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
      }),
    };
    base["밝은 지도"].addTo(map);
    L.control.layers(base, null, { position: "topright" }).addTo(map);
    L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
    map.attributionControl.addAttribution('관찰: <a href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>, <a href="https://www.gbif.org" target="_blank" rel="noopener">GBIF</a>');

    L.geoJSON(window.KR_PROVINCES, {
      interactive: false,
      style: { className: "prov-line", weight: 1.1, opacity: 1, fill: false },
    }).addTo(map);

    cluster = L.markerClusterGroup({
      chunkedLoading: true,
      showCoverageOnHover: false,
      maxClusterRadius: 48,
      disableClusteringAtZoom: 16,
      iconCreateFunction: (c) => {
        const n = c.getChildCount();
        const size = n < 10 ? 28 : n < 100 ? 34 : n < 1000 ? 42 : 50;
        const label = n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n;
        return L.divIcon({ className: "", html: `<div class="cluster" style="width:${size}px;height:${size}px">${label}</div>`, iconSize: [size, size] });
      },
    });
    cluster.on("click", (e) => {
      const o = e.layer.options;
      const html = o.src === "gbif" ? gbifPopup(o.spId, o.ref) : inatPopup(o.spId, o.ref);
      L.popup({ maxWidth: 280, minWidth: 240 }).setLatLng(e.layer.getLatLng()).setContent(html).openOn(map);
    });

    heat = L.heatLayer([], {
      radius: 14, blur: 16, maxZoom: 14, minOpacity: 0.08,
      gradient: { 0.2: "#4dabf7", 0.4: "#51cf66", 0.6: "#fcc419", 0.8: "#ff922b", 1: "#e03131" },
    });

    choro = L.geoJSON(window.KR_PROVINCES, {
      style: () => ({ weight: 1, color: "#fff", fillOpacity: 0.85, fillColor: "#eee" }),
      onEachFeature: (feat, layer) => {
        layer.on({
          mouseover: (e) => e.target.setStyle({ weight: 2.5, color: "#173a24" }),
          mouseout: (e) => e.target.setStyle({ weight: 1, color: "#fff" }),
          click: () => showRegion(App.geo.byCode.get(feat.properties.code)),
        });
      },
    });
  };

  // ---------- 팝업 ----------
  const speciesHead = (spId, badge) => {
    const sp = S.spById.get(spId) || { name: "", sci: "" };
    return `<div class="pop-title"><span class="dot" style="background:${App.data.colorOf(spId)}"></span>${esc(sp.name)} ${badge}</div>
      <div class="pop-sci">${esc(sp.sci)}</div>`;
  };

  const inatPopup = (spId, o) => {
    const src = SRC();
    const sp = S.spById.get(spId) || { name: "" };
    const st = App.data.SOURCES[o.q ? "verified" : "pending"];
    const url = src.obsUrl(o.id);
    const photo = o.ph
      ? `<a href="${url}" target="_blank" rel="noopener" class="pop-photo-link"><img class="pop-photo" src="${src.photoUrl(o.ph, "small")}" alt="${esc(sp.name)} 관찰 사진" loading="lazy"></a>
         <div class="pop-credit">© ${esc(o.u)} · ${esc(src.licenseLabel(o.lic))}</div>`
      : `<a class="pop-nophoto" href="${url}" target="_blank" rel="noopener">${o.np ? "사진은 iNaturalist에서 보기 ↗" : "사진 없음"}</a>`;
    const loc = o.obsc ? "위치 흐림(관찰자 보호 설정)" : o.acc > 1000 ? `오차 약 ${fmt(Math.round(o.acc / 100) / 10)} km` : "";
    return `${photo}
      ${speciesHead(spId, `<span class="badge ${st.badge}">${st.short}</span>`)}
      <div class="pop-row"><span>관찰일</span><span>${fmtDate(o.date)}</span></div>
      <div class="pop-row"><span>장소</span><span>${esc(o.pl || regionName(o.reg))}</span></div>
      <div class="pop-row"><span>관찰자</span><span>${esc(o.u)}</span></div>
      ${loc ? `<div class="pop-row"><span>위치</span><span>${esc(loc)}</span></div>` : ""}
      <div class="pop-actions">
        <a class="btn btn-primary btn-sm" href="${url}" target="_blank" rel="noopener">iNaturalist에서 보기 ↗</a>
      </div>
      ${o.q ? "" : `<div class="pop-help">종 이름을 아시면 iNaturalist에서 확인을 도와주세요. 의견이 모이면 ‘검증됨’이 됩니다.</div>`}`;
  };

  const gbifPopup = (spId, i) => {
    const src = SRC();
    const e = S.gbif[spId];
    if (!e) return "";
    const ds = S.gbifDatasets[e.ds[i]];
    return `${speciesHead(spId, `<span class="badge badge-gray">기관·타 플랫폼</span>`)}
      <div class="pop-row"><span>연도</span><span>${e.year[i] || "미상"}</span></div>
      <div class="pop-row"><span>지역</span><span>${esc(regionName(e.region[i]))}</span></div>
      <div class="pop-row"><span>유형</span><span>${esc(src.basisLabel(e.basis[i]))}</span></div>
      ${ds ? `<div class="pop-row"><span>출처</span><span>${esc([src.orgLabel(ds[2]), ds[1]].filter(Boolean).join(" · "))}</span></div>` : ""}
      <div class="pop-actions"><a class="btn btn-light btn-sm" href="${src.gbifOccUrl(e.key[i])}" target="_blank" rel="noopener">GBIF 원본 기록 ↗</a></div>`;
  };

  // ---------- 레이어 ----------
  const markerFor = (spId, lat, lng, source, ref) => {
    if (source === "gbif") {
      const e = S.gbif[spId];
      let arr = gbifMarkers.get(e);
      if (!arr) { arr = new Array(e.n); gbifMarkers.set(e, arr); }
      return arr[ref] || (arr[ref] = L.marker([lat, lng], { icon: icon("gbif", App.data.colorOf(spId)), keyboard: false, src: "gbif", spId, ref }));
    }
    let m = inatMarkers.get(ref);
    if (!m) {
      m = L.marker([lat, lng], { icon: icon(source, App.data.colorOf(spId)), keyboard: false, src: source, spId, ref });
      inatMarkers.set(ref, m);
    }
    return m;
  };

  const renderCluster = (on) => {
    if (!on) { cluster.clearLayers(); if (map.hasLayer(cluster)) map.removeLayer(cluster); clusterKey = ""; return; }
    const batch = [];
    let h = 0;
    App.data.each((spId, lat, lng, y, reg, source, ref) => {
      const m = markerFor(spId, lat, lng, source, ref);
      h = (h * 31 + L.stamp(m)) | 0;
      batch.push(m);
    });
    // 표시할 마커가 그대로면 다시 그리지 않음(자동 갱신 때 깜빡임 방지)
    const key = `${batch.length}:${h}`;
    if (key !== clusterKey) {
      cluster.clearLayers();
      cluster.addLayers(batch);
      clusterKey = key;
    }
    if (!map.hasLayer(cluster)) map.addLayer(cluster);
  };

  const renderHeat = (on) => {
    if (!on) { if (map.hasLayer(heat)) map.removeLayer(heat); return; }
    const pts = [];
    App.data.each((spId, lat, lng) => pts.push([lat, lng, 1]));
    if (!map.hasLayer(heat)) map.addLayer(heat);
    heat.setLatLngs(pts);
  };

  let choroScale = { max: 0, min: 0, metric: "records" };
  const renderChoro = (on) => {
    if (!on) { if (map.hasLayer(choro)) map.removeLayer(choro); return; }
    const stats = App.data.byRegion();
    lastRegionStats = stats;
    const metric = S.choroMetric;
    const vals = metric === "species" ? stats.species.map((m) => m.size) : stats.records;
    const max = Math.max(0, ...vals);
    const nz = vals.filter((v) => v > 0);
    const min = nz.length ? Math.min(...nz) : 0;
    choroScale = { max, min, metric };
    const f = metric === "species" ? (v) => v : Math.log;
    const span = f(max) - f(min || 1);
    choro.eachLayer((layer) => {
      const idx = App.geo.byCode.get(layer.feature.properties.code);
      const v = vals[idx];
      const t = !v ? 0 : span > 0 ? 0.1 + 0.9 * ((f(v) - f(min)) / span) : 1;
      layer.setStyle({ fillColor: seqColor(t) || "#f4f5f2", fillOpacity: 0.85 });
      layer.unbindTooltip();
      const bs = stats.bySource[idx];
      layer.bindTooltip(
        `<b>${esc(App.geo.regions[idx].name)}</b><br>기록 ${fmt(stats.records[idx])}건 · ${stats.species[idx].size}종<br>` +
        `검증됨 ${fmt(bs.verified)} · 확인 중 ${fmt(bs.pending)} · 기관 ${fmt(bs.gbif)}`,
        { sticky: true, className: "region-tooltip" },
      );
    });
    if (!map.hasLayer(choro)) { map.addLayer(choro); choro.bringToBack(); }
  };

  const renderSummary = () => {
    const c = { verified: 0, pending: 0, gbif: 0 };
    const sp = new Set();
    App.data.each((spId, lat, lng, y, reg, source) => { c[source]++; sp.add(spId); });
    const total = c.verified + c.pending + c.gbif;
    const mode = S.mapMode;
    let legend = "";
    if (mode === "cluster") {
      const groups = new Set([...sp].map((id) => S.spById.get(id).group));
      legend = `<div class="legend-row">${Object.entries(window.TAXON_GROUPS)
        .filter(([k]) => groups.has(k))
        .map(([, g]) => `<span class="legend-item"><span class="dot" style="background:${g.color}"></span>${g.label}</span>`).join("")}</div>
        <div class="legend-row legend-shapes">
          <span class="legend-item"><span class="pt pt-verified" style="--c:var(--text-2)"></span>검증됨</span>
          <span class="legend-item"><span class="pt pt-pending" style="--c:var(--text-2)"></span>확인 중</span>
          <span class="legend-item"><span class="pt pt-gbif" style="--c:var(--text-2)"></span>기관·타 플랫폼</span>
        </div>`;
    } else if (mode === "heat") {
      legend = `<div class="legend-scale" style="background:linear-gradient(90deg,#4dabf7,#51cf66,#fcc419,#ff922b,#e03131);height:10px;border-radius:3px"></div>
        <div class="legend-scale-labels"><span>적음</span><span>기록 밀도</span><span>많음</span></div>`;
    } else {
      const label = choroScale.metric === "species" ? "출현 종 수" : "기록 수(로그 척도)";
      legend = `<div class="legend-scale">${SEQ.slice(1).map((col) => `<span style="background:${col}"></span>`).join("")}</div>
        <div class="legend-scale-labels"><span>${fmt(choroScale.min || 0)}</span><span>${label}</span><span>${fmt(choroScale.max)}</span></div>`;
    }
    document.getElementById("map-summary").innerHTML = `
      <div class="sum-main">${fmt(total)}건 · ${sp.size}종 표시 중</div>
      <div class="muted" style="margin-bottom:6px">검증됨 ${fmt(c.verified)} · 확인 중 ${fmt(c.pending)} · 기관 ${fmt(c.gbif)}</div>
      ${legend}`;
  };

  const render = () => {
    if (!map) return;
    const mode = S.mapMode;
    renderCluster(mode === "cluster");
    renderHeat(mode === "heat");
    renderChoro(mode === "choropleth");
    renderSummary();
    if (openRegion != null) showRegion(openRegion, true);
  };

  // ---------- 시·도 패널 ----------
  const showRegion = (idx, refresh) => {
    if (idx == null || idx < 0) return;
    openRegion = idx;
    const stats = (refresh || !lastRegionStats) ? App.data.byRegion() : lastRegionStats;
    lastRegionStats = stats;
    const reg = App.geo.regions[idx];
    const m = stats.species[idx];
    const bs = stats.bySource[idx];
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const max = list.length ? list[0][1] : 0;
    const panel = document.getElementById("region-panel");
    panel.innerHTML = `
      <div class="rp-head">
        <div><h2>${esc(reg.name)}</h2><div class="muted small">현재 필터 기준</div></div>
        <button class="icon-btn" id="rp-close" aria-label="닫기">✕</button>
      </div>
      <div class="rp-body">
        <div class="rp-stats">
          <div class="rp-stat"><b>${fmt(stats.records[idx])}</b><span>전체 기록</span></div>
          <div class="rp-stat"><b>${m.size}</b><span>출현 종</span></div>
          <div class="rp-stat"><b>${fmt(bs.verified)}</b><span>시민 관찰 · 검증됨</span></div>
          <div class="rp-stat"><b>${fmt(bs.pending)}</b><span>시민 관찰 · 확인 중</span></div>
        </div>
        <h3 style="margin-bottom:8px">종별 기록</h3>
        ${list.length ? `<div class="bars">${list.map(([id, n]) => {
          const sp = S.spById.get(id);
          return `<div class="bar-row clickable" data-sp="${esc(id)}" title="이 종만 지도에 표시">
            <span class="bar-label">${esc(sp.name)}</span>
            <span class="bar-track"><span class="bar-fill" style="display:block;width:${(n / max) * 100}%;background:${App.data.colorOf(id)}"></span></span>
            <span class="bar-val">${fmt(n)}</span></div>`;
        }).join("")}</div>` : `<p class="muted">현재 필터 조건에서 기록이 없습니다.</p>`}
      </div>`;
    panel.hidden = false;
    panel.querySelector("#rp-close").onclick = () => { panel.hidden = true; openRegion = null; };
    panel.querySelectorAll("[data-sp]").forEach((el) => {
      el.onclick = () => App.ui.selectOnlySpecies(el.dataset.sp);
    });
  };

  const flyToRegion = (idx) => {
    const layer = choro.getLayers().find((l) => App.geo.byCode.get(l.feature.properties.code) === idx);
    if (layer) map.fitBounds(layer.getBounds(), { padding: [40, 40] });
  };

  const invalidate = () => map && map.invalidateSize();
  const setView = (lat, lng, zoom) => map && map.setView([lat, lng], zoom);

  return { init, render, showRegion, flyToRegion, invalidate, setView };
})();
