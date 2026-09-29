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
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL, provider_ref TEXT,
  amount_microusd INTEGER NOT NULL, fee_microusd INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
module.exports={q,txCharge};
