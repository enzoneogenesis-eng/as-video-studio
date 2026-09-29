'use strict';
const {txRefundStale}=require('./saas-db');
let timer=null;
function run(){
 try{const n=txRefundStale(Number(process.env.CREDIT_RESERVATION_TTL_MINUTES||120));if(n)console.warn('[recovery] creditos devueltos por reservas expiradas:',n);}
 catch(e){console.error('[recovery]',e.message);}
}
function start(){run();timer=setInterval(run,5*60*1000);if(timer.unref)timer.unref();}
function stop(){if(timer)clearInterval(timer);}
module.exports={start,stop,run};
