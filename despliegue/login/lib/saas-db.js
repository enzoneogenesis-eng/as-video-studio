'use strict';
/**
 * Ledger financiero del SaaS.
 * Dinero en micro-USD (1 USD = 1.000.000) y creditos en enteros para evitar
 * errores de punto flotante. Los movimientos son append-only.
 */
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  price_microusd INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES plans(id), status TEXT NOT NULL DEFAULT 'active',
  provider TEXT, provider_ref TEXT, started_at TEXT NOT NULL DEFAULT (datetime('now')),
  current_period_end TEXT, cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL, kind TEXT NOT NULL, reference_type TEXT, reference_id TEXT,
  note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_credit_user ON credit_ledger(user_id,id);
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT,
  payload_hash TEXT,
  processed_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider,event_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL, provider_ref TEXT,
  plan_code TEXT, credits_granted INTEGER NOT NULL DEFAULT 0,
  amount_microusd INTEGER NOT NULL, fee_microusd INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS usage_imports (
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(source,source_event_id)
);
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  project_id TEXT, job_id TEXT, provider TEXT NOT NULL, model TEXT,
  operation TEXT NOT NULL, units_json TEXT,
  cost_microusd INTEGER NOT NULL DEFAULT 0,
  credits_charged INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'succeeded', error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON ai_usage(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_project ON ai_usage(project_id,created_at);
CREATE TABLE IF NOT EXISTS credit_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_key TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL CHECK(credits > 0),
  project_id TEXT, operation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved',
  usage_id INTEGER REFERENCES ai_usage(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_reservation_user ON credit_reservations(user_id,status);
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, target_type TEXT, target_id TEXT, detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO plans(code,name,price_microusd,credits) VALUES
 ('starter','Starter',19000000,100),('creator','Creator',39000000,300),('pro','Pro',79000000,800);
`);

const q = {
  balance: db.prepare('SELECT COALESCE(SUM(delta),0) balance FROM credit_ledger WHERE user_id=?'),
  ledger: db.prepare('SELECT * FROM credit_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?'),
  addCredit: db.prepare('INSERT INTO credit_ledger(user_id,delta,kind,reference_type,reference_id,note) VALUES(?,?,?,?,?,?)'),
  addUsage: db.prepare(`INSERT INTO ai_usage(user_id,project_id,job_id,provider,model,operation,units_json,cost_microusd,credits_charged,status,error_code)
    VALUES(@user_id,@project_id,@job_id,@provider,@model,@operation,@units_json,@cost_microusd,@credits_charged,@status,@error_code)`),
  reservationByKey: db.prepare('SELECT * FROM credit_reservations WHERE reservation_key=?'),
  addReservation: db.prepare('INSERT INTO credit_reservations(reservation_key,user_id,credits,project_id,operation) VALUES(?,?,?,?,?)'),
  settleReservation: db.prepare("UPDATE credit_reservations SET status=?,usage_id=?,settled_at=datetime('now') WHERE id=? AND status='reserved'"),
  usageImport: db.prepare('SELECT * FROM usage_imports WHERE source=? AND source_event_id=?'),
  addUsageImport: db.prepare('INSERT INTO usage_imports(source,source_event_id) VALUES(?,?)'),
  paymentEvent: db.prepare('SELECT * FROM payment_events WHERE provider=? AND event_id=?'),
  addPaymentEvent: db.prepare('INSERT INTO payment_events(provider,event_id,event_type,payload_hash) VALUES(?,?,?,?)'),
  paymentByRef: db.prepare('SELECT * FROM payments WHERE provider=? AND provider_ref=?'),
  addPayment: db.prepare('INSERT INTO payments(user_id,provider,provider_ref,plan_code,credits_granted,amount_microusd,fee_microusd,currency,status) VALUES(?,?,?,?,?,?,?,?,?)'),
  planByCode: db.prepare('SELECT * FROM plans WHERE code=? AND active=1'),
  audit: db.prepare('INSERT INTO admin_audit(actor_user_id,action,target_type,target_id,detail_json) VALUES(?,?,?,?,?)'),
};
const txCharge = db.transaction((userId, usage) => {
  const balance = q.balance.get(userId).balance;
  const credits = Number(usage.credits_charged || 0);
  if (credits > balance) { const e=new Error('Creditos insuficientes'); e.code='INSUFFICIENT_CREDITS'; throw e; }
  const info=q.addUsage.run({...usage,user_id:userId,units_json:JSON.stringify(usage.units||{}),cost_microusd:Number(usage.cost_microusd||0),credits_charged:credits,status:usage.status||'succeeded',error_code:usage.error_code||null});
  if (credits) q.addCredit.run(userId,-credits,'ai_usage','ai_usage',String(info.lastInsertRowid),usage.operation);
  return {usageId:Number(info.lastInsertRowid),balance:balance-credits};
});
const txReserve=db.transaction((userId,key,credits,projectId,operation)=>{
  const existing=q.reservationByKey.get(key); if(existing) return existing;
  const balance=q.balance.get(userId).balance; credits=Number(credits);
  if(!Number.isInteger(credits)||credits<=0) throw new Error('Reserva invalida');
  if(credits>balance){const e=new Error('Creditos insuficientes');e.code='INSUFFICIENT_CREDITS';throw e;}
  q.addCredit.run(userId,-credits,'reservation','job',key,operation);
  q.addReservation.run(key,userId,credits,projectId||null,operation);
  return q.reservationByKey.get(key);
});
const txSettle=db.transaction((key,usage)=>{
  const r=q.reservationByKey.get(key); if(!r) throw new Error('Reserva no encontrada');
  if(r.status!=='reserved') return r;
  const ok=usage.status==='succeeded';
  const info=q.addUsage.run({...usage,user_id:r.user_id,project_id:usage.project_id||r.project_id,units_json:JSON.stringify(usage.units||{}),cost_microusd:Number(usage.cost_microusd||0),credits_charged:ok?r.credits:0,status:usage.status,error_code:usage.error_code||null});
  q.settleReservation.run(ok?'charged':'refunded',Number(info.lastInsertRowid),r.id);
  if(!ok) q.addCredit.run(r.user_id,r.credits,'refund','job',key,'Devolucion automatica por generacion fallida');
  return q.reservationByKey.get(key);
});
const txImportUsage=db.transaction((source,eventId,usage)=>{
  if(q.usageImport.get(source,eventId)) return {duplicate:true};
  q.addUsageImport.run(source,eventId);
  const info=q.addUsage.run({...usage,units_json:JSON.stringify(usage.units||{}),cost_microusd:Number(usage.cost_microusd||0),credits_charged:Number(usage.credits_charged||0),status:usage.status||'succeeded',error_code:usage.error_code||null});
  return {duplicate:false,usageId:Number(info.lastInsertRowid)};
});
const txPayment=db.transaction((p)=>{
  const seen=q.paymentEvent.get(p.provider,p.event_id); if(seen) return {duplicate:true};
  q.addPaymentEvent.run(p.provider,p.event_id,p.event_type||null,p.payload_hash||null);
  const old=q.paymentByRef.get(p.provider,p.provider_ref); if(old) return {duplicate:true,payment:old};
  const plan=q.planByCode.get(p.plan_code); if(!plan) throw new Error('Plan desconocido');
  const credits=Number(p.credits_granted||plan.credits);
  const info=q.addPayment.run(p.user_id,p.provider,p.provider_ref,p.plan_code,credits,Number(p.amount_microusd),Number(p.fee_microusd||0),p.currency||'USD',p.status);
  if(p.status==='paid'&&credits>0) q.addCredit.run(p.user_id,credits,'purchase','payment',String(info.lastInsertRowid),'Compra '+p.plan_code);
  return {duplicate:false,paymentId:Number(info.lastInsertRowid),credits};
});
module.exports={q,txCharge,txReserve,txSettle,txPayment,txImportUsage};
