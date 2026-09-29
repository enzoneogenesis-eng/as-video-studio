"""Entrega fiable de costes al SaaS sin frenar renders.
Si HTTP falla, persiste el evento en JSONL y lo reintenta en llamadas futuras.
"""
import json, os, time, urllib.request
from pathlib import Path
URL=os.environ.get("SAAS_COST_URL","").strip()
SECRET=os.environ.get("INTERNAL_COST_SECRET","").strip()
OUTBOX=Path(os.environ.get("SAAS_COST_OUTBOX",".as-video-studio/cost-outbox.jsonl"))
def _post(payload):
    req=urllib.request.Request(URL,data=json.dumps(payload).encode("utf-8"),headers={"Content-Type":"application/json","X-Studio-Cost-Secret":SECRET},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=2) as r:return 200<=r.status<300
    except Exception:return False
def _guardar(payload):
    try:
        OUTBOX.parent.mkdir(parents=True,exist_ok=True)
        with OUTBOX.open("a",encoding="utf-8") as f:f.write(json.dumps(payload,ensure_ascii=False)+"\n")
    except Exception:pass
def vaciar_pendientes(max_eventos=25):
    if not URL or not SECRET or not OUTBOX.exists():return 0
    try: lineas=OUTBOX.read_text(encoding="utf-8").splitlines()
    except Exception:return 0
    quedan=[]; enviados=0
    for i,linea in enumerate(lineas):
        if enviados>=max_eventos:quedan.extend(lineas[i:]);break
        try:p=json.loads(linea)
        except Exception:continue
        if _post(p):enviados+=1
        else:quedan.append(linea)
    try:
        tmp=OUTBOX.with_suffix(".tmp");tmp.write_text(("\n".join(quedan)+"\n") if quedan else "",encoding="utf-8");tmp.replace(OUTBOX)
    except Exception:pass
    return enviados
def enviar_coste(registro,proyecto_id,user_id=None,job_id=None):
    if not URL or not SECRET:return False
    vaciar_pendientes(5)
    payload={"eventId":f"{proyecto_id}:{registro.get('id')}","projectId":proyecto_id,"userId":user_id,"jobId":job_id,"provider":registro.get("proveedor"),"operation":registro.get("operacion"),"paso":registro.get("paso"),"unidad":registro.get("unidad"),"tokens":registro.get("tokens") or {},"cantidad":registro.get("cantidad") or {},"usd":registro.get("usd"),"createdAt":int(time.time())}
    if _post(payload):return True
    _guardar(payload);return False
