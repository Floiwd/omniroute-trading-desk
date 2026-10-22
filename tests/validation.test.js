const test = require('node:test');
const assert = require('node:assert');
const { parsePrice, validateAndSanitizePlan, applyConsensus } = require('../server.js');

const ocr = (extra = {}) => ({
  image_quality: { is_trading_chart: true, price_axis_readable: true, visibility_score_0_to_100: 90 },
  extracted_facts: {
    current_price_on_chart: '2657.20',
    visible_price_range_high: '2675.00',
    visible_price_range_low: '2640.00',
    ...extra
  }
});

const plan = (action, order_type, entry, sl, tp1, tp2, confidence = 80) => ({
  verdict: { action, order_type, confidence_score: confidence },
  essential_order_inputs: { entry_price: entry, stop_loss: sl, take_profit_1: tp1, take_profit_2: tp2 }
});

test('parsePrice gère les formats courants', () => {
  assert.strictEqual(parsePrice('2657.20'), 2657.2);
  assert.strictEqual(parsePrice('2,657.20'), 2657.2);
  assert.strictEqual(parsePrice('2.657,20'), 2657.2);
  assert.strictEqual(parsePrice('2657,2'), 2657.2);
  assert.strictEqual(parsePrice('1.08450'), 1.0845);
  assert.strictEqual(parsePrice('0,6543'), 0.6543);
  assert.strictEqual(parsePrice('104 250.5'), 104250.5);
  assert.strictEqual(parsePrice('Entrée: 2650.40 (zone)'), 2650.4);
  assert.strictEqual(parsePrice('1:2.4'), null);
  assert.strictEqual(parsePrice('ILLISIBLE'), null);
  assert.strictEqual(parsePrice(2650), 2650);
});

test('BUY cohérent : validé, R:R recalculé, type d’ordre corrigé', () => {
  const p = validateAndSanitizePlan(ocr(), plan('BUY', 'MARKET', '2651.00', '2647.50', '2660.00', '2667.50'), { riskPercent: '0.5' });
  assert.strictEqual(p.verdict.action, 'BUY');
  assert.strictEqual(p.verdict.order_type, 'BUY_LIMIT');
  assert.match(p.essential_order_inputs.risk_reward_ratio, /1:2\.57 \(TP1\) · 1:4\.71 \(TP2\)/);
  assert.strictEqual(p.essential_order_inputs.recommended_risk_pct, '0.5%');
});

test('BUY incohérent → NO_TRADE', () => {
  const p = validateAndSanitizePlan(ocr(), plan('BUY', 'MARKET', '2657', '2660', '2665', '2670'));
  assert.strictEqual(p.verdict.action, 'NO_TRADE');
});

test('R:R insuffisant → WAIT', () => {
  const p = validateAndSanitizePlan(ocr(), plan('SELL', 'MARKET', '2657.2', '2662', '2654', '2652'));
  assert.strictEqual(p.verdict.action, 'WAIT');
});

test('Niveau hors plage visible (hallucination) → NO_TRADE', () => {
  const p = validateAndSanitizePlan(ocr(), plan('BUY', 'MARKET', '2657.2', '2650', '2720', '2800'));
  assert.strictEqual(p.verdict.action, 'NO_TRADE');
});

test('Axe illisible → NO_TRADE et aucun niveau', () => {
  const o = ocr({ current_price_on_chart: 'ILLISIBLE' });
  o.image_quality.price_axis_readable = false;
  const p = validateAndSanitizePlan(o, plan('BUY', 'MARKET', '2657.2', '2650', '2670', '2680'));
  assert.strictEqual(p.verdict.action, 'NO_TRADE');
  assert.match(p.essential_order_inputs.entry_price, /NON DISPONIBLE/);
});

test('Plan sans structure ne fait pas planter le serveur', () => {
  const p = validateAndSanitizePlan(ocr(), {});
  assert.strictEqual(p.verdict.action, 'WAIT');
  assert.ok(Array.isArray(p.audit_trail));
});

test('Consensus : directions opposées → NO_TRADE', () => {
  const p = validateAndSanitizePlan(ocr(), plan('BUY', 'BUY_LIMIT', '2651.00', '2647.50', '2660.00', '2667.50'));
  applyConsensus(p, ocr(), { ocr: ocr(), plan: plan('SELL', 'MARKET', '1', '2', '0', '0'), model: 'x' });
  assert.strictEqual(p.verdict.action, 'NO_TRADE');
});

test('Consensus : prix actuel divergent → NO_TRADE', () => {
  const p = validateAndSanitizePlan(ocr(), plan('BUY', 'BUY_LIMIT', '2651.00', '2647.50', '2660.00', '2667.50'));
  applyConsensus(p, ocr(), { ocr: ocr({ current_price_on_chart: '2625.70' }), plan: plan('BUY', 'MARKET'), model: 'x' });
  assert.strictEqual(p.verdict.action, 'NO_TRADE');
});
