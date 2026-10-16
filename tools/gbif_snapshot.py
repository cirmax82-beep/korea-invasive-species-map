"""GBIF 국내 관찰기록 스냅샷 생성기.

공유(아티팩트) 버전은 브라우저에서 GBIF API를 직접 부를 수 없으므로,
이 스크립트로 받은 자료를 data/gbif-snapshot.json 으로 함께 게시합니다.

    python tools/gbif_snapshot.py
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.gbif.org/v1/occurrence/search"
PAGE = 300
MAX_PER_SPECIES = 12000
# iNaturalist 검증 관찰은 앱이 iNaturalist에서 직접 받으므로 GBIF에서는 뺌(중복 방지)
INAT_DATASET = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"
BASIS_CODE = {
    "HUMAN_OBSERVATION": 1, "OBSERVATION": 1, "PRESERVED_SPECIMEN": 2, "MACHINE_OBSERVATION": 3,
    "MATERIAL_SAMPLE": 4, "OCCURRENCE": 5, "LIVING_SPECIMEN": 6,
}


def load_species():
    src = (ROOT / "js" / "data-species.js").read_text(encoding="utf-8")
    out = []
    for m in re.finditer(r'\{ id: "([^"]+)", name: "([^"]+)".*?gbif: (\d+|null)', src):
        if m.group(3) != "null":
            out.append((m.group(1), m.group(2), int(m.group(3))))
    return out


def load_gadm_index():
    src = (ROOT / "js" / "data-regions.js").read_text(encoding="utf-8")
    gj = json.loads(src[src.index("window.KR_PROVINCES = ") + len("window.KR_PROVINCES = "):].rstrip().rstrip(";"))
    return {f["properties"]["gadm"]: i for i, f in enumerate(gj["features"])}


def fetch(taxon_key, offset):
    qs = urllib.parse.urlencode({
        "country": "KR", "taxonKey": taxon_key, "hasCoordinate": "true", "hasGeospatialIssue": "false",
        "occurrenceStatus": "PRESENT", "limit": PAGE, "offset": offset,
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f"{API}?{qs}", timeout=60) as r:
                return json.load(r)
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1 + attempt)


def species_records(sp, gadm):
    sid, name, key = sp
    first = fetch(key, 0)
    total = first["count"]
    results = list(first["results"])
    for off in range(PAGE, min(total, MAX_PER_SPECIES), PAGE):
        results.extend(fetch(key, off)["results"])
    seen, cols = set(), {k: [] for k in ("lat", "lng", "year", "key", "region", "basis", "ds")}
    for r in results:
        if r.get("decimalLatitude") is None or r["key"] in seen or r.get("datasetKey") == INAT_DATASET:
            continue
        seen.add(r["key"])
        gid = ((r.get("gadm") or {}).get("level1") or {}).get("gid")
        cols["lat"].append(round(r["decimalLatitude"], 5))
        cols["lng"].append(round(r["decimalLongitude"], 5))
        cols["year"].append(r.get("year") or 0)
        cols["key"].append(r["key"])
        cols["region"].append(gadm.get(gid, -1))   # -1이면 앱이 좌표로 판별
        cols["basis"].append(BASIS_CODE.get(r.get("basisOfRecord"), 0))
        cols["ds"].append(r.get("datasetKey") or "")
    print(f"  {name}: {len(cols['key']):,}/{total:,}", flush=True)
    return sid, {"taxonKey": key, "total": total, **cols}


_orgs = {}


def fetch_title(key):
    """자료 묶음 제목과 자료를 낸 기관 이름."""
    try:
        with urllib.request.urlopen(f"https://api.gbif.org/v1/dataset/{key}", timeout=60) as r:
            ds = json.load(r)
        org = ds.get("publishingOrganizationKey")
        if org and org not in _orgs:
            with urllib.request.urlopen(f"https://api.gbif.org/v1/organization/{org}", timeout=60) as r:
                _orgs[org] = json.load(r).get("title", "")
        return ds.get("title", ""), _orgs.get(org, "")
    except Exception:
        return "", ""


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    species, gadm = load_species(), load_gadm_index()
    print(f"GBIF에서 {len(species)}종을 받습니다…")
    with ThreadPoolExecutor(max_workers=4) as ex:
        entries = dict(ex.map(lambda s: species_records(s, gadm), species))
    # 자료 묶음(dataset) 키를 번호로 바꾸고 제목을 함께 저장 → 팝업에 "출처: 네이처링 …" 표시
    keys = sorted({k for e in entries.values() for k in e["ds"] if k})
    titles = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for k, t in zip(keys, ex.map(lambda k: fetch_title(k), keys)):
            titles[k] = t
    index = {k: i for i, k in enumerate(keys)}
    for e in entries.values():
        e["ds"] = [index.get(k, -1) for k in e["ds"]]
    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "GBIF.org occurrence search (country=KR, iNaturalist 제외)",
        "datasets": [[k, *titles[k]] for k in keys],   # [키, 제목, 기관]
        "species": entries,
    }
    path = ROOT / "data" / "gbif-snapshot.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = sum(len(e["key"]) for e in entries.values())
    print(f"저장: {path} ({n:,}건, {path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
