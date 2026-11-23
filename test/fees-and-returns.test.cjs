const assert = require('node:assert/strict');
global.window = {};
require('../backtest.js');
const market = {
  id:'one', title:'Election', outcome:1, settledAt:'2025-01-04', closeAt:'2025-01-04',
  history: [1,2,3].map((d,i)=>({t:Date.UTC(2025,0,d,12),p:[.50,.50,.52][i]}))
};
const plan = {id:'s',name:'Momentum',stake:50,side:'yes',match:'all',conditions:[{type:'priceAtLeast',value:.2}]};
const run = (markets, options={}) => window.ElectionBacktest.runStrategies([{...plan,markets}],{fees:true,...options});
function close(a,b){assert.ok(Math.abs(a-b)<1e-9, a+' versus '+b);}
for(const [metadata, fee] of [[{source:'kalshi'},1.75],[{source:'kalshi',feeMultiplier:.5},.875],
  [{source:'kalshi',feeWaiverUntil:'2025-02-01'},0],[{source:'polymarket',feeRate:.02},.5],
  [{source:'polymarket'},1.25],[{source:'polymarket',feesEnabled:false},0]]) {
  const m={...market,...metadata};
  const result=run([m]);
  const t=result.trades[0];
  close(t.fee,fee);close(t.profit,50-fee);close(result.totals.roi,(50-fee)/(50+fee));
  assert.equal(result.totals.fees,fee);close(result.equity.at(-1).pnl,result.totals.profit);
  close(result.equity[0].pnl,-fee);assert.deepEqual(result.strategies[0].equity,result.equity);
  const active=run([{...m,outcome:null,settledAt:null}],{mode:'live',asOf:'2025-01-03'});
  close(active.totals.profit,2-fee);close(active.markedEquity.at(-1).pnl,2-fee);
  close(active.markedEquity[0].pnl,-fee);
  const gross=run([m],{fees:false});close(gross.totals.fees,0);close(gross.totals.roi,1);
}
const extra={...market,source:'kalshi',history:market.history.map(p=>({...p,p:.3333333}))};
const result=run([extra]);const fee=result.trades[0].fee;close(fee,2.3334);
console.log('Verified standard fees, custom rates, exemptions, rounding, net returns, and fees on both chart timelines.');
