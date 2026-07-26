#!/usr/bin/env node

const baseUrl = (process.env.SALPAY_API_BASE || 'http://127.0.0.1:3012').replace(/\/$/, '');
const testName = `smoke${Date.now()}.sal`;
const primaryAddress = 'SC1Tou2VtQX3Pb3nYrEVLwFAniy8QeEjGfBRJTzxL4A8CoxPVeUDLxTLMKZvQmtcnYHcuWqH85CgM9gt8Ti4qoyh7tDPcN9YpUv';
const chainProofTxHash = String(process.env.SALPAY_SMOKE_CHAIN_TX_HASH || '').trim();

async function api(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  return { status: res.status, ok: res.ok, body };
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function logStep(label) {
  console.log(`\n== ${label} ==`);
}

(async () => {
  console.log(`Running salpay smoke tests against ${baseUrl}`);

  logStep('health and turnstile config');
  const health = await api('/healthz');
  expect(health.status === 200 && health.body?.status === 'ok', 'healthz failed');
  console.log('healthz ok');

  const turnstile = await api('/turnstile-config');
  expect(turnstile.status === 200 && turnstile.body?.success === true, 'turnstile-config failed');
  console.log(`turnstile effective: ${turnstile.body.enforced_effective}`);
  const paymentVerificationMode = String(turnstile.body?.payment_verification_mode || 'client_attested');
  console.log(`payment verification mode: ${paymentVerificationMode}`);

  logStep('reserve rejects missing primary address');
  const reserveBad = await api('/api/mint/reserve', {
    method: 'POST',
    body: JSON.stringify({ name: `${testName}x` })
  });
  expect(reserveBad.status === 400 || reserveBad.status === 403, 'reserve bad request should fail');
  console.log(`reserve missing primary_address rejected with ${reserveBad.status}`);

  logStep('reserve success');
  const reserve = await api('/api/mint/reserve', {
    method: 'POST',
    body: JSON.stringify({ name: testName, primary_address: primaryAddress })
  });
  expect(reserve.status === 200 && reserve.body?.success === true, 'reserve success failed');
  const reservationId = reserve.body.reservation_id;
  const treasuryAddress = reserve.body.treasury_address;
  const fee = reserve.body.fee;
  expect(reservationId && treasuryAddress && fee > 0, 'reserve response missing required fields');
  console.log(`reserved ${testName} fee=${fee}`);

  logStep('quote by reservation');
  const quote = await api('/api/mint/quote', {
    method: 'POST',
    body: JSON.stringify({ reservation_id: reservationId })
  });
  expect(quote.status === 200 && quote.body?.fee === fee, 'quote mismatch');
  console.log('quote ok');

  logStep('execute blocked before verified payment');
  const executeBefore = await api('/api/mint/execute', {
    method: 'POST',
    body: JSON.stringify({ reservation_id: reservationId, idempotency_key: `pre-${Date.now()}` })
  });
  expect(executeBefore.status === 409 || executeBefore.status === 403, 'execute before verify should fail');
  console.log(`execute before verify rejected with ${executeBefore.status}`);

  logStep('verify-payment rejects wrong treasury destination');
  const verifyWrongTreasury = await api('/api/mint/verify-payment', {
    method: 'POST',
    body: JSON.stringify({
      reservation_id: reservationId,
      amount: fee,
      tx_hash: `sim_bad_${Date.now()}`,
      to_address: 'not_the_treasury'
    })
  });
  expect(verifyWrongTreasury.status === 400 || verifyWrongTreasury.status === 403, 'verify-payment wrong treasury should fail');
  console.log(`verify wrong treasury rejected with ${verifyWrongTreasury.status}`);

  logStep('verify-payment insufficient amount');
  const verifyInsufficient = await api('/api/mint/verify-payment', {
    method: 'POST',
    body: JSON.stringify({
      reservation_id: reservationId,
      amount: Math.max(1, fee - 1),
      tx_hash: `sim_insufficient_${Date.now()}`,
      to_address: treasuryAddress
    })
  });
  if (paymentVerificationMode === 'chain_proof') {
    expect(verifyInsufficient.status === 409, 'chain proof should reject unproven tx');
    expect(verifyInsufficient.body?.proof_reason, 'chain proof failure should include proof_reason');
    console.log(`chain-proof rejection reason: ${verifyInsufficient.body.proof_reason}`);
  } else {
    expect(verifyInsufficient.status === 200, 'verify insufficient should return 200 with status');
    expect(verifyInsufficient.body?.success === false && verifyInsufficient.body?.status === 'insufficient', 'verify insufficient status mismatch');
    console.log('insufficient payment correctly rejected');
  }

  logStep('verify-payment success');
  if (paymentVerificationMode === 'chain_proof' && !chainProofTxHash) {
    console.log('Skipping positive chain-proof verify: set SALPAY_SMOKE_CHAIN_TX_HASH to run it against a real tx.');
    console.log('\nAll smoke checks passed (chain-proof negative coverage).');
    return;
  }

  const verify = await api('/api/mint/verify-payment', {
    method: 'POST',
    body: JSON.stringify({
      reservation_id: reservationId,
      amount: fee,
      tx_hash: paymentVerificationMode === 'chain_proof' ? chainProofTxHash : `sim_ok_${Date.now()}`,
      to_address: treasuryAddress
    })
  });
  expect(verify.status === 200 && verify.body?.success === true, 'verify-payment success failed');
  console.log('payment verification accepted');

  logStep('execute success and idempotency');
  const idemKey = `idem-${Date.now()}`;
  const execute = await api('/api/mint/execute', {
    method: 'POST',
    body: JSON.stringify({ reservation_id: reservationId, idempotency_key: idemKey })
  });
  expect(execute.status === 200 && execute.body?.success === true, 'execute failed');
  const jobId = execute.body.job_id;
  expect(jobId, 'execute missing job id');
  console.log(`execute ok job=${jobId}`);

  const executeAgain = await api('/api/mint/execute', {
    method: 'POST',
    body: JSON.stringify({ reservation_id: reservationId, idempotency_key: idemKey })
  });
  expect(executeAgain.status === 404 || (executeAgain.status === 200 && executeAgain.body?.reused), 'execute idempotency behavior unexpected after reservation consumed');
  console.log(`execute repeat handled with ${executeAgain.status}`);

  logStep('status and resolve');
  const status = await api(`/api/mint/status/${jobId}`);
  expect(status.status === 200 && status.body?.success === true, 'mint status failed');

  const resolve = await api(`/resolve/${testName}`);
  expect(resolve.status === 200 && resolve.body?.success === true, 'resolve failed for minted name');
  expect(resolve.body?.resolved_address === primaryAddress, 'resolve address mismatch');
  console.log('minted name resolves to intended primary address');

  logStep('send to minted name (client-wallet mode expected)');
  const send = await api('/send', {
    method: 'POST',
    body: JSON.stringify({ name: testName, amount: 1.5 })
  });
  expect(send.status === 200, 'send should succeed in client-wallet mode');
  expect(send.body?.resolved_address === primaryAddress, 'send resolved_address mismatch');
  console.log(`send flow resolved destination=${send.body.resolved_address}`);

  logStep('suggest includes minted name by prefix');
  const prefix = testName.substring(0, 5);
  const suggest = await api(`/suggest?q=${encodeURIComponent(prefix)}`);
  expect(suggest.status === 200 && suggest.body?.success === true, 'suggest failed');
  expect(Array.isArray(suggest.body?.suggestions), 'suggestions should be array');
  expect(suggest.body.suggestions.some((s) => s.name === testName), 'minted name not present in suggestions');
  console.log('suggest includes newly minted name');

  logStep('register is prepare-only');
  const registerName = `prep${Date.now()}.sal`;
  const register = await api('/register', {
    method: 'POST',
    body: JSON.stringify({ name: registerName, primary_address: primaryAddress })
  });
  expect(register.status === 200 && register.body?.success === true, 'register failed');
  expect(register.body?.reservation_required === true, 'register should indicate reservation required');

  const resolvePrepared = await api(`/resolve/${registerName}`);
  expect(resolvePrepared.status === 404, 'prepared register name should not resolve before execute');
  console.log('register prepare-only behavior verified');

  logStep('audit endpoint alive');
  const audit = await api('/api/mint/audit?limit=25');
  expect(audit.status === 200 && audit.body?.success === true && Array.isArray(audit.body?.items), 'audit failed');
  expect(audit.body.items.length > 0, 'audit should contain events after smoke tests');
  console.log(`audit contains ${audit.body.items.length} events`);

  console.log('\nAll smoke checks passed.');
})().catch((error) => {
  console.error('\nSmoke test failed:', error.message);
  process.exit(1);
});
