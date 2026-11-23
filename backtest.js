(function () {
  'use strict';

  const DAY = 86400000;
  const LOOKBACK_DAYS = 90;
  const conditionTypes = new Set([
    'priceAtLeast',
    'priceAtMost',
    'risesBy',
    'fallsBy',
    'crossesAbove',
    'crossesBelow',
  ]);
  const exitTypes = new Set([...conditionTypes, 'gainFromEntry', 'lossFromEntry']);

  const skipReasons = Object.freeze({
    duplicate: 'This contract already appears in the sample.',
    outcome: 'A confirmed binary settlement outcome is required.',
    settlement: 'A valid settlement date is required.',
    window: 'Settlement falls outside the selected dates.',
    history: 'Fewer than two days of eligible price history.',
    threshold: 'No eligible daily close reached the entry threshold.',
    conditions: 'No eligible daily close matched the entry conditions.',
    nextClose: 'No qualifying signal had a tradable close on the following UTC day.',
    closed: 'The live replay requires a contract that is currently open.',
    mark: 'No later UTC day had an observed price for valuing the position.',
  });

  function numeric(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '') return Number(value);
    return NaN;
  }

  function timestamp(value) {
    const number = numeric(value);
    if (Number.isFinite(number)) return number < 1e11 ? number * 1000 : number;
    return typeof value === 'string' ? Date.parse(value) : NaN;
  }

  function dateBoundary(value, endOfDay) {
    if (value === undefined || value === null || value === '') return null;
    let time = timestamp(value);
    const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!Number.isFinite(time) || (dateOnly && new Date(time).toISOString().slice(0, 10) !== value)) {
      throw new RangeError('Enter a valid date for the simulation window.');
    }
    if (dateOnly && endOfDay) time += DAY - 1;
    return time;
  }

  function settingsFor(options) {
    const startDate = dateBoundary(options.startDate, false);
    const endDate = dateBoundary(options.endDate, true);
    if (startDate !== null && endDate !== null && startDate > endDate) {
      throw new RangeError('The start date must be on or before the end date.');
    }
    const mode = options.mode || 'archive';
    if (mode !== 'archive' && mode !== 'live') throw new RangeError('Choose a valid simulation mode.');
    let asOf = null;
    if (mode === 'live') {
      const now = Date.now();
      const requested = dateBoundary(options.asOf, true) ?? now;
      if (Math.floor(requested / DAY) > Math.floor(now / DAY))
        throw new RangeError('Choose today or an earlier UTC date.');
      asOf = Math.min(requested, now);
    }
    return { mode, startDate, endDate, asOf, fees: options.fees === true, lookbackDays: LOOKBACK_DAYS };
  }

  function positiveStake(value) {
    const stake = numeric(value);
    if (!Number.isFinite(stake) || stake <= 0) throw new RangeError('Stake must be a positive amount.');
    return stake;
  }

  function strategyFor(input) {
    const { id, name, side, match } = input;
    const { exitConditions = [], exitMatch = 'any' } = input;
    if (side !== 'yes' && side !== 'no') throw new RangeError('Choose Yes or No for each strategy.');
    if (![match, exitMatch].every((value) => value === 'all' || value === 'any'))
      throw new RangeError('Choose whether all or any conditions must match.');
    if (!Array.isArray(input.conditions) || !input.conditions.length)
      throw new RangeError('Add at least one entry condition.');
    if (!Array.isArray(exitConditions)) throw new RangeError('Supply a list of exit conditions.');
    function normalize({ type, value }, supported) {
      if (!supported.has(type)) throw new RangeError('Choose a supported condition.');
      const fraction = numeric(value);
      if (!(fraction >= 0 && fraction <= 1))
        throw new RangeError('Condition values must be between 0 and 1 inclusive.');
      return { type, value: fraction };
    }
    return { id, name, side, stake: positiveStake(input.stake), match, exitMatch,
      conditions: input.conditions.map((c) => normalize(c, conditionTypes)),
      exitConditions: exitConditions.map((c) => normalize(c, exitTypes)) };
  }

  // Keep the last valid observation on each UTC calendar day. Providers may
  // return intraday observations or pages in reverse chronological order.
  function dailyCloses(history, from, until, side, includeEnd = false) {
    const byDay = new Map();
    for (const point of history || []) {
      if (!point) continue;
      const t = timestamp(point.t);
      const p = numeric(point.p);
      if (!Number.isFinite(t) || t < from || t > until || (t === until && !includeEnd) || !(p >= 0 && p <= 1))
        continue;
      const day = Math.floor(t / DAY);
      const earlier = byDay.get(day);
      if (!earlier || t >= earlier.t) byDay.set(day, { day, t, p: side === 'no' ? 1 - p : p });
    }
    return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  }

  // Complementing a price or subtracting daily closes can move an exact
  // decimal threshold by a few floating-point units on the probability scale.
  function compare(a, b) {
    if (b === 0 || b === 1) return a - b;
    return Math.abs(a - b) <= 2 * Number.EPSILON ? 0 : a - b;
  }

  function matches({ type, value }, price, previousPrice, entryPrice) {
    if (type === 'priceAtLeast') return compare(price, value) >= 0;
    if (type === 'priceAtMost') return compare(price, value) <= 0;
    if (type === 'gainFromEntry') return compare(price - entryPrice, value) >= 0;
    if (type === 'lossFromEntry') return compare(entryPrice - price, value) >= 0;
    if (previousPrice === undefined) return false;
    switch (type) {
      case 'risesBy':
        return compare(price - previousPrice, value) >= 0;
      case 'fallsBy':
        return compare(previousPrice - price, value) >= 0;
      case 'crossesAbove':
        return compare(previousPrice, value) < 0 && compare(price, value) >= 0;
      case 'crossesBelow':
        return compare(previousPrice, value) > 0 && compare(price, value) <= 0;
    }
  }

  function findFill(closes, conditions, match, startIndex = 0, entryPrice) {
    if (closes.length < 2) return 'history';

    let foundSignal = false;
    for (let i = startIndex; i < closes.length; i++) {
      const signal = closes[i];
      if (signal.p <= 0 || signal.p >= 1) continue;
      const previous = closes[i - 1];
      const previousPrice = previous?.day === signal.day - 1 ? previous.p : undefined;
      const test = (condition) => matches(condition, signal.p, previousPrice, entryPrice);
      const qualifies = match === 'all' ? conditions.every(test) : conditions.some(test);
      if (!qualifies) continue;
      foundSignal = true;
      const fill = closes[i + 1];
      if (fill?.day === signal.day + 1 && fill.p > 0 && fill.p < 1)
        return { signal, fill, previousPrice, index: i + 1 };
    }
    return foundSignal ? 'nextClose' : 'conditions';
  }

  function fillFee(market, p, shares, time, signedCost) {
    const basis = shares * p * (1 - p);
    if ((market.source || market.venue) === 'polymarket') {
      if (market.feesEnabled === false) return 0;
      const rate = market.feeRate ?? 0.05;
      return Math.round(basis * rate * 100000) / 100000;
    }
    if (time < Date.parse(market.feeWaiverUntil) || market.feeMultiplier === 0) return 0;
    const cost = (signedCost + basis * 0.07 * (market.feeMultiplier ?? 1)) * 10000;
    return Math.max(0, Math.ceil(cost - Number.EPSILON * Math.abs(cost) * 2) / 10000 - signedCost);
  }

  function simulateMarket(market, strategy, settings) {
    const outcome = numeric(market.outcome);
    const settledAt = timestamp(market.settledAt);
    const live = settings.mode === 'live';
    if (live) {
      if (outcome === 0 || outcome === 1 || Number.isFinite(settledAt)) return 'closed';
    } else {
      if (outcome !== 0 && outcome !== 1) return 'outcome';
      if (!Number.isFinite(settledAt)) return 'settlement';
      if (settledAt < (settings.startDate ?? -Infinity) || settledAt > (settings.endDate ?? Infinity)) return 'window';
    }
    const cutoff = live ? settings.asOf : settledAt;
    const closeAt = timestamp(market.tradingClosedAt || (live ? null : market.closeAt));
    const tradingEnd = Number.isFinite(closeAt) ? closeAt : Infinity;
    const until = Math.min(cutoff, tradingEnd);
    const from = Math.max(cutoff - LOOKBACK_DAYS * DAY, settings.startDate ?? -Infinity);
    const closes = dailyCloses(market.history, from, until, strategy.side, live && cutoff < tradingEnd);
    const buy = findFill(closes, strategy.conditions, strategy.match);
    if (typeof buy === 'string') return buy;
    const entry = { signalAt: buy.signal.t, signalPrice: buy.signal.p, enteredAt: buy.fill.t,
      entryPrice: buy.fill.p, stake: strategy.stake, shares: strategy.stake / buy.fill.p };
    const sell = strategy.exitConditions?.length
      ? findFill(closes, strategy.exitConditions, strategy.exitMatch, buy.index, buy.fill.p)
      : null;
    const sold = sell && typeof sell !== 'string';
    if (live) entry.marks = closes.slice(buy.index + 1, sold ? sell.index + 1 : closes.length).map(({ t, p }) => ({ t, p }));
    if (sold) {
      const proceeds = entry.shares * sell.fill.p;
      const exitTriggers = strategy.exitConditions.filter((rule) =>
        matches(rule, sell.signal.p, sell.previousPrice, entry.entryPrice));
      return { ...entry, status: 'sold', exitSignalAt: sell.signal.t, exitSignalPrice: sell.signal.p,
        exitedAt: sell.fill.t, exitPrice: sell.fill.p, exitTriggers, proceeds, profit: proceeds - entry.stake };
    }
    if (live) {
      const mark = closes[closes.length - 1];
      if (mark.day <= buy.fill.day) return 'mark';
      const markedValue = entry.shares * mark.p;
      return {
        ...entry,
        status: 'open',
        markedAt: mark.t,
        markPrice: mark.p,
        markedValue,
        staleDays: Math.floor(settings.asOf / DAY) - mark.day,
        profit: markedValue - entry.stake,
      };
    }
    const won = outcome === (strategy.side === 'yes' ? 1 : 0);
    const payout = won ? entry.shares : 0;
    return {
      ...entry,
      status: 'settled',
      settledAt,
      settlementBasis: market.settlementBasis,
      outcome,
      won,
      payout,
      profit: payout - entry.stake,
    };
  }

  function peakExposure(trades) {
    const events = [];
    for (const trade of trades) {
      events.push({ time: trade.enteredAt, count: 1, stake: trade.stake });
      const end = trade.exitedAt ?? trade.settledAt;
      if (end !== undefined) events.push({ time: end, count: -1, stake: -trade.stake });
    }
    // Sales and settlements release stake before other entries at the same instant.
    events.sort((a, b) => a.time - b.time || a.count - b.count);
    let count = 0,
      openStake = 0,
      maxConcurrent = 0,
      peakOpenStake = 0;
    for (const event of events) {
      count += event.count;
      openStake = count ? openStake + event.stake : 0;
      maxConcurrent = Math.max(maxConcurrent, count);
      peakOpenStake = Math.max(peakOpenStake, openStake);
    }
    return { maxConcurrent, peakOpenStake };
  }

  function summarize(trades, settings) {
    const count = trades.length;
    const staked = trades.reduce((total, trade) => total + trade.stake, 0);
    const entryFees = trades.reduce((total, trade) => total + trade.entryFee, 0);
    const exitFees = trades.reduce((total, trade) => total + trade.exitFee, 0);
    const fees = entryFees + exitFees;
    const soldCount = trades.filter((trade) => trade.status === 'sold').length;
    const proceeds = trades.reduce((total, trade) => total + (trade.proceeds ?? 0), 0);
    const outlay = staked + entryFees;
    const common = { count, staked, entryFees, exitFees, fees, outlay, soldCount, proceeds, ...peakExposure(trades) };
    if (settings.mode === 'live') {
      const positiveCount = trades.filter((t) => t.profit > 0).length;
      const markedValue = trades.reduce((total, trade) => total + (trade.markedValue ?? 0), 0);
      const profit = proceeds + markedValue - outlay - exitFees;
      return {
        ...common,
        markedValue,
        profit,
        roi: count ? profit / outlay : null,
        positiveCount,
        positiveRate: count ? positiveCount / count : null,
      };
    }
    const wins = trades.filter((t) => t.status === 'sold' ? t.profit > 0 : t.won).length;
    const payout = trades.reduce((total, trade) => total + (trade.payout ?? 0), 0);
    const profit = proceeds + payout - outlay - exitFees;
    return {
      ...common,
      wins,
      winRate: count ? wins / count : null,
      payout,
      profit,
      roi: count ? profit / outlay : null,
    };
  }

  // Realize P&L at the sale or settlement and group simultaneous events.
  // A live position accrues daily changes only while it is held.
  function equityCurves(trades, settings, finalProfit) {
    const live = settings.mode === 'live';
    const changes = new Map();
    function add(time, change) {
      changes.set(time, (changes.get(time) || 0) + change);
    }
    if (trades.length) add(trades[0].enteredAt, 0);
    for (const trade of trades) {
      if (trade.entryFee) add(trade.enteredAt, -trade.entryFee);
      if (live) {
        let previous = 0;
        add(trade.enteredAt, 0);
        for (const mark of trade.marks) {
          const current = trade.shares * mark.p - trade.stake;
          add(mark.t, current - previous);
          previous = current;
        }
        if (trade.exitFee) add(trade.exitedAt, -trade.exitFee);
      } else {
        add(trade.exitedAt ?? trade.settledAt, trade.profit + trade.entryFee);
      }
    }
    let pnl = 0;
    const points = [];
    for (const [t, change] of Array.from(changes).sort((a, b) => a[0] - b[0])) {
      pnl += change;
      points.push({ t, pnl });
    }
    // Use the same final valuation as the summary even at a rounding boundary.
    if (points.length) points.at(-1).pnl = finalProfit;
    return live ? { equity: [], markedEquity: points } : { equity: points };
  }

  function evaluate(markets, strategy, settings, attribution) {
    if (!Array.isArray(markets)) throw new TypeError('Supply an array of election contracts.');
    const trades = [];
    const skipped = [];
    const seen = new Set();
    for (const market of markets) {
      const { id, title } = market;
      const source = market.source || market.venue;
      const identity = { id, title, source, venue: source, ...attribution };
      const key = JSON.stringify([source, id]);
      const result = seen.has(key) ? 'duplicate' : simulateMarket(market, strategy, settings);
      seen.add(key);
      if (typeof result === 'string') {
        const code = !attribution && result === 'conditions' ? 'threshold' : result;
        skipped.push({ ...identity, code, reason: skipReasons[code] });
      } else {
        const entryFee = settings.fees ? fillFee(market, result.entryPrice, result.shares, result.enteredAt, result.stake) : 0;
        const exitFee = settings.fees && result.status === 'sold'
          ? fillFee(market, result.exitPrice, result.shares, result.exitedAt, -result.proceeds) : 0;
        const fee = entryFee + exitFee;
        trades.push({ ...identity, ...result, entryFee, exitFee, fee, profit: result.profit - fee });
      }
    }
    trades.sort((a, b) => a.enteredAt - b.enteredAt);
    return { trades, skipped, selectedCount: seen.size, totals: summarize(trades, settings) };
  }

  function runStrategies(strategies, options = {}) {
    if (!Array.isArray(strategies)) throw new TypeError('Supply an array of strategies.');
    const settings = settingsFor(options);
    const results = strategies.map((input) => {
      const strategy = strategyFor(input);
      const attribution = { strategyId: strategy.id, strategyName: strategy.name, side: strategy.side };
      const evaluated = evaluate(input.markets, strategy, settings, attribution);
      return { ...strategy, ...evaluated, ...equityCurves(evaluated.trades, settings, evaluated.totals.profit) };
    });
    const trades = results.flatMap((result) => result.trades).sort((a, b) => a.enteredAt - b.enteredAt);
    const skipped = results.flatMap((result) => result.skipped);
    const totals = summarize(trades, settings);
    return { settings, strategies: results, trades, skipped, totals, ...equityCurves(trades, settings, totals.profit) };
  }

  function run(markets, options = {}) {
    const threshold = numeric(options.threshold === undefined ? 0.6 : options.threshold);
    if (!(threshold > 0 && threshold < 1)) throw new RangeError('Threshold must be between 0 and 1.');
    const stake = positiveStake(options.stake === undefined ? 100 : options.stake);
    const settings = { ...settingsFor(options), threshold, stake };
    const strategy = strategyFor({
      side: 'yes',
      stake,
      match: 'all',
      conditions: [{ type: 'priceAtLeast', value: threshold }],
      exitConditions: options.exitConditions,
      exitMatch: options.exitMatch,
    });
    const { trades, skipped, totals } = evaluate(markets, strategy, settings);
    return { settings, trades, skipped, totals, ...equityCurves(trades, settings, totals.profit) };
  }

  window.ElectionBacktest = Object.freeze({ run, runStrategies, dailyCloses, fillFee });
})();
