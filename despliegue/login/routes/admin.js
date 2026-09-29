'use strict';
const express=require('express');
const {db,stmt}=require('../lib/db');
const {q}=require('../lib/saas-db');
const {requireAuth,verifyCsrf}=require('../lib/middleware');
const router=express.Router();
router.use(requireAuth);
router.use((req,res,next)=>{const u=stmt.findById.get(req.session.userId); if(!u||u.role!=='admin') return res.status(403).json({ok:false,error:'Solo administradores.'}); req.admin=u; next();});
router.get('/dashboard',(req,res)=>{
 const one=(sql)=>db.prepare(sql).get();
 const revenue=one("SELECT COALESCE(SUM(amount_microusd-fee_microusd),0) v FROM payments WHERE status='paid'").v;
 const costs=one("SELECT COALESCE(SUM(cost_microusd),0) v FROM ai_usage WHERE status='succeeded'").v;
 res.json({ok:true,metrics:{
  users:one('SELECT COUNT(*) v FROM users').v,
  activeUsers:one('SELECT COUNT(*) v FROM users WHERE is_active=1').v,
  payingCustomers:one("SELECT COUNT(DISTINCT user_id) v FROM subscriptions WHERE status='active'").v,
  revenueMicrousd:revenue,aiCostMicrousd:costs,grossProfitMicrousd:revenue-costs,
  marginPct:revenue?Math.round(((revenue-costs)/revenue)*10000)/100:null,
  videos:one("SELECT COUNT(DISTINCT project_id) v FROM ai_usage WHERE project_id IS NOT NULL").v,
  failedGenerations:one("SELECT COUNT(*) v FROM ai_usage WHERE status='failed'").v
 }});
});
router.get('/customers',(req,res)=>res.json({ok:true,customers:db.prepare(`
 SELECT u.id,u.username,u.display_name,u.email,u.is_active,u.last_login_at,
 COALESCE((SELECT SUM(delta) FROM credit_ledger c WHERE c.user_id=u.id),0) credits,
 COALESCE((SELECT SUM(amount_microusd-fee_microusd) FROM payments p WHERE p.user_id=u.id AND p.status='paid'),0) revenue_microusd,
 COALESCE((SELECT SUM(cost_microusd) FROM ai_usage a WHERE a.user_id=u.id AND a.status='succeeded'),0) ai_cost_microusd
 FROM users u ORDER BY u.id DESC`).all()});
router.get('/timeseries',(req,res)=>{
 const days=Math.min(365,Math.max(7,Number(req.query.days)||30));
 const revenue=db.prepare(`SELECT substr(created_at,1,10) day,SUM(amount_microusd-fee_microusd) value FROM payments WHERE status='paid' AND created_at>=datetime('now',?) GROUP BY day ORDER BY day`).all(`-${days} days`);
 const costs=db.prepare(`SELECT substr(created_at,1,10) day,SUM(cost_microusd) value FROM ai_usage WHERE status='succeeded' AND created_at>=datetime('now',?) GROUP BY day ORDER BY day`).all(`-${days} days`);
 res.json({ok:true,days,revenue,costs});
});
router.get('/providers',(req,res)=>res.json({ok:true,providers:db.prepare(`
 SELECT provider,COUNT(*) calls,SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) succeeded,
 SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
 COALESCE(SUM(CASE WHEN status='succeeded' THEN cost_microusd ELSE 0 END),0) cost_microusd
 FROM ai_usage GROUP BY provider ORDER BY cost_microusd DESC`).all()}));
router.get('/usage',(req,res)=>res.json({ok:true,usage:db.prepare('SELECT * FROM ai_usage ORDER BY id DESC LIMIT 250').all()});
router.get('/audit',(req,res)=>res.json({ok:true,audit:db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT 250').all()});
router.post('/customers/:id/credits',verifyCsrf,(req,res)=>{const id=Number(req.params.id),delta=Number(req.body&&req.body.delta); if(!Number.isInteger(delta)||!delta) return res.status(400).json({ok:false,error:'delta debe ser un entero distinto de cero.'}); if(!stmt.findById.get(id)) return res.status(404).json({ok:false,error:'Usuario no encontrado.'}); q.addCredit.run(id,delta,'admin_adjustment','user',String(id),String(req.body.note||'').slice(0,300)); q.audit.run(req.admin.id,'credits.adjust','user',String(id),JSON.stringify({delta,note:req.body.note||null})); res.json({ok:true,balance:q.balance.get(id).balance});});
module.exports=router;
