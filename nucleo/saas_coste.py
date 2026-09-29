"""Puente opcional entre nucleo.coste y el ledger comercial SaaS.
No bloquea el pipeline si el panel esta caido. Reintentos/cola persistente se
anadiran antes de produccion para garantizar entrega eventual.
"""
import json, os, urllib.request
URL=os.environ.get("SAAS_COST_URL","").strip()
SECRET=os.environ.get("INTERNAL_COST_SECRET","").strip()
def enviar_coste(registro, proyecto_id, user_id=None, job_id=None):
    if not URL or not SECRET:
        return False
    payload={
        "eventId": f"{proyecto_id}:{registro.get('id')}",
        "projectId": proyecto_id, "userId": user_id, "jobId": job_id,
        "provider": registro.get("proveedor"), "operation": registro.get("operacion"),
        "paso": registro.get("paso"), "unidad": registro.get("unidad"),
        "tokens": registro.get("tokens") or {}, "cantidad": registro.get("cantidad") or {},
        "usd": registro.get("usd"),
    }
    req=urllib.request.Request(URL,data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type":"application/json","X-Studio-Cost-Secret":SECRET},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=2) as response:
            return 200 <= response.status < 300
    except Exception:
        return False
