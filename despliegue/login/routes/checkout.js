'use strict';
const express=require('express');const crypto=require('crypto');
const {requireAuth,verifyCsrf}=require('../lib/middleware');const {txCheckout}=require('../lib/saas-db');
const router=express.Router();router.use(requireAuth);
router.post('/session',verifyCsrf,(req,res)=>{try{
 const plan=String(req.body&&req.body.plan||'').toLowerCase(),provider=String(req.body&&req.body.provider||'mercadopago').toLowerCase();
 if(!['stripe','mercadopago'].includes(provider))return res.status(400).json({ok:false,error:'Proveedor invalido'});
 const key=String(req.body&&req.body.idempotencyKey||crypto.randomUUID());
 const session=txCheckout(req.session.userId,key,plan,provider);
 // La sesion interna queda lista. La URL externa se crea solo cuando existan
 // credenciales reales del proveedor, evitando checkouts falsos en produccion.
 res.json({ok:true,session,requiresProviderCredentials:true});
}catch(e){res.status(400).json({ok:false,error:e.message})}});
module.exports=router;