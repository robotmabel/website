/* The ONE pricing rule, browser side. Mirrors commerce/pricing.py line for line;
   commerce/tests/test_pricing_parity.py runs both over random carts and fails
   if they disagree. A classic script (order.html) AND a node module (the test):
   the page reads window.MabelOrderPricing, node reads module.exports. */
(function (root) {
  'use strict';
  function step(cat, id) {
    for (var i = 0; i < cat.steps.length; i++) if (cat.steps[i].id === id) return cat.steps[i];
    throw new Error('no step ' + id);
  }
  function opt(options, id, what) {
    if (id == null) {
      for (var i = 0; i < options.length; i++) if (options[i]['default']) return options[i];
      return options[0];
    }
    for (var j = 0; j < options.length; j++) if (options[j].id === id) return options[j];
    throw new Error('unknown ' + what + ' option ' + id);
  }
  function tier(cat, id) {
    for (var i = 0; i < cat.tiers.length; i++) if (cat.tiers[i].id === id) return cat.tiers[i];
    throw new Error('unknown tier ' + id);
  }
  function defaults(cat) {
    var sel = {};
    cat.steps.forEach(function (s) {
      if (s.options) sel[s.id] = opt(s.options, null, s.id).id;
      (s.groups || []).forEach(function (g) { sel[g.id] = opt(g.options, null, g.id).id; });
    });
    return sel;
  }
  function priceConfig(cat, t, sel) {
    tier(cat, t);
    sel = sel || {};
    var robot = opt(step(cat, 'robot').options, sel.robot, 'robot');
    var has = {}; robot.has.forEach(function (h) { has[h] = true; });
    var lines = [{ label: robot.name, price: robot.price[t] }];
    var total = robot.price[t];
    var compute = opt(step(cat, 'compute').options, sel.compute, 'compute');
    lines.push({ label: compute.name, price: compute.price[t] }); total += compute.price[t];
    step(cat, 'sensors').groups.forEach(function (g) {
      if (!has[g.requires]) return;
      var o = opt(g.options, sel[g.id], g.id);
      lines.push({ label: g.title + ': ' + o.name, price: o.price[t] }); total += o.price[t];
    });
    var eff = step(cat, 'effector');
    if (has[eff.requires]) {
      var e = opt(eff.options, sel.effector, 'effector');
      lines.push({ label: e.name, price: e.price[t] }); total += e.price[t];
    }
    return { total: total, lines: lines, summary: lines.map(function (l) { return l.label; }).join(' · ') };
  }
  function part(cat, sku) {
    for (var i = 0; i < cat.parts.length; i++) if (cat.parts[i].sku === sku) return cat.parts[i];
    throw new Error('unknown part ' + sku);
  }
  function priceCart(cat, items) {
    if (!items || !items.length) throw new Error('empty cart');
    var lines = items.map(function (it) {
      var qty = it.qty || 1;
      if (it.kind === 'config') {
        var pc = priceConfig(cat, it.tier || 'assembled', it.sel || {});
        return { name: 'MABEL — ' + tier(cat, it.tier || 'assembled').name, desc: pc.summary,
                 unit: pc.total, qty: qty, amount: pc.total * qty };
      }
      if (it.kind === 'part') {
        var p = part(cat, it.sku);
        return { name: p.name, desc: p.spec, unit: p.price, qty: qty, amount: p.price * qty };
      }
      throw new Error('unknown item kind ' + it.kind);
    });
    return { total: lines.reduce(function (a, l) { return a + l.amount; }, 0), lines: lines };
  }
  function depositAmount(cat, total) { return Math.round(total * (cat.deposit_fraction || 0.10)); }
  /* Which steps/groups apply to a robot — the page hides the rest. */
  function applies(cat, sel) {
    var robot = opt(step(cat, 'robot').options, sel.robot, 'robot');
    var has = {}; robot.has.forEach(function (h) { has[h] = true; });
    return function (requires) { return !requires || !!has[requires]; };
  }
  var api = { defaults: defaults, priceConfig: priceConfig, priceCart: priceCart,
              depositAmount: depositAmount, applies: applies, part: part };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MabelOrderPricing = api;
})(typeof window !== 'undefined' ? window : globalThis);
