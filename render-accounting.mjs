/**
 * --quote and --receipt: the price, plan coverage and time Sogni quotes for a
 * request before it starts, and the charge Sogni recorded for a project after
 * it finished. Prices and times come from Sogni; this module only arranges them.
 */

/** Error code for a request Sogni cannot quote, as opposed to a network or account failure. */
export const QUOTE_UNAVAILABLE = 'QUOTE_UNAVAILABLE';

/** An Error with the QUOTE_UNAVAILABLE code and an optional hint. */
export function quoteUnavailableError(message, { hint, details, cause } = {}) {
  const err = new Error(message);
  err.code = QUOTE_UNAVAILABLE;
  err.retryable = false;
  if (hint) err.hint = hint;
  if (details) err.details = details;
  if (cause) err.cause = cause;
  return err;
}

/** A finite number from a Sogni amount (sent as a decimal string or a number), else undefined. */
export function parseAmount(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(number) ? number : undefined;
}

function compact(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Rounds away float noise from decimal arithmetic without changing a value
// Sogni could have sent: its amounts carry far fewer than 15 significant digits.
function tidy(value) {
  return Number(value.toPrecision(15));
}

/** `{ spark, sogni, usd }` from an SDK cost estimate, each only when Sogni sent it. */
export function quotePrice(estimate) {
  return compact({
    spark: parseAmount(estimate?.spark),
    sogni: parseAmount(estimate?.sogni),
    usd: parseAmount(estimate?.usd)
  });
}

/**
 * Sogni's time estimate, or null when it sent none. The SDK returns the render
 * and total seconds; Sogni computes the total as render plus queue wait
 * (rounded to 0.01 s), so the wait is their difference at that precision.
 */
export function quoteTime(estimate) {
  const renderSeconds = parseAmount(estimate?.estimatedRenderSeconds);
  const totalSeconds = parseAmount(estimate?.estimatedTotalSeconds);
  const queueSeconds = renderSeconds !== undefined && totalSeconds !== undefined
    ? Math.max(0, Math.round((totalSeconds - renderSeconds) * 100) / 100)
    : undefined;
  const time = compact({ renderSeconds, queueSeconds, totalSeconds });
  return Object.keys(time).length ? time : null;
}

/**
 * The account's plan as `--quote` reports it: `{ active: false }` without a
 * plan, `{ active: true, tier?, partnerDiscountBps? }` with one, or null when
 * the plan could not be read.
 */
export function planFromSubscription(subscription) {
  if (!subscription || typeof subscription !== 'object') return null;
  if (subscription.active !== true) return { active: false };
  const bps = parseAmount(subscription.frontierDiscountBps);
  return compact({
    active: true,
    tier: typeof subscription.tier === 'string' && subscription.tier ? subscription.tier : undefined,
    partnerDiscountBps: bps !== undefined && bps > 0 ? bps : undefined
  });
}

/**
 * Whether the plan would pay for the request, as the CLI reads the account:
 * an active plan, a model plans cover (not a partner model), SPARK billing and
 * no explicit token billing. Sogni decides again when the project is submitted.
 */
export function isPlanCovered({ plan, partnerModel, billingMode, tokenType }) {
  return plan?.active === true && !partnerModel && billingMode !== 'tokens' && tokenType !== 'sogni';
}

/**
 * The quote for a partner model after a member's discount: Sogni takes `bps`
 * basis points off the Spark, SOGNI and USD amounts when it admits the project.
 * Sogni settles some partner models from the vendor's actual usage, so the
 * recorded charge can differ slightly. Null when there is no discount.
 */
export function memberPrice(price, bps) {
  if (!(bps > 0) || bps >= 10000) return null;
  const factor = (10000 - bps) / 10000;
  const discounted = {};
  for (const key of ['spark', 'sogni', 'usd']) {
    if (price[key] !== undefined) discounted[key] = tidy(price[key] * factor);
  }
  return { ...discounted, discountBps: bps };
}

/** `{ spark, sogni, premiumSpark? }` from the wrapper's balance, or null when none could be read. */
export function quoteBalance(balance) {
  if (!balance || typeof balance !== 'object') return null;
  const out = compact({
    spark: parseAmount(balance.spark),
    sogni: parseAmount(balance.sogni),
    premiumSpark: parseAmount(balance.premiumSpark)
  });
  return out.spark === undefined && out.sogni === undefined ? null : out;
}

/** The `--quote --json` object, fields in the documented order. */
export function buildQuoteResult({
  media, model, network, tokenType, settings, estimate, partnerModel, subscription, balance, billingMode
}) {
  const price = quotePrice(estimate);
  const plan = planFromSubscription(subscription);
  const discount = partnerModel && plan?.active ? memberPrice(price, plan.partnerDiscountBps) : null;
  const time = quoteTime(estimate);
  const dailyFairUsePct = parseAmount(estimate?.dailyFairUsePct);
  const balances = quoteBalance(balance);
  return {
    success: true,
    type: 'quote',
    media,
    model,
    network,
    tokenType,
    settings,
    price,
    ...(discount ? { memberPrice: discount } : {}),
    partnerModel: Boolean(partnerModel),
    planCovered: isPlanCovered({ plan, partnerModel, billingMode, tokenType }),
    ...(plan ? { plan } : {}),
    ...(time ? { time } : {}),
    ...(dailyFairUsePct !== undefined ? { dailyFairUsePct } : {}),
    ...(balances ? { balance: balances } : {})
  };
}

// Sogni's payment models, named for the person who paid.
const PAID_BY = {
  subscription: 'plan',
  paid_spark: 'spark',
  free_spark: 'spark',
  sogni: 'sogni',
  promo_credit: 'credit'
};

function unavailable(reason) {
  return { charge: null, chargeUnavailable: reason };
}

/**
 * The charge Sogni recorded for one finished project record
 * (`GET /v2/projects/:id`): who paid, what left the balances, and the work's
 * value. Returns `{ charge }` or `{ charge: null, chargeUnavailable }`.
 */
export function chargeFromProjectRecord(record) {
  if (!record || typeof record !== 'object') return unavailable('Sogni returned no record for this project.');
  if (record.finished === false) return unavailable('Sogni had not finished this project when its record was read.');
  const paidBy = PAID_BY[record.paymentModel];
  if (!paidBy) return unavailable('Sogni did not record how this project was paid.');
  const cost = record.costActual;
  const value = compact({
    spark: parseAmount(cost?.costInSpark),
    sogni: parseAmount(cost?.costInSogni),
    usd: parseAmount(cost?.costInUSD)
  });
  let amount;
  if (paidBy === 'plan' || paidBy === 'credit') {
    amount = { spark: 0, sogni: 0, usd: 0 };
  } else if (paidBy === 'spark') {
    if (value.spark === undefined) return unavailable('Sogni did not record this project\'s Spark cost.');
    amount = { spark: value.spark, sogni: 0, usd: value.usd ?? 0 };
  } else {
    if (value.sogni === undefined) return unavailable('Sogni did not record this project\'s SOGNI cost.');
    amount = { spark: 0, sogni: value.sogni, usd: value.usd ?? 0 };
  }
  return { charge: { paidBy, amount, ...(Object.keys(value).length ? { value } : {}) } };
}

/**
 * One charge for every project a run submitted: amounts add up when the same
 * balance paid for all of them; otherwise the charge is reported unavailable.
 */
export function chargeFromProjectRecords(records) {
  const charges = records.map(chargeFromProjectRecord);
  const missing = charges.find((entry) => entry.charge === null);
  if (missing) return missing;
  if (charges.length === 0) return unavailable('This run submitted no project.');
  if (charges.length === 1) return charges[0];
  const paidBy = charges[0].charge.paidBy;
  if (charges.some((entry) => entry.charge.paidBy !== paidBy)) {
    return unavailable('This run\'s projects were paid in different ways.');
  }
  const sum = (field) => {
    const out = {};
    for (const key of ['spark', 'sogni', 'usd']) {
      const values = charges.map((entry) => entry.charge[field]?.[key]);
      if (values.every((value) => value !== undefined)) out[key] = tidy(values.reduce((total, value) => total + value, 0));
    }
    return out;
  };
  const value = sum('value');
  return { charge: { paidBy, amount: sum('amount'), ...(Object.keys(value).length ? { value } : {}) } };
}
