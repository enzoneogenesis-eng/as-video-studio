'use strict';
const express=require('express');
const {db,stmt}=require('../lib/db');
const {q}=require('../lib/saas-db');
const {requireAuth}=require('../lib/middleware');
const router=express.Router();router.use(requireAuth);
router.get('/me',(req,res)=>{
 const u=stmt.findById.get(req.session.userId); if(!u)return res.status(404).json({ok:false,error:'Usuario no encontrado'});
 const sub=db.prepare(`SELECT s.status,s.current_period_end,p.code plan_code,p.name plan_name,p.credits plan_credits,p.price_microusd
 FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id WHERE s.user_id=? ORDER BY s.id DESC LIMIT 1`).get(u.id);
 const spent=db.prepare("SELECT COALESCE(SUM(credits_charged),0) credits,COALESCE(SUM(cost_microusd),0) cost FROM ai_usage WHERE user_id=? AND status='succeeded'").get(u.id);
 res.json({ok:true,user:{id:u.id,username:u.username,displayName:u.display_name,email:u.email,role:u.role},credits:q.balance.get(u.id).balance,subscription:sub||null,usage:spent});
});
router.get('/plans',(req,res)=>res.json({ok:true,plans:db.prepare('SELECT code,name,price_microusd,credits FROM plans WHERE active=1 ORDER BY price_microusd').all()}));
router.get('/history',(req,res)=>res.json({ok:true,usage:db.prepare('SELECT id,project_id,provider,model,operation,cost_microusd,credits_charged,status,created_at FROM ai_usage WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.session.userId)}));
module.exports=router;
