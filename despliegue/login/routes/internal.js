'use strict';
const express=require('express');
const crypto=require('crypto');
const config=require('../lib/config');
const {txImportUsage}=require('../lib/saas-db');
const router=express.Router();
function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)}
router.post('/cost-event',(req,res)=>{
 if(!config.internalCostSecret)return res.status(503).json({ok:false,error:'Ingesta de costes no configurada.'});
 if(!equal(req.get('x-studio-cost-secret'),config.internalCostSecret))return res.status(401).json({ok:false,error:'No autorizado.'});
 try{
  const b=req.body||{},eventId=String(b.eventId||'').slice(0,180);
  if(!eventId)return res.status(400).json({ok:false,error:'Falta eventId.'});
  const usd=b.usd==null?0:Number(b.usd);
  const result=txImportUsage('as-video-studio',eventId,{
   user_id:b.userId==null?null:Number(b.userId),project_id:String(b.projectId||'').slice(0,180)||null,
   job_id:String(b.jobId||'').slice(0,180)||null,provider:String(b.provider||'unknown').slice(0,80),
   model:String(b.model||'').slice(0,120)||null,operation:String(b.operation||'studio').slice(0,120),
   units:{tokens:b.tokens||{},cantidad:b.cantidad||{},paso:b.paso||null,unidad:b.unidad||null},
   cost_microusd:Math.max(0,Math.round(usd*1000000)),credits_charged:0,status:'succeeded',error_code:null
  });
  res.json({ok:true,result});
 }catch(e){res.status(400).json({ok:false,error:e.message});}
});
module.exports=router;