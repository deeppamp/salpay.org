const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = Number(process.env.PORT || 3001);
const WALLET_RPC_URL = process.env.SALVIUM_RPC_URL || 'http://127.0.0.1:29088/json_rpc';
// View-only treasury wallet-rpc for chain_proof + public treasury stats. Falls back to SALVIUM_RPC_URL.
const TREASURY_VIEW_RPC_URL = String(process.env.TREASURY_VIEW_RPC_URL || '').trim() || WALLET_RPC_URL;
// Public website/GUI treasury balance (view-only RPC required). Default on for salpay.org.
const TREASURY_PUBLIC_STATS = String(process.env.TREASURY_PUBLIC_STATS || 'true').trim().toLowerCase() === 'true';
const TREASURY_STATS_CACHE_MS = Math.max(5000, Number(process.env.TREASURY_STATS_CACHE_MS || 30000));
let treasuryStatsCache = { at: 0, payload: null };

const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const SALPAY_NETWORK_RAW = String(process.env.SALPAY_NETWORK || 'testnet').trim().toLowerCase();
const SALPAY_NETWORK = ['mainnet', 'testnet', 'stagenet'].includes(SALPAY_NETWORK_RAW) ? SALPAY_NETWORK_RAW : 'testnet';
const MINT_TREASURY_ADDRESS = (
  process.env[`MINT_TREASURY_ADDRESS_${SALPAY_NETWORK.toUpperCase()}`]
  || process.env.MINT_TREASURY_ADDRESS
  || ''
).trim();
const MINT_BURN_ADDRESS = String(process.env.MINT_BURN_ADDRESS || '').trim();
// Burn split: mainnet default 50% protocol BURN; testnet/stagenet default 0 (many
// offline/test builds do not support protocol BURN — mint would hang waiting for it).
// Explicit MINT_BURN_PERCENT always wins when set.
const MINT_BURN_PERCENT_ENV = process.env.MINT_BURN_PERCENT;
const MINT_BURN_PERCENT_DEFAULT = SALPAY_NETWORK === 'mainnet' ? 50 : 0;
const MINT_BURN_PERCENT_RAW = (MINT_BURN_PERCENT_ENV != null && String(MINT_BURN_PERCENT_ENV).trim() !== '')
  ? Number(MINT_BURN_PERCENT_ENV)
  : MINT_BURN_PERCENT_DEFAULT;
const MINT_BURN_PERCENT = Number.isFinite(MINT_BURN_PERCENT_RAW)
  ? Math.max(0, Math.min(100, MINT_BURN_PERCENT_RAW))
  : MINT_BURN_PERCENT_DEFAULT;
const MINT_RESERVATION_TTL_SECONDS = Number(process.env.MINT_RESERVATION_TTL_SECONDS || 900);
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || '';
const TURNSTILE_ENFORCE = String(process.env.TURNSTILE_ENFORCE || 'false').toLowerCase() === 'true';
const TURNSTILE_EFFECTIVE = TURNSTILE_ENFORCE && TURNSTILE_SECRET.trim().length > 0;
const TURNSTILE_ALLOW_TRUSTED_CLIENT = String(process.env.TURNSTILE_ALLOW_TRUSTED_CLIENT || 'false').toLowerCase() === 'true';
const TURNSTILE_TRUSTED_CLIENT_KEY = String(process.env.TURNSTILE_TRUSTED_CLIENT_KEY || '').trim();
const TURNSTILE_SKIP_MINT_WHEN_CHAIN_PROOF = String(process.env.TURNSTILE_SKIP_MINT_WHEN_CHAIN_PROOF || 'true').toLowerCase() === 'true';
const MINT_PAYMENT_VERIFICATION_MODE_RAW = String(process.env.MINT_PAYMENT_VERIFICATION_MODE || 'client_attested').trim().toLowerCase();
const MINT_PAYMENT_VERIFICATION_MODE = ['client_attested', 'chain_proof'].includes(MINT_PAYMENT_VERIFICATION_MODE_RAW)
  ? MINT_PAYMENT_VERIFICATION_MODE_RAW
  : 'client_attested';
const MINT_CHAIN_PROOF_MIN_CONFIRMATIONS = Math.max(0, Number(process.env.MINT_CHAIN_PROOF_MIN_CONFIRMATIONS || 1));
const RATE_LIMIT_SEND_PER_MINUTE = Number(process.env.RATE_LIMIT_SEND_PER_MINUTE || 10);
const RATE_LIMIT_REGISTER_PER_MINUTE = Number(process.env.RATE_LIMIT_REGISTER_PER_MINUTE || 10);
const RATE_LIMIT_SUGGEST_PER_MINUTE = Number(process.env.RATE_LIMIT_SUGGEST_PER_MINUTE || 120);
const PAYMENT_MODE = String(process.env.PAYMENT_MODE || 'relay').trim().toLowerCase();
const NON_CUSTODIAL_MODE = PAYMENT_MODE === 'client_wallet';
const NAMES_DB_PATH = process.env.NAMES_DB_PATH || path.join(__dirname, 'data', 'minted-names.json');
const RESOLVE_VERIFIED_ONLY = String(process.env.RESOLVE_VERIFIED_ONLY || 'true').trim().toLowerCase() === 'true';
const AUTHORITATIVE_NAME_CHECK_URL = String(process.env.AUTHORITATIVE_NAME_CHECK_URL || '').trim();
const AUTHORITATIVE_NAME_CHECK_FAIL_CLOSED = String(process.env.AUTHORITATIVE_NAME_CHECK_FAIL_CLOSED || 'true').trim().toLowerCase() === 'true';
const AUTHORITATIVE_NAME_CHECK_TIMEOUT_MS = Math.max(500, Number(process.env.AUTHORITATIVE_NAME_CHECK_TIMEOUT_MS || 2500));
const AUTHORITATIVE_TICKER_CHECK_URL = String(process.env.AUTHORITATIVE_TICKER_CHECK_URL || '').trim();
const AUTHORITATIVE_TICKER_CHECK_FAIL_CLOSED = String(process.env.AUTHORITATIVE_TICKER_CHECK_FAIL_CLOSED || 'true').trim().toLowerCase() === 'true';
const AUTHORITATIVE_TICKER_CHECK_TIMEOUT_MS = Math.max(500, Number(process.env.AUTHORITATIVE_TICKER_CHECK_TIMEOUT_MS || 2500));
// Optional second layer: on-chain / indexer uniqueness (stub until wired).
// Use "stub" to explicitly acknowledge chain not checked yet, or an HTTP URL when ready.
// wallet_rpc → token_info/get_tokens via CHAIN_TICKER_RPC_URL || TREASURY_VIEW_RPC_URL || SALVIUM_RPC_URL.
const CHAIN_NAME_CHECK_URL = String(process.env.CHAIN_NAME_CHECK_URL || '').trim();
const CHAIN_TICKER_CHECK_URL = String(process.env.CHAIN_TICKER_CHECK_URL || '').trim();
const CHAIN_TICKER_RPC_URL = String(process.env.CHAIN_TICKER_RPC_URL || '').trim();
const CHAIN_CHECK_FAIL_CLOSED = String(process.env.CHAIN_CHECK_FAIL_CLOSED || 'false').trim().toLowerCase() === 'true';
const MAINNET_STRICT_GUARDS = String(process.env.MAINNET_STRICT_GUARDS || 'true').trim().toLowerCase() === 'true';
// Public base for absolute image URLs (e.g. https://salpay.org). Falls back to request host.
const PUBLIC_API_BASE_URL = String(process.env.PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || '').trim().replace(/\/$/, '');
const NAME_IMAGES_DIR = process.env.NAME_IMAGES_DIR
  || path.join(path.dirname(process.env.NAMES_DB_PATH || path.join(__dirname, 'data', 'minted-names.json')), 'name-images');
const MAX_NAME_IMAGE_BYTES = Math.max(32 * 1024, Math.min(1024 * 1024, Number(process.env.MAX_NAME_IMAGE_BYTES || 512 * 1024)));
const ALLOWED_NAME_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp'
};
const OPS_ALERT_WINDOW_SECONDS = Math.max(60, Number(process.env.OPS_ALERT_WINDOW_SECONDS || 300));
const OPS_ALERT_FAILURE_THRESHOLD = Math.max(1, Number(process.env.OPS_ALERT_FAILURE_THRESHOLD || 10));
const OPS_ALERT_COOLDOWN_SECONDS = Math.max(30, Number(process.env.OPS_ALERT_COOLDOWN_SECONDS || 120));
const SAL_NAME_SUFFIX = '.sal';
const SAL_NAME_BASE_MIN_LENGTH = 1;
const SAL_NAME_BASE_MAX_LENGTH = 63;
const SAL_NAME_BASE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SAL_NAME_RULE_MESSAGE = 'Name must be lowercase, end with .sal, contain 1-63 letters/numbers/hyphens before .sal, and start/end with a letter or number';
// Fixed SAL tiers for offline/private testnet (no oracle).
const SAL_NAME_FEE_TIERS = [
  { min_length: 1, max_length: 4, fee: 2000 },
  { min_length: 5, max_length: 6, fee: 500 },
  { min_length: 7, max_length: SAL_NAME_BASE_MAX_LENGTH, fee: 100 }
];
// Mainnet target: ~$20–$50 USD paid in SAL1 (no specialty names). See PRICING-USDT-PEGGED.md.
const FEE_CURRENCY = String(process.env.FEE_CURRENCY || 'sal').trim().toLowerCase() === 'usd' ? 'usd' : 'sal';
const FEE_USD_TIERS = [
  { min_length: 1, max_length: 4, usd: 50 },
  { min_length: 5, max_length: 6, usd: 35 },
  { min_length: 7, max_length: SAL_NAME_BASE_MAX_LENGTH, usd: 20 }
];
// Manual fallback USD-per-SAL1 (used when oracle is off/down or for clamps).
const SAL_USD_MANUAL_RATE = Math.max(0, Number(process.env.SAL_USD_MANUAL_RATE || 0));
const FEE_USD_BUFFER_PERCENT = Math.max(0, Math.min(25, Number(process.env.FEE_USD_BUFFER_PERCENT || 3)));
// Price source: auto (CoinGecko → manual → last good), coingecko, or manual.
const SAL_USD_PRICE_SOURCE_RAW = String(process.env.SAL_USD_PRICE_SOURCE || 'auto').trim().toLowerCase();
const SAL_USD_PRICE_SOURCE = ['auto', 'coingecko', 'manual'].includes(SAL_USD_PRICE_SOURCE_RAW)
  ? SAL_USD_PRICE_SOURCE_RAW
  : 'auto';
const COINGECKO_COIN_ID = String(process.env.COINGECKO_COIN_ID || 'salvium').trim() || 'salvium';
const COINGECKO_API_BASE = String(process.env.COINGECKO_API_BASE || 'https://api.coingecko.com/api/v3').trim()
  .replace(/\/+$/, '');
const SAL_USD_RATE_CACHE_MS = Math.max(30_000, Number(process.env.SAL_USD_RATE_CACHE_MS || 300_000)); // 5m default
const SAL_USD_RATE_MIN = Math.max(0, Number(process.env.SAL_USD_RATE_MIN || 0.0001));
const SAL_USD_RATE_MAX = Math.max(SAL_USD_RATE_MIN, Number(process.env.SAL_USD_RATE_MAX || 100));
const SAL_USD_RATE_FETCH_TIMEOUT_MS = Math.max(2000, Number(process.env.SAL_USD_RATE_FETCH_TIMEOUT_MS || 8000));
/** @type {{ rate: number, source: string, fetched_at: number, raw?: number, error?: string|null }} */
let salUsdRateState = {
  rate: SAL_USD_MANUAL_RATE > 0 ? SAL_USD_MANUAL_RATE : 0,
  source: SAL_USD_MANUAL_RATE > 0 ? 'manual' : 'none',
  fetched_at: 0,
  raw: SAL_USD_MANUAL_RATE > 0 ? SAL_USD_MANUAL_RATE : undefined,
  error: null
};
let salUsdRateInflight = null;
// Protocol burn (GUI/CLI BURN tx), not a fake burn address. Mainnet: set MINT_BURN_PERCENT=50.
const MINT_BURN_KIND = String(process.env.MINT_BURN_KIND || 'protocol').trim().toLowerCase() === 'address'
  ? 'address'
  : 'protocol';

if (TURNSTILE_ENFORCE && !TURNSTILE_EFFECTIVE) {
  console.warn('TURNSTILE_ENFORCE=true but TURNSTILE_SECRET is missing; Turnstile checks are disabled until secret is set.');
}

if (MINT_PAYMENT_VERIFICATION_MODE_RAW !== MINT_PAYMENT_VERIFICATION_MODE) {
  console.warn(`Unknown MINT_PAYMENT_VERIFICATION_MODE=${MINT_PAYMENT_VERIFICATION_MODE_RAW}; defaulting to client_attested.`);
}

if (SALPAY_NETWORK_RAW !== SALPAY_NETWORK) {
  console.warn(`Unknown SALPAY_NETWORK=${SALPAY_NETWORK_RAW}; defaulting to testnet.`);
}

if (SALPAY_NETWORK === 'mainnet' && MAINNET_STRICT_GUARDS) {
  if (MINT_PAYMENT_VERIFICATION_MODE !== 'chain_proof') {
    console.error('Mainnet strict mode requires MINT_PAYMENT_VERIFICATION_MODE=chain_proof. Refusing to start.');
    process.exit(1);
  }

  if (!AUTHORITATIVE_NAME_CHECK_URL) {
    console.error('Mainnet strict mode requires AUTHORITATIVE_NAME_CHECK_URL (use "self" for built-in registry). Refusing to start.');
    process.exit(1);
  }

  if (!AUTHORITATIVE_TICKER_CHECK_URL) {
    console.error('Mainnet strict mode requires AUTHORITATIVE_TICKER_CHECK_URL (use "self" for built-in registry). Refusing to start.');
    process.exit(1);
  }

  if (!String(process.env.TREASURY_VIEW_RPC_URL || '').trim()) {
    console.error(
      'Mainnet strict mode requires TREASURY_VIEW_RPC_URL (view-only wallet-rpc that sees mint fee deposits). Refusing to start.'
    );
    process.exit(1);
  }

  if (MINT_BURN_PERCENT > 0 && !String(process.env.OPS_API_KEY || '').trim()) {
    console.error(
      'Mainnet strict mode with MINT_BURN_PERCENT>0 requires OPS_API_KEY for operator burn-queue auth. Refusing to start.'
    );
    process.exit(1);
  }

  if (CORS_ALLOW_ORIGIN === '*' || !CORS_ALLOW_ORIGIN) {
    console.error(
      'Mainnet strict mode refuses CORS_ALLOW_ORIGIN=* (or empty). Set CORS_ALLOW_ORIGIN=https://salpay.org. Refusing to start.'
    );
    process.exit(1);
  }

  if (!TURNSTILE_EFFECTIVE) {
    console.error(
      'Mainnet strict mode requires working Turnstile (TURNSTILE_ENFORCE=true and TURNSTILE_SECRET set). Refusing to start.'
    );
    process.exit(1);
  }

  if (PAYMENT_MODE !== 'client_wallet' && PAYMENT_MODE !== 'relay') {
    console.warn(`Mainnet: unusual PAYMENT_MODE=${PAYMENT_MODE}; recommended client_wallet.`);
  }

  if (!CHAIN_TICKER_CHECK_URL || isChainStubUrl(CHAIN_TICKER_CHECK_URL)) {
    console.warn(
      'Mainnet: CHAIN_TICKER_CHECK_URL is stub/empty. SalPay DB still blocks your issued tickers, ' +
      'but foreign on-chain tickers are not probed. Set CHAIN_TICKER_CHECK_URL=wallet_rpc (token_info) ' +
      'or an HTTP indexer when ready; use CHAIN_CHECK_FAIL_CLOSED=true once the probe is reliable.'
    );
  }
}

if (!MINT_TREASURY_ADDRESS) {
  console.error(`Missing mint treasury configuration. Set MINT_TREASURY_ADDRESS_${SALPAY_NETWORK.toUpperCase()} or MINT_TREASURY_ADDRESS.`);
  process.exit(1);
}

if (!isLikelyAddress(MINT_TREASURY_ADDRESS)) {
  console.error('Configured mint treasury address does not look valid. Refusing to start.');
  process.exit(1);
}

// Address-split burn requires a burn SC address. Protocol burn does not (wallet BURN tx).
if (MINT_BURN_PERCENT > 0 && MINT_BURN_KIND === 'address' && !MINT_BURN_ADDRESS) {
  console.error('MINT_BURN_PERCENT>0 with MINT_BURN_KIND=address requires MINT_BURN_ADDRESS. Refusing to start.');
  process.exit(1);
}

if (MINT_BURN_KIND === 'address' && MINT_BURN_ADDRESS && !isLikelyAddress(MINT_BURN_ADDRESS)) {
  console.error('Configured burn address does not look valid. Refusing to start.');
  process.exit(1);
}

function roundSalAmount(value) {
  return Number(Number(value).toFixed(12));
}

/**
 * User mint payment: always 100% transfer to treasury (any wallet).
 * Operator later burns MINT_BURN_PERCENT via ops burn-queue (not user protocol burn).
 * Set MINT_USER_SPLIT_PAYMENT=true only for legacy dual-leg user burn experiments.
 */
const MINT_USER_SPLIT_PAYMENT = String(process.env.MINT_USER_SPLIT_PAYMENT || 'false').trim().toLowerCase() === 'true';
const OPS_API_KEY = String(process.env.OPS_API_KEY || '').trim();

function operatorBurnAmountSal(totalFeeSal) {
  const total = Number(totalFeeSal);
  if (!Number.isFinite(total) || total <= 0 || MINT_BURN_PERCENT <= 0) return 0;
  return roundSalAmount(total * (MINT_BURN_PERCENT / 100));
}

function buildOperatorBurnPlan(totalFeeSal) {
  const fee = roundSalAmount(Number(totalFeeSal) || 0);
  const burnAmount = operatorBurnAmountSal(fee);
  return {
    mode: 'operator_after_mint',
    percent: MINT_BURN_PERCENT,
    kind: MINT_BURN_KIND,
    fee_sal: fee,
    burn_amount_sal: burnAmount,
    treasury_keeps_sal: roundSalAmount(Math.max(0, fee - burnAmount)),
    note: burnAmount > 0
      ? 'User pays full fee to treasury. Operator burns burn_amount_sal later; proof attached to mint record.'
      : 'No operator burn configured (MINT_BURN_PERCENT=0).'
  };
}

function buildPaymentOutputs(totalFeeSal) {
  const total = Number(totalFeeSal);
  if (!Number.isFinite(total) || total <= 0) {
    return [];
  }

  // Default / production: single transfer of full fee (any wallet can mint).
  if (!MINT_USER_SPLIT_PAYMENT || MINT_BURN_PERCENT <= 0) {
    return [{
      role: 'treasury',
      kind: 'transfer',
      address: MINT_TREASURY_ADDRESS,
      amount: roundSalAmount(total)
    }];
  }

  // Legacy optional path: user pays split (treasury + protocol burn or burn address).
  const burnAmount = roundSalAmount(total * (MINT_BURN_PERCENT / 100));
  const treasuryAmount = roundSalAmount(total - burnAmount);
  if (burnAmount <= 0 || treasuryAmount <= 0) {
    return [{
      role: 'treasury',
      kind: 'transfer',
      address: MINT_TREASURY_ADDRESS,
      amount: roundSalAmount(total)
    }];
  }

  if (MINT_BURN_KIND === 'protocol') {
    return [
      {
        role: 'treasury',
        kind: 'transfer',
        address: MINT_TREASURY_ADDRESS,
        amount: treasuryAmount
      },
      {
        role: 'burn',
        kind: 'protocol_burn',
        asset_type: 'SAL1',
        amount: burnAmount
      }
    ];
  }

  if (!MINT_BURN_ADDRESS) {
    return [{
      role: 'treasury',
      kind: 'transfer',
      address: MINT_TREASURY_ADDRESS,
      amount: roundSalAmount(total)
    }];
  }

  return [
    {
      role: 'treasury',
      kind: 'transfer',
      address: MINT_TREASURY_ADDRESS,
      amount: treasuryAmount
    },
    {
      role: 'burn',
      kind: 'transfer',
      address: MINT_BURN_ADDRESS,
      amount: burnAmount
    }
  ];
}

function paymentRequiresProtocolBurn(outputs = []) {
  return (outputs || []).some((o) => String(o?.kind || '') === 'protocol_burn' || (String(o?.role) === 'burn' && !o?.address));
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length || left.length === 0) {
    // Compare against self to keep runtime roughly constant when lengths differ.
    crypto.timingSafeEqual(left.length ? left : Buffer.from('0'), left.length ? left : Buffer.from('0'));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function requireOpsAuth(req, res) {
  if (!OPS_API_KEY) {
    res.status(503).json({
      success: false,
      error: 'OPS_API_KEY is not configured on this server'
    });
    return false;
  }
  const headerKey = String(req.get('x-ops-key') || '').trim();
  const auth = String(req.get('authorization') || '').trim();
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const provided = headerKey || bearer;
  if (!timingSafeEqualString(provided, OPS_API_KEY)) {
    res.status(401).json({ success: false, error: 'Unauthorized (ops key required)' });
    return false;
  }
  return true;
}

/** Reject reusing the same treasury payment tx for multiple mints. */
function isPaymentTxHashAlreadyUsed(txHash, excludeReservationId = '') {
  const target = String(txHash || '').trim().toLowerCase();
  if (!target) return false;

  for (const [resId, verification] of paymentVerifications.entries()) {
    if (excludeReservationId && resId === excludeReservationId) continue;
    if (verification?.status !== 'verified') continue;
    const prior = String(verification.tx_hash || '').trim().toLowerCase();
    if (prior && prior === target) return true;
  }

  for (const minted of mintedNames.values()) {
    const prior = String(
      minted?.verification?.payment_tx_hash
      || minted?.operator_burn?.payment_tx_hash
      || ''
    ).trim().toLowerCase();
    if (prior && prior === target) return true;
  }

  for (const reservation of mintReservations.values()) {
    if (excludeReservationId && reservation.id === excludeReservationId) continue;
    if (!reservation?.payment_verified) continue;
    const prior = String(reservation.payment_tx_hash || '').trim().toLowerCase();
    if (prior && prior === target) return true;
  }

  return false;
}

function publicBurnProofFromMint(record) {
  if (!record) return null;
  const burn = record.operator_burn || null;
  return {
    name: record.name,
    ticker: record.ticker || null,
    fee_sal: burn?.fee_sal ?? null,
    payment_tx_hash: record.verification?.payment_tx_hash || burn?.payment_tx_hash || null,
    operator_burn: burn
      ? {
          status: burn.status,
          percent: burn.percent,
          amount_sal: burn.amount_sal,
          burn_tx_hash: burn.burn_tx_hash || null,
          burned_at: burn.burned_at || null,
          kind: burn.kind || MINT_BURN_KIND
        }
      : null
  };
}

function normalizeOutputsByAddress(outputs = []) {
  const merged = new Map();
  for (const item of outputs) {
    const address = String(item?.address || '').trim();
    const amount = Number(item?.amount || 0);
    if (!address || !Number.isFinite(amount) || amount <= 0) continue;
    const current = merged.get(address) || { address, amount: 0 };
    current.amount = roundSalAmount(current.amount + amount);
    merged.set(address, current);
  }
  return Array.from(merged.values());
}

app.set('trust proxy', true);

// 1mb for mint image uploads (base64 of up to ~512KB binary).
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));

const mintReservations = new Map();
const reservationByName = new Map();
const mintJobs = new Map();
const mintedNames = new Map();
const paymentVerifications = new Map();
const auditTrail = [];
const opsFailureWindows = new Map();
const opsAlertLastAt = new Map();

function loadMintedNames() {
  try {
    if (fs.existsSync(NAMES_DB_PATH)) {
      const raw = fs.readFileSync(NAMES_DB_PATH, 'utf8');
      const records = JSON.parse(raw);
      if (Array.isArray(records)) {
        for (const record of records) {
          if (record && record.name) {
            mintedNames.set(record.name, record);
          }
        }
        console.log(`Loaded ${mintedNames.size} minted names from ${NAMES_DB_PATH}`);
      }
    }
  } catch (err) {
    console.warn('Could not load minted names db:', err.message);
  }
}

function persistMintedNames() {
  try {
    fs.mkdirSync(path.dirname(NAMES_DB_PATH), { recursive: true });
    const records = Array.from(mintedNames.values());
    fs.writeFileSync(NAMES_DB_PATH, JSON.stringify(records, null, 2), 'utf8');
  } catch (err) {
    console.warn('Could not persist minted names:', err.message);
  }
}

loadMintedNames();
const rateLimitBuckets = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeSalNameBase(input) {
  return String(input || '').trim().toLowerCase();
}

function getSalNamePolicy() {
  const rateMeta = getSalUsdRateMeta();
  return {
    suffix: SAL_NAME_SUFFIX,
    base_min_length: SAL_NAME_BASE_MIN_LENGTH,
    base_max_length: SAL_NAME_BASE_MAX_LENGTH,
    allowed_characters: 'lowercase letters a-z, digits 0-9, hyphen',
    must_start_with: 'letter or digit',
    must_end_with: 'letter or digit',
    regex: '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.sal$',
    fee_currency: FEE_CURRENCY,
    fee_tiers: SAL_NAME_FEE_TIERS,
    fee_usd_tiers: FEE_USD_TIERS,
    fee_usd_range: { min_usd: 20, max_usd: 50 },
    specialty_names: false,
    mint_burn_percent: MINT_BURN_PERCENT,
    mint_burn_kind: MINT_BURN_KIND,
    sal_usd_rate: rateMeta.sal_usd_rate,
    sal_usd_rate_source: rateMeta.sal_usd_rate_source,
    sal_usd_rate_fresh: rateMeta.sal_usd_rate_fresh,
    fee_usd_buffer_percent: FEE_USD_BUFFER_PERCENT,
    ticker_rule: {
      length: 4,
      allowed_characters: 'uppercase letters A-Z and digits 0-9'
    }
  };
}

function normalizeName(input) {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized.endsWith(SAL_NAME_SUFFIX)) {
    return null;
  }

  const baseName = normalized.slice(0, -SAL_NAME_SUFFIX.length);
  if (!baseName) {
    return null;
  }

  if (baseName.length < SAL_NAME_BASE_MIN_LENGTH || baseName.length > SAL_NAME_BASE_MAX_LENGTH) {
    return null;
  }

  if (!SAL_NAME_BASE_PATTERN.test(baseName)) {
    return null;
  }

  return normalized;
}

function isLikelyAddress(input) {
  const value = String(input || '').trim();
  return /^[A-Za-z0-9]{40,220}$/.test(value);
}

function toFiniteNumberOrNull(input) {
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

// Salvium uses 8 display decimals (CRYPTONOTE_DISPLAY_DECIMAL_POINT = 8).
// Do not use Monero's 1e12 here — mainnet/testnet fee/balance math depends on this.
const SAL_ATOMIC_UNITS = 1e8;

function normalizeAmountToSal(input) {
  const numeric = toFiniteNumberOrNull(input);
  if (numeric == null) return null;

  // Wallet RPC often reports atomic units; convert when value is clearly atomic.
  // Threshold: values larger than a "huge" whole-SAL amount are treated as atomic.
  if (numeric > 1e6) {
    return numeric / SAL_ATOMIC_UNITS;
  }

  return numeric;
}

function collectTransferAddresses(transfer) {
  const addresses = new Set();

  if (!transfer || typeof transfer !== 'object') {
    return [];
  }

  for (const key of ['address', 'destination', 'to_address', 'recipient']) {
    const value = String(transfer[key] || '').trim();
    if (value) addresses.add(value);
  }

  const destinations = Array.isArray(transfer.destinations) ? transfer.destinations : [];
  for (const destination of destinations) {
    const value = String(destination?.address || destination?.to_address || destination?.destination || '').trim();
    if (value) addresses.add(value);
  }

  return Array.from(addresses);
}

function collectTransferAmountCandidates(transfer) {
  const amounts = [];

  for (const key of ['amount', 'amount_received', 'received', 'total_amount']) {
    if (transfer?.[key] != null) {
      amounts.push(transfer[key]);
    }
  }

  const destinations = Array.isArray(transfer?.destinations) ? transfer.destinations : [];
  for (const destination of destinations) {
    if (destination?.amount != null) {
      amounts.push(destination.amount);
    }
  }

  return amounts
    .map(normalizeAmountToSal)
    .filter((value) => value != null && value >= 0);
}

function flattenTransferResult(result) {
  const list = [];
  if (!result || typeof result !== 'object') {
    return list;
  }

  if (result.transfer && typeof result.transfer === 'object') {
    list.push(result.transfer);
  }

  if (Array.isArray(result.transfers)) {
    list.push(...result.transfers);
  }

  for (const key of ['in', 'out', 'pending', 'pool', 'failed']) {
    if (Array.isArray(result[key])) {
      list.push(...result[key]);
    }
  }

  return list;
}

async function walletRpcCall(method, params = {}, rpcUrl = WALLET_RPC_URL) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '0',
      method,
      params
    })
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    throw new Error(data?.error?.message || `${method} failed`);
  }

  return data.result || {};
}

async function walletRpcRawCall(method, params = {}, rpcUrl = WALLET_RPC_URL) {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '0',
      method,
      params
    })
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return {
    http_ok: response.ok,
    status: response.status,
    result: data?.result || null,
    error: data?.error || null,
    raw: data
  };
}

async function treasuryViewRpcRawCall(method, params = {}) {
  return walletRpcRawCall(method, params, TREASURY_VIEW_RPC_URL);
}

function isSelfRegistryUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  return u === 'self' || u === 'local' || u === 'internal' || u === 'db' || u === 'builtin';
}

function isChainStubUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  return u === 'stub' || u === 'none' || u === 'off' || u === 'disabled';
}

/** CHAIN_TICKER_CHECK_URL=wallet_rpc (or wallet / rpc) → probe tokens via chain ticker RPC. */
function isWalletRpcChainUrl(url) {
  const u = String(url || '').trim().toLowerCase();
  return u === 'wallet_rpc' || u === 'wallet' || u === 'rpc' || u === 'salvium_rpc';
}

/** RPC used for on-chain ticker probes (prefer dedicated, then treasury view, then general). */
function chainTickerRpcUrl() {
  return CHAIN_TICKER_RPC_URL || TREASURY_VIEW_RPC_URL || WALLET_RPC_URL;
}

/**
 * Live ticker probe using wallet-rpc token_info / get_tokens.
 *
 * Mainnet strategy (low upkeep):
 * 1) SalPay DB + reservations always block tickers you already issued.
 * 2) SAL* / BURN always blocked (chain-reserved).
 * 3) token_info(asset_type=TICKER): if found → taken (do not mint).
 * 4) get_tokens scan as fallback when token_info is "not found".
 * 5) If RPC methods missing: fail-closed when CHAIN_CHECK_FAIL_CLOSED=true
 *    (recommended on mainnet once wallet-rpc supports token_info).
 *
 * token_info is only as global as the Salvium node/wallet implementation.
 * When a public ticker indexer exists, set CHAIN_TICKER_CHECK_URL=https://...
 */
async function checkTickerViaWalletRpc(ticker) {
  const target = String(ticker || '').trim().toUpperCase();
  const rpcUrl = chainTickerRpcUrl();
  if (!/^[A-Z0-9]{4}$/.test(target)) {
    return {
      ok: false,
      checked: true,
      source: 'wallet_rpc',
      data: { available: false, error: 'invalid_ticker', ticker: target }
    };
  }
  if (isChainReservedTicker(target)) {
    return {
      ok: false,
      checked: true,
      source: 'wallet_rpc',
      data: { available: false, taken: true, reserved: true, ticker: target }
    };
  }

  try {
    // Prefer token_info when present: clear taken vs unknown.
    const info = await walletRpcRawCall('token_info', { asset_type: target }, rpcUrl);
    if (info?.result && (info.result.asset_type || info.result.ticker || info.result.name || info.result.supply != null)) {
      return {
        ok: false,
        checked: true,
        source: 'wallet_rpc',
        data: {
          available: false,
          taken: true,
          exists: true,
          ticker: target,
          token_info: info.result,
          rpc: rpcUrl
        }
      };
    }
    const infoErr = String(info?.error?.message || '').toLowerCase();
    const infoMissing = !infoErr
      || infoErr.includes('not found')
      || infoErr.includes('unknown')
      || infoErr.includes('does not exist')
      || infoErr.includes('no such');
    const infoUnsupported = infoErr.includes('method not found')
      || infoErr.includes('not available')
      || infoErr.includes('not yet available');

    if (infoUnsupported) {
      // Fall through to get_tokens; if that also unsupported, fail-closed policy applies.
    } else if (infoErr && !infoMissing) {
      return {
        ok: !CHAIN_CHECK_FAIL_CLOSED,
        checked: false,
        source: 'wallet_rpc',
        error: info?.error?.message || 'token_info failed',
        rpc: rpcUrl
      };
    } else if (infoMissing && info?.error) {
      // Explicit not-found from token_info → free at chain layer (still subject to local DB).
      return {
        ok: true,
        checked: true,
        source: 'wallet_rpc',
        data: {
          available: true,
          taken: false,
          exists: false,
          ticker: target,
          via: 'token_info_not_found',
          rpc: rpcUrl
        }
      };
    }

    const listed = await walletRpcRawCall('get_tokens', {}, rpcUrl);
    if (listed?.error) {
      const listErr = String(listed.error.message || '').toLowerCase();
      if (listErr.includes('method not found') || listErr.includes('not available') || listErr.includes('not yet available')) {
        // Cannot prove free on-chain. Mainnet should set CHAIN_CHECK_FAIL_CLOSED=true only when
        // token_info works; otherwise keep fail-open and rely on SalPay DB + reserved list.
        return {
          ok: !CHAIN_CHECK_FAIL_CLOSED,
          checked: false,
          source: 'wallet_rpc',
          error: 'token_info/get_tokens unavailable on chain ticker RPC',
          data: {
            available: !CHAIN_CHECK_FAIL_CLOSED,
            stub_like: true,
            ticker: target,
            rpc: rpcUrl,
            note: CHAIN_CHECK_FAIL_CLOSED
              ? 'Fail-closed: refusing mint until chain ticker RPC supports token_info/get_tokens.'
              : 'Chain ticker methods unavailable; local SalPay registry is the only uniqueness layer.'
          }
        };
      }
      return {
        ok: !CHAIN_CHECK_FAIL_CLOSED,
        checked: false,
        source: 'wallet_rpc',
        error: listed.error.message || 'get_tokens failed',
        rpc: rpcUrl
      };
    }

    const tokens = listed?.result?.tokens
      || listed?.result?.assets
      || listed?.result
      || [];
    const arr = Array.isArray(tokens) ? tokens : [];
    const hit = arr.some((t) => {
      const at = String(t?.asset_type || t?.ticker || t?.type || t || '').trim().toUpperCase();
      return at === target;
    });

    return {
      ok: !hit,
      checked: true,
      source: 'wallet_rpc',
      data: {
        available: !hit,
        taken: hit,
        exists: hit,
        ticker: target,
        scanned: arr.length,
        via: 'get_tokens',
        rpc: rpcUrl
      }
    };
  } catch (error) {
    return {
      ok: !CHAIN_CHECK_FAIL_CLOSED,
      checked: false,
      source: 'wallet_rpc',
      error: error?.message || 'wallet_rpc ticker check failed',
      rpc: chainTickerRpcUrl()
    };
  }
}

/** Built-in registry: minted DB + active reservations (authoritative for SalPay policy). */
function checkLocalNameRegistry(name, options = {}) {
  const normalized = normalizeName(name) || String(name || '').trim().toLowerCase();
  const excludeName = String(options.exclude_name || '').trim().toLowerCase();
  const excludeReservationId = String(options.exclude_reservation_id || '').trim();
  if (!normalized || !normalized.endsWith('.sal')) {
    return {
      ok: false,
      checked: true,
      source: 'local_registry',
      data: { available: false, exists: false, error: 'invalid_name', name: normalized || null }
    };
  }

  // Already-minted names are always taken (never exclude minted records).
  if (mintedNames.has(normalized)) {
    const minted = mintedNames.get(normalized);
    return {
      ok: false,
      checked: true,
      source: 'local_registry',
      data: {
        available: false,
        exists: true,
        minted: true,
        taken: true,
        name: normalized,
        ticker: minted?.ticker || null,
        source: 'minted'
      }
    };
  }

  const existingReservationId = reservationByName.get(normalized);
  if (existingReservationId) {
    // Mid-mint: allow the same reservation/name to pass uniqueness checks on execute.
    if (excludeReservationId && existingReservationId === excludeReservationId) {
      // fall through to available
    } else if (excludeName && normalized === excludeName) {
      // fall through to available
    } else {
      const existingReservation = mintReservations.get(existingReservationId);
      if (reservationActive(existingReservation)) {
        return {
          ok: false,
          checked: true,
          source: 'local_registry',
          data: {
            available: false,
            exists: true,
            reserved: true,
            taken: true,
            name: normalized,
            reservation_id: existingReservationId,
            source: 'reserved'
          }
        };
      }
    }
  }

  return {
    ok: true,
    checked: true,
    source: 'local_registry',
    data: { available: true, exists: false, minted: false, taken: false, name: normalized }
  };
}

function checkLocalTickerRegistry(ticker, options = {}) {
  const target = String(ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(target)) {
    return {
      ok: false,
      checked: true,
      source: 'local_registry',
      data: { available: false, exists: false, error: 'invalid_ticker', ticker: target || null }
    };
  }

  const taken = isTickerTaken(target, options);
  return {
    ok: !taken,
    checked: true,
    source: 'local_registry',
    data: {
      available: !taken,
      exists: taken,
      taken,
      minted: taken,
      ticker: target
    }
  };
}

async function checkAuthoritativeAvailability({ kind, value, url, failClosed, timeoutMs, queryKey, options = {} }) {
  if (!url) {
    return { ok: true, checked: false, source: null, note: 'disabled' };
  }

  if (isSelfRegistryUrl(url)) {
    if (queryKey === 'name' || kind === 'name' || String(kind || '').includes('name')) {
      return checkLocalNameRegistry(value, options);
    }
    return checkLocalTickerRegistry(value, options);
  }

  if (isChainStubUrl(url)) {
    return {
      ok: true,
      checked: true,
      source: 'chain_stub',
      data: {
        available: true,
        stub: true,
        note: 'On-chain uniqueness not wired yet; local registry is authoritative for now.'
      }
    };
  }

  if (isWalletRpcChainUrl(url) && (queryKey === 'ticker' || kind === 'ticker' || String(kind || '').includes('ticker'))) {
    return checkTickerViaWalletRpc(value);
  }

  const hasPlaceholder = url.includes(`{${queryKey}}`);
  const requestUrl = hasPlaceholder
    ? url.replace(`{${queryKey}}`, encodeURIComponent(value))
    : `${url}${url.includes('?') ? '&' : '?'}${queryKey}=${encodeURIComponent(value)}`;

  try {
    const response = await fetch(requestUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(`${kind} authoritative check failed with HTTP ${response.status}`);
    }

    const data = await response.json();
    const availableFromApi = data?.available;
    const knownTaken = Boolean(data?.exists || data?.minted || data?.taken || data?.found || data?.reserved);
    const available = availableFromApi != null ? Boolean(availableFromApi) : !knownTaken;

    return {
      ok: available,
      checked: true,
      source: data?.source || 'authoritative_api',
      data
    };
  } catch (error) {
    return {
      ok: !failClosed,
      checked: false,
      source: 'authoritative_api',
      error: error?.message || `${kind} authoritative check failed`
    };
  }
}

async function checkChainAvailability({ kind, value, url, queryKey, options = {} }) {
  if (!url) {
    return { ok: true, checked: false, source: null, note: 'chain_check_disabled' };
  }
  return checkAuthoritativeAvailability({
    kind: `chain_${kind}`,
    value,
    url,
    failClosed: CHAIN_CHECK_FAIL_CLOSED,
    timeoutMs: AUTHORITATIVE_NAME_CHECK_TIMEOUT_MS,
    queryKey,
    options
  });
}

async function checkAuthoritativeNameAvailability(name, options = {}) {
  const primary = await checkAuthoritativeAvailability({
    kind: 'name',
    value: name,
    url: AUTHORITATIVE_NAME_CHECK_URL,
    failClosed: AUTHORITATIVE_NAME_CHECK_FAIL_CLOSED,
    timeoutMs: AUTHORITATIVE_NAME_CHECK_TIMEOUT_MS,
    queryKey: 'name',
    options
  });
  if (!primary.ok) return primary;

  const chain = await checkChainAvailability({
    kind: 'name',
    value: name,
    url: CHAIN_NAME_CHECK_URL,
    queryKey: 'name',
    options
  });
  if (!chain.ok) return chain;

  return {
    ...primary,
    chain: chain.checked ? chain : undefined
  };
}

async function checkAuthoritativeTickerAvailability(ticker, options = {}) {
  // Local/self registry first (minted + reservations), then optional live-chain indexer.
  // Mainnet go-live: set CHAIN_TICKER_CHECK_URL to a real ticker indexer (not stub).
  const primary = await checkAuthoritativeAvailability({
    kind: 'ticker',
    value: ticker,
    url: AUTHORITATIVE_TICKER_CHECK_URL,
    failClosed: AUTHORITATIVE_TICKER_CHECK_FAIL_CLOSED,
    timeoutMs: AUTHORITATIVE_TICKER_CHECK_TIMEOUT_MS,
    queryKey: 'ticker',
    options
  });
  if (!primary.ok) return primary;

  const chain = await checkChainAvailability({
    kind: 'ticker',
    value: ticker,
    url: CHAIN_TICKER_CHECK_URL,
    queryKey: 'ticker',
    options
  });
  if (!chain.ok) return chain;

  return {
    ...primary,
    chain: chain.checked ? chain : undefined,
    verified_layers: [
      primary.checked ? (primary.source || 'authoritative') : null,
      chain.checked ? (chain.source || 'chain') : null
    ].filter(Boolean)
  };
}

function publicApiBase(req) {
  if (PUBLIC_API_BASE_URL) return PUBLIC_API_BASE_URL;
  try {
    const host = req?.get?.('host');
    if (host) {
      const proto = String(req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
      return `${proto}://${host}`.replace(/\/$/, '');
    }
  } catch (_) { /* ignore */ }
  return `http://127.0.0.1:${PORT}`;
}

function absolutizeImageUrl(req, imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${publicApiBase(req)}${url}`;
  return `${publicApiBase(req)}/${url}`;
}

function validateImageMeta(imageUrl, imageHash) {
  const url = String(imageUrl || '').trim();
  const hash = String(imageHash || '').trim().toLowerCase();

  if (!url && !hash) {
    return { ok: true, image_url: null, image_hash: null };
  }

  if (url) {
    const isHosted = url.startsWith('/api/name-images/');
    const isHttps = /^https:\/\//i.test(url);
    const isLocalHttp = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url);
    if (!isHosted && !isHttps && !isLocalHttp) {
      return {
        ok: false,
        error: 'image_url must be https://, local http://127.0.0.1, or /api/name-images/…'
      };
    }
    if (url.length > 2048) {
      return { ok: false, error: 'image_url is too long (max 2048 chars)' };
    }
  }

  if (hash && !/^[a-f0-9]{64}$/.test(hash)) {
    return { ok: false, error: 'image_hash must be a 64-character sha256 hex string' };
  }

  return {
    ok: true,
    image_url: url || null,
    image_hash: hash || null
  };
}

function ensureNameImagesDir() {
  fs.mkdirSync(NAME_IMAGES_DIR, { recursive: true });
}

function safeImageFilename(name) {
  const base = path.basename(String(name || ''));
  if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/i.test(base)) return null;
  return base.toLowerCase();
}

async function probeWalletCapabilities() {
  const versionProbe = await walletRpcRawCall('get_version', {});
  const createTokenProbe = await walletRpcRawCall('create_token', {});
  const createTokenError = String(createTokenProbe?.error?.message || '').toLowerCase();
  const createTokenUnavailable =
    createTokenError.includes('not available') ||
    createTokenError.includes('not yet available') ||
    createTokenError.includes('method not found');

  const createTokenSupported = Boolean(createTokenProbe?.result) || (!createTokenUnavailable && !!createTokenProbe?.error);

  return {
    checked_at: nowIso(),
    wallet_rpc_url: WALLET_RPC_URL,
    get_version_ok: versionProbe.http_ok && !versionProbe.error,
    wallet_version: versionProbe?.result?.version || null,
    wallet_release: versionProbe?.result?.release ?? null,
    create_token_supported: createTokenSupported,
    create_token_probe_error: createTokenProbe?.error?.message || null,
    create_token_probe_code: createTokenProbe?.error?.code || null,
    token_mint_path_ready: createTokenSupported,
    note: createTokenSupported
      ? 'create_token appears callable on this runtime (probe may still fail on params/policy).'
      : 'create_token appears unavailable on this runtime.'
  };
}

/**
 * Look up a transfer for chain_proof. Prefer treasury view-only wallet-rpc
 * (TREASURY_VIEW_RPC_URL) so mint fees paid to the treasury are visible.
 *
 * Salvium multi-asset wallets may need asset_type=SAL1. We also refresh first
 * so recently confirmed deposits are not missed (tx_not_found after user paid).
 */
/**
 * Carrot SC addresses can display as multiple encodings for the same account.
 * Prefer exact string match; otherwise ask the view wallet if both resolve to
 * the same address index (major/minor).
 */
async function addressesBelongToTreasury(observedAddresses, expectedAddress, rpcUrl = TREASURY_VIEW_RPC_URL) {
  const expected = String(expectedAddress || '').trim();
  const observed = (observedAddresses || []).map((a) => String(a || '').trim()).filter(Boolean);
  if (!expected || observed.length === 0) {
    return { match: false, matched_address: null, via: null };
  }
  if (observed.includes(expected)) {
    return { match: true, matched_address: expected, via: 'exact' };
  }

  let expectedIndex = null;
  try {
    const idx = await walletRpcRawCall('get_address_index', { address: expected }, rpcUrl);
    if (idx?.result?.index) expectedIndex = idx.result.index;
  } catch {
    expectedIndex = null;
  }
  if (!expectedIndex) {
    return { match: false, matched_address: null, via: null };
  }

  for (const addr of observed) {
    try {
      const idx = await walletRpcRawCall('get_address_index', { address: addr }, rpcUrl);
      const index = idx?.result?.index;
      if (
        index
        && Number(index.major) === Number(expectedIndex.major)
        && Number(index.minor) === Number(expectedIndex.minor)
      ) {
        return { match: true, matched_address: addr, via: 'address_index', index };
      }
    } catch {
      /* try next */
    }
  }
  return { match: false, matched_address: null, via: null, expected_index: expectedIndex };
}

async function findTransferByTxHash(txHash, rpcUrl = TREASURY_VIEW_RPC_URL) {
  const target = String(txHash || '').trim().toLowerCase();
  if (!target) return null;
  const candidates = [];

  // Pull latest blocks into the view wallet before scanning (bounded so mint API stays responsive).
  try {
    await walletRpcCall('refresh', {}, rpcUrl);
  } catch {
    /* optional — wallet may be mid-scan */
  }

  const byIdVariants = [
    { txid: txHash },
    { txid: txHash, account_index: 0 },
    { txid: txHash, asset_type: 'SAL1' },
    { txid: txHash, account_index: 0, asset_type: 'SAL1' },
    { txid: target },
    { txid: target, asset_type: 'SAL1' }
  ];
  for (const params of byIdVariants) {
    try {
      const byId = await walletRpcCall('get_transfer_by_txid', params, rpcUrl);
      candidates.push(...flattenTransferResult(byId));
    } catch {
      /* try next */
    }
  }

  const transferVariants = [
    { in: true, out: true, pending: true, pool: true, failed: true },
    { in: true, pending: true, pool: true, asset_type: 'SAL1' },
    { in: true, pending: true, pool: true, account_index: 0, asset_type: 'SAL1' },
    { in: true, pending: true, pool: true, failed: true, account_index: 0, subaddr_indices: [0] },
    { in: true, pending: true, pool: true, all_accounts: true }
  ];
  for (const params of transferVariants) {
    try {
      const allTransfers = await walletRpcCall('get_transfers', params, rpcUrl);
      candidates.push(...flattenTransferResult(allTransfers));
    } catch {
      /* try next */
    }
  }

  // Incoming-transfer scan (some Salvium builds surface deposits here first).
  for (const params of [
    { transfer_type: 'all' },
    { transfer_type: 'available' },
    { transfer_type: 'all', account_index: 0 },
    { transfer_type: 'all', asset_type: 'SAL1' }
  ]) {
    try {
      const inc = await walletRpcCall('incoming_transfers', params, rpcUrl);
      const transfers = Array.isArray(inc?.transfers) ? inc.transfers : [];
      for (const t of transfers) {
        candidates.push(t);
      }
    } catch {
      /* try next */
    }
  }

  return candidates.find((entry) => {
    const entryTxHash = String(entry?.tx_hash || entry?.txid || entry?.txid_hex || '')
      .trim()
      .toLowerCase();
    return entryTxHash && entryTxHash === target;
  }) || null;
}

async function verifyPaymentByChainProof({ txHash, expectedAddress, requiredAmountSal }) {
  let transfer;
  try {
    transfer = await findTransferByTxHash(txHash);
  } catch (error) {
    return {
      verified: false,
      reason: 'wallet_rpc_error',
      details: { message: error?.message || 'Unable to query wallet RPC' }
    };
  }

  if (!transfer) {
    return {
      verified: false,
      reason: 'tx_not_found',
      details: {
        tx_hash: txHash,
        hint: 'Treasury view wallet has not indexed this payment yet. Wait for sync, then retry Verify. Funds are not “held” by SalPay software — they are on-chain at the treasury address once the tx confirms.'
      }
    };
  }

  const addresses = collectTransferAddresses(transfer);
  // Some multi-asset transfers omit destination strings but are still to this wallet
  // if get_transfer_by_txid returned them from the treasury view wallet.
  const destCandidates = addresses.length > 0 ? addresses : [expectedAddress];

  const destCheck = await addressesBelongToTreasury(destCandidates, expectedAddress);
  if (!destCheck.match) {
    return {
      verified: false,
      reason: 'destination_mismatch',
      details: {
        tx_hash: txHash,
        expected_address: expectedAddress,
        observed_addresses: destCandidates
      }
    };
  }

  const amountCandidates = collectTransferAmountCandidates(transfer);
  // Also accept nested multi-asset amount fields used by Salvium.
  for (const key of ['amount_sal', 'sal_amount', 'net_amount']) {
    if (transfer?.[key] != null) amountCandidates.push(normalizeAmountToSal(transfer[key]));
  }
  if (Array.isArray(transfer?.amounts)) {
    for (const a of transfer.amounts) {
      if (a?.amount != null) amountCandidates.push(normalizeAmountToSal(a.amount));
      if (typeof a === 'number') amountCandidates.push(normalizeAmountToSal(a));
    }
  }
  const finiteAmounts = amountCandidates.filter((v) => v != null && Number.isFinite(v) && v >= 0);
  const maxAmount = finiteAmounts.length > 0 ? Math.max(...finiteAmounts) : null;
  if (maxAmount == null) {
    return {
      verified: false,
      reason: 'amount_unavailable',
      details: { tx_hash: txHash, expected_amount_sal: requiredAmountSal }
    };
  }

  // Small float tolerance for atomic→SAL conversion noise.
  if (maxAmount + 1e-6 < requiredAmountSal) {
    return {
      verified: false,
      reason: 'insufficient_on_chain',
      details: {
        tx_hash: txHash,
        on_chain_amount_sal: maxAmount,
        required_amount_sal: requiredAmountSal
      }
    };
  }

  const confirmations = Math.max(0, Number(transfer?.confirmations || transfer?.num_confirmations || 0));
  if (confirmations < MINT_CHAIN_PROOF_MIN_CONFIRMATIONS) {
    return {
      verified: false,
      reason: 'confirmations_pending',
      details: {
        tx_hash: txHash,
        confirmations,
        required_confirmations: MINT_CHAIN_PROOF_MIN_CONFIRMATIONS
      }
    };
  }

  return {
    verified: true,
    reason: 'ok',
    details: {
      tx_hash: txHash,
      on_chain_amount_sal: maxAmount,
      confirmations,
      matched_address: destCheck.matched_address || expectedAddress,
      address_match_via: destCheck.via || 'exact'
    }
  };
}

function computeFeeUsd(baseLength) {
  for (const tier of FEE_USD_TIERS) {
    if (baseLength >= tier.min_length && baseLength <= tier.max_length) {
      return tier.usd;
    }
  }
  return FEE_USD_TIERS[FEE_USD_TIERS.length - 1].usd;
}

function clampSalUsdRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < SAL_USD_RATE_MIN || n > SAL_USD_RATE_MAX) {
    console.warn(`SAL/USD rate ${n} outside clamp [${SAL_USD_RATE_MIN}, ${SAL_USD_RATE_MAX}]; ignoring`);
    return null;
  }
  return n;
}

function isSalUsdRateFresh() {
  if (!(salUsdRateState.rate > 0) || !salUsdRateState.fetched_at) return false;
  return (Date.now() - salUsdRateState.fetched_at) < SAL_USD_RATE_CACHE_MS;
}

/**
 * Resolve USD-per-1-SAL1 for fee conversion.
 * Priority depends on SAL_USD_PRICE_SOURCE (auto|coingecko|manual).
 * Never throws — always returns a rate or 0.
 */
function getSalUsdRate() {
  if (salUsdRateState.rate > 0) return salUsdRateState.rate;
  if (SAL_USD_MANUAL_RATE > 0) return SAL_USD_MANUAL_RATE;
  return 0;
}

function getSalUsdRateMeta() {
  const rate = getSalUsdRate();
  return {
    sal_usd_rate: rate > 0 ? rate : null,
    sal_usd_rate_source: rate > 0 ? (salUsdRateState.source || 'unknown') : 'none',
    sal_usd_rate_fetched_at: salUsdRateState.fetched_at
      ? new Date(salUsdRateState.fetched_at).toISOString()
      : null,
    sal_usd_rate_fresh: isSalUsdRateFresh(),
    sal_usd_price_source_config: SAL_USD_PRICE_SOURCE,
    sal_usd_manual_rate: SAL_USD_MANUAL_RATE > 0 ? SAL_USD_MANUAL_RATE : null,
    coingecko_coin_id: COINGECKO_COIN_ID,
    fee_usd_buffer_percent: FEE_USD_BUFFER_PERCENT,
    last_error: salUsdRateState.error || null
  };
}

async function fetchCoingeckoSalUsdRate() {
  const url = `${COINGECKO_API_BASE}/simple/price?ids=${encodeURIComponent(COINGECKO_COIN_ID)}&vs_currencies=usd`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'salpay.org-backend/1.0'
    },
    signal: AbortSignal.timeout(SAL_USD_RATE_FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    throw new Error(`CoinGecko HTTP ${response.status}`);
  }
  const data = await response.json();
  const raw = Number(data?.[COINGECKO_COIN_ID]?.usd);
  const clamped = clampSalUsdRate(raw);
  if (clamped == null) {
    throw new Error(`CoinGecko returned unusable usd price: ${raw}`);
  }
  return { rate: clamped, raw };
}

/**
 * Refresh SAL/USD rate from CoinGecko when configured. Safe to call often (deduped + cached).
 * On failure keeps last good rate (or manual).
 */
async function ensureSalUsdRateFresh(opts = {}) {
  const force = Boolean(opts.force);
  if (FEE_CURRENCY !== 'usd') {
    return getSalUsdRateMeta();
  }
  if (SAL_USD_PRICE_SOURCE === 'manual') {
    if (SAL_USD_MANUAL_RATE > 0) {
      salUsdRateState = {
        rate: SAL_USD_MANUAL_RATE,
        source: 'manual',
        fetched_at: Date.now(),
        raw: SAL_USD_MANUAL_RATE,
        error: null
      };
    }
    return getSalUsdRateMeta();
  }
  if (!force && isSalUsdRateFresh()) {
    return getSalUsdRateMeta();
  }
  if (salUsdRateInflight) {
    try {
      await salUsdRateInflight;
    } catch (_) {
      /* kept in state */
    }
    return getSalUsdRateMeta();
  }

  salUsdRateInflight = (async () => {
    try {
      const { rate, raw } = await fetchCoingeckoSalUsdRate();
      salUsdRateState = {
        rate,
        source: 'coingecko',
        fetched_at: Date.now(),
        raw,
        error: null
      };
      console.log(`SAL/USD rate updated from CoinGecko: ${rate} (id=${COINGECKO_COIN_ID})`);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.warn(`CoinGecko SAL/USD fetch failed: ${msg}`);
      // Prefer last good live rate; else manual fallback.
      if (salUsdRateState.rate > 0 && salUsdRateState.source === 'coingecko') {
        salUsdRateState = {
          ...salUsdRateState,
          error: msg
        };
      } else if (SAL_USD_MANUAL_RATE > 0) {
        salUsdRateState = {
          rate: SAL_USD_MANUAL_RATE,
          source: 'manual_fallback',
          fetched_at: Date.now(),
          raw: SAL_USD_MANUAL_RATE,
          error: msg
        };
      } else {
        salUsdRateState = {
          ...salUsdRateState,
          error: msg
        };
      }
    } finally {
      salUsdRateInflight = null;
    }
  })();

  await salUsdRateInflight;
  return getSalUsdRateMeta();
}

// Warm the rate cache on boot + refresh periodically (mainnet USD fees).
if (FEE_CURRENCY === 'usd' && SAL_USD_PRICE_SOURCE !== 'manual') {
  ensureSalUsdRateFresh({ force: true }).catch(() => {});
  setInterval(() => {
    ensureSalUsdRateFresh({ force: true }).catch(() => {});
  }, SAL_USD_RATE_CACHE_MS).unref?.();
}

function computeFee(baseName) {
  const len = String(baseName || '').length;

  // Mainnet path: USD schedule → SAL1 using live/manual rate (locked per quote/reserve).
  if (FEE_CURRENCY === 'usd') {
    const rate = getSalUsdRate();
    if (!(rate > 0)) {
      console.warn('FEE_CURRENCY=usd but no SAL/USD rate available; falling back to fixed SAL tiers.');
    } else {
      const usd = computeFeeUsd(len);
      const buffer = 1 + (FEE_USD_BUFFER_PERCENT / 100);
      const sal = (usd / rate) * buffer;
      // Round up to 2 decimal SAL for clean wallet amounts.
      return Math.ceil(sal * 100) / 100;
    }
  }

  // Testnet / default: fixed SAL1 tiers (no specialty names).
  if (len <= 4) return 2000;
  if (len <= 6) return 500;
  return 100;
}

function feeMetaForName(baseName) {
  const len = String(baseName || '').length;
  const rate = getSalUsdRate();
  if (FEE_CURRENCY === 'usd' && rate > 0) {
    const usd = computeFeeUsd(len);
    return {
      fee_currency: 'usd',
      fee_usd: usd,
      fee_sal: computeFee(baseName),
      fee_usd_buffer_percent: FEE_USD_BUFFER_PERCENT,
      ...getSalUsdRateMeta()
    };
  }
  return {
    fee_currency: 'sal',
    fee_sal: computeFee(baseName),
    fee_usd: null,
    sal_usd_rate: null,
    sal_usd_rate_source: null
  };
}

/**
 * Salvium wallet2::create_token rejects asset types that:
 * - start with "SAL" (any length prefix of 3: SAL*)
 * - equal reserved: SAL, SAL1, SAL2, BURN
 * Keep SalPay tickers out of that set so on-chain create_token can succeed.
 */
function isChainReservedTicker(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!t) return false;
  if (t === 'BURN' || t === 'SAL' || t === 'SAL1' || t === 'SAL2') return true;
  if (t.startsWith('SAL')) return true;
  return false;
}

function isValidMintTicker(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  return /^[A-Z0-9]{4}$/.test(t) && !isChainReservedTicker(t);
}

function suggestedTickerFromName(name) {
  const baseName = String(name || '').replace(/\.sal$/i, '').trim();
  let suggested = baseName.substring(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (suggested.length < 4) {
    suggested = (suggested + '1234').substring(0, 4);
  }
  // Never auto-suggest chain-reserved SAL* / BURN tickers.
  if (isChainReservedTicker(suggested)) {
    const rest = (baseName.substring(3) || baseName || 'NAME').toUpperCase().replace(/[^A-Z0-9]/g, '');
    suggested = (`X${rest}${suggested}`).replace(/[^A-Z0-9]/g, '').substring(0, 4);
    if (suggested.length < 4) suggested = (suggested + 'X0Y1').substring(0, 4);
    if (isChainReservedTicker(suggested)) {
      suggested = `X${(baseName.substring(1, 4) || 'NAM').toUpperCase()}`.replace(/[^A-Z0-9]/g, '');
      while (suggested.length < 4) suggested += '0';
      suggested = suggested.substring(0, 4);
    }
  }
  return suggested;
}

function coerceTicker(name, ticker) {
  if (typeof ticker === 'string' && ticker.trim().length > 0) {
    const manualTicker = ticker.trim().toUpperCase();
    if (!isValidMintTicker(manualTicker)) {
      return null;
    }
    // Explicit ticker is returned as-is (caller must check isTickerTaken).
    return manualTicker;
  }
  // Auto: always a free ticker from DB (+ reserved set), never a taken natural stem.
  const free = pickPreferredAvailableTicker(name, '');
  if (free) return free;
  // Fallback natural stem only if nothing free found (should be rare).
  return suggestedTickerFromName(name);
}

function listTakenTickers() {
  const taken = new Set();

  for (const minted of mintedNames.values()) {
    const value = String(minted?.ticker || '').trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(value)) {
      taken.add(value);
    }
  }

  for (const reservation of mintReservations.values()) {
    if (!reservationActive(reservation)) continue;
    const value = String(reservation?.ticker || '').trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(value)) {
      taken.add(value);
    }
  }

  return taken;
}

/** Who currently holds a ticker in SalPay DB (minted or active reservation). */
function findTickerOwner(ticker, options = {}) {
  const target = String(ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(target)) return null;
  const excludeName = String(options.exclude_name || '').trim().toLowerCase();
  const excludeReservationId = String(options.exclude_reservation_id || '').trim();

  // Minted tickers are always taken — never exclude a completed mint.
  for (const minted of mintedNames.values()) {
    const mintedTicker = String(minted?.ticker || '').trim().toUpperCase();
    const mintedName = String(minted?.name || '').trim().toLowerCase();
    if (mintedTicker === target) {
      return { name: mintedName, ticker: mintedTicker, source: 'minted' };
    }
  }

  // Reservations: allow excluding the in-progress mint for this name/id.
  for (const reservation of mintReservations.values()) {
    if (!reservationActive(reservation)) continue;
    const reservationTicker = String(reservation?.ticker || '').trim().toUpperCase();
    const reservationName = String(reservation?.name || '').trim().toLowerCase();
    const reservationId = String(reservation?.id || '').trim();
    if (excludeReservationId && reservationId === excludeReservationId) continue;
    if (excludeName && reservationName === excludeName) continue;
    if (reservationTicker === target) {
      return {
        name: reservationName,
        ticker: reservationTicker,
        source: 'reserved',
        reservation_id: reservation.id || null
      };
    }
  }

  return null;
}

function isTickerTaken(ticker, options = {}) {
  const target = String(ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(target)) {
    return false;
  }
  // Chain-reserved tickers are never available for mint/create_token.
  if (isChainReservedTicker(target)) {
    return true;
  }

  return findTickerOwner(target, options) != null;
}

function suggestAvailableTickers(name, limit = 5) {
  const max = Math.max(1, Math.min(20, Number(limit) || 5));
  const exclude = normalizeName(name) || String(name || '').trim().toLowerCase();
  const desired = suggestedTickerFromName(name);
  // Live set from DB + reservations (recomputed every call).
  // Drop only this name's active reservation ticker so mid-mint re-suggest works;
  // already-minted tickers always stay taken.
  const taken = listTakenTickers();
  for (const reservation of mintReservations.values()) {
    if (!reservationActive(reservation)) continue;
    const reservationName = String(reservation?.name || '').trim().toLowerCase();
    if (exclude && reservationName === exclude) {
      const own = String(reservation?.ticker || '').trim().toUpperCase();
      if (/^[A-Z0-9]{4}$/.test(own)) taken.delete(own);
    }
  }
  const suggestions = [];
  const seen = new Set();

  const pushCandidate = (raw) => {
    const candidate = String(raw || '').trim().toUpperCase();
    if (!isValidMintTicker(candidate)) return;
    if (seen.has(candidate)) return;
    // Belt-and-suspenders: Set + full owner scan (handles any DB edge cases).
    if (taken.has(candidate) || isTickerTaken(candidate, { exclude_name: exclude })) return;
    if (isChainReservedTicker(candidate)) return;
    seen.add(candidate);
    suggestions.push(candidate);
  };

  // Prefer the natural 4-char stem when free (e.g. PAMP from pamps.sal).
  pushCandidate(desired);

  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const base = String(name || '').replace(/\.sal$/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  // Never default stem to "SAL" — chain forbids SAL* asset types.
  let stem3 = (desired.substring(0, 3) || base.substring(0, 3) || 'NAM').padEnd(3, 'X').substring(0, 3);
  if (stem3 === 'SAL' || isChainReservedTicker(`${stem3}0`)) stem3 = 'NAM';
  let stem2 = (desired.substring(0, 2) || base.substring(0, 2) || 'NA').padEnd(2, 'X').substring(0, 2);
  if (stem2 === 'SA') stem2 = 'NA';

  // Variant 1: stem3 + suffix (PAM0..PAMZ)
  for (let i = 0; i < alphabet.length && suggestions.length < max; i += 1) {
    pushCandidate(`${stem3}${alphabet[i]}`);
  }

  // Variant 2: stem2 + two chars
  for (let i = 0; i < alphabet.length && suggestions.length < max; i += 1) {
    for (let j = 0; j < alphabet.length && suggestions.length < max; j += 1) {
      pushCandidate(`${stem2}${alphabet[i]}${alphabet[j]}`);
    }
  }

  // Variant 3: wide scramble so we always fill free chips when possible.
  for (let n = 0; n < 36 * 36 && suggestions.length < max; n += 1) {
    const a = alphabet[n % alphabet.length];
    const b = alphabet[Math.floor(n / alphabet.length) % alphabet.length];
    pushCandidate(`${stem2}${a}${b}`);
    pushCandidate(`X${stem2.substring(0, 2)}${a}`);
    pushCandidate(`${a}${b}${stem2}`);
    pushCandidate(`Z${a}${b}${stem2.charAt(0) || '0'}`);
  }

  // Final pass: drop anything that became taken (paranoia).
  return suggestions
    .filter((t) => !isTickerTaken(t, { exclude_name: exclude }) && isValidMintTicker(t))
    .slice(0, max);
}

function pickPreferredAvailableTicker(name, requestedTicker) {
  const exclude = normalizeName(name) || String(name || '').trim().toLowerCase();
  const requested = String(requestedTicker || '').trim().toUpperCase();
  if (
    isValidMintTicker(requested)
    && !isTickerTaken(requested, { exclude_name: exclude })
  ) {
    return requested;
  }
  const suggestions = suggestAvailableTickers(name, 8);
  for (const candidate of suggestions) {
    if (!isTickerTaken(candidate, { exclude_name: exclude })) {
      return candidate;
    }
  }
  return null;
}

function tickerValidationError(ticker) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!t) return null;
  if (!/^[A-Z0-9]{4}$/.test(t)) {
    return 'Ticker must be exactly 4 letters or numbers';
  }
  if (isChainReservedTicker(t)) {
    return `Ticker ${t} is reserved by Salvium (cannot start with SAL, or be SAL/SAL1/SAL2/BURN). Pick another free ticker.`;
  }
  return null;
}

function reservationActive(record) {
  return record && Date.now() < record.expires_at_ms;
}

function getRequesterIp(req) {
  const cfConnectingIp = String(req.headers['cf-connecting-ip'] || '').split(',')[0].trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (forwardedFor) {
    return forwardedFor;
  }

  return req.socket.remoteAddress || 'unknown';
}

function createRateLimiter(endpoint, maxPerMinute) {
  const windowMs = 60 * 1000;

  return (req, res, next) => {
    const now = Date.now();
    const ip = getRequesterIp(req);
    const bucketKey = `${endpoint}:${ip}`;
    const existing = rateLimitBuckets.get(bucketKey);

    if (!existing || now >= existing.resetAt) {
      rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    existing.count += 1;
    rateLimitBuckets.set(bucketKey, existing);

    if (existing.count > maxPerMinute) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        error: `Rate limit exceeded for ${endpoint}`,
        retry_after_seconds: retryAfterSeconds
      });
    }

    return next();
  };
}

const suggestRateLimiter = createRateLimiter('/suggest', RATE_LIMIT_SUGGEST_PER_MINUTE);
const sendRateLimiter = createRateLimiter('/send', RATE_LIMIT_SEND_PER_MINUTE);
const registerRateLimiter = createRateLimiter('/register', RATE_LIMIT_REGISTER_PER_MINUTE);
const mintReserveRateLimiter = createRateLimiter('/mint/reserve', RATE_LIMIT_REGISTER_PER_MINUTE);
const mintVerifyRateLimiter = createRateLimiter('/mint/verify-payment', RATE_LIMIT_REGISTER_PER_MINUTE);
const mintExecuteRateLimiter = createRateLimiter('/mint/execute', RATE_LIMIT_REGISTER_PER_MINUTE);

function trackedEventKey(event) {
  if (event === 'send' || event === 'register') return event;
  if (event.startsWith('mint.reserve')) return 'mint.reserve';
  if (event.startsWith('mint.verify-payment')) return 'mint.verify-payment';
  if (event.startsWith('mint.execute')) return 'mint.execute';
  return null;
}

function pruneFailureWindow(key, nowMs) {
  const windowMs = OPS_ALERT_WINDOW_SECONDS * 1000;
  const list = opsFailureWindows.get(key) || [];
  const pruned = list.filter((item) => nowMs - item.atMs <= windowMs);
  opsFailureWindows.set(key, pruned);
  return pruned;
}

function recordFailureSignal(key, details = {}) {
  const nowMs = Date.now();
  const current = pruneFailureWindow(key, nowMs);
  current.push({ atMs: nowMs, details });
  opsFailureWindows.set(key, current);

  if (current.length < OPS_ALERT_FAILURE_THRESHOLD) {
    return;
  }

  const cooldownMs = OPS_ALERT_COOLDOWN_SECONDS * 1000;
  const lastAlertAt = opsAlertLastAt.get(key) || 0;
  if (nowMs - lastAlertAt < cooldownMs) {
    return;
  }

  opsAlertLastAt.set(key, nowMs);
  console.warn(`[ops-alert] high failure rate for ${key}: ${current.length} failures within ${OPS_ALERT_WINDOW_SECONDS}s`);
}

function addAudit(event, req, decision, details = {}) {
  const item = {
    id: crypto.randomUUID(),
    at: nowIso(),
    endpoint: req.path,
    method: req.method,
    requester: {
      ip: getRequesterIp(req),
      user_agent: req.headers['user-agent'] || null,
      origin: req.headers.origin || null
    },
    payload: req.body || {},
    decision,
    event,
    details
  };

  auditTrail.push(item);
  if (auditTrail.length > 1000) {
    auditTrail.shift();
  }

  const eventKey = trackedEventKey(event);
  if (eventKey && (decision === 'rejected' || decision === 'blocked')) {
    recordFailureSignal(eventKey, {
      endpoint: req.path,
      reason: details?.reason || null,
      at: item.at
    });
  }
}

function trimExpiredReservations() {
  const now = Date.now();
  for (const [reservationId, record] of mintReservations.entries()) {
    if (record.expires_at_ms <= now) {
      mintReservations.delete(reservationId);
      if (reservationByName.get(record.name) === reservationId) {
        reservationByName.delete(record.name);
      }
    }
  }
}

async function verifyTurnstile(req, options = {}) {
  if (!TURNSTILE_EFFECTIVE) {
    return {
      success: true,
      skipped: true,
      reason: TURNSTILE_ENFORCE ? 'misconfigured_secret' : 'disabled'
    };
  }

  if (options.allowMintBypass && TURNSTILE_SKIP_MINT_WHEN_CHAIN_PROOF && MINT_PAYMENT_VERIFICATION_MODE === 'chain_proof') {
    return {
      success: true,
      skipped: true,
      reason: 'mint_chain_proof_policy'
    };
  }

  // Optional native client bypass using a shared key for desktop wallet flows.
  if (TURNSTILE_ALLOW_TRUSTED_CLIENT && TURNSTILE_TRUSTED_CLIENT_KEY) {
    const headerKey = String(req.headers['x-salpay-client-key'] || '').trim();
    const bodyKey = String(req.body?.client_key || '').trim();
    const suppliedKey = headerKey || bodyKey;
    if (suppliedKey && suppliedKey === TURNSTILE_TRUSTED_CLIENT_KEY) {
      return {
        success: true,
        skipped: true,
        reason: 'trusted_client'
      };
    }
  }

  const token = String(req.body?.turnstile_token || '').trim();
  if (!token) {
    return { success: false, error: 'Turnstile token is required' };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', TURNSTILE_SECRET);
    formData.append('response', token);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    });

    const data = await response.json();
    if (!data.success) {
      return { success: false, error: 'Turnstile validation failed', data };
    }
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error?.message || 'Turnstile validation error' };
  }
}

// Allow frontend browser requests + baseline security headers.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  // Browsers never send x-ops-key; keep CORS header allowlist tight.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // Ops key must never be required from browsers; do not reflect arbitrary origins.
  if (CORS_ALLOW_ORIGIN !== '*') {
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  // Block ops routes from accidental CORS exposure (defense-in-depth).
  if (String(req.path || '').includes('/ops/')) {
    res.removeHeader('Access-Control-Allow-Origin');
  }

  return next();
});

// Fallback data used for local resolver and autocomplete demos.
const FALLBACK_ADDRESS = 'SC1Tou2VtQX3Pb3nYrEVLwFAniy8QeEjGfBRJTzxL4A8CoxPVeUDLxTLMKZvQmtcnYHcuWqH85CgM9gt8Ti4qoyh7tDPcN9YpUv';

const fallbackSeed = [
  ['alice.sal', 'ALIC', 'Test name for salpay.org'],
  ['alex.sal', 'ALEX'],
  ['albert.sal', 'ALBE'],
  ['alicia.sal', 'ALIA'],
  ['alina.sal', 'ALIN'],
  ['alina-pay.sal', 'ALIP'],
  ['aliyah.sal', 'ALIY'],
  ['allison.sal', 'ALLI'],
  ['alyssa.sal', 'ALYS'],
  ['alvaro.sal', 'ALVA'],
  ['amelia.sal', 'AMEL'],
  ['anna.sal', 'ANNA'],
  ['ava.sal', 'AVA1'],
  ['bob.sal', 'BOBB', 'Second test name'],
  ['bobcat.sal', 'BOBC'],
  ['bobby.sal', 'BOBY'],
  ['brandon.sal', 'BRAN'],
  ['brianna.sal', 'BRIA'],
  ['brooke.sal', 'BROO'],
  ['bryce.sal', 'BRYC'],
  ['caleb.sal', 'CALE'],
  ['carla.sal', 'CARL'],
  ['charlie.sal', 'CHAR'],
  ['chloe.sal', 'CHLO'],
  ['claire.sal', 'CLAI'],
  ['daniel.sal', 'DANI'],
  ['daphne.sal', 'DAPH'],
  ['dylan.sal', 'DYLA'],
  ['emma.sal', 'EMMA'],
  ['ethan.sal', 'ETHA'],
  ['eva.sal', 'EVA1'],
  ['merchant.sal', 'MERC'],
  ['payday.sal', 'PAYD'],
  ['payment.sal', 'PAYT'],
  ['payme.sal', 'PAYM'],
  ['paynow.sal', 'PAYN'],
  ['salmon.sal', 'SALM'],
  ['salpay.sal', 'SALP'],
  ['sally.sal', 'SALL'],
  ['salty.sal', 'SALT'],
  ['salvia.sal', 'SALV'],
  ['shop.sal', 'SHOP'],
  ['shopper.sal', 'SHOP'],
  ['shopping.sal', 'SHOP'],
  ['wallet.sal', 'WALL'],
  ['walletpay.sal', 'WALP'],
  ['walletx.sal', 'WALX']
];

const fallbackNames = Object.fromEntries(
  fallbackSeed.map(([name, ticker, description]) => [
    name,
    {
      ticker,
      resolved_address: FALLBACK_ADDRESS,
      records: { description: description || 'Autocomplete test name' }
    }
  ])
);

fallbackNames['alice.sal'].sub_names = {
  shop: { index: 42, label: 'Shop payments' },
  pay: { index: 5, label: 'General payments' }
};

const suggestionNames = Object.entries(fallbackNames).map(([name, details]) => ({
  name,
  ticker: details.ticker,
  resolved_address: details.resolved_address
}));

async function fetchWalletBalance(rpcUrl = WALLET_RPC_URL, timeoutMs = 12000) {
  // Empty Salvium view wallets can error with "Source asset 'SAL1' not found"
  // until the first deposit is indexed. Try several shapes, then get_accounts.
  const attempts = [
    { account_index: 0 },
    { account_index: 0, asset_type: 'SAL1' },
    { account_index: 0, all_accounts: true }
  ];

  let lastError = null;
  for (const params of attempts) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '0',
          method: 'get_balance',
          params
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      const data = await response.json();
      if (data?.error) {
        lastError = new Error(data.error.message || 'get_balance failed');
        continue;
      }
      const balances = Array.isArray(data?.result?.balances) ? data.result.balances : [];
      const sal1 = balances.find((b) => String(b?.asset_type || '').toUpperCase() === 'SAL1') || balances[0] || null;
      const balance = sal1 || {
        asset_type: data?.result?.asset_type || 'SAL1',
        balance: data?.result?.balance,
        unlocked_balance: data?.result?.unlocked_balance,
        blocks_to_unlock: data?.result?.blocks_to_unlock
      };

      return {
        asset_type: balance?.asset_type || 'SAL1',
        balance: balance?.balance || 0,
        unlocked_balance: balance?.unlocked_balance || 0,
        blocks_to_unlock: balance?.blocks_to_unlock || 0,
        raw: data
      };
    } catch (error) {
      lastError = error;
    }
  }

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '0',
        method: 'get_accounts',
        params: {}
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await response.json();
    if (!data?.error && data?.result) {
      return {
        asset_type: 'SAL1',
        balance: data.result.total_balance || 0,
        unlocked_balance: data.result.total_unlocked_balance || 0,
        blocks_to_unlock: 0,
        raw: data,
        source: 'get_accounts_fallback'
      };
    }
  } catch (error) {
    lastError = error;
  }

  throw lastError || new Error('get_balance failed');
}

/** Address shown for public mint treasury (mainnet by default on production). */
function publicTreasuryAddress() {
  return (
    process.env.TREASURY_PUBLIC_ADDRESS
    || process.env.MINT_TREASURY_ADDRESS_MAINNET
    || MINT_TREASURY_ADDRESS
    || ''
  ).trim();
}

/**
 * Public treasury stats for website + GUI.
 * Requires view-only wallet-rpc (TREASURY_VIEW_RPC_URL) — never put spend keys on the server.
 */
async function getPublicTreasuryStats() {
  const address = publicTreasuryAddress();
  if (!TREASURY_PUBLIC_STATS) {
    return {
      success: true,
      enabled: false,
      available: false,
      address,
      message: 'Public treasury stats are disabled (TREASURY_PUBLIC_STATS=false).'
    };
  }

  const now = Date.now();
  if (treasuryStatsCache.payload && (now - treasuryStatsCache.at) < TREASURY_STATS_CACHE_MS) {
    return treasuryStatsCache.payload;
  }

  const payload = {
    success: true,
    enabled: true,
    address,
    asset_type: 'SAL1',
    balance_sal: null,
    unlocked_balance_sal: null,
    blocks_to_unlock: null,
    available: false,
    updated_at: nowIso(),
    source: null,
    note: null,
    wallet_height: null
  };

  try {
    // Short timeout so a busy initial refresh does not hang the website.
    const bal = await fetchWalletBalance(TREASURY_VIEW_RPC_URL, 8000);
    payload.asset_type = bal.asset_type || 'SAL1';
    payload.balance_sal = Number((Number(bal.balance) / SAL_ATOMIC_UNITS).toFixed(6));
    payload.unlocked_balance_sal = Number((Number(bal.unlocked_balance) / SAL_ATOMIC_UNITS).toFixed(6));
    payload.blocks_to_unlock = bal.blocks_to_unlock || 0;
    payload.available = true;
    payload.source = 'wallet_rpc';

    // Confirm the view wallet actually watches this treasury (Carrot display may differ).
    let recognized = false;
    if (address) {
      try {
        const idx = await treasuryViewRpcRawCall('get_address_index', { address });
        recognized = Boolean(idx?.result && !idx?.error);
      } catch (_) {
        recognized = false;
      }
    }
    try {
      const height = await treasuryViewRpcRawCall('get_height', {});
      payload.wallet_height = height?.result?.height ?? null;
    } catch (_) { /* optional while scanning */ }

    payload.expected_address_recognized = recognized;
    payload.note = recognized
      ? 'Public view of mint registration fees (view-only wallet). Spend keys are not on the server.'
      : 'View RPC is up but did not recognize the configured treasury address — check view-wallet setup.';
  } catch (error) {
    const msg = error?.message || 'Treasury balance unavailable';
    const busy = /abort|timeout|timed out/i.test(msg);
    payload.available = false;
    payload.source = busy ? 'syncing' : 'unavailable';
    payload.error = msg;
    payload.note = busy
      ? 'Treasury view wallet is connected but busy syncing the chain. Balance will appear when refresh catches up.'
      : 'Could not query treasury view wallet. Set TREASURY_VIEW_RPC_URL to a view-only wallet-rpc ' +
        'of the mint treasury and keep it connected to a mainnet daemon.';
  }

  treasuryStatsCache = { at: now, payload };
  return payload;
}

async function fetchWalletPrimaryAddress() {
  const response = await fetch(WALLET_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '0',
      method: 'get_address',
      params: { account_index: 0 }
    })
  });

  const data = await response.json();
  const primary = data?.result?.address || data?.result?.addresses?.[0]?.address || null;

  if (!primary || typeof primary !== 'string') {
    throw new Error('Wallet primary address unavailable');
  }

  return primary;
}

// Built-in authoritative registry (DB + reservations). Point AUTHORITATIVE_*_URL at "self"
// or http(s)://…/api/registry/check?name={name} / ?ticker={ticker}.
app.get(['/api/registry/check', '/registry/check'], (req, res) => {
  const nameQ = req.query.name != null ? String(req.query.name) : '';
  const tickerQ = req.query.ticker != null ? String(req.query.ticker) : '';

  if (nameQ) {
    const result = checkLocalNameRegistry(nameQ);
    return res.json({
      success: true,
      available: result.ok,
      exists: Boolean(result.data?.exists),
      minted: Boolean(result.data?.minted),
      reserved: Boolean(result.data?.reserved),
      taken: Boolean(result.data?.taken || result.data?.exists),
      found: Boolean(result.data?.exists),
      name: result.data?.name || null,
      ticker: result.data?.ticker || null,
      source: result.source,
      ...(result.data || {})
    });
  }

  if (tickerQ) {
    const result = checkLocalTickerRegistry(tickerQ);
    return res.json({
      success: true,
      available: result.ok,
      exists: Boolean(result.data?.exists),
      minted: Boolean(result.data?.minted),
      taken: Boolean(result.data?.taken),
      found: Boolean(result.data?.exists),
      ticker: result.data?.ticker || String(tickerQ).trim().toUpperCase(),
      source: result.source,
      ...(result.data || {})
    });
  }

  return res.status(400).json({
    success: false,
    error: 'Provide name= or ticker= query parameter'
  });
});

app.get(['/api/registry/name', '/registry/name'], (req, res) => {
  const name = String(req.query.name || req.params?.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  const result = checkLocalNameRegistry(name);
  return res.json({
    success: true,
    available: result.ok,
    exists: Boolean(result.data?.exists),
    minted: Boolean(result.data?.minted),
    reserved: Boolean(result.data?.reserved),
    taken: Boolean(result.data?.taken || result.data?.exists),
    found: Boolean(result.data?.exists),
    name: result.data?.name || null,
    source: result.source,
    ...(result.data || {})
  });
});

app.get(['/api/registry/ticker', '/registry/ticker'], (req, res) => {
  const ticker = String(req.query.ticker || '').trim();
  if (!ticker) {
    return res.status(400).json({ success: false, error: 'ticker is required' });
  }
  const result = checkLocalTickerRegistry(ticker);
  return res.json({
    success: true,
    available: result.ok,
    exists: Boolean(result.data?.exists),
    taken: Boolean(result.data?.taken),
    found: Boolean(result.data?.exists),
    ticker: result.data?.ticker || ticker.toUpperCase(),
    source: result.source,
    ...(result.data || {})
  });
});

// Optional name avatar images (NFT-style). Served from local NAME_IMAGES_DIR.
app.get(['/api/name-images/:file', '/name-images/:file'], (req, res) => {
  const safe = safeImageFilename(req.params.file);
  if (!safe) {
    return res.status(400).json({ success: false, error: 'Invalid image filename' });
  }
  const full = path.join(NAME_IMAGES_DIR, safe);
  if (!fs.existsSync(full)) {
    return res.status(404).json({ success: false, error: 'Image not found' });
  }
  const ext = path.extname(safe).toLowerCase();
  const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Content-Type', type);
  return res.sendFile(full);
});

app.post(['/api/mint/upload-image', '/mint/upload-image'], async (req, res) => {
  try {
    let contentType = String(req.body?.content_type || req.body?.mime_type || '').trim().toLowerCase();
    let b64 = String(req.body?.image_base64 || req.body?.data || '').trim();

    if (b64.startsWith('data:')) {
      const match = /^data:([^;]+);base64,(.+)$/i.exec(b64);
      if (!match) {
        return res.status(400).json({ success: false, error: 'Invalid data URL for image' });
      }
      contentType = contentType || match[1].toLowerCase();
      b64 = match[2];
    }

    if (!b64) {
      return res.status(400).json({ success: false, error: 'image_base64 is required' });
    }

    let buffer;
    try {
      buffer = Buffer.from(b64.replace(/\s/g, ''), 'base64');
    } catch (_) {
      return res.status(400).json({ success: false, error: 'image_base64 is not valid base64' });
    }

    if (!buffer.length) {
      return res.status(400).json({ success: false, error: 'Empty image' });
    }
    if (buffer.length > MAX_NAME_IMAGE_BYTES) {
      return res.status(400).json({
        success: false,
        error: `Image too large (max ${Math.floor(MAX_NAME_IMAGE_BYTES / 1024)} KB)`
      });
    }

    // Prefer magic-byte sniff over claimed MIME/extension (Windows downloads often wrong/missing).
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    const isWebp = buffer.length > 12
      && buffer.toString('ascii', 0, 4) === 'RIFF'
      && buffer.toString('ascii', 8, 12) === 'WEBP';

    if (isPng) contentType = 'image/png';
    else if (isJpeg) contentType = 'image/jpeg';
    else if (isWebp) contentType = 'image/webp';
    else if (contentType === 'image/jpg') contentType = 'image/jpeg';

    if (!contentType || !ALLOWED_NAME_IMAGE_TYPES[contentType]) {
      return res.status(400).json({
        success: false,
        error: 'Unsupported image type. Use a real PNG, JPEG, or WebP file (max 512 KB).'
      });
    }

    const ext = ALLOWED_NAME_IMAGE_TYPES[contentType];
    const imageHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const filename = `${imageHash}.${ext}`;
    ensureNameImagesDir();
    const full = path.join(NAME_IMAGES_DIR, filename);
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, buffer);
    }

    const relativeUrl = `/api/name-images/${filename}`;
    return res.json({
      success: true,
      image_url: relativeUrl,
      image_url_absolute: absolutizeImageUrl(req, relativeUrl),
      image_hash: imageHash,
      content_type: contentType,
      size_bytes: buffer.length
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error?.message || 'Image upload failed'
    });
  }
});

// List minted names owned by a primary address (wallet can refresh left-panel assets).
app.get(['/api/names/by-address', '/names/by-address'], (req, res) => {
  const address = String(req.query.address || req.query.primary_address || '').trim();
  if (!address || !isLikelyAddress(address)) {
    return res.status(400).json({ success: false, error: 'address query parameter required' });
  }
  const items = [];
  for (const record of mintedNames.values()) {
    if (String(record?.primary_address || '').trim() !== address) continue;
    items.push({
      name: record.name,
      ticker: record.ticker || null,
      primary_address: record.primary_address,
      image_url: record.image_url || null,
      image_url_absolute: absolutizeImageUrl(req, record.image_url || null),
      image_hash: record.image_hash || null,
      minted_at: record.minted_at || null
    });
  }
  items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return res.json({ success: true, address, count: items.length, names: items });
});

// Resolve endpoint (GUI WalletManager uses /api/resolve/:name; keep bare /resolve too)
app.get(['/resolve/:name', '/api/resolve/:name'], async (req, res) => {
  const name = req.params.name.toLowerCase();

  const minted = mintedNames.get(name);
  if (minted) {
    const imageUrl = minted.image_url || null;
    return res.json({
      success: true,
      name,
      source: 'minted',
      ticker: minted.ticker || null,
      resolved_address: minted.primary_address,
      image_url: imageUrl,
      image_url_absolute: absolutizeImageUrl(req, imageUrl),
      image_hash: minted.image_hash || null,
      records: minted.records || {}
    });
  }

  if (fallbackNames[name]) {
    if (RESOLVE_VERIFIED_ONLY) {
      return res.status(404).json({ success: false, error: 'Name not verified by salpay service' });
    }
    return res.json({ success: true, name, source: 'fallback', ...fallbackNames[name] });
  }

  res.status(404).json({ success: false, error: 'Name not found' });
});

app.get('/suggest', suggestRateLimiter, async (req, res) => {
  const query = String(req.query.q || '').trim().toLowerCase();

  if (query.length < 3) {
    return res.json({ success: true, suggestions: [] });
  }

  const normalizedQuery = query.endsWith('.sal') ? query.slice(0, -4) : query;

  const mintedSuggestions = Array.from(mintedNames.values())
    .filter(r => r.name && (r.name.startsWith(normalizedQuery) || r.name.startsWith(query)))
    .map(r => ({
      name: r.name,
      ticker: r.ticker || null,
      resolved_address: r.primary_address,
      image_url: r.image_url || null,
      image_hash: r.image_hash || null,
      source: 'minted'
    }));

  if (RESOLVE_VERIFIED_ONLY) {
    return res.json({ success: true, suggestions: mintedSuggestions.slice(0, 6) });
  }

  const fallbackSuggestions = suggestionNames
    .filter(({ name }) =>
      !mintedNames.has(name) &&
      (name.startsWith(normalizedQuery) || name.startsWith(query))
    )
    .sort((left, right) => left.name.length - right.name.length || left.name.localeCompare(right.name));

  const suggestions = [...mintedSuggestions, ...fallbackSuggestions].slice(0, 6);

  return res.json({ success: true, suggestions });
});

app.post('/send', sendRateLimiter, async (req, res) => {
  try {
    const turnstile = await verifyTurnstile(req);
    if (!turnstile.success) {
      addAudit('send', req, 'blocked', { reason: turnstile.error });
      return res.status(403).json({ success: false, error: turnstile.error });
    }

    const targetInput = String(req.body?.name || '').trim();
    const name = targetInput.toLowerCase();
    const amount = Number(req.body?.amount);

    if (!name) {
      addAudit('send', req, 'rejected', { reason: 'missing_name' });
      return res.status(400).json({ success: false, error: 'Name is required' });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      addAudit('send', req, 'rejected', { reason: 'invalid_amount', name: targetInput });
      return res.status(400).json({ success: false, error: 'Amount must be greater than 0' });
    }

    const looksLikeDirectAddress =
      /^[A-Za-z0-9]{30,}$/.test(targetInput) &&
      (targetInput.startsWith('SC') || targetInput.startsWith('Sa'));

    const minted = looksLikeDirectAddress ? null : mintedNames.get(name);
    const resolved = looksLikeDirectAddress
      ? { resolved_address: targetInput, ticker: null }
      : minted
      ? { resolved_address: minted.primary_address, ticker: minted.ticker || null }
      : RESOLVE_VERIFIED_ONLY
      ? null
      : fallbackNames[name];

    if (!resolved) {
      const policyError = !looksLikeDirectAddress && RESOLVE_VERIFIED_ONLY
        ? 'Name not verified by salpay service'
        : 'Name not found';
      addAudit('send', req, 'rejected', {
        reason: policyError === 'Name not verified by salpay service' ? 'not_verified' : 'name_not_found',
        name: targetInput
      });
      return res.status(404).json({ success: false, error: policyError });
    }

    if (NON_CUSTODIAL_MODE) {
      addAudit('send', req, 'approved', {
        name: targetInput,
        amount,
        resolved_address: resolved.resolved_address,
        relay_mode: 'client_wallet'
      });
      return res.json({
        success: true,
        name: targetInput,
        amount,
        token: resolved.ticker,
        resolved_address: resolved.resolved_address,
        relay_mode: 'client_wallet',
        tx_hash: null,
        message: `Resolved ${targetInput}. Send ${amount} SAL from your wallet to ${resolved.resolved_address}`
      });
    }

    const walletBalance = await fetchWalletBalance();
    if (walletBalance.unlocked_balance <= 0) {
      addAudit('send', req, 'rejected', {
        reason: 'wallet_unlocked_balance_zero',
        name: targetInput,
        amount
      });
      return res.status(409).json({
        success: false,
        error: 'Wallet has no spendable inputs yet',
        hint: `Balance is ${walletBalance.balance} ${walletBalance.asset_type}, unlocked ${walletBalance.unlocked_balance}.`,
        blocks_to_unlock: walletBalance.blocks_to_unlock,
        wallet_balance: walletBalance.balance,
        unlocked_balance: walletBalance.unlocked_balance
      });
    }

    const atomicAmount = Math.round(amount * SAL_ATOMIC_UNITS);
    const walletResponse = await fetch(WALLET_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '0',
        method: 'transfer',
        params: {
          source_asset: 'SAL1',
          dest_asset: 'SAL1',
          tx_type: 3,
          account_index: 0,
          asset_type: 'SAL1',
          destinations: [{ address: resolved.resolved_address, amount: atomicAmount, asset_type: 'SAL1' }],
          priority: 0,
          ring_size: 16,
          do_not_relay: false,
          get_tx_key: true
        }
      })
    });

    const walletData = await walletResponse.json();

    if (walletData?.error) {
      addAudit('send', req, 'rejected', {
        reason: 'wallet_transfer_error',
        name: targetInput,
        amount,
        wallet_error: walletData.error.message || 'Transfer failed'
      });
      return res.status(400).json({
        success: false,
        error: walletData.error.message || 'Transfer failed',
        resolved_address: resolved.resolved_address,
        name: targetInput,
        amount
      });
    }

    addAudit('send', req, 'approved', {
      name: targetInput,
      amount,
      resolved_address: resolved.resolved_address,
      relay_mode: 'server_wallet'
    });
    return res.json({
      success: true,
      name: targetInput,
      amount,
      token: resolved.ticker,
      resolved_address: resolved.resolved_address,
      relay_mode: 'server_wallet',
      tx_hash: walletData.result?.tx_hash || walletData.result?.tx_hash_list?.[0] || null,
      fee: walletData.result?.fee_list?.[0] || null,
      message: `Sent ${amount} SAL to ${name}`
    });
  } catch (error) {
    addAudit('send', req, 'rejected', { reason: 'unexpected_error', message: error?.message || null });
    return res.status(500).json({ success: false, error: error?.message || 'Unable to send payment' });
  }
});

app.post(['/api/mint/reserve', '/mint/reserve'], mintReserveRateLimiter, async (req, res) => {
  trimExpiredReservations();

  const turnstile = await verifyTurnstile(req, { allowMintBypass: true });
  if (!turnstile.success) {
    addAudit('mint.reserve', req, 'blocked', { reason: turnstile.error });
    return res.status(403).json({ success: false, error: turnstile.error });
  }

  const name = normalizeName(req.body?.name);
  if (!name) {
    addAudit('mint.reserve', req, 'rejected', { reason: 'invalid_name' });
    return res.status(400).json({ success: false, error: SAL_NAME_RULE_MESSAGE, name_policy: getSalNamePolicy() });
  }

  if (mintedNames.has(name)) {
    addAudit('mint.reserve', req, 'rejected', { reason: 'already_minted', name });
    return res.status(409).json({ success: false, error: 'Name is already minted' });
  }

  // IMPORTANT: check active reservation BEFORE authoritative uniqueness.
  // Local registry marks reserved names as "taken", which used to surface as
  // "already minted on authoritative source" and blocked resume/pay.
  const existingReservationId = reservationByName.get(name);
  if (existingReservationId) {
    const existingReservation = mintReservations.get(existingReservationId);
    if (reservationActive(existingReservation)) {
      addAudit('mint.reserve', req, 'rejected', {
        reason: 'already_reserved',
        reservation_id: existingReservationId,
        name
      });
      return res.status(409).json({
        success: false,
        error: 'Name is already reserved',
        resumable: true,
        reservation_id: existingReservationId,
        expires_at: existingReservation.expires_at,
        name: existingReservation.name,
        ticker: existingReservation.ticker,
        fee: existingReservation.fee,
        treasury_address: existingReservation.treasury_address,
        payment_outputs: Array.isArray(existingReservation.payment_outputs)
          ? existingReservation.payment_outputs
          : buildPaymentOutputs(existingReservation.fee),
        primary_address: existingReservation.primary_address || null,
        payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury',
        note: 'Resume this reservation: pay the locked fee once, then verify. Do not create a second reservation.'
      });
    }
  }

  const authoritativeName = await checkAuthoritativeNameAvailability(name);
  if (!authoritativeName.ok) {
    if (authoritativeName.checked) {
      // Defensive: if registry said reserved, resume (should have been caught above).
      const maybeRid = authoritativeName.data?.reservation_id || reservationByName.get(name);
      const maybeRes = maybeRid ? mintReservations.get(maybeRid) : null;
      if (maybeRes && reservationActive(maybeRes)) {
        return res.status(409).json({
          success: false,
          error: 'Name is already reserved',
          resumable: true,
          reservation_id: maybeRid,
          expires_at: maybeRes.expires_at,
          name: maybeRes.name,
          ticker: maybeRes.ticker,
          fee: maybeRes.fee,
          treasury_address: maybeRes.treasury_address,
          payment_outputs: Array.isArray(maybeRes.payment_outputs)
            ? maybeRes.payment_outputs
            : buildPaymentOutputs(maybeRes.fee),
          payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury'
        });
      }
      addAudit('mint.reserve', req, 'rejected', {
        reason: 'authoritative_name_conflict',
        name,
        source: authoritativeName.source,
        details: authoritativeName.data || null
      });
      return res.status(409).json({
        success: false,
        error: authoritativeName.data?.reserved
          ? 'Name is already reserved'
          : 'Name is already minted on authoritative source',
        source: authoritativeName.source || 'authoritative_api',
        reservation_id: maybeRid || null,
        resumable: Boolean(maybeRid)
      });
    }

    addAudit('mint.reserve', req, 'rejected', {
      reason: 'authoritative_name_check_unavailable',
      name,
      source: authoritativeName.source,
      error: authoritativeName.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative name availability check unavailable'
    });
  }

  const requestedTicker = typeof req.body?.ticker === 'string' ? req.body.ticker.trim().toUpperCase() : '';
  const hasExplicitTicker = requestedTicker.length > 0;
  const alternatives = suggestAvailableTickers(name, 3);
  let ticker = hasExplicitTicker
    ? coerceTicker(name, requestedTicker)
    : pickPreferredAvailableTicker(name, '');

  if (!ticker) {
    const detail = hasExplicitTicker
      ? (tickerValidationError(requestedTicker) || 'Invalid ticker')
      : 'No free ticker available for this name';
    addAudit('mint.reserve', req, 'rejected', { reason: 'invalid_ticker', name, ticker: requestedTicker || null });
    return res.status(400).json({
      success: false,
      error: detail,
      available_ticker_suggestions: alternatives
    });
  }

  if (isTickerTaken(ticker, { exclude_name: name })) {
    const owner = findTickerOwner(ticker, { exclude_name: name });
    const preferred = pickPreferredAvailableTicker(name, '');
    addAudit('mint.reserve', req, 'rejected', {
      reason: 'ticker_taken',
      name,
      ticker,
      owner: owner?.name || null,
      alternatives
    });
    return res.status(409).json({
      success: false,
      error: owner?.name
        ? `Ticker ${ticker} is already used by ${owner.name}`
        : `Ticker ${ticker} is already taken`,
      ticker,
      ticker_owner: owner?.name || null,
      preferred_ticker: preferred,
      available_ticker_suggestions: alternatives
    });
  }

  const authoritativeTicker = await checkAuthoritativeTickerAvailability(ticker, { exclude_name: name });
  if (!authoritativeTicker.ok) {
    if (authoritativeTicker.checked) {
      const preferred = pickPreferredAvailableTicker(name, '');
      addAudit('mint.reserve', req, 'rejected', {
        reason: 'authoritative_ticker_conflict',
        name,
        ticker,
        alternatives,
        source: authoritativeTicker.source,
        details: authoritativeTicker.data || null
      });
      return res.status(409).json({
        success: false,
        error: 'Ticker is already taken on authoritative source',
        ticker,
        preferred_ticker: preferred,
        source: authoritativeTicker.source || 'authoritative_api',
        available_ticker_suggestions: alternatives
      });
    }

    addAudit('mint.reserve', req, 'rejected', {
      reason: 'authoritative_ticker_check_unavailable',
      name,
      ticker,
      source: authoritativeTicker.source,
      error: authoritativeTicker.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative ticker availability check unavailable',
      ticker,
      available_ticker_suggestions: alternatives
    });
  }

  const primaryAddressForReservation = String(req.body?.primary_address || '').trim();
  if (!isLikelyAddress(primaryAddressForReservation)) {
    addAudit('mint.reserve', req, 'rejected', { reason: 'invalid_primary_address', name });
    return res.status(400).json({
      success: false,
      error: 'primary_address is required and must look like a valid wallet address'
    });
  }

  const imageMeta = validateImageMeta(req.body?.image_url, req.body?.image_hash);
  if (!imageMeta.ok) {
    addAudit('mint.reserve', req, 'rejected', { reason: 'invalid_image_meta', name });
    return res.status(400).json({ success: false, error: imageMeta.error });
  }

  const baseName = name.replace(/\.sal$/, '');
  await ensureSalUsdRateFresh();
  const fee = computeFee(baseName);
  const feeMeta = feeMetaForName(baseName);
  const paymentOutputs = buildPaymentOutputs(fee);
  const reservationId = crypto.randomUUID();
  const createdAtMs = Date.now();
  const expiresAtMs = createdAtMs + (MINT_RESERVATION_TTL_SECONDS * 1000);

  const operatorBurn = buildOperatorBurnPlan(fee);
  const record = {
    id: reservationId,
    name,
    ticker,
    fee,
    fee_meta: feeMeta,
    primary_address: primaryAddressForReservation,
    treasury_address: MINT_TREASURY_ADDRESS,
    payment_outputs: paymentOutputs,
    operator_burn_plan: operatorBurn,
    image_url: imageMeta.image_url,
    image_hash: imageMeta.image_hash,
    created_at: new Date(createdAtMs).toISOString(),
    expires_at: new Date(expiresAtMs).toISOString(),
    expires_at_ms: expiresAtMs,
    payment_verified: false,
    payment_tx_hash: null,
    requester_metadata: req.body?.requester || null
  };

  mintReservations.set(reservationId, record);
  reservationByName.set(name, reservationId);

  addAudit('mint.reserve', req, 'approved', {
    reservation_id: reservationId,
    name,
    ticker,
    fee,
    payment_outputs: paymentOutputs,
    operator_burn: operatorBurn,
    has_image: Boolean(imageMeta.image_url),
    expires_at: record.expires_at
  });

  return res.json({
    success: true,
    reservation_id: reservationId,
    name,
    ticker,
    fee,
    fee_meta: feeMeta,
    treasury_address: MINT_TREASURY_ADDRESS,
    payment_outputs: paymentOutputs,
    payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury',
    operator_burn: operatorBurn,
    user_instructions: MINT_USER_SPLIT_PAYMENT
      ? 'Follow payment_outputs (may include user-side burn).'
      : 'Pay the full fee in one SAL1 transfer to treasury_address from any wallet, then paste that tx hash.',
    image_url: imageMeta.image_url,
    image_url_absolute: absolutizeImageUrl(req, imageMeta.image_url),
    image_hash: imageMeta.image_hash,
    expires_at: record.expires_at,
    ttl_seconds: MINT_RESERVATION_TTL_SECONDS
  });
});

app.post(['/api/mint/release', '/mint/release'], async (req, res) => {
  trimExpiredReservations();

  const turnstile = await verifyTurnstile(req, { allowMintBypass: true });
  if (!turnstile.success) {
    addAudit('mint.release', req, 'blocked', { reason: turnstile.error });
    return res.status(403).json({ success: false, error: turnstile.error });
  }

  const reservationId = String(req.body?.reservation_id || '').trim();
  if (!reservationId) {
    addAudit('mint.release', req, 'rejected', { reason: 'missing_reservation_id' });
    return res.status(400).json({ success: false, error: 'reservation_id is required' });
  }

  const record = mintReservations.get(reservationId);
  if (!record) {
    addAudit('mint.release', req, 'approved', {
      reservation_id: reservationId,
      released: false,
      reason: 'already_missing'
    });
    return res.json({ success: true, released: false, reservation_id: reservationId });
  }

  mintReservations.delete(reservationId);
  if (reservationByName.get(record.name) === reservationId) {
    reservationByName.delete(record.name);
  }
  paymentVerifications.delete(reservationId);

  addAudit('mint.release', req, 'approved', {
    reservation_id: reservationId,
    name: record.name,
    released: true
  });

  return res.json({ success: true, released: true, reservation_id: reservationId, name: record.name });
});

app.post(['/api/mint/quote', '/mint/quote'], async (req, res) => {
  trimExpiredReservations();

  const reservationId = String(req.body?.reservation_id || '').trim();
  const providedName = req.body?.name;

  if (reservationId) {
    const record = mintReservations.get(reservationId);
    if (!reservationActive(record)) {
      addAudit('mint.quote', req, 'rejected', { reason: 'reservation_not_found_or_expired', reservation_id: reservationId });
      return res.status(404).json({ success: false, error: 'Reservation not found or expired' });
    }

    addAudit('mint.quote', req, 'approved', { reservation_id: reservationId, name: record.name, fee: record.fee });
    return res.json({
      success: true,
      reservation_id: reservationId,
      name: record.name,
      ticker: record.ticker,
      fee: record.fee,
      treasury_address: record.treasury_address,
      payment_outputs: Array.isArray(record.payment_outputs) ? record.payment_outputs : buildPaymentOutputs(record.fee),
      expires_at: record.expires_at
    });
  }

  const name = normalizeName(providedName);
  if (!name) {
    addAudit('mint.quote', req, 'rejected', { reason: 'invalid_name' });
    return res.status(400).json({ success: false, error: 'Provide a valid .sal name or reservation_id', name_policy: getSalNamePolicy() });
  }

  if (mintedNames.has(name)) {
    addAudit('mint.quote', req, 'rejected', { reason: 'already_minted', name });
    return res.status(409).json({ success: false, error: 'Name is already minted' });
  }

  // Active reservation: return locked fee/ticker so GUI can resume (not "already minted").
  const existingQuoteReservationId = reservationByName.get(name);
  if (existingQuoteReservationId) {
    const existingQuoteReservation = mintReservations.get(existingQuoteReservationId);
    if (reservationActive(existingQuoteReservation)) {
      addAudit('mint.quote', req, 'approved', {
        reason: 'resume_active_reservation',
        reservation_id: existingQuoteReservationId,
        name
      });
      return res.json({
        success: true,
        resumable: true,
        reservation_id: existingQuoteReservationId,
        name: existingQuoteReservation.name,
        ticker: existingQuoteReservation.ticker,
        fee: existingQuoteReservation.fee,
        treasury_address: existingQuoteReservation.treasury_address,
        payment_outputs: Array.isArray(existingQuoteReservation.payment_outputs)
          ? existingQuoteReservation.payment_outputs
          : buildPaymentOutputs(existingQuoteReservation.fee),
        expires_at: existingQuoteReservation.expires_at,
        payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury',
        preferred_ticker: existingQuoteReservation.ticker,
        available_ticker_suggestions: existingQuoteReservation.ticker
          ? [existingQuoteReservation.ticker]
          : [],
        note: 'Name is already reserved. Resume payment with this locked fee — do not create a second reservation.'
      });
    }
  }

  const authoritativeName = await checkAuthoritativeNameAvailability(name);
  if (!authoritativeName.ok) {
    if (authoritativeName.checked) {
      const reservedId = authoritativeName.data?.reservation_id || reservationByName.get(name);
      const reserved = reservedId ? mintReservations.get(reservedId) : null;
      if (reserved && reservationActive(reserved)) {
        addAudit('mint.quote', req, 'approved', {
          reason: 'resume_active_reservation_via_auth',
          reservation_id: reservedId,
          name
        });
        return res.json({
          success: true,
          resumable: true,
          reservation_id: reservedId,
          name: reserved.name,
          ticker: reserved.ticker,
          fee: reserved.fee,
          treasury_address: reserved.treasury_address,
          payment_outputs: Array.isArray(reserved.payment_outputs)
            ? reserved.payment_outputs
            : buildPaymentOutputs(reserved.fee),
          expires_at: reserved.expires_at,
          payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury',
          preferred_ticker: reserved.ticker,
          available_ticker_suggestions: reserved.ticker ? [reserved.ticker] : [],
          note: 'Name is already reserved. Resume payment with this locked fee.'
        });
      }
      addAudit('mint.quote', req, 'rejected', {
        reason: 'authoritative_name_conflict',
        name,
        source: authoritativeName.source,
        details: authoritativeName.data || null
      });
      return res.status(409).json({
        success: false,
        error: authoritativeName.data?.reserved
          ? 'Name is already reserved'
          : 'Name is already minted on authoritative source',
        source: authoritativeName.source || 'authoritative_api',
        reservation_id: reservedId || null,
        resumable: Boolean(reservedId)
      });
    }

    addAudit('mint.quote', req, 'rejected', {
      reason: 'authoritative_name_check_unavailable',
      name,
      source: authoritativeName.source,
      error: authoritativeName.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative name availability check unavailable'
    });
  }

  const requestedTicker = typeof req.body?.ticker === 'string' ? req.body.ticker.trim().toUpperCase() : '';
  const hasExplicitTicker = requestedTicker.length > 0;
  const natural = suggestedTickerFromName(name);
  const availableTickerSuggestions = suggestAvailableTickers(name, 3);

  // Always resolve to a free ticker unless client forced one that is free.
  let ticker = hasExplicitTicker
    ? coerceTicker(name, requestedTicker)
    : pickPreferredAvailableTicker(name, '');

  if (!ticker) {
    const detail = hasExplicitTicker
      ? (tickerValidationError(requestedTicker) || 'Invalid ticker')
      : 'No free ticker available for this name';
    addAudit('mint.quote', req, 'rejected', { reason: 'invalid_ticker', name, ticker: requestedTicker || null });
    return res.status(400).json({
      success: false,
      error: detail,
      available_ticker_suggestions: availableTickerSuggestions
    });
  }

  if (isTickerTaken(ticker, { exclude_name: name })) {
    // Explicit taken ticker: never return success with a taken stem.
    const owner = findTickerOwner(ticker, { exclude_name: name });
    const preferred = pickPreferredAvailableTicker(name, '');
    addAudit('mint.quote', req, 'rejected', {
      reason: 'ticker_taken',
      name,
      ticker,
      owner: owner?.name || null,
      alternatives: availableTickerSuggestions
    });
    return res.status(409).json({
      success: false,
      error: owner?.name
        ? `Ticker ${ticker} is already used by ${owner.name}`
        : `Ticker ${ticker} is already taken`,
      ticker,
      ticker_owner: owner?.name || null,
      preferred_ticker: preferred,
      available_ticker_suggestions: availableTickerSuggestions
    });
  }

  const authoritativeTicker = await checkAuthoritativeTickerAvailability(ticker, { exclude_name: name });
  if (!authoritativeTicker.ok) {
    if (authoritativeTicker.checked) {
      const preferred = pickPreferredAvailableTicker(name, '');
      addAudit('mint.quote', req, 'rejected', {
        reason: 'authoritative_ticker_conflict',
        name,
        ticker,
        alternatives: availableTickerSuggestions,
        source: authoritativeTicker.source,
        details: authoritativeTicker.data || null
      });
      return res.status(409).json({
        success: false,
        error: 'Ticker is already taken on authoritative source',
        ticker,
        preferred_ticker: preferred,
        source: authoritativeTicker.source || 'authoritative_api',
        available_ticker_suggestions: availableTickerSuggestions
      });
    }

    addAudit('mint.quote', req, 'rejected', {
      reason: 'authoritative_ticker_check_unavailable',
      name,
      ticker,
      source: authoritativeTicker.source,
      error: authoritativeTicker.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative ticker availability check unavailable',
      ticker,
      available_ticker_suggestions: availableTickerSuggestions
    });
  }

  const baseName = name.replace(/\.sal$/, '');
  await ensureSalUsdRateFresh();
  const fee = computeFee(baseName);
  const feeMeta = feeMetaForName(baseName);
  const paymentOutputs = buildPaymentOutputs(fee);
  const naturalTaken = isTickerTaken(natural, { exclude_name: name });
  const naturalOwner = naturalTaken ? findTickerOwner(natural, { exclude_name: name }) : null;

  const operatorBurn = buildOperatorBurnPlan(fee);
  addAudit('mint.quote', req, 'approved', {
    name,
    ticker,
    fee,
    sal_usd_rate: feeMeta.sal_usd_rate,
    sal_usd_rate_source: feeMeta.sal_usd_rate_source,
    available_ticker_suggestions: availableTickerSuggestions
  });
  return res.json({
    success: true,
    name,
    ticker, // always free
    fee,
    fee_meta: feeMeta,
    treasury_address: MINT_TREASURY_ADDRESS,
    payment_outputs: paymentOutputs,
    payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury',
    operator_burn: operatorBurn,
    desired_ticker: natural,
    desired_available: !naturalTaken,
    desired_owner: naturalOwner?.name || null,
    preferred_ticker: ticker,
    available_ticker_suggestions: availableTickerSuggestions,
    note: naturalTaken && naturalOwner?.name
      ? `${natural} is used by ${naturalOwner.name}; using free ticker ${ticker}`
      : 'Quote is informational until reservation exists. Pay full fee to treasury from any wallet.'
  });
});

// Lightweight ticker availability probe for wallet/web UIs (testnet + mainnet).
// Always free against local minted/reserved DB; when live-chain indexer is set
// (CHAIN_TICKER_CHECK_URL), every returned chip is also free on-chain.
app.get(['/api/mint/ticker-suggestions', '/mint/ticker-suggestions'], async (req, res) => {
  trimExpiredReservations();

  const name = normalizeName(req.query?.name || req.query?.q || '');
  const limit = Math.max(1, Math.min(10, Number(req.query?.limit || 3)));
  if (!name) {
    return res.status(400).json({
      success: false,
      error: 'Query param name is required (e.g. ?name=alice.sal)',
      name_policy: getSalNamePolicy()
    });
  }

  const nameAlreadyMinted = mintedNames.has(name);
  const desired = suggestedTickerFromName(name);
  // Over-generate then filter so every returned chip is free.
  let pool = suggestAvailableTickers(name, Math.max(limit * 8, 24));
  const verified = [];
  const layers = ['local_minted_db'];
  if (AUTHORITATIVE_TICKER_CHECK_URL && !isSelfRegistryUrl(AUTHORITATIVE_TICKER_CHECK_URL)) {
    layers.push('authoritative_api');
  }
  if (CHAIN_TICKER_CHECK_URL && !isChainStubUrl(CHAIN_TICKER_CHECK_URL) && !isSelfRegistryUrl(CHAIN_TICKER_CHECK_URL)) {
    layers.push('live_chain');
  }

  const isFullyFree = async (candidate) => {
    if (!isValidMintTicker(candidate)) return false;
    if (isTickerTaken(candidate, { exclude_name: name })) return false;
    // Full stack: self/local authoritative + optional HTTP authoritative + optional chain.
    const check = await checkAuthoritativeTickerAvailability(candidate, { exclude_name: name });
    return Boolean(check.ok);
  };

  for (const candidate of pool) {
    if (verified.length >= limit) break;
    if (await isFullyFree(candidate)) verified.push(candidate);
  }

  // Top up from a wider local pool if filters dropped candidates.
  if (verified.length < limit) {
    const more = suggestAvailableTickers(name, limit * 12);
    for (const candidate of more) {
      if (verified.length >= limit) break;
      if (verified.includes(candidate)) continue;
      if (await isFullyFree(candidate)) verified.push(candidate);
    }
  }

  const suggestions = verified.slice(0, limit);
  // desired_available: never claim free if name is already minted with that ticker.
  let desiredAvailable = !isTickerTaken(desired, { exclude_name: nameAlreadyMinted ? '' : name });
  if (nameAlreadyMinted) {
    const owner = findTickerOwner(desired);
    if (owner?.name === name) desiredAvailable = false;
  }
  // Also re-check desired against authoritative/chain when free locally.
  if (desiredAvailable && isValidMintTicker(desired)) {
    const desiredCheck = await checkAuthoritativeTickerAvailability(desired, {
      exclude_name: nameAlreadyMinted ? '' : name
    });
    desiredAvailable = Boolean(desiredCheck.ok);
  }
  const desiredOwner = desiredAvailable ? null : findTickerOwner(desired, {
    exclude_name: nameAlreadyMinted ? '' : name
  });
  const preferred = suggestions[0] || null;
  const chainLive = layers.includes('live_chain');
  return res.json({
    success: true,
    name,
    name_already_minted: nameAlreadyMinted,
    desired_ticker: desired,
    desired_available: desiredAvailable,
    desired_owner: desiredOwner?.name || null,
    suggested_ticker: preferred,
    available_ticker_suggestions: suggestions,
    preferred_ticker: preferred,
    count: suggestions.length,
    verified_against: layers.join('+'),
    source: chainLive ? 'local+chain' : (AUTHORITATIVE_TICKER_CHECK_URL ? 'local+authoritative' : 'local'),
    note: nameAlreadyMinted
      ? `${name} is already minted; suggestions are free alternatives only.`
      : (desiredAvailable
        ? `All chips verified free against ${layers.join(' + ')}.`
        : `${desired} is used by ${desiredOwner?.name || 'another name'}; free chips verified against ${layers.join(' + ')}.`)
  });
});

app.post(['/api/mint/verify-payment', '/mint/verify-payment'], mintVerifyRateLimiter, async (req, res) => {
  trimExpiredReservations();

  const turnstile = await verifyTurnstile(req, { allowMintBypass: true });
  if (!turnstile.success) {
    addAudit('mint.verify-payment', req, 'blocked', { reason: turnstile.error });
    return res.status(403).json({ success: false, error: turnstile.error });
  }

  const reservationId = String(req.body?.reservation_id || '').trim();
  if (!reservationId) {
    addAudit('mint.verify-payment', req, 'rejected', { reason: 'missing_reservation_id' });
    return res.status(400).json({ success: false, error: 'reservation_id is required' });
  }

  const record = mintReservations.get(reservationId);
  if (!reservationActive(record)) {
    addAudit('mint.verify-payment', req, 'rejected', { reason: 'reservation_not_found_or_expired', reservation_id: reservationId });
    return res.status(404).json({ success: false, error: 'Reservation not found or expired' });
  }

  const paidAmount = Number(req.body?.amount || 0);
  const txHash = String(req.body?.tx_hash || req.body?.treasury_tx_hash || '').trim() || null;
  const burnTxHash = String(req.body?.burn_tx_hash || '').trim() || null;
  const paidToAddress = String(req.body?.to_address || req.body?.treasury_address || '').trim();
  const requestedOutputs = Array.isArray(req.body?.outputs) ? req.body.outputs : [];
  const expectedOutputs = Array.isArray(record.payment_outputs) && record.payment_outputs.length > 0
    ? record.payment_outputs
    : buildPaymentOutputs(record.fee);
  const protocolBurnRequired = paymentRequiresProtocolBurn(expectedOutputs);
  const transferOutputsExpected = expectedOutputs.filter((o) => String(o?.kind || 'transfer') === 'transfer' && o?.address);
  const protocolBurnExpected = expectedOutputs.find((o) => String(o?.kind) === 'protocol_burn' || (String(o?.role) === 'burn' && !o?.address));
  const normalizedExpectedOutputs = normalizeOutputsByAddress(transferOutputsExpected);
  const splitEnabled = normalizedExpectedOutputs.length > 1;

  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    addAudit('mint.verify-payment', req, 'rejected', { reason: 'invalid_amount', reservation_id: reservationId });
    return res.status(400).json({ success: false, error: 'amount must be a positive number' });
  }

  if (!txHash) {
    addAudit('mint.verify-payment', req, 'rejected', { reason: 'missing_tx_hash', reservation_id: reservationId });
    return res.status(400).json({
      success: false,
      error: protocolBurnRequired
        ? 'treasury_tx_hash (or tx_hash) is required for the treasury transfer half'
        : 'tx_hash is required'
    });
  }

  // Prevent one treasury payment from being reused to mint multiple names.
  if (isPaymentTxHashAlreadyUsed(txHash, reservationId)) {
    addAudit('mint.verify-payment', req, 'rejected', {
      reason: 'payment_tx_hash_reuse',
      reservation_id: reservationId,
      tx_hash: txHash
    });
    return res.status(409).json({
      success: false,
      error: 'This payment transaction was already used for another mint'
    });
  }

  if (protocolBurnRequired && !burnTxHash) {
    addAudit('mint.verify-payment', req, 'rejected', {
      reason: 'missing_burn_tx_hash',
      reservation_id: reservationId
    });
    return res.status(400).json({
      success: false,
      error: 'burn_tx_hash is required (protocol BURN for the burn half of the mint fee)',
      expected_burn_amount: protocolBurnExpected?.amount || null,
      expected_outputs: expectedOutputs
    });
  }

  if (splitEnabled && requestedOutputs.length === 0 && !protocolBurnRequired) {
    addAudit('mint.verify-payment', req, 'rejected', {
      reason: 'missing_outputs_for_split_payment',
      reservation_id: reservationId
    });
    return res.status(400).json({
      success: false,
      error: 'outputs[] is required for split payment verification',
      expected_outputs: expectedOutputs
    });
  }

  let paidAmountEffective = paidAmount;
  let paidToAddressEffective = paidToAddress;

  if (requestedOutputs.length > 0) {
    const normalizedOutputsRaw = requestedOutputs
      .map((item) => ({
        address: String(item?.address || '').trim(),
        amount: Number(item?.amount)
      }))
      .filter((item) => item.address && Number.isFinite(item.amount) && item.amount > 0);

    const normalizedOutputs = normalizeOutputsByAddress(normalizedOutputsRaw);

    if (normalizedOutputs.length !== normalizedExpectedOutputs.length) {
      addAudit('mint.verify-payment', req, 'rejected', {
        reason: 'invalid_outputs_count',
        reservation_id: reservationId,
        expected_outputs_count: normalizedExpectedOutputs.length,
        provided_outputs_count: normalizedOutputs.length
      });
      return res.status(400).json({
        success: false,
        error: 'Provided outputs do not match expected payment outputs',
        expected_outputs: normalizedExpectedOutputs
      });
    }

    for (const expected of normalizedExpectedOutputs) {
      const matched = normalizedOutputs.find((out) => out.address === expected.address);
      if (!matched || Math.abs(Number(matched.amount) - Number(expected.amount)) > 1e-9) {
        addAudit('mint.verify-payment', req, 'rejected', {
          reason: 'output_mismatch',
          reservation_id: reservationId,
          expected_output: expected,
          provided_outputs: normalizedOutputs
        });
        return res.status(400).json({
          success: false,
          error: 'Provided outputs do not match expected treasury/burn split',
          expected_outputs: normalizedExpectedOutputs
        });
      }
    }

    paidAmountEffective = normalizedOutputs.reduce((sum, out) => sum + out.amount, 0);
    paidToAddressEffective = normalizedExpectedOutputs[0]?.address || record.treasury_address;
  } else {
    if (!paidToAddress) {
      addAudit('mint.verify-payment', req, 'rejected', { reason: 'missing_to_address', reservation_id: reservationId });
      return res.status(400).json({ success: false, error: 'to_address is required and must match treasury address' });
    }

    if (paidToAddress !== record.treasury_address) {
      addAudit('mint.verify-payment', req, 'rejected', {
        reason: 'treasury_mismatch',
        reservation_id: reservationId,
        expected_treasury_address: record.treasury_address,
        paid_to_address: paidToAddress
      });
      return res.status(400).json({ success: false, error: 'Payment destination does not match treasury address' });
    }
  }

  let verificationMode = 'client_attested';
  let chainProofDetails = null;

  if (MINT_PAYMENT_VERIFICATION_MODE === 'chain_proof') {
    verificationMode = 'chain_proof';

    if (splitEnabled) {
      addAudit('mint.verify-payment', req, 'rejected', {
        reason: 'chain_proof_address_split_not_supported',
        reservation_id: reservationId
      });
      return res.status(409).json({
        success: false,
        error: 'chain_proof mode does not support multi-address transfer splits; use protocol burn (kind=protocol_burn) or single treasury',
        verification_mode: verificationMode,
        expected_outputs: expectedOutputs
      });
    }

    // Verify treasury half (or full fee) on-chain.
    const treasuryRequired = protocolBurnExpected
      ? Number(protocolBurnExpected.amount > 0
        ? (record.fee - protocolBurnExpected.amount)
        : record.fee)
      : record.fee;
    const treasuryAmountRequired = protocolBurnRequired
      ? Number(expectedOutputs.find((o) => o.role === 'treasury')?.amount || treasuryRequired)
      : record.fee;

    const proof = await verifyPaymentByChainProof({
      txHash,
      expectedAddress: paidToAddressEffective || record.treasury_address,
      requiredAmountSal: treasuryAmountRequired
    });

    chainProofDetails = proof.details || null;
    if (!proof.verified) {
      addAudit('mint.verify-payment', req, 'rejected', {
        reason: 'chain_proof_failed',
        proof_reason: proof.reason,
        reservation_id: reservationId,
        tx_hash: txHash,
        to_address: paidToAddress,
        proof_details: proof.details || null
      });

      return res.status(409).json({
        success: false,
        error: 'On-chain payment proof failed',
        verification_mode: verificationMode,
        proof_reason: proof.reason,
        details: proof.details || null
      });
    }

    if (typeof proof.details?.on_chain_amount_sal === 'number') {
      paidAmountEffective = proof.details.on_chain_amount_sal;
    }

    // Protocol burn half: require burn_tx_hash. Best-effort: if wallet-rpc can see the burn
    // transfer (type BURN / amount_burnt), require amount >= expected burn leg. Many setups
    // cannot see the payer's burn from a treasury view-wallet — then presence of hash +
    // treasury chain_proof is accepted (audit trail); tighten when daemon burn index exists.
    if (protocolBurnRequired && burnTxHash) {
      const burnLeg = Number(protocolBurnExpected?.amount || 0);
      let burnTransfer = null;
      try {
        burnTransfer = await findTransferByTxHash(burnTxHash);
      } catch {
        burnTransfer = null;
      }
      if (burnTransfer) {
        const burnType = String(burnTransfer?.type || burnTransfer?.tx_type || '').toLowerCase();
        const burntCandidates = [
          burnTransfer?.amount_burnt,
          burnTransfer?.burnt,
          burnTransfer?.amount
        ]
          .map((v) => (v == null ? null : normalizeAmountToSal(v)))
          .filter((v) => v != null && Number.isFinite(v));
        const maxBurnt = burntCandidates.length ? Math.max(...burntCandidates) : null;
        const looksLikeBurn = burnType.includes('burn') || maxBurnt != null;
        if (looksLikeBurn && maxBurnt != null && burnLeg > 0 && maxBurnt + 1e-9 < burnLeg) {
          addAudit('mint.verify-payment', req, 'rejected', {
            reason: 'burn_amount_insufficient',
            reservation_id: reservationId,
            burn_tx_hash: burnTxHash,
            on_chain_burnt: maxBurnt,
            required_burn: burnLeg
          });
          return res.status(409).json({
            success: false,
            error: 'On-chain protocol burn amount is below required burn half',
            verification_mode: verificationMode,
            details: {
              burn_tx_hash: burnTxHash,
              on_chain_burnt_sal: maxBurnt,
              required_burn_sal: burnLeg
            }
          });
        }
        chainProofDetails = {
          ...(chainProofDetails || {}),
          burn: {
            tx_hash: burnTxHash,
            observed: true,
            type: burnType || null,
            on_chain_burnt_sal: maxBurnt
          }
        };
      } else {
        chainProofDetails = {
          ...(chainProofDetails || {}),
          burn: {
            tx_hash: burnTxHash,
            observed: false,
            note: 'Burn tx not visible to server wallet-rpc; hash recorded. Use treasury view-wallet for transfers; burns may need daemon index later.'
          }
        };
      }

      const treasuryLeg = Number(expectedOutputs.find((o) => o.role === 'treasury')?.amount || 0);
      if (paidAmountEffective + 1e-9 >= treasuryLeg) {
        paidAmountEffective = record.fee;
      }
    }
  }

  // When protocol burn is required, full fee = treasury transfer + burn amount.
  if (protocolBurnRequired && protocolBurnExpected) {
    const treasuryLeg = Number(expectedOutputs.find((o) => o.role === 'treasury')?.amount || 0);
    const burnLeg = Number(protocolBurnExpected.amount || 0);
    const sumLegs = roundSalAmount(treasuryLeg + burnLeg);
    if (Math.abs(paidAmount - sumLegs) > 1e-6 && Math.abs(paidAmount - record.fee) > 1e-6) {
      addAudit('mint.verify-payment', req, 'rejected', {
        reason: 'fee_split_amount_mismatch',
        reservation_id: reservationId,
        paid_amount: paidAmount,
        expected_fee: record.fee,
        treasury_leg: treasuryLeg,
        burn_leg: burnLeg
      });
      return res.status(400).json({
        success: false,
        error: 'amount must equal full fee (treasury half + protocol burn half)',
        expected_fee: record.fee,
        expected_outputs: expectedOutputs
      });
    }
    // client_attested: trust attested full fee once both tx hashes present.
    if (MINT_PAYMENT_VERIFICATION_MODE !== 'chain_proof') {
      paidAmountEffective = record.fee;
    }
  }

  const status = paidAmountEffective >= record.fee ? 'verified' : 'insufficient';

  const verification = {
    id: crypto.randomUUID(),
    reservation_id: reservationId,
    paid_amount: paidAmountEffective,
    required_amount: record.fee,
    tx_hash: txHash,
    burn_tx_hash: burnTxHash,
    to_address: paidToAddressEffective,
    outputs: requestedOutputs.length > 0 ? requestedOutputs : expectedOutputs,
    verification_mode: verificationMode,
    payment_policy: {
      user_payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury',
      burn_percent: MINT_BURN_PERCENT,
      burn_kind: MINT_BURN_KIND,
      protocol_burn_required: protocolBurnRequired,
      operator_burn_after_mint: !MINT_USER_SPLIT_PAYMENT && MINT_BURN_PERCENT > 0
    },
    chain_proof: chainProofDetails,
    status,
    verified_at: nowIso()
  };

  paymentVerifications.set(reservationId, verification);
  if (status === 'verified') {
    record.payment_verified = true;
    record.payment_tx_hash = txHash;
    record.burn_tx_hash = burnTxHash;
    mintReservations.set(reservationId, record);
  }

  addAudit('mint.verify-payment', req, status === 'verified' ? 'approved' : 'rejected', {
    reservation_id: reservationId,
    paid_amount: paidAmountEffective,
    required_amount: record.fee,
    tx_hash: txHash,
    burn_tx_hash: burnTxHash,
    to_address: paidToAddressEffective,
    outputs: requestedOutputs.length > 0 ? requestedOutputs : expectedOutputs,
    verification_mode: verificationMode,
    chain_proof: chainProofDetails,
    status
  });

  return res.json({
    success: status === 'verified',
    reservation_id: reservationId,
    status,
    verification_mode: verificationMode,
    paid_amount: paidAmountEffective,
    required_amount: record.fee,
    tx_hash: txHash,
    burn_tx_hash: burnTxHash,
    to_address: paidToAddressEffective,
    outputs: requestedOutputs.length > 0 ? requestedOutputs : expectedOutputs,
    chain_proof: chainProofDetails,
    verified_at: verification.verified_at
  });
});

app.post(['/api/mint/execute', '/mint/execute'], mintExecuteRateLimiter, async (req, res) => {
  trimExpiredReservations();

  const turnstile = await verifyTurnstile(req, { allowMintBypass: true });
  if (!turnstile.success) {
    addAudit('mint.execute', req, 'blocked', { reason: turnstile.error });
    return res.status(403).json({ success: false, error: turnstile.error });
  }

  const reservationId = String(req.body?.reservation_id || '').trim();
  const idempotencyKey = String(req.body?.idempotency_key || '').trim();

  if (!reservationId) {
    addAudit('mint.execute', req, 'rejected', { reason: 'missing_reservation_id' });
    return res.status(400).json({ success: false, error: 'reservation_id is required' });
  }

  const record = mintReservations.get(reservationId);
  if (!reservationActive(record)) {
    addAudit('mint.execute', req, 'rejected', { reason: 'reservation_not_found_or_expired', reservation_id: reservationId });
    return res.status(404).json({ success: false, error: 'Reservation not found or expired' });
  }

  if (mintedNames.has(record.name)) {
    addAudit('mint.execute', req, 'rejected', { reason: 'already_minted', name: record.name, reservation_id: reservationId });
    return res.status(409).json({ success: false, error: 'Name already minted' });
  }

  // Defense-in-depth: never trust client_attested on mainnet even if process was mis-started.
  if (SALPAY_NETWORK === 'mainnet' && MINT_PAYMENT_VERIFICATION_MODE !== 'chain_proof') {
    addAudit('mint.execute', req, 'rejected', { reason: 'mainnet_requires_chain_proof' });
    return res.status(503).json({
      success: false,
      error: 'Mainnet execute requires chain_proof payment verification'
    });
  }

  const executeExclude = {
    exclude_name: record.name,
    exclude_reservation_id: reservationId
  };

  if (isTickerTaken(record.ticker, executeExclude)) {
    const alternatives = suggestAvailableTickers(record.name);
    addAudit('mint.execute', req, 'rejected', {
      reason: 'ticker_taken',
      name: record.name,
      ticker: record.ticker,
      reservation_id: reservationId,
      alternatives
    });
    return res.status(409).json({
      success: false,
      error: 'Ticker is already taken',
      ticker: record.ticker,
      available_ticker_suggestions: alternatives
    });
  }

  const authoritativeTicker = await checkAuthoritativeTickerAvailability(record.ticker, executeExclude);
  if (!authoritativeTicker.ok) {
    if (authoritativeTicker.checked) {
      const alternatives = suggestAvailableTickers(record.name);
      addAudit('mint.execute', req, 'rejected', {
        reason: 'authoritative_ticker_conflict',
        name: record.name,
        ticker: record.ticker,
        reservation_id: reservationId,
        alternatives,
        source: authoritativeTicker.source,
        details: authoritativeTicker.data || null
      });
      return res.status(409).json({
        success: false,
        error: 'Ticker is already taken on authoritative source',
        ticker: record.ticker,
        source: authoritativeTicker.source || 'authoritative_api',
        available_ticker_suggestions: alternatives
      });
    }

    addAudit('mint.execute', req, 'rejected', {
      reason: 'authoritative_ticker_check_unavailable',
      name: record.name,
      ticker: record.ticker,
      reservation_id: reservationId,
      source: authoritativeTicker.source,
      error: authoritativeTicker.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative ticker availability check unavailable',
      ticker: record.ticker
    });
  }

  const authoritativeUniqueness = await checkAuthoritativeNameAvailability(record.name, executeExclude);
  if (!authoritativeUniqueness.ok) {
    if (authoritativeUniqueness.checked) {
      addAudit('mint.execute', req, 'rejected', {
        reason: 'authoritative_name_conflict',
        reservation_id: reservationId,
        name: record.name,
        source: authoritativeUniqueness.source,
        details: authoritativeUniqueness.data || null
      });
      return res.status(409).json({
        success: false,
        error: 'Name is already minted on authoritative source',
        source: authoritativeUniqueness.source || 'authoritative_api'
      });
    }

    addAudit('mint.execute', req, 'rejected', {
      reason: 'authoritative_check_unavailable',
      reservation_id: reservationId,
      name: record.name,
      source: authoritativeUniqueness.source,
      error: authoritativeUniqueness.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative uniqueness check unavailable',
      hint: 'Retry execute after uniqueness service recovers.'
    });
  }

  const verification = paymentVerifications.get(reservationId);
  if (!record.payment_verified || verification?.status !== 'verified') {
    addAudit('mint.execute', req, 'rejected', { reason: 'payment_not_verified', reservation_id: reservationId });
    return res.status(409).json({ success: false, error: 'Payment has not been verified' });
  }

  const paymentTx = String(verification?.tx_hash || record.payment_tx_hash || '').trim();
  if (!paymentTx) {
    addAudit('mint.execute', req, 'rejected', { reason: 'missing_verified_payment_tx', reservation_id: reservationId });
    return res.status(409).json({ success: false, error: 'Verified payment tx hash missing; re-verify payment' });
  }
  if (isPaymentTxHashAlreadyUsed(paymentTx, reservationId)) {
    addAudit('mint.execute', req, 'rejected', {
      reason: 'payment_tx_hash_reuse',
      reservation_id: reservationId,
      tx_hash: paymentTx
    });
    return res.status(409).json({
      success: false,
      error: 'This payment transaction was already used for another mint'
    });
  }
  if (Number(verification?.paid_amount || 0) + 1e-9 < Number(record.fee || 0)) {
    addAudit('mint.execute', req, 'rejected', {
      reason: 'verified_amount_below_fee',
      reservation_id: reservationId,
      paid_amount: verification?.paid_amount,
      fee: record.fee
    });
    return res.status(409).json({ success: false, error: 'Verified payment amount is below required fee' });
  }

  if (!isLikelyAddress(record.primary_address)) {
    addAudit('mint.execute', req, 'rejected', { reason: 'invalid_primary_address', reservation_id: reservationId });
    return res.status(409).json({
      success: false,
      error: 'Reservation primary address is missing or invalid; reserve again with a valid primary_address'
    });
  }

  if (idempotencyKey) {
    const duplicate = Array.from(mintJobs.values()).find(
      (job) => job.idempotency_key && job.idempotency_key === idempotencyKey
    );
    if (duplicate) {
      addAudit('mint.execute', req, 'approved', {
        reservation_id: reservationId,
        idempotency_key: idempotencyKey,
        reused_job_id: duplicate.id
      });
      return res.json({ success: true, job_id: duplicate.id, reused: true, status: duplicate.status, tx_hash: duplicate.tx_hash });
    }
  }

  const jobId = crypto.randomUUID();
  const txHash = `sim_${crypto.randomBytes(16).toString('hex')}`;
  const verificationEvidence = paymentVerifications.get(reservationId) || null;
  const job = {
    id: jobId,
    reservation_id: reservationId,
    name: record.name,
    ticker: record.ticker,
    status: 'completed',
    tx_hash: txHash,
    created_at: nowIso(),
    completed_at: nowIso(),
    idempotency_key: idempotencyKey || null
  };

  const burnPlan = record.operator_burn_plan || buildOperatorBurnPlan(record.fee);
  const burnAmount = Number(burnPlan.burn_amount_sal || 0);
  const operatorBurn = {
    status: burnAmount > 0 ? 'pending' : 'not_required',
    percent: burnPlan.percent,
    kind: burnPlan.kind || MINT_BURN_KIND,
    fee_sal: record.fee,
    amount_sal: burnAmount,
    treasury_keeps_sal: burnPlan.treasury_keeps_sal,
    payment_tx_hash: verificationEvidence?.tx_hash || record.payment_tx_hash || null,
    burn_tx_hash: null,
    burned_at: null,
    note: burnAmount > 0
      ? 'Awaiting operator protocol burn of amount_sal from treasury funds; public proof attaches here.'
      : 'No operator burn configured.'
  };

  mintJobs.set(jobId, job);
  mintedNames.set(record.name, {
    name: record.name,
    ticker: record.ticker,
    primary_address: record.primary_address,
    image_url: record.image_url || null,
    image_hash: record.image_hash || null,
    minted_at: job.completed_at,
    tx_hash: txHash,
    verification: {
      by: 'salpay_service',
      mode: MINT_PAYMENT_VERIFICATION_MODE,
      verified_at: verificationEvidence?.verified_at || nowIso(),
      verification_status: verificationEvidence?.status || null,
      payment_tx_hash: verificationEvidence?.tx_hash || null,
      reservation_id: reservationId
    },
    operator_burn: operatorBurn,
    records: {}
  });
  persistMintedNames();

  mintReservations.delete(reservationId);
  if (reservationByName.get(record.name) === reservationId) {
    reservationByName.delete(record.name);
  }

  addAudit('mint.execute', req, 'approved', {
    reservation_id: reservationId,
    job_id: jobId,
    name: record.name,
    tx_hash: txHash,
    operator_burn_status: operatorBurn.status,
    operator_burn_amount: operatorBurn.amount_sal
  });

  return res.json({
    success: true,
    job_id: jobId,
    status: job.status,
    tx_hash: txHash,
    name: record.name,
    ticker: record.ticker,
    image_url: record.image_url || null,
    image_url_absolute: absolutizeImageUrl(req, record.image_url || null),
    image_hash: record.image_hash || null,
    operator_burn: operatorBurn
  });
});

app.get(['/api/mint/status/:id', '/mint/status/:id'], (req, res) => {
  const job = mintJobs.get(req.params.id);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Mint job not found' });
  }

  return res.json({ success: true, ...job });
});

app.get(['/api/mint/audit', '/mint/audit'], (req, res) => {
  // Audit may include reservation ids / payment hashes — ops only.
  if (!requireOpsAuth(req, res)) return;
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const items = auditTrail.slice(-limit).reverse();
  return res.json({ success: true, count: items.length, items });
});

app.get('/wallet-status', async (req, res) => {
  if (NON_CUSTODIAL_MODE) {
    return res.json({
      success: true,
      mode: 'client_wallet',
      message: 'Server wallet relay is disabled. Users send from their own local wallets.'
    });
  }

  try {
    const walletBalance = await fetchWalletBalance();
    return res.json({
      success: true,
      asset_type: walletBalance.asset_type,
      balance: (walletBalance.balance / SAL_ATOMIC_UNITS).toFixed(6),
      unlocked_balance: (walletBalance.unlocked_balance / SAL_ATOMIC_UNITS).toFixed(6),
      blocks_to_unlock: walletBalance.blocks_to_unlock,
      atomic_units: SAL_ATOMIC_UNITS
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error?.message || 'Unable to query wallet' });
  }
});

app.get(['/turnstile-config', '/api/turnstile-config'], (req, res) => {
  const paymentOutputsPreview = buildPaymentOutputs(100);
  res.json({
    success: true,
    salpay_network: SALPAY_NETWORK,
    enforced_requested: TURNSTILE_ENFORCE,
    enforced_effective: TURNSTILE_EFFECTIVE,
    has_secret: TURNSTILE_SECRET.trim().length > 0,
    trusted_client_enabled: TURNSTILE_ALLOW_TRUSTED_CLIENT && TURNSTILE_TRUSTED_CLIENT_KEY.length > 0,
    mint_turnstile_bypass_when_chain_proof: TURNSTILE_SKIP_MINT_WHEN_CHAIN_PROOF,
    resolve_verified_only: RESOLVE_VERIFIED_ONLY,
    payment_verification_mode: MINT_PAYMENT_VERIFICATION_MODE,
    mainnet_strict_guards: MAINNET_STRICT_GUARDS,
    authoritative_name_check_enabled: AUTHORITATIVE_NAME_CHECK_URL.length > 0,
    authoritative_ticker_check_enabled: AUTHORITATIVE_TICKER_CHECK_URL.length > 0,
    authoritative_name_mode: isSelfRegistryUrl(AUTHORITATIVE_NAME_CHECK_URL)
      ? 'self'
      : (AUTHORITATIVE_NAME_CHECK_URL ? 'http' : 'off'),
    authoritative_ticker_mode: isSelfRegistryUrl(AUTHORITATIVE_TICKER_CHECK_URL)
      ? 'self'
      : (AUTHORITATIVE_TICKER_CHECK_URL ? 'http' : 'off'),
    chain_name_check_enabled: CHAIN_NAME_CHECK_URL.length > 0,
    chain_ticker_check_enabled: CHAIN_TICKER_CHECK_URL.length > 0,
    name_images_enabled: true,
    max_name_image_bytes: MAX_NAME_IMAGE_BYTES,
    chain_proof_min_confirmations: MINT_CHAIN_PROOF_MIN_CONFIRMATIONS,
    mint_treasury_address: MINT_TREASURY_ADDRESS,
    treasury_view_rpc_configured: Boolean(String(process.env.TREASURY_VIEW_RPC_URL || '').trim()),
    treasury_view_rpc_url: TREASURY_VIEW_RPC_URL,
    treasury_public_stats: TREASURY_PUBLIC_STATS,
    mint_burn_percent: MINT_BURN_PERCENT,
    mint_burn_kind: MINT_BURN_KIND,
    mint_burn_address: MINT_BURN_KIND === 'address' ? (MINT_BURN_ADDRESS || null) : null,
    mint_user_payment_mode: MINT_USER_SPLIT_PAYMENT ? 'user_split' : 'full_treasury',
    mint_operator_burn_after_mint: !MINT_USER_SPLIT_PAYMENT && MINT_BURN_PERCENT > 0,
    mint_payment_outputs_preview: paymentOutputsPreview,
    operator_burn_preview: buildOperatorBurnPlan(100),
    fee_currency: FEE_CURRENCY,
    fee_usd_tiers: FEE_USD_TIERS,
    name_policy: getSalNamePolicy()
  });
});

// --- Operator burn queue (treasury owner burns 50% after full user payment) ---

app.get(['/api/ops/burn-queue', '/ops/burn-queue'], (req, res) => {
  if (!requireOpsAuth(req, res)) return;
  const statusFilter = String(req.query?.status || 'pending').trim().toLowerCase();
  const items = Array.from(mintedNames.values())
    .filter((r) => r && r.operator_burn)
    .filter((r) => {
      const st = String(r.operator_burn.status || '').toLowerCase();
      if (statusFilter === 'all') return true;
      return st === statusFilter;
    })
    .map((r) => ({
      name: r.name,
      ticker: r.ticker,
      minted_at: r.minted_at,
      primary_address: r.primary_address,
      payment_tx_hash: r.verification?.payment_tx_hash || r.operator_burn?.payment_tx_hash || null,
      operator_burn: r.operator_burn,
      // CLI helper for the ops machine (protocol burn of amount_sal SAL1)
      suggested_cli: r.operator_burn?.amount_sal > 0
        ? `burn ${r.operator_burn.amount_sal} SAL1`
        : null
    }))
    .sort((a, b) => String(a.minted_at || '').localeCompare(String(b.minted_at || '')));

  return res.json({
    success: true,
    status_filter: statusFilter,
    count: items.length,
    treasury_address: MINT_TREASURY_ADDRESS,
    burn_percent: MINT_BURN_PERCENT,
    burn_kind: MINT_BURN_KIND,
    items
  });
});

/**
 * Operator recovery: complete a mint after the user paid but chain_proof failed
 * (e.g. treasury view-wallet not scanning SAL1 yet). Does NOT move funds —
 * only registers the name once ops confirms the payment_tx_hash out-of-band.
 *
 * POST /api/ops/force-mint-complete
 * Headers: x-ops-key: OPS_API_KEY
 * Body: {
 *   name, ticker, primary_address, payment_tx_hash,
 *   fee? (default from quote tiers), note?
 * }
 */
const opsForceMintRateLimiter = createRateLimiter('/ops/force-mint-complete', 10);

app.post(['/api/ops/force-mint-complete', '/ops/force-mint-complete'], opsForceMintRateLimiter, (req, res) => {
  if (!requireOpsAuth(req, res)) return;

  const name = normalizeName(req.body?.name || '');
  const tickerRaw = String(req.body?.ticker || '').trim().toUpperCase();
  const primary = String(req.body?.primary_address || '').trim();
  const paymentTxHash = String(req.body?.payment_tx_hash || req.body?.tx_hash || '').trim().toLowerCase();
  const baseStem = (name || '').replace(/\.sal$/i, '');
  const fee = Number(req.body?.fee != null ? req.body.fee : computeFee(baseStem));
  const note = String(req.body?.note || 'ops force-mint after paid-but-unverified').trim().slice(0, 500);

  if (!name) {
    return res.status(400).json({ success: false, error: 'valid .sal name is required' });
  }
  if (mintedNames.has(name)) {
    const existing = mintedNames.get(name);
    return res.json({
      success: true,
      already_minted: true,
      name,
      ticker: existing?.ticker || null,
      primary_address: existing?.primary_address || null,
      payment_tx_hash: existing?.verification?.payment_tx_hash || null
    });
  }
  if (!isValidMintTicker(tickerRaw) || isChainReservedTicker(tickerRaw)) {
    return res.status(400).json({ success: false, error: 'valid free ticker is required' });
  }
  if (isTickerTaken(tickerRaw, { exclude_name: name })) {
    return res.status(409).json({ success: false, error: `Ticker ${tickerRaw} is already taken` });
  }
  if (!isLikelyAddress(primary)) {
    return res.status(400).json({ success: false, error: 'primary_address is required' });
  }
  // Strict 64-hex tx hash — prevents garbage registration.
  if (!/^[a-f0-9]{64}$/.test(paymentTxHash)) {
    return res.status(400).json({ success: false, error: 'payment_tx_hash must be 64 hex characters' });
  }
  if (!Number.isFinite(fee) || fee <= 0 || fee > 1e7) {
    return res.status(400).json({ success: false, error: 'fee is invalid' });
  }
  if (isPaymentTxHashAlreadyUsed(paymentTxHash, '')) {
    return res.status(409).json({
      success: false,
      error: 'This payment_tx_hash was already used for another mint'
    });
  }

  const jobId = crypto.randomUUID();
  const now = nowIso();
  const burnPlan = buildOperatorBurnPlan(fee);
  const burnAmount = Number(burnPlan.burn_amount_sal || 0);
  const operatorBurn = {
    status: burnAmount > 0 ? 'pending' : 'not_required',
    percent: burnPlan.percent,
    kind: burnPlan.kind || MINT_BURN_KIND,
    fee_sal: fee,
    amount_sal: burnAmount,
    treasury_keeps_sal: burnPlan.treasury_keeps_sal,
    payment_tx_hash: paymentTxHash,
    burn_tx_hash: null,
    burned_at: null,
    note: burnAmount > 0
      ? 'Awaiting operator protocol burn of amount_sal from treasury funds; public proof attaches here.'
      : 'No operator burn configured.'
  };

  mintedNames.set(name, {
    name,
    ticker: tickerRaw,
    primary_address: primary,
    image_url: null,
    image_hash: null,
    minted_at: now,
    tx_hash: `ops_${crypto.randomBytes(8).toString('hex')}`,
    verification: {
      by: 'ops_force_mint',
      mode: 'ops_attested',
      verified_at: now,
      verification_status: 'verified',
      payment_tx_hash: paymentTxHash,
      note
    },
    operator_burn: operatorBurn,
    records: {}
  });
  persistMintedNames();

  // Drop any active reservation for this name.
  const rid = reservationByName.get(name);
  if (rid) {
    mintReservations.delete(rid);
    reservationByName.delete(name);
    paymentVerifications.delete(rid);
  }

  addAudit('ops.force-mint-complete', req, 'approved', {
    name,
    ticker: tickerRaw,
    payment_tx_hash: paymentTxHash,
    fee,
    job_id: jobId
  });

  return res.json({
    success: true,
    forced: true,
    name,
    ticker: tickerRaw,
    primary_address: primary,
    payment_tx_hash: paymentTxHash,
    fee,
    operator_burn: operatorBurn,
    note: 'Name registered. User funds were already at treasury; this only completes registration.'
  });
});

app.post(['/api/ops/burn-complete', '/ops/burn-complete'], (req, res) => {
  if (!requireOpsAuth(req, res)) return;

  const name = normalizeName(req.body?.name || '');
  const burnTxHash = String(req.body?.burn_tx_hash || req.body?.tx_hash || '').trim();
  const amountOverride = req.body?.amount != null ? Number(req.body.amount) : null;

  if (!name || !mintedNames.has(name)) {
    return res.status(404).json({ success: false, error: 'Minted name not found' });
  }
  if (!burnTxHash || burnTxHash.length < 16) {
    return res.status(400).json({ success: false, error: 'burn_tx_hash is required' });
  }

  const record = mintedNames.get(name);
  const prev = record.operator_burn || buildOperatorBurnPlan(record.fee || 0);
  const expectedAmount = Number(prev.amount_sal || prev.burn_amount_sal || operatorBurnAmountSal(record.fee || 0));
  if (amountOverride != null && Number.isFinite(amountOverride) && Math.abs(amountOverride - expectedAmount) > 1e-6) {
    return res.status(400).json({
      success: false,
      error: 'amount does not match expected operator burn',
      expected_amount_sal: expectedAmount
    });
  }

  record.operator_burn = {
    status: 'burned',
    percent: prev.percent ?? MINT_BURN_PERCENT,
    kind: prev.kind || MINT_BURN_KIND,
    fee_sal: prev.fee_sal ?? record.fee ?? null,
    amount_sal: expectedAmount,
    treasury_keeps_sal: prev.treasury_keeps_sal ?? null,
    payment_tx_hash: prev.payment_tx_hash || record.verification?.payment_tx_hash || null,
    burn_tx_hash: burnTxHash,
    burned_at: nowIso(),
    recorded_by: 'ops_api',
    note: 'Operator protocol burn recorded; public proof available via /api/mint/burn-proof/:name'
  };
  mintedNames.set(name, record);
  persistMintedNames();

  addAudit('ops.burn-complete', req, 'approved', {
    name,
    burn_tx_hash: burnTxHash,
    amount_sal: expectedAmount
  });

  return res.json({
    success: true,
    name,
    operator_burn: record.operator_burn,
    proof: publicBurnProofFromMint(record)
  });
});

/** Public burn/payment proof for a minted name (transparency). */
app.get(['/api/mint/burn-proof/:name', '/mint/burn-proof/:name'], (req, res) => {
  const name = normalizeName(req.params.name);
  if (!name || !mintedNames.has(name)) {
    return res.status(404).json({ success: false, error: 'Name not found' });
  }
  const proof = publicBurnProofFromMint(mintedNames.get(name));
  return res.json({ success: true, ...proof });
});

/** Public list of recent mints + burn status (no secrets). */
app.get(['/api/burns', '/burns', '/api/mint/burns'], (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const items = Array.from(mintedNames.values())
    .sort((a, b) => String(b.minted_at || '').localeCompare(String(a.minted_at || '')))
    .slice(0, limit)
    .map((r) => publicBurnProofFromMint(r));
  return res.json({
    success: true,
    count: items.length,
    burn_policy: {
      user_pays: 'full_fee_to_treasury',
      operator_burns_percent: MINT_BURN_PERCENT,
      kind: MINT_BURN_KIND
    },
    items
  });
});

// Public mint treasury balance (website + GUI). Safe if view-only RPC is used.
app.get(['/api/treasury', '/treasury', '/api/treasury/stats', '/treasury/stats'], async (req, res) => {
  try {
    const stats = await getPublicTreasuryStats();
    return res.json(stats);
  } catch (error) {
    return res.status(500).json({
      success: false,
      address: publicTreasuryAddress(),
      error: error?.message || 'Treasury stats failed'
    });
  }
});

/** Probe view-only treasury wallet-rpc (for chain_proof readiness). */
app.get(['/api/treasury-view-status', '/treasury-view-status'], async (req, res) => {
  // Prefer explicit override, then mainnet treasury (view wallet is almost always mainnet),
  // then the active network treasury address.
  const expected = (
    process.env.TREASURY_VIEW_EXPECTED_ADDRESS
    || process.env.MINT_TREASURY_ADDRESS_MAINNET
    || MINT_TREASURY_ADDRESS
    || ''
  ).trim();
  try {
    const version = await treasuryViewRpcRawCall('get_version', {});
    if (version.error && !version.result) {
      return res.status(503).json({
        success: false,
        available: false,
        error: version.error.message || 'treasury view rpc error',
        treasury_view_rpc_url: TREASURY_VIEW_RPC_URL,
        expected_treasury_address: expected
      });
    }

    const address = await treasuryViewRpcRawCall('get_address', {});
    const height = await treasuryViewRpcRawCall('get_height', {});
    let addressIndex = null;
    let addressRecognized = false;
    if (expected) {
      const idx = await treasuryViewRpcRawCall('get_address_index', { address: expected });
      if (idx.result && !idx.error) {
        addressIndex = idx.result.index || idx.result;
        addressRecognized = true;
      }
    }

    const primaryCarrot = address?.result?.addresses?.[0]?.address_carrot
      || address?.result?.address
      || null;

    // Readiness: can we read balances / any inbound history? Empty wallets are still
    // "ready" if balance APIs respond; "deposits_indexed" is true when any inbound exists.
    let balanceOk = false;
    let balanceSal = null;
    let depositsIndexed = false;
    try {
      const bal = await fetchWalletBalance(TREASURY_VIEW_RPC_URL, 6000);
      balanceOk = true;
      balanceSal = Number((Number(bal.balance || 0) / SAL_ATOMIC_UNITS).toFixed(6));
    } catch {
      balanceOk = false;
    }
    try {
      const hist = await walletRpcRawCall(
        'get_transfers',
        { in: true, pending: true, pool: true, account_index: 0 },
        TREASURY_VIEW_RPC_URL
      );
      const ins = Array.isArray(hist?.result?.in) ? hist.result.in : [];
      const pending = Array.isArray(hist?.result?.pending) ? hist.result.pending : [];
      const pool = Array.isArray(hist?.result?.pool) ? hist.result.pool : [];
      depositsIndexed = (ins.length + pending.length + pool.length) > 0 || (balanceSal != null && balanceSal > 0);
    } catch {
      /* optional */
    }

    const walletHeight = height?.result?.height ?? null;
    const chainProofReady = Boolean(addressRecognized && balanceOk);
    let note;
    if (!addressRecognized) {
      note = 'View RPC is up but did not recognize MINT_TREASURY_ADDRESS — recreate view wallet with generate-from-svb-key using the treasury spend wallet’s View-balance secret.';
    } else if (!balanceOk) {
      note = 'Treasury address is recognized but balance APIs are not ready (wallet may still be opening/syncing).';
    } else if (!depositsIndexed) {
      note = 'View wallet is online and ready for new deposits. If a known payment is missing, re-export the View-balance secret from the treasury spend wallet and recreate this view wallet.';
    } else {
      note = 'Treasury view wallet is online and indexing deposits (chain_proof ready).';
    }

    return res.json({
      success: true,
      available: true,
      treasury_view_rpc_url: TREASURY_VIEW_RPC_URL,
      expected_treasury_address: expected,
      primary_carrot_address: primaryCarrot,
      // Carrot view-only may display a different primary string; recognition via index is the check.
      expected_address_recognized: addressRecognized,
      expected_address_index: addressIndex,
      wallet_height: walletHeight,
      balance_ok: balanceOk,
      balance_sal: balanceSal,
      deposits_indexed: depositsIndexed,
      chain_proof_ready: chainProofReady,
      watch_only: true,
      note
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      available: false,
      chain_proof_ready: false,
      error: error?.message || 'Unable to reach treasury view RPC',
      treasury_view_rpc_url: TREASURY_VIEW_RPC_URL,
      expected_treasury_address: expected,
      hint: 'Ensure salpay-treasury-view.service is running and the view wallet is open.'
    });
  }
});

app.get(['/api/name-policy', '/name-policy'], async (req, res) => {
  if (FEE_CURRENCY === 'usd') {
    await ensureSalUsdRateFresh();
  }
  res.json({
    success: true,
    salpay_network: SALPAY_NETWORK,
    name_policy: getSalNamePolicy(),
    name_rule_message: SAL_NAME_RULE_MESSAGE,
    sal_usd: getSalUsdRateMeta()
  });
});

/** Public SAL/USD rate used for mint fee conversion (CoinGecko + fallbacks). */
app.get(['/api/price/sal', '/price/sal'], async (req, res) => {
  const force = String(req.query?.refresh || '').trim() === '1';
  await ensureSalUsdRateFresh({ force });
  const meta = getSalUsdRateMeta();
  const examples = FEE_USD_TIERS.map((tier) => {
    const rate = getSalUsdRate();
    const buffer = 1 + (FEE_USD_BUFFER_PERCENT / 100);
    const feeSal = rate > 0 ? Math.ceil(((tier.usd / rate) * buffer) * 100) / 100 : null;
    return {
      min_length: tier.min_length,
      max_length: tier.max_length,
      fee_usd: tier.usd,
      fee_sal: feeSal
    };
  });
  res.json({
    success: true,
    asset: 'SAL1',
    vs: 'usd',
    ...meta,
    fee_currency: FEE_CURRENCY,
    fee_examples: examples
  });
});


app.get(['/api/wallet-capabilities', '/wallet-capabilities'], async (req, res) => {
  if (NON_CUSTODIAL_MODE) {
    return res.json({
      success: true,
      checked_at: nowIso(),
      mode: 'client_wallet',
      wallet_rpc_required: false,
      create_token_supported: null,
      token_mint_path_ready: null,
      note: 'Wallet capability probe skipped because PAYMENT_MODE=client_wallet.'
    });
  }

  try {
    const capabilities = await probeWalletCapabilities();
    return res.json({ success: true, ...capabilities });
  } catch (error) {
    return res.status(503).json({
      success: false,
      error: error?.message || 'Unable to probe wallet capabilities'
    });
  }
});

app.get(['/api/ops/metrics', '/ops/metrics'], (req, res) => {
  if (!requireOpsAuth(req, res)) return;
  const nowMs = Date.now();
  const windowSeconds = OPS_ALERT_WINDOW_SECONDS;
  const tracked = ['send', 'register', 'mint.reserve', 'mint.verify-payment', 'mint.execute'];

  const failure_counts = Object.fromEntries(
    tracked.map((key) => {
      const list = pruneFailureWindow(key, nowMs);
      return [key, list.length];
    })
  );

  return res.json({
    success: true,
    at: nowIso(),
    window_seconds: windowSeconds,
    alert_threshold: OPS_ALERT_FAILURE_THRESHOLD,
    alert_cooldown_seconds: OPS_ALERT_COOLDOWN_SECONDS,
    failure_counts
  });
});

// === REGISTRATION ENDPOINT (Whisky-style) ===
app.post('/register', registerRateLimiter, async (req, res) => {
  const turnstile = await verifyTurnstile(req);
  if (!turnstile.success) {
    addAudit('register', req, 'blocked', { reason: turnstile.error });
    return res.status(403).json({ success: false, error: turnstile.error });
  }

  const { name, ticker, primary_address: providedPrimaryAddress } = req.body;

  const normalizedName = normalizeName(name);
  if (!normalizedName) {
    addAudit('register', req, 'rejected', { reason: 'invalid_name' });
    return res.status(400).json({ success: false, error: SAL_NAME_RULE_MESSAGE, name_policy: getSalNamePolicy() });
  }

  const baseName = normalizedName.replace('.sal', '').trim();
  const requestedTicker = typeof ticker === 'string' ? ticker.trim().toUpperCase() : '';
  const hasExplicitTicker = requestedTicker.length > 0;
  let suggestedTicker = coerceTicker(normalizedName, requestedTicker);
  if (!suggestedTicker) {
    const detail = tickerValidationError(requestedTicker)
      || 'Ticker must be exactly 4 letters or numbers (not SAL*/BURN reserved)';
    addAudit('register', req, 'rejected', { reason: 'invalid_ticker', name: normalizedName, ticker: requestedTicker || null });
    return res.status(400).json({
      success: false,
      error: detail,
      available_ticker_suggestions: suggestAvailableTickers(normalizedName, 3)
    });
  }

  if (mintedNames.has(normalizedName)) {
    addAudit('register', req, 'rejected', { reason: 'already_minted', name: normalizedName });
    return res.status(409).json({ success: false, error: 'Name is already minted' });
  }

  // Match quote/reserve: if no ticker forced and stem is taken, auto-pick a free one.
  if (!hasExplicitTicker && isTickerTaken(suggestedTicker, { exclude_name: normalizedName })) {
    const preferred = pickPreferredAvailableTicker(normalizedName, '');
    if (preferred) {
      suggestedTicker = preferred;
    }
  }

  if (isTickerTaken(suggestedTicker, { exclude_name: normalizedName })) {
    const alternatives = suggestAvailableTickers(normalizedName, 3);
    addAudit('register', req, 'rejected', {
      reason: 'ticker_taken',
      name: normalizedName,
      ticker: suggestedTicker,
      alternatives
    });
    return res.status(409).json({
      success: false,
      error: 'Ticker is already taken',
      ticker: suggestedTicker,
      available_ticker_suggestions: alternatives
    });
  }

  const authoritativeName = await checkAuthoritativeNameAvailability(normalizedName, {
    exclude_name: normalizedName
  });
  if (!authoritativeName.ok) {
    if (authoritativeName.checked) {
      addAudit('register', req, 'rejected', {
        reason: 'authoritative_name_conflict',
        name: normalizedName,
        source: authoritativeName.source,
        details: authoritativeName.data || null
      });
      return res.status(409).json({
        success: false,
        error: 'Name is already minted on authoritative source',
        source: authoritativeName.source || 'authoritative_api'
      });
    }

    addAudit('register', req, 'rejected', {
      reason: 'authoritative_name_check_unavailable',
      name: normalizedName,
      source: authoritativeName.source,
      error: authoritativeName.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative name availability check unavailable'
    });
  }

  const authoritativeTicker = await checkAuthoritativeTickerAvailability(suggestedTicker, {
    exclude_name: normalizedName
  });
  if (!authoritativeTicker.ok) {
    if (authoritativeTicker.checked) {
      const alternatives = suggestAvailableTickers(normalizedName);
      addAudit('register', req, 'rejected', {
        reason: 'authoritative_ticker_conflict',
        name: normalizedName,
        ticker: suggestedTicker,
        alternatives,
        source: authoritativeTicker.source,
        details: authoritativeTicker.data || null
      });
      return res.status(409).json({
        success: false,
        error: 'Ticker is already taken on authoritative source',
        ticker: suggestedTicker,
        source: authoritativeTicker.source || 'authoritative_api',
        available_ticker_suggestions: alternatives
      });
    }

    addAudit('register', req, 'rejected', {
      reason: 'authoritative_ticker_check_unavailable',
      name: normalizedName,
      ticker: suggestedTicker,
      source: authoritativeTicker.source,
      error: authoritativeTicker.error || null
    });
    return res.status(503).json({
      success: false,
      error: 'Authoritative ticker availability check unavailable',
      ticker: suggestedTicker
    });
  }

  await ensureSalUsdRateFresh();
  const fee = computeFee(baseName);

  let primaryAddress = String(providedPrimaryAddress || '').trim();
  let primaryAddressSource = 'request';

  if (!primaryAddress) {
    if (NON_CUSTODIAL_MODE) {
      addAudit('register', req, 'rejected', { reason: 'missing_primary_address', name: normalizedName });
      return res.status(400).json({
        success: false,
        error: 'primary_address is required in client_wallet mode',
        hint: 'Paste your wallet primary address from your local wallet app.'
      });
    }

    try {
      primaryAddress = await fetchWalletPrimaryAddress();
      primaryAddressSource = 'wallet_rpc';
    } catch (error) {
      addAudit('register', req, 'rejected', { reason: 'wallet_primary_address_unavailable', name: normalizedName });
      return res.status(503).json({
        success: false,
        error: 'Could not determine wallet address automatically',
        hint: 'Start wallet RPC or provide primary_address explicitly.'
      });
    }
  }

  if (!isLikelyAddress(primaryAddress)) {
    addAudit('register', req, 'rejected', { reason: 'invalid_primary_address', name: normalizedName });
    return res.status(400).json({
      success: false,
      error: 'primary_address must look like a valid wallet address'
    });
  }

  addAudit('register', req, 'approved', {
    name: normalizedName,
    ticker: suggestedTicker,
    fee,
    primary_address_source: primaryAddressSource
  });

  res.json({
    success: true,
    name: normalizedName,
    ticker: suggestedTicker,
    fee: fee,
    primary_address: primaryAddress,
    primary_address_source: primaryAddressSource,
    treasury_address: MINT_TREASURY_ADDRESS,
    message: `Prepared registration for ${normalizedName}. Name becomes active after payment verification and execute step.`,
    active_on_chain: false,
    reservation_required: true,
    next_command: `cd scripts && mint-sal-name.bat ${suggestedTicker} ${normalizedName} ${primaryAddress}`
  });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Dynamic .sal Resolver + Registration active',
    salpay_network: SALPAY_NETWORK,
    payment_verification_mode: MINT_PAYMENT_VERIFICATION_MODE,
    mainnet_strict_guards: MAINNET_STRICT_GUARDS,
    authoritative_name_check_enabled: AUTHORITATIVE_NAME_CHECK_URL.length > 0,
    authoritative_ticker_check_enabled: AUTHORITATIVE_TICKER_CHECK_URL.length > 0,
    authoritative_name_mode: isSelfRegistryUrl(AUTHORITATIVE_NAME_CHECK_URL)
      ? 'self'
      : (AUTHORITATIVE_NAME_CHECK_URL ? 'http' : 'off'),
    authoritative_ticker_mode: isSelfRegistryUrl(AUTHORITATIVE_TICKER_CHECK_URL)
      ? 'self'
      : (AUTHORITATIVE_TICKER_CHECK_URL ? 'http' : 'off'),
    chain_name_check: CHAIN_NAME_CHECK_URL || null,
    chain_ticker_check: CHAIN_TICKER_CHECK_URL || null,
    name_images_enabled: true,
    minted_count: mintedNames.size
  });
});

app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    fee_currency: FEE_CURRENCY,
    sal_usd_rate: getSalUsdRate() || null,
    sal_usd_rate_source: getSalUsdRateMeta().sal_usd_rate_source
  });
});

app.listen(PORT, () => {
  console.log(`.sal Resolver + Registration running on http://localhost:${PORT}`);
  if (FEE_CURRENCY === 'usd') {
    console.log(
      `Fee pricing: USD tiers → SAL1 via ${SAL_USD_PRICE_SOURCE}`
      + (SAL_USD_MANUAL_RATE > 0 ? ` (manual fallback ${SAL_USD_MANUAL_RATE})` : '')
    );
  }
});
