'use strict';
const express=require('express');
const {q}=require('../lib/saas-db');
const {requireAuth}=require('../lib/middleware');
const router=express.Router();
router.use(requireAuth);
router.get('/credits',(req,res)=>res.json({ok:true,balance:q.balance.get(req.session.userId).balance,ledger:q.ledger.all(req.session.userId,50)}));
module.exports=router;
