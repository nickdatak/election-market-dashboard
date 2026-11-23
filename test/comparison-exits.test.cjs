const assert = require('node:assert/strict');
global.window = {};
require('../backtest.js');
const { runStrategies, fillFee } = window.ElectionBacktest;
const time = (day) => Date.UTC(2025, 0, day, 12);
const rule = (type, value) => ({ type, value });
const points = (prices) => prices.map((p, i) => ({t: time(i + 1), p})).filter((point) => point.p !== null);
const market = {id:'one', source:'polymarket', title:'Election', outcome:0, feeRate:.05,
  settledAt:time(11), closeAt:time(10), history:points([.9,.5,.6,.55,.8,.25,.2,.99,1])};
const base = {id:'one', name:'Plan', side:'yes', stake:50, match:'all',
  conditions:[rule('priceAtLeast', .1)], markets:[market]};
const exits = (rules, extra = {}) => ({ ...base, exitConditions:rules, ...extra });
const gain = rule('gainFromEntry', .1), stop = rule('lossFromEntry', .15);
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, a+' versus '+b);
const pair = runStrategies([exits([gain,stop]), {...base,id:'hold'}], {fees:true});
const [sell,hold] = pair.trades;
const single = window.ElectionBacktest.run([{...market,source:undefined,venue:'polymarket'}],
  {threshold:.1,stake:50,fees:true,exitConditions:[gain,stop]});
close(single.totals.profit,sell.profit);
assert.equal(sell.status, 'sold');
assert.deepEqual(sell.exitTriggers,[gain]);
assert.equal(sell.exitSignalAt, time(3)); assert.equal(sell.enteredAt,time(2)); assert.equal(sell.exitedAt,time(4));
close(sell.exitSignalPrice,.6); close(sell.exitPrice,.55); close(sell.entryFee,1.25); close(sell.exitFee,1.2375);
close(sell.profit,2.5125); close(pair.strategies[0].totals.roi,sell.profit/51.25);
assert.equal(hold.status,'settled'); assert.equal(hold.exitFee,0); close(hold.profit,-51.25);
assert.equal(pair.totals.wins,1); assert.equal(pair.totals.soldCount,1);
close(pair.totals.profit, sell.profit+hold.profit); close(pair.totals.roi,pair.totals.profit/102.5);
close(pair.equity[0].pnl,-2.5); close(pair.equity[1].pnl, sell.profit-1.25);
assert.deepEqual(pair.equity.map(p=>p.t),[time(2),time(4),time(11)]);

// All rules must match the same close. Crossings use strictly consecutive days.
const all = runStrategies([exits([gain,rule('crossesAbove',.7)],{exitMatch:'all'})]).trades[0];
assert.equal(all.exitSignalAt,time(5)); assert.equal(all.exitedAt,time(6));
assert.equal(all.exitTriggers.length,2);
const bothImpossible=runStrategies([exits([gain,stop],{exitMatch:'all'})]).trades[0];
assert.equal(bothImpossible.status,'settled');
const no=runStrategies([exits([rule('gainFromEntry',.09),rule('lossFromEntry',.1)],{side:'no'})]).trades[0];
assert.equal(no.exitSignalAt,time(3)); close(no.exitSignalPrice,.4); close(no.exitPrice,.45);
// An entry-close signal can sell tomorrow. The day before entry cannot signal a sale.
const immediate=runStrategies([exits([rule('priceAtLeast',.5)])]).trades[0];
assert.equal(immediate.exitSignalAt,time(2)); assert.equal(immediate.exitedAt,time(3));
const testMarket=(changes,conditions=[gain])=>runStrategies([exits(conditions,{markets:[{...market,...changes}]})]).trades[0];
assert.equal(testMarket({history:points([.9,.5,.55,.57])},[rule('priceAtLeast',.8)]).status,'settled');
assert.equal(testMarket({history:points([.3,.5,.7,null,.4,.8,1,.6,.45,.4])}).exitedAt,time(9));
assert.equal(testMarket({history:points([.3,.5,.7,0,.3,.4])}).status,'settled');
assert.equal(testMarket({closeAt:time(4)}).status,'settled');
assert.equal(testMarket({tradingClosedAt:time(4)}).status,'settled');
assert.equal(testMarket({settledAt:time(4)}).status,'settled');
assert.equal(testMarket({history:points([.2,.4,null,.6,.61])},[rule('risesBy',.12)]).status,'settled');
// Fees evaluated separately at each fill, using the original share count for the sale.
const kalshi={...market,source:'kalshi',feeWaiverUntil:new Date(time(3)).toISOString()};
const withFees=runStrategies([exits([gain],{markets:[kalshi]})],{fees:true}).trades[0];
assert.equal(withFees.entryFee,0); assert.ok(withFees.exitFee>0);
close(withFees.exitFee,fillFee(kalshi,.55,100,time(4),-55));
const feeFree=runStrategies([exits([gain],{markets:[{...market,feesEnabled:false}]})],{fees:true}).trades[0];
assert.equal(feeFree.fee,0);
const liveMarket={...market,outcome:null,settledAt:null,closeAt:null};
const liveExits=exits([gain],{markets:[liveMarket]});
const active=(day,plans=[liveExits])=>runStrategies(plans,{mode:'live',asOf:time(day),fees:true});
const before=active(3);
assert.equal(before.trades[0].status,'open'); assert.equal(before.trades[0].exitFee,0);
const after=active(9);
assert.equal(after.trades[0].status,'sold'); assert.equal(after.totals.markedValue,0);
assert.deepEqual(after.markedEquity.map(p=>p.t),[time(2),time(3),time(4)]);
close(after.markedEquity[1].pnl,8.75); close(after.markedEquity[2].pnl,sell.profit);
const mixed=active(9,[liveExits,{...base,id:'open',markets:[liveMarket]}]);
assert.equal(mixed.totals.soldCount,1);close(mixed.totals.profit,sell.profit+48.75);
const later=exits([], {id:'later',stake:75,markets:[{...liveMarket,id:'later',history:points([null,null,.4,.6,.8])}]});
const tied=active(9,[liveExits,later]);
assert.equal(tied.totals.maxConcurrent,1); assert.equal(tied.totals.peakOpenStake,75);
for (const invalid of [{exitMatch:'none'},{exitConditions:{}},{exitConditions:[rule('unknown',.5)]},
  {exitConditions:[rule('gainFromEntry',-1)]},{conditions:[gain]}])
  assert.throws(()=>runStrategies([{...base,...invalid}]));
console.log('Comparison exits verified for independent strategies, both sides, AND/OR, gap and boundary fills, fallbacks, fee timing, realized and marked P&L, returns and exposure.');
