'use strict';
const express=require('express');const {requireAuth}=require('../lib/middleware');const router=express.Router();router.use(requireAuth);
const MODES={images:{name:'Imagenes',sceneSeconds:6,imageShare:1,videoShare:0,base:4},hybrid:{name:'Hibrido',sceneSeconds:6,imageShare:.8,videoShare:.2,base:8},animated:{name:'Animado',sceneSeconds:6,imageShare:0,videoShare:1,base:18}};
const STYLES=['documental','misterio','terror','historia','negocios','filosofia','ciencia','emocional'];
router.post('/estimate',(req,res)=>{const minutes=Math.min(120,Math.max(1,Number(req.body&&req.body.minutes)||10)),mode=String(req.body&&req.body.mode||'images'),m=MODES[mode];if(!m)return res.status(400).json({ok:false,error:'Modo invalido'});const scenes=Math.ceil(minutes*60/m.sceneSeconds),images=Math.ceil(scenes*m.imageShare),clips=Math.ceil(scenes*m.videoShare),voice=Math.ceil(minutes*1.2),credits=Math.ceil(m.base+images*.22+clips*2.4+voice);res.json({ok:true,estimate:{minutes,scenes,images,animatedClips:clips,voiceCredits:voice,credits,mode,name:m.name}})});
router.get('/presets',(req,res)=>res.json({ok:true,modes:MODES,styles:STYLES}));
module.exports=router;