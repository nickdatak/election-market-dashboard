(() => {
  'use strict';
  const DAY = 86400000;
  const keyFor = (market) => market.source + ':' + market.id;

  // Sample without replacement without changing the displayed ordering of the source pool.
  function sample(rows, count, random = Math.random) {
    if (!Number.isInteger(count) || count < 1 || count > 500) throw Error('Choose a sample size from 1 to 500.');
    const copy = [...new Map(rows.map((m) => [keyFor(m), m])).values()];
    const size = Math.min(count, copy.length);
    for (let i = 0; i < size; i++) {
      const j = i + Math.floor(random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, size);
  }

  function seriesFor(market, history, { start, end, days }) {
    const { opened, closed } = window.ElectionDiscovery.tradingBounds(market);
    const until = Math.min(end, closed);
    const closes = window.ElectionBacktest.dailyCloses(history, Math.max(start - days * DAY, opened),
      until, 'yes', until < closed);
    let sum = 0, streak = 0;
    const rows = [];
    for (let i = 0; i < closes.length; i++) {
      const point = closes[i];
      const consecutive = i > 0 && closes[i - 1].day + 1 === point.day;
      if (!consecutive) { sum = 0; streak = 0; }
      const average = streak >= days ? Math.max(0, Math.min(1, sum / days)) : null;
      if (point.t >= start) rows.push({ ...point, average, previous: consecutive ? closes[i - 1].p : null });
      if (streak >= days) sum -= closes[i - days].p;
      sum += point.p;
      streak++;
    }
    return rows;
  }

  function coverageOf(rows) {
    let streak = 0, longest = 0, previousDay = null, through = null;
    for (const row of rows) {
      if (row.average !== null && row.p > 0 && row.p < 1) {
        streak = row.day === previousDay + 1 ? streak + 1 : 1;
        if (streak > longest) { longest = streak; through = row.day; }
      } else streak = 0;
      previousDay = row.day;
    }
    return { days: longest, from: longest ? (through - longest + 1) * DAY : null, through: longest ? through * DAY : null };
  }

  function inspectHistory(market, history, settings) {
    return coverageOf(seriesFor(market, history, settings));
  }

  function qualifies(rule, price, average, previous) {
    const direction = rule.direction === 'above' ? 1 : -1;
    const amount = rule.amount / 100;
    if (rule.basis === 'level') return direction * (price - amount) >= -1e-12;
    const reference = rule.basis === 'average' ? average : previous;
    return reference !== null && direction * (price - reference) >= amount - 1e-12;
  }

  function replay(rows, market, plan, settings, changes) {
    const trades = [];
    const sidePrice = (p) => p === null ? null : plan.side === 'yes' ? p : 1 - p;
    const fee = (p, shares, t, cost) => settings.fees ? window.ElectionBacktest.fillFee(market, p, shares, t, cost) : 0;
    const move = (t, delta) => changes.set(t, (changes.get(t) || 0) + delta);
    const finalDay = Math.floor(settings.end / DAY);
    const buyAllowed = (t) => t >= (plan.buyFrom ?? -Infinity) && t <= (plan.buyThrough ?? Infinity);
    let position = null, signal = null;

    function finish(t, price, status, sellSignal = null) {
      const value = position.shares * price;
      const exitFee = status === 'Sold' || status === 'Window sale' ? fee(price, position.shares, t, -value) : 0;
      move(t, value - position.value - exitFee);
      trades.push({ ...position, status, exitSignal: sellSignal, endedAt: t, exitPrice: price, exitFee,
        value, profit: value - plan.stake - position.entryFee - exitFee });
      position = null;
    }

    for (const row of rows) {
      const p = sidePrice(row.p);
      const tradable = p > 0 && p < 1;
      const finalSaleDay = settings.liquidate && row.day === finalDay;
      if (position) {
        const value = position.shares * p;
        move(row.t, value - position.value);
        position.value = value;
      }
      if (signal && signal.day + 1 === row.day && tradable) {
        if (!position && buyAllowed(row.t) && !finalSaleDay) {
          const shares = plan.stake / p;
          const entryFee = fee(p, shares, row.t, plan.stake);
          position = { strategy: plan.name, side: plan.side, market, stake: plan.stake, shares, entryFee,
            buySignal: signal.t, enteredAt: row.t, entryPrice: p, value: plan.stake };
          move(row.t, -entryFee);
        } else if (position) finish(row.t, p, 'Sold', signal.t);
      }
      signal = null;
      if (finalSaleDay && tradable && position) finish(row.t, p, 'Window sale');
      if (!tradable || finalSaleDay || (!position && !buyAllowed(row.t))) continue;
      if (qualifies(position ? plan.sell : plan.buy, p, sidePrice(row.average), sidePrice(row.previous))) signal = row;
    }
    if (position) {
      const resolved = Date.parse(market.settledAt);
      const last = rows.at(-1);
      if (resolved >= position.enteredAt && resolved <= settings.end && (market.outcome === 0 || market.outcome === 1))
        finish(resolved, sidePrice(market.outcome), 'Settled');
      else finish(last.t, sidePrice(last.p), 'Marked open');
    }
    return trades;
  }

  function summarize(trades) {
    let staked = 0, entryFees = 0, exitFees = 0, realized = 0, marked = 0, open = 0;
    for (const t of trades) {
      staked += t.stake;
      entryFees += t.entryFee;
      exitFees += t.exitFee;
      if (t.status === 'Marked open') { marked += t.profit; open++; }
      else realized += t.profit;
    }
    const profit = realized + marked;
    return { count: trades.length, open, realized, marked, staked, fees: entryFees + exitFees, profit,
      roi: staked ? profit / (staked + entryFees) : null };
  }

  function curve(deltas, settings, profit) {
    const changes = new Map(deltas);
    if (!changes.has(settings.start)) changes.set(settings.start, 0);
    if (!changes.has(settings.end)) changes.set(settings.end, 0);
    let pnl = 0;
    const points = [...changes].sort((a,b) => a[0] - b[0]).map(([t, delta]) => ({ t, pnl: pnl += delta }));
    points.at(-1).pnl = profit;
    return points;
  }

  function run(markets, plans, settings) {
    if (!Number.isFinite(settings.start) || !Number.isFinite(settings.end) || settings.end < settings.start ||
        !Number.isInteger(settings.days) || settings.days < 1 || settings.days > 90)
      throw Error('Choose a valid trading window and a 1–90 day average.');
    const windowDays = Math.floor(settings.end / DAY) - Math.floor(settings.start / DAY) + 1;
    if (settings.minDays !== undefined && (!Number.isInteger(settings.minDays) ||
        settings.minDays < 3 || settings.minDays > windowDays))
      throw Error('Choose a minimum of at least 3 days within the trading window.');
    const series = new Map(), eligible = [], rejected = [];
    for (const m of markets) {
      const rows = seriesFor(m, m.history, settings);
      if (settings.minDays !== undefined) {
        const coverage = coverageOf(rows);
        if (coverage.days < settings.minDays) { rejected.push({ market:m, coverage }); continue; }
      }
      eligible.push(m);
      series.set(keyFor(m), rows);
    }
    const portfolio = new Map();
    const strategies = plans.map((plan) => {
      const changes = new Map();
      const trades = eligible.flatMap((m) => replay(series.get(keyFor(m)), m, plan, settings, changes));
      const totals = summarize(trades);
      for (const [t, delta] of changes) portfolio.set(t, (portfolio.get(t) || 0) + delta);
      return { name: plan.name, trades, totals, markedEquity: curve(changes, settings, totals.profit) };
    });
    const trades = strategies.flatMap((s) => s.trades).sort((a,b) => a.enteredAt - b.enteredAt);
    const totals = summarize(trades);
    return { settings: { ...settings, mode: 'trading' }, strategies, trades, totals, series, rejected,
      markedEquity: curve(portfolio, settings, totals.profit) };
  }

  window.ElectionTrading = Object.freeze({ sample, run, keyFor, inspectHistory });
})();
