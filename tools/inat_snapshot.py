"""iNaturalist 국내 교란생물 관찰 스냅샷 생성기.

앱은 이 스냅샷을 먼저 읽고, 그 뒤에 바뀐 관찰만 iNaturalist API에서 실시간으로 받아 합칩니다.
방문자마다 수십 번씩 API를 부르지 않도록 하기 위한 것입니다. 하루 한 번 정도 다시 만들면 충분합니다.

    python tools/inat_snapshot.py

사진은 CC 라이선스가 붙은 것만 미리보기 대상으로 저장합니다(‘모든 권리 보유’ 사진은 링크만).
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://api.inaturalist.org/v2/observations"
PLACE_KOREA = 6891
UA = {"User-Agent": "invasive-species-map-korea/1.0 (citizen science map; snapshot)"}
FIELDS = ("id,quality_grade,observed_on,location,place_guess,obscured,positional_accuracy,"
          "user.login,photos.url,photos.license_code")


def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except Exception:
            if attempt == 4:
                raise
            time.sleep(3 * (attempt + 1))


def load_species():
    src = (ROOT / "js" / "data-species.js").read_text(encoding="utf-8")
    return [(m.group(1), m.group(2), int(m.group(3)))
            for m in re.finditer(r'\{ id: "([^"]+)", name: "([^"]+)".*?inat: (\d+)', src)]


def short_photo(photos):
    """CC 라이선스 사진 1장을 'o123.jpg'(open-data) 또는 's123.jpg'(static) 꼴로 줄여 저장."""
    for p in photos or []:
        lic = p.get("license_code")
        url = p.get("url") or ""
        m = re.search(r"//(inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)/photos/(\d+)/square\.(\w+)", url)
        if lic and m:
            host = "o" if m.group(1).startswith("inaturalist-open-data") else "s"
            return f"{host}{m.group(2)}.{m.group(3)}", lic
    return "", ""


def pack(o):
    lat, lng = (float(v) for v in o["location"].split(","))
    date = int((o.get("observed_on") or "0").replace("-", "") or 0)
    photo, lic = short_photo(o.get("photos"))
    acc = o.get("positional_accuracy")
    return [o["id"], round(lat, 5), round(lng, 5), date, 1 if o["quality_grade"] == "research" else 0,
            -1 if acc is None else int(acc), 1 if o.get("obscured") else 0,
            (o.get("user") or {}).get("login", ""), (o.get("place_guess") or "")[:60], photo, lic,
            len(o.get("photos") or [])]


def fetch_species(taxon_id):
    rows, last = [], 0
    while True:
        qs = urllib.parse.urlencode({
            "place_id": PLACE_KOREA, "taxon_id": taxon_id, "verifiable": "true", "per_page": 200,
            "order_by": "id", "order": "asc", "id_above": last, "fields": FIELDS,
        })
        d = get(f"{API}?{qs}")
        res = d.get("results", [])
        rows += [pack(o) for o in res if o.get("location")]
        if len(res) < 200:
            return rows
        last = res[-1]["id"]
        time.sleep(1.0)   # iNaturalist 권장: 초당 1회 이하


def taxon_photos(ids):
    out = {}
    results = []
    for i in range(0, len(ids), 20):   # 한 번에 너무 많이 요청하면 422 오류
        results += get("https://api.inaturalist.org/v1/taxa/" + ",".join(map(str, ids[i:i + 20]))).get("results", [])
        time.sleep(1.0)
    for t in results:
        p = t.get("default_photo") or {}
        url = p.get("square_url") or ""
        m = re.search(r"//(inaturalist-open-data\.s3\.amazonaws\.com|static\.inaturalist\.org)/photos/(\d+)/square\.(\w+)", url)
        if m and p.get("license_code"):
            host = "o" if m.group(1).startswith("inaturalist-open-data") else "s"
            out[t["id"]] = {"photo": f"{host}{m.group(2)}.{m.group(3)}", "lic": p["license_code"],
                            "by": p.get("attribution", "")}
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    species = load_species()
    started = datetime.now(timezone.utc)
    obs, taxa, total = {}, {}, 0
    photos = taxon_photos([t for _, _, t in species])
    for sid, name, tid in species:
        rows = fetch_species(tid)
        obs[sid] = rows
        taxa[sid] = {"id": tid, **photos.get(tid, {})}
        total += len(rows)
        verified = sum(r[4] for r in rows)
        print(f"  {name}: {len(rows):,}건 (검증됨 {verified:,})", flush=True)
        time.sleep(1.0)
    out = {
        "generatedAt": started.isoformat(timespec="seconds"),
        "source": "iNaturalist (place_id=6891, verifiable=true)",
        "place_id": PLACE_KOREA,
        "columns": ["id", "lat", "lng", "date", "verified", "accuracy_m", "obscured", "user", "place", "photo", "license", "photos"],
        "taxa": taxa,
        "obs": obs,
    }
    path = ROOT / "data" / "inat-snapshot.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장: {path} ({total:,}건, {path.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
