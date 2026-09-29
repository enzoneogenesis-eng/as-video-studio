# SaaS MVP — arquitectura

Rama: `saas-mvp`.

## Principios de calidad
- Ledger de creditos append-only: nunca se pisa saldo.
- Dinero en micro-USD: evita errores de coma flotante.
- Cada uso de IA registra usuario, proyecto, trabajo, proveedor, modelo, coste, creditos y estado.
- Una generacion fallida se registra pero no debe consumir creditos.
- Ajustes manuales de creditos quedan auditados.
- `main` permanece estable; el SaaS se integra por PR tras pruebas.

## Panel Super Admin
`GET /api/admin/dashboard`: clientes, ingresos netos de fees, coste IA, beneficio bruto, margen, proyectos y fallos.
`GET /api/admin/customers`: rentabilidad y creditos por cliente.
`GET /api/admin/usage`: consumo IA.
`GET /api/admin/audit`: acciones administrativas.
`POST /api/admin/customers/:id/credits`: regalar/quitar creditos con auditoria.

## Cliente
`GET /api/billing/credits`: saldo e historial.

## Siguiente etapa
Conectar eventos reales de `nucleo/coste.py` al ledger SaaS; webhooks idempotentes de Stripe/Mercado Pago; cola de trabajos y reembolsos automaticos; UI Super Admin; pruebas de concurrencia y recuperacion.
