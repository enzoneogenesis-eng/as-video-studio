'use strict';
const express=require('express');
const crypto=require('crypto');
const {txReserve,txSettle}=require('../lib/saas-db');
const {requireAuth,verifyCsrf}=require('../lib/middleware');
const router=express.Router();
router.use(requireAuth);
router.post('/reserve',verifyCsrf,(req,res)=>{
 try{
  const credits=Number(req.body&&req.body.credits);
  const operation=String(req.body&&req.body.operation||'generation').slice(0,80);
  const projectId=String(req.body&&req.body.projectId||'').slice(0,160)||null;
  const key=String(req.body&&req.body.idempotencyKey||crypto.randomUUID()).slice(0,160);
  const r=txReserve(req.session.userId,key,credits,projectId,operation);
  res.json({ok:true,reservation:r});
 }catch(e){res.status(e.code==='INSUFFICIENT_CREDITS'?402:400).json({ok:false,error:e.message,code:e.code||'INVALID_RESERVATION'});}
});
router.post('/settle',verifyCsrf,(req,res)=>{
 try{
  const key=String(req.body&&req.body.idempotencyKey||'');
  if(!key)return res.status(400).json({ok:false,error:'Falta idempotencyKey.'});
  const status=req.body&&req.body.status==='succeeded'?'succeeded':'failed';
  const r=txSettle(key,{job_id:String(req.body.jobId||'').slice(0,160)||null,provider:String(req.body.provider||'unknown').slice(0,80),model:String(req.body.model||'').slice(0,120)||null,operation:String(req.body.operation||'generation').slice(0,80),units:req.body.units||{},cost_microusd:Number(req.body.costMicrousd||0),status,error_code:status==='failed'?String(req.body.errorCode||'GENERATION_FAILED').slice(0,100):null});
  res.json({ok:true,reservation:r});
 }catch(e){res.status(400).json({ok:false,error:e.message});}
});
module.exports=router;