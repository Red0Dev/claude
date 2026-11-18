#!/usr/bin/env python3
"""Filtra candidatos pela distancia entre o endereco deles e o endereco da vaga.

Uso:
  python3 filtro.py vagas.csv candidatos.csv --raio 5 [--saida pasta]

vagas.csv       (separado por ;)  vaga;unidade;endereco
candidatos.csv  (separado por ;)  nome;vaga;endereco;whatsapp

Cada candidato e comparado com todas as unidades da vaga dele e fica com a
mais proxima. Distancia = trajeto de carro (OSRM); se a rota falhar, usa linha reta.
So o endereco e enviado aos servicos de mapa (nunca nome ou telefone).
"""
import argparse, csv, json, math, os, re, sys, time, unicodedata, urllib.parse, urllib.request

UA = "filtro-curriculos/1.0"
AQUI = os.path.dirname(os.path.abspath(__file__))
CACHE_PATH = os.path.join(AQUI, ".cache_geo.json")
_ultimo_nominatim = 0.0


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "pt-BR"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def nominatim(q):
    global _ultimo_nominatim
    espera = 1.1 - (time.time() - _ultimo_nominatim)  # politica de uso: 1 req/s
    if espera > 0:
        time.sleep(espera)
    _ultimo_nominatim = time.time()
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 1, "countrycodes": "br"})
    try:
        res = get_json(url)
    except Exception:
        return None
    if not res:
        return None
    r = res[0]
    rank = int(r.get("place_rank", 0))
    tipo = r.get("addresstype", "")
    if rank >= 26 and tipo not in ("city", "town", "village", "municipality"):
        nivel = "rua"
    elif tipo in ("suburb", "neighbourhood", "quarter", "city_district", "borough", "hamlet"):
        nivel = "bairro"
    else:
        nivel = "cidade"
    return {"lat": float(r["lat"]), "lon": float(r["lon"]), "nivel": nivel, "achado": r["display_name"]}


def variantes(endereco):
    """Tentativas de busca, da mais precisa para a mais generica."""
    cep = re.search(r"\b(\d{5})-?(\d{3})\b", endereco)
    sem_cep = re.sub(r"\b\d{5}-?\d{3}\b", "", endereco)
    sem_cep = re.sub(r"\bcep\b[:\s]*", "", sem_cep, flags=re.I)
    partes = [p.strip(" .") for p in re.split(r",| - | – |/", sem_cep) if p.strip(" .")]
    vs = []
    numero = re.search(r"\b(\d{1,5})\b", sem_cep)
    if cep:
        try:
            d = get_json(f"https://brasilapi.com.br/api/cep/v1/{cep.group(1)}{cep.group(2)}")
            rua = d.get("street") or ""
            if rua and numero:
                rua = f"{rua} {numero.group(1)}"
            vs.append(", ".join(x for x in [rua, d.get("neighborhood"), d.get("city"), d.get("state")] if x))
        except Exception:
            pass
    if len(partes) > 1 or not cep:
        vs.append(", ".join(partes))
    sem_num = [re.sub(r"\b(n[ºo°.]?\s*)?\d{1,5}\b", "", p, flags=re.I).strip() for p in partes]
    sem_num = [p for p in sem_num if p]
    vs.append(", ".join(sem_num))
    for i in range(1, len(sem_num) - 1):  # vai largando a rua, depois o bairro...
        vs.append(", ".join(sem_num[i:]))
    vistos, out = set(), []
    for v in vs:
        if v and norm(v) not in vistos:
            vistos.add(norm(v)); out.append(v)
    return out


def geocode(endereco, cache):
    chave = norm(endereco)
    if chave in cache:
        return cache[chave]
    achado = None
    for v in variantes(endereco):
        achado = nominatim(v)
        if achado:
            break
    cache[chave] = achado
    with open(CACHE_PATH, "w") as f:
        json.dump(cache, f, ensure_ascii=False, indent=1)
    return achado


def linha_reta_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def rota_km(a, b):
    url = (f"https://router.project-osrm.org/route/v1/driving/"
           f"{a['lon']},{a['lat']};{b['lon']},{b['lat']}?overview=false")
    try:
        r = get_json(url)
        if r.get("code") == "Ok":
            return r["routes"][0]["distance"] / 1000, "rota"
    except Exception:
        pass
    return linha_reta_km(a, b), "linha reta"


def ler_csv(caminho):
    with open(caminho, encoding="utf-8-sig") as f:
        cabecalho = f.readline(); f.seek(0)
        sep = ";" if cabecalho.count(";") >= cabecalho.count(",") else ","
        return [{norm(k): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(f, delimiter=sep)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vagas"); ap.add_argument("candidatos")
    ap.add_argument("--raio", type=float, required=True, help="distancia maxima em km")
    ap.add_argument("--saida", default=".")
    a = ap.parse_args()

    cache = json.load(open(CACHE_PATH)) if os.path.exists(CACHE_PATH) else {}
    unidades = {}
    for v in ler_csv(a.vagas):
        g = geocode(v["endereco"], cache)
        if not g:
            sys.exit(f"Nao consegui localizar o endereco da vaga: {v['endereco']}")
        unidades.setdefault(norm(v["vaga"]), []).append({**v, "geo": g})

    aprovados, fora, sem_local = [], [], []
    for c in ler_csv(a.candidatos):
        opcoes = unidades.get(norm(c["vaga"]))
        if not opcoes:
            sem_local.append({**c, "motivo": f"vaga '{c['vaga']}' nao cadastrada"}); continue
        g = geocode(c["endereco"], cache) if c.get("endereco") else None
        if not g or g["nivel"] == "cidade":
            sem_local.append({**c, "motivo": "endereco incompleto/nao encontrado no mapa"}); continue
        melhor = None
        for u in opcoes:
            km, tipo = rota_km(g, u["geo"])
            if not melhor or km < melhor[0]:
                melhor = (km, tipo, u)
        km, tipo, u = melhor
        if linha_reta_km(g, u["geo"]) > 100:  # achou um lugar com o mesmo nome em outro estado
            sem_local.append({**c, "motivo": f"endereco caiu longe demais ({g['achado']}) - conferir"}); continue
        linha = {"nome": c["nome"], "vaga": c["vaga"], "unidade": u.get("unidade") or "",
                 "endereco_vaga": u["endereco"], "whatsapp": c.get("whatsapp", ""),
                 "km": round(km, 1), "medida": tipo, "precisao": g["nivel"]}
        (aprovados if km <= a.raio else fora).append(linha)

    aprovados.sort(key=lambda r: (norm(r["vaga"]), r["km"]))
    fora.sort(key=lambda r: (norm(r["vaga"]), r["km"]))
    os.makedirs(a.saida, exist_ok=True)
    for nome, linhas in (("aprovados", aprovados), ("fora_do_raio", fora), ("sem_localizacao", sem_local)):
        if not linhas:
            continue
        with open(os.path.join(a.saida, f"{nome}.csv"), "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(linhas[0].keys()), delimiter=";")
            w.writeheader(); w.writerows(linhas)
    print(json.dumps({"aprovados": aprovados, "fora_do_raio": fora, "sem_localizacao": sem_local},
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
