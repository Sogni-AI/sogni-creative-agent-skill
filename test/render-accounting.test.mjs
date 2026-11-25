import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTE_UNAVAILABLE, buildQuoteResult, chargeFromProjectRecord, chargeFromProjectRecords,
  isPlanCovered, memberPrice, planFromSubscription, quoteTime, quoteUnavailableError
} from '../render-accounting.mjs';

const UNLIMITED = { active: true, status: 'active', tier: 'unlimited', frontierDiscountBps: 500 };

test('a quote reports Sogni\'s price, plan, time, fair-use share and balance in the documented order', () => {
  const quote = buildQuoteResult({
    media: 'image',
    model: 'z_image_turbo_bf16',
    network: 'fast',
    tokenType: 'spark',
    settings: { width: 1024, height: 1024, count: 1, steps: 8 },
    estimate: {
      token: '1.6', spark: '1.6', sogni: '0.08', usd: '0.008',
      estimatedRenderSeconds: 6.6, estimatedTotalSeconds: 16.6, dailyFairUsePct: 0.1
    },
    partnerModel: false,
    subscription: UNLIMITED,
    balance: { spark: 840.2, sogni: 12, premiumSpark: 5 },
    billingMode: undefined
  });
  assert.equal(JSON.stringify(quote), JSON.stringify({
    success: true,
    type: 'quote',
    media: 'image',
    model: 'z_image_turbo_bf16',
    network: 'fast',
    tokenType: 'spark',
    settings: { width: 1024, height: 1024, count: 1, steps: 8 },
    price: { spark: 1.6, sogni: 0.08, usd: 0.008 },
    partnerModel: false,
    planCovered: true,
    plan: { active: true, tier: 'unlimited', partnerDiscountBps: 500 },
    time: { renderSeconds: 6.6, queueSeconds: 10, totalSeconds: 16.6 },
    dailyFairUsePct: 0.1,
    balance: { spark: 840.2, sogni: 12, premiumSpark: 5 }
  }));
});

test('a partner model never counts as covered and shows the member price Sogni charges', () => {
  const quote = buildQuoteResult({
    media: 'video', model: 'seedance-2-5', network: 'fast', tokenType: 'spark', settings: {},
    estimate: { spark: '20.67', sogni: '1.2', usd: '0.1' },
    partnerModel: true, subscription: { ...UNLIMITED, tier: 'unlimited_pro', frontierDiscountBps: 1000 }, balance: null
  });
  assert.equal(quote.planCovered, false);
  assert.deepEqual(quote.memberPrice, { spark: 18.603, sogni: 1.08, usd: 0.09, discountBps: 1000 });
  assert.equal('time' in quote, false);
  assert.equal('balance' in quote, false);
  assert.equal('dailyFairUsePct' in quote, false);

  const accountPrice = { spark: '18.603', token: '18.603', usd: '0.09', sogni: '1.08', discountBps: 1000 };
  const personal = buildQuoteResult({
    media: 'video', estimate: { spark: '20.67', accountPrice }, partnerModel: true, subscription: null
  });
  assert.equal(personal.price.spark, 20.67);
  assert.deepEqual(personal.accountPrice, accountPrice);

  const noPlan = buildQuoteResult({
    media: 'image', model: 'seedream-5-5-uncensored', network: 'fast', tokenType: 'spark', settings: {},
    estimate: { spark: '4' }, partnerModel: true, subscription: { active: false, status: 'none' }, balance: null
  });
  assert.deepEqual(noPlan.plan, { active: false });
  assert.equal('memberPrice' in noPlan, false);
});

test('plan coverage needs an active plan, a covered model, Spark and no token billing', () => {
  const plan = planFromSubscription(UNLIMITED);
  assert.equal(isPlanCovered({ plan, partnerModel: false, billingMode: undefined, tokenType: 'spark' }), true);
  assert.equal(isPlanCovered({ plan, partnerModel: false, billingMode: 'subscription', tokenType: 'spark' }), true);
  assert.equal(isPlanCovered({ plan, partnerModel: false, billingMode: 'tokens', tokenType: 'spark' }), false);
  assert.equal(isPlanCovered({ plan, partnerModel: false, billingMode: undefined, tokenType: 'sogni' }), false);
  assert.equal(isPlanCovered({ plan, partnerModel: true, billingMode: undefined, tokenType: 'spark' }), false);
  assert.equal(isPlanCovered({ plan: null, partnerModel: false, billingMode: undefined, tokenType: 'spark' }), false);
  assert.equal(planFromSubscription(null), null);
  assert.deepEqual(planFromSubscription({ active: true }), { active: true });
});

test('time fields appear only when Sogni sent them', () => {
  assert.equal(quoteTime({ spark: '1' }), null);
  assert.deepEqual(quoteTime({ estimatedRenderSeconds: 12.5 }), { renderSeconds: 12.5 });
  assert.deepEqual(quoteTime({ estimatedRenderSeconds: 0.3, estimatedTotalSeconds: 0.6 }), {
    renderSeconds: 0.3, queueSeconds: 0.3, totalSeconds: 0.6
  });
  assert.equal(memberPrice({ spark: 1 }, 0), null);
});

test('the charge follows the payment model Sogni recorded, never the request', () => {
  const cost = { costInSpark: '20.67', costInSogni: '1.2', costInUSD: '0.1', costInToken: '20.67' };
  assert.deepEqual(chargeFromProjectRecord({ finished: true, paymentModel: 'subscription', costActual: cost }), {
    charge: { paidBy: 'plan', amount: { spark: 0, sogni: 0, usd: 0 }, value: { spark: 20.67, sogni: 1.2, usd: 0.1 } }
  });
  assert.deepEqual(chargeFromProjectRecord({ finished: true, paymentModel: 'free_spark', costActual: cost }).charge.amount,
    { spark: 20.67, sogni: 0, usd: 0.1 });
  assert.deepEqual(chargeFromProjectRecord({ finished: true, paymentModel: 'sogni', costActual: cost }).charge.amount,
    { spark: 0, sogni: 1.2, usd: 0.1 });
  assert.equal(chargeFromProjectRecord({ finished: true, paymentModel: 'promo_credit', costActual: cost }).charge.paidBy, 'credit');

  for (const [record, reason] of [
    [null, /no record/],
    [{ finished: false, paymentModel: 'subscription', costActual: cost }, /had not finished/],
    [{ finished: true, costActual: cost }, /how this project was paid/],
    [{ finished: true, paymentModel: 'paid_spark', costActual: {} }, /Spark cost/]
  ]) {
    const result = chargeFromProjectRecord(record);
    assert.equal(result.charge, null);
    assert.match(result.chargeUnavailable, reason);
  }
});

test('a run\'s projects add up when the same balance paid for all of them', () => {
  const record = (spark) => ({ finished: true, paymentModel: 'paid_spark', costActual: { costInSpark: spark, costInUSD: '0.1', costInSogni: '1' } });
  assert.deepEqual(chargeFromProjectRecords([record('0.1'), record('0.2')]).charge, {
    paidBy: 'spark', amount: { spark: 0.3, sogni: 0, usd: 0.2 }, value: { spark: 0.3, sogni: 2, usd: 0.2 }
  });
  const mixed = chargeFromProjectRecords([record('1'), { ...record('1'), paymentModel: 'subscription' }]);
  assert.equal(mixed.charge, null);
  assert.match(mixed.chargeUnavailable, /different ways/);
});

test('quote refusals carry their own error code', () => {
  const err = quoteUnavailableError('No quote.', { hint: 'Try another model.' });
  assert.equal(err.code, QUOTE_UNAVAILABLE);
  assert.equal(err.hint, 'Try another model.');
});
