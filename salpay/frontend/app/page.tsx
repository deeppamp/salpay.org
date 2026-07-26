"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useEffect, useRef, useState } from "react";

type TurnstileWidgetId = string | number;

type TurnstileApi = {
  render: (container: string | HTMLElement, options: Record<string, unknown>) => TurnstileWidgetId;
  reset: (widgetId?: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export default function Home() {
  const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
  const SAL_NAME_RULE_MESSAGE =
    "Use lowercase letters, numbers, or hyphens, keep 1-63 characters before .sal, and start/end with a letter or number.";
  const SAL_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sal$/;
  const turnstileSiteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();
  const turnstileSiteKeyLooksPlaceholder =
    /YOUR_REAL|PUT_REAL|PASTE_REAL|YOUR_TURNSTILE|REAL_SITE_KEY|SITE_KEY_HERE|CHANGEME|YOUR_ACTUAL_TURNSTILE_SITE_KEY|REAL_CLOUDFLARE_SITE_KEY/i.test(
      turnstileSiteKey
    );
  const [turnstileEnforced, setTurnstileEnforced] = useState<boolean | null>(null);
  const [feePolicy, setFeePolicy] = useState<{
    network: string;
    fee_currency: "sal" | "usd";
    fee_usd_range?: { min_usd?: number; max_usd?: number };
    mint_burn_percent?: number;
  } | null>(null);
  const walletRefreshMs = 10000;

  // Keep homepage branding text centralized so future feature edits don't accidentally change it.
  const BRAND_BADGE = ".SAL";
  const HERO_TITLE_PREFIX = "Pay to names";
  const HERO_TITLE_SUFFIX = "SAL";
  const HERO_SUBTITLE = "Type a .sal name to send SAL1";

  const [toName, setToName] = useState("");
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<any>(null);
  const [sending, setSending] = useState(false);
  const [walletStatus, setWalletStatus] = useState<any>(null);
  const [walletStatusLoading, setWalletStatusLoading] = useState(false);
  const [walletStatusLastUpdated, setWalletStatusLastUpdated] = useState<string | null>(null);
  const [registerName, setRegisterName] = useState("");
  const [registerTicker, setRegisterTicker] = useState("");
  const [registerPrimaryAddress, setRegisterPrimaryAddress] = useState("");
  const [registerResult, setRegisterResult] = useState<any>(null);
  const [registering, setRegistering] = useState(false);
  const [registerFee, setRegisterFee] = useState<number | null>(null);
  const [registerFeeLoading, setRegisterFeeLoading] = useState(false);
  const [freeTickers, setFreeTickers] = useState<string[]>([]);
  const [freeTickerNote, setFreeTickerNote] = useState<string>("");
  const [tickerManual, setTickerManual] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [registerTurnstileToken, setRegisterTurnstileToken] = useState("");
  const [sendTurnstileToken, setSendTurnstileToken] = useState("");
  // Full website mint wizard: form → pay → verify → done
  const [mintStep, setMintStep] = useState<"form" | "pay" | "verify" | "done">("form");
  const [mintReservation, setMintReservation] = useState<any>(null);
  const [paymentTxHash, setPaymentTxHash] = useState("");
  const [burnTxHash, setBurnTxHash] = useState("");
  const [mintBusy, setMintBusy] = useState(false);
  const [mintMessage, setMintMessage] = useState<string | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintExecuteResult, setMintExecuteResult] = useState<any>(null);
  const [treasuryStats, setTreasuryStats] = useState<any>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const registerTurnstileRef = useRef<HTMLDivElement | null>(null);
  const sendTurnstileRef = useRef<HTMLDivElement | null>(null);
  const registerWidgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const sendWidgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const lockedBalance =
    walletStatus?.balance != null && walletStatus?.unlocked_balance != null
      ? Math.max(Number(walletStatus.balance) - Number(walletStatus.unlocked_balance), 0).toFixed(6)
      : null;

  const apiFetch = (path: string, init?: RequestInit) => fetch(`${apiBaseUrl}${path}`, init);
  const turnstileReady = turnstileEnforced === true && !!turnstileSiteKey && !turnstileSiteKeyLooksPlaceholder;
  const turnstileMisconfigured = turnstileEnforced === true && (!turnstileSiteKey || turnstileSiteKeyLooksPlaceholder);

  const resetTurnstile = (widgetId: TurnstileWidgetId | null, clearToken: () => void) => {
    if (widgetId != null && window.turnstile) {
      window.turnstile.reset(widgetId);
    }
    clearToken();
  };

  const copyText = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(successMessage);
      window.setTimeout(() => setCopyFeedback(null), 2500);
    } catch {
      setCopyFeedback("Copy failed. You can still select and copy manually.");
      window.setTimeout(() => setCopyFeedback(null), 3000);
    }
  };

  const loadWalletStatus = async () => {
    setWalletStatusLoading(true);
    try {
      const res = await apiFetch("/wallet-status");
      const data = await res.json();
      setWalletStatus(data);
      setWalletStatusLastUpdated(new Date().toLocaleTimeString());
    } catch {
      setWalletStatus({ success: false, error: "Wallet status unavailable" });
      setWalletStatusLastUpdated(null);
    }
    setWalletStatusLoading(false);
  };

  const loadTreasuryStats = async () => {
    try {
      const res = await apiFetch("/api/treasury");
      const data = await res.json();
      setTreasuryStats(data);
    } catch {
      setTreasuryStats({ success: false, available: false, error: "Treasury stats unavailable" });
    }
  };

  useEffect(() => {
    loadWalletStatus();
    loadTreasuryStats();

    const intervalId = window.setInterval(() => {
      loadWalletStatus();
      loadTreasuryStats();
    }, walletRefreshMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const loadTurnstileConfig = async () => {
      try {
        const res = await apiFetch("/turnstile-config");
        const data = await res.json();
        setTurnstileEnforced(Boolean(data?.enforced_effective));
        const currency = String(data?.fee_currency || data?.name_policy?.fee_currency || "sal").toLowerCase() === "usd"
          ? "usd"
          : "sal";
        setFeePolicy({
          network: String(data?.salpay_network || "testnet"),
          fee_currency: currency,
          fee_usd_range: data?.name_policy?.fee_usd_range || data?.fee_usd_range || { min_usd: 20, max_usd: 50 },
          mint_burn_percent: Number(data?.mint_burn_percent ?? data?.name_policy?.mint_burn_percent ?? 0),
        });
      } catch {
        setTurnstileEnforced(false);
        setFeePolicy(null);
      }
    };

    loadTurnstileConfig();
  }, []);

  const feeHelpText = (() => {
    if (registerFee == null) return null;
    const network = feePolicy?.network || "testnet";
    const isMainnet = network === "mainnet";
    const currency = feePolicy?.fee_currency || (isMainnet ? "usd" : "sal");
    const minUsd = feePolicy?.fee_usd_range?.min_usd ?? 20;
    const maxUsd = feePolicy?.fee_usd_range?.max_usd ?? 50;

    if (currency === "usd" || isMainnet) {
      return `Mainnet fee is about $${minUsd}–$${maxUsd} USD, converted to SAL1 (shorter names cost more). Pay the full amount to the treasury address from any wallet.`;
    }
    // Testnet / fixed SAL tiers
    if (registerFee >= 2000) {
      return "Testnet fee: short names (1–4 characters before .sal) = 2000 SAL1. Mainnet uses ~$20–$50 USD in SAL1.";
    }
    if (registerFee >= 500) {
      return "Testnet fee: mid-length names (5–6 characters) = 500 SAL1. Longer names = 100 SAL1.";
    }
    return "Testnet fee: long names (7+ characters before .sal) = 100 SAL1. Mainnet uses ~$20–$50 USD in SAL1.";
  })();

  useEffect(() => {
    if (!turnstileReady) return;

    const mountWidgets = () => {
      if (!window.turnstile) return;

      if (registerTurnstileRef.current && registerWidgetIdRef.current == null) {
        registerWidgetIdRef.current = window.turnstile.render(registerTurnstileRef.current, {
          sitekey: turnstileSiteKey,
          theme: "dark",
          callback: (token: string) => setRegisterTurnstileToken(token),
          "expired-callback": () => setRegisterTurnstileToken(""),
          "error-callback": () => setRegisterTurnstileToken("")
        });
      }

      if (sendTurnstileRef.current && sendWidgetIdRef.current == null) {
        sendWidgetIdRef.current = window.turnstile.render(sendTurnstileRef.current, {
          sitekey: turnstileSiteKey,
          theme: "dark",
          callback: (token: string) => setSendTurnstileToken(token),
          "expired-callback": () => setSendTurnstileToken(""),
          "error-callback": () => setSendTurnstileToken("")
        });
      }
    };

    if (window.turnstile) {
      mountWidgets();
      return;
    }

    const existingScript = document.getElementById("cf-turnstile-script") as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", mountWidgets, { once: true });
      return () => existingScript.removeEventListener("load", mountWidgets);
    }

    const script = document.createElement("script");
    script.id = "cf-turnstile-script";
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", mountWidgets, { once: true });
    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", mountWidgets);
    };
  }, [turnstileReady, turnstileSiteKey]);

  const fetchRegisterFee = async (name: string) => {
    const candidate = normalizeSalName(name);
    if (!candidate || !isValidSalName(candidate)) {
      setRegisterFee(null);
      setFreeTickers([]);
      setFreeTickerNote("");
      return;
    }
    setRegisterFeeLoading(true);
    try {
      // 1) Free tickers always from registry API (DB-verified; never invent local stems).
      const sugRes = await apiFetch(
        `/api/mint/ticker-suggestions?name=${encodeURIComponent(candidate)}&limit=3`
      );
      const sug = await sugRes.json();
      let freeList: string[] = [];
      if (sug.success && Array.isArray(sug.available_ticker_suggestions)) {
        freeList = sug.available_ticker_suggestions
          .map((t: string) => String(t).toUpperCase())
          .filter((t: string) => /^[A-Z0-9]{4}$/.test(t))
          .slice(0, 3);
        setFreeTickers(freeList);
        const preferred = String(sug.preferred_ticker || freeList[0] || "")
          .toUpperCase()
          .slice(0, 4);
        if (preferred && /^[A-Z0-9]{4}$/.test(preferred)) {
          setRegisterTicker(preferred);
          setTickerManual(true);
        } else {
          setRegisterTicker("");
          setTickerManual(false);
        }
        if (sug.desired_available === false && sug.desired_ticker) {
          setFreeTickerNote(
            sug.desired_owner
              ? `${sug.desired_ticker} is used by ${sug.desired_owner} — using ${preferred || "a free ticker"}.`
              : `${sug.desired_ticker} is taken — using ${preferred || "a free ticker"}.`
          );
        } else {
          setFreeTickerNote(freeList.length ? "Free tickers (verified against SalPay registry):" : "No free tickers available");
        }
      } else {
        setFreeTickers([]);
        setRegisterTicker("");
        setFreeTickerNote("Could not verify free tickers — try again");
      }

      // 2) Fee from quote without sending a ticker (server assigns free one).
      const quoteRes = await apiFetch("/api/mint/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: candidate }),
      });
      const quote = await quoteRes.json();
      if (quote.success) {
        setRegisterFee(typeof quote.fee === "number" ? quote.fee : null);
        // Prefer quote free list if present (same registry).
        if (Array.isArray(quote.available_ticker_suggestions) && quote.available_ticker_suggestions.length) {
          const qList = quote.available_ticker_suggestions
            .map((t: string) => String(t).toUpperCase())
            .filter((t: string) => /^[A-Z0-9]{4}$/.test(t))
            .slice(0, 3);
          setFreeTickers(qList);
          const qPref = String(quote.preferred_ticker || quote.ticker || qList[0] || "")
            .toUpperCase()
            .slice(0, 4);
          if (qPref && /^[A-Z0-9]{4}$/.test(qPref)) {
            setRegisterTicker(qPref);
            setTickerManual(true);
          }
        }
      } else if (quote.error && /already minted/i.test(String(quote.error))) {
        setRegisterFee(null);
        setFreeTickerNote(String(quote.error));
      } else if (!quote.success) {
        // Fee estimate only if quote failed for non-minted reasons
        const base = candidate.replace(/\.sal$/, "");
        setRegisterFee(base.length <= 4 ? 2000 : base.length <= 6 ? 500 : 100);
      }
    } catch {
      setRegisterFee(null);
      setFreeTickers([]);
      setRegisterTicker("");
      setFreeTickerNote("Registration service not reachable");
    }
    setRegisterFeeLoading(false);
  };

  const resetMintWizard = () => {
    setMintStep("form");
    setMintReservation(null);
    setPaymentTxHash("");
    setBurnTxHash("");
    setMintBusy(false);
    setMintMessage(null);
    setMintError(null);
    setMintExecuteResult(null);
    setRegisterResult(null);
  };


  /** Step 1: create mint reservation (website path uses policy mint API, not prepare-only /register). */
  const handleStartMint = async () => {
    const candidate = normalizeSalName(registerName);
    // Only allow a ticker that was verified free by the server (chip list).
    let manualTicker = registerTicker.trim().toUpperCase();
    if (!freeTickers.includes(manualTicker) && freeTickers.length > 0) {
      manualTicker = String(freeTickers[0] || "").toUpperCase();
      setRegisterTicker(manualTicker);
      setTickerManual(true);
    }
    const primary = registerPrimaryAddress.trim();

    setMintError(null);
    setMintMessage(null);

    if (!candidate || !isValidSalName(candidate)) {
      setMintError(SAL_NAME_RULE_MESSAGE);
      return;
    }

    if (!/^[A-Z0-9]{4}$/.test(manualTicker)) {
      setMintError("Pick a free 4-character ticker chip (or type one) before reserving");
      return;
    }

    if (!primary || primary.length < 20) {
      setMintError("Paste your wallet primary address (SC… / Carrot). Required so the name resolves to you.");
      return;
    }

    if (turnstileReady && !registerTurnstileToken) {
      setMintError("Complete the Turnstile security check first");
      return;
    }

    if (turnstileMisconfigured) {
      setMintError("Security check is required but site key is missing in frontend build");
      return;
    }

    setRegistering(true);
    setMintBusy(true);
    try {
      const res = await apiFetch("/api/mint/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidate,
          ticker: manualTicker || undefined,
          primary_address: primary,
          turnstile_token: registerTurnstileToken || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMintReservation(data);
        setRegisterFee(typeof data.fee === "number" ? data.fee : null);
        if (data.ticker) setRegisterTicker(String(data.ticker).toUpperCase().slice(0, 4));
        setRegisterResult(data);
        setMintStep("pay");
        setMintMessage("Reservation created. Pay the fee from your wallet, then paste the payment tx hash.");
      } else {
        if (Array.isArray(data.available_ticker_suggestions)) {
          setFreeTickers(data.available_ticker_suggestions.map((t: string) => String(t).toUpperCase()).slice(0, 3));
          setFreeTickerNote(
            data.ticker
              ? `${data.ticker} is taken — pick a free ticker below.`
              : "Ticker unavailable — pick a free ticker below."
          );
        }
        setMintError(data.error || "Could not reserve name");
      }
    } catch {
      setMintError("Mint service not reachable");
    } finally {
      if (turnstileReady) {
        resetTurnstile(registerWidgetIdRef.current, () => setRegisterTurnstileToken(""));
      }
      setRegistering(false);
      setMintBusy(false);
    }
  };

  /** Step 2–3: verify payment then execute mint. */
  const handleVerifyAndExecuteMint = async () => {
    setMintError(null);
    setMintMessage(null);

    const reservationId = String(mintReservation?.reservation_id || "").trim();
    const fee = Number(mintReservation?.fee);
    const treasury = String(mintReservation?.treasury_address || "").trim();
    const txHash = paymentTxHash.trim();
    const burnHash = burnTxHash.trim();
    const outputs = Array.isArray(mintReservation?.payment_outputs) ? mintReservation.payment_outputs : [];
    const needsProtocolBurn = outputs.some(
      (o: any) => o?.kind === "protocol_burn" || (o?.role === "burn" && !o?.address)
    );

    if (!reservationId) {
      setMintError("Missing reservation. Start mint again.");
      return;
    }
    if (!txHash || txHash.length < 16) {
      setMintError("Paste the treasury transfer transaction hash from your wallet.");
      return;
    }
    if (needsProtocolBurn && (!burnHash || burnHash.length < 16)) {
      setMintError("This mint requires a protocol BURN for half the fee. Paste the burn tx hash too.");
      return;
    }
    if (!Number.isFinite(fee) || fee <= 0 || !treasury) {
      setMintError("Reservation is missing fee or treasury address.");
      return;
    }

    setMintBusy(true);
    try {
      setMintStep("verify");
      setMintMessage("Verifying payment…");

      const verifyRes = await apiFetch("/api/mint/verify-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: reservationId,
          amount: fee,
          tx_hash: txHash,
          treasury_tx_hash: txHash,
          burn_tx_hash: needsProtocolBurn ? burnHash : undefined,
          to_address: treasury,
          outputs,
          turnstile_token: registerTurnstileToken || undefined,
        }),
      });
      const verify = await verifyRes.json();
      if (!verify.success || verify.status !== "verified") {
        setMintError(verify.error || verify.proof_reason || "Payment not verified yet. Check tx hash / amount / destination.");
        setMintStep("pay");
        return;
      }

      setMintMessage("Payment verified. Executing mint…");
      const execRes = await apiFetch("/api/mint/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reservation_id: reservationId,
          idempotency_key: `web-${reservationId}`,
          turnstile_token: registerTurnstileToken || undefined,
        }),
      });
      const exec = await execRes.json();
      if (!exec.success) {
        setMintError(exec.error || "Mint execute failed");
        setMintStep("pay");
        return;
      }

      setMintExecuteResult(exec);
      setMintStep("done");
      setMintMessage(`Mint complete for ${mintReservation?.name || registerName}. You can resolve and send to it now.`);
    } catch {
      setMintError("Verify/execute request failed — is the API running?");
      setMintStep("pay");
    } finally {
      setMintBusy(false);
    }
  };

  const copyAndSend = () => {
    if (result?.final_address) {
      navigator.clipboard.writeText(result.final_address);
      alert(`✅ Address copied!\n\nSend ${result.amount} SAL to:\n${result.final_address}\n\n(Use your Salvium wallet or GUI)`);
    }
  };

  const formatSendError = (error: string) => {
    if (error.includes("no input candidates provided")) {
      return "The wallet does not have spendable inputs yet. Keep mining or wait for unlocked outputs, then try again.";
    }

    return error;
  };

  const showSendPopup = (message: string) => {
    window.alert(message);
  };

  const normalizeSalName = (value: string) => {
    const candidate = value.trim().toLowerCase();
    return candidate.endsWith(".sal") ? candidate : `${candidate}.sal`;
  };

  const isValidSalName = (value: string) => SAL_NAME_REGEX.test(value);

  const handleDirectSend = async () => {
    const query = nameInputRef.current?.value.trim() || toName.trim();
    const sendAmount = Number(amountInputRef.current?.value || amount);

    if (!query) {
      const error = "Name is required";
      setResult({ success: false, error });
      showSendPopup(`Send failed: ${error}`);
      return;
    }

    if (!Number.isFinite(sendAmount) || sendAmount <= 0) {
      const error = "Enter a valid amount";
      setResult({ success: false, error });
      showSendPopup(`Send failed: ${error}`);
      return;
    }

    if (turnstileReady && !sendTurnstileToken) {
      const error = "Complete the Turnstile security check first";
      setResult({ success: false, error });
      showSendPopup(`Send failed: ${error}`);
      return;
    }

    if (turnstileMisconfigured) {
      const error = "Security check is required but site key is missing in frontend build";
      setResult({ success: false, error });
      showSendPopup(`Send failed: ${error}`);
      return;
    }

    setSending(true);
    try {
      const res = await apiFetch("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: query,
          amount: sendAmount,
          turnstile_token: sendTurnstileToken || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResult({
          success: true,
          ...data,
          final_address: data.resolved_address,
        });
        if (data.relay_mode === "client_wallet") {
          showSendPopup(`Address resolved.\n\nTo: ${data.name}\nAmount: ${data.amount} SAL\nDestination: ${data.resolved_address}\n\nSend from your local wallet.`);
        } else {
          showSendPopup(`Payment sent successfully!\n\nTo: ${data.name}\nAmount: ${data.amount} SAL${data.tx_hash ? `\nTx Hash: ${data.tx_hash}` : ""}`);
        }
        loadWalletStatus();
      } else {
        const formattedError = formatSendError(data.error || "Send failed");
        setResult({
          success: false,
          error: formattedError,
          hint: data.hint,
        });
        showSendPopup(`Send failed: ${formattedError}`);
      }
    } catch (err) {
      const error = "Send service not reachable";
      setResult({ success: false, error });
      showSendPopup(`Send failed: ${error}`);
    } finally {
      if (turnstileReady) {
        resetTurnstile(sendWidgetIdRef.current, () => setSendTurnstileToken(""));
      }
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md fixed w-full z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold tracking-tighter text-emerald-400">{BRAND_BADGE}</div>
            <div className="text-xs px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-full">on Salvium</div>
          </div>
        </div>
      </nav>

      <div className="pt-24 pb-20 max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <h1 className="text-6xl md:text-7xl font-bold tracking-tighter mb-4">
            {HERO_TITLE_PREFIX}<span className="text-emerald-400">.</span><span className="text-emerald-400">{HERO_TITLE_SUFFIX}</span>
          </h1>
          <p className="text-xl text-zinc-400">{HERO_SUBTITLE}</p>
        </div>

        <Card className="mb-8 bg-zinc-900 border-zinc-700 text-zinc-100 max-w-xl mx-auto">
          <CardHeader>
            <CardTitle className="text-center text-2xl text-zinc-100">Mint a .sal Name</CardTitle>
            <p className="text-center text-xs text-zinc-400 pt-2">
              {mintStep === "form" && "1 · Name & ticker"}
              {mintStep === "pay" && "2 · Pay fee from your wallet"}
              {mintStep === "verify" && "3 · Verifying…"}
              {mintStep === "done" && "4 · Complete"}
            </p>
          </CardHeader>
          <CardContent className="space-y-6 pt-4">
            {mintStep === "form" && (
              <>
                <div>
                  <label className="text-sm text-zinc-300 block mb-2">Name</label>
                  <Input
                    placeholder="yourname.sal"
                    value={registerName}
                    onChange={(e) => { setRegisterName(e.target.value); fetchRegisterFee(e.target.value); }}
                    className={`bg-zinc-950 border-zinc-600 text-zinc-100 placeholder:text-zinc-400 py-7 text-lg ${
                      registerName.trim().length > 0 && !SAL_NAME_REGEX.test(normalizeSalName(registerName))
                        ? "border-red-500"
                        : registerName.trim().length > 0 ? "border-emerald-600" : ""
                    }`}
                    autoComplete="off"
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">{SAL_NAME_RULE_MESSAGE}</p>
                </div>

                <div>
                  <label className="text-sm text-zinc-300 block mb-2">Ticker (4 chars)</label>
                  <Input
                    placeholder="AUTO"
                    value={registerTicker}
                    onChange={(e) => {
                      setTickerManual(e.target.value.trim().length > 0);
                      setRegisterTicker(e.target.value.toUpperCase().slice(0, 4));
                    }}
                    className="bg-zinc-950 border-zinc-600 text-zinc-100 placeholder:text-zinc-400 py-7 text-lg uppercase"
                    autoComplete="off"
                  />
                  {(freeTickerNote || freeTickers.length > 0) && (
                    <div className="mt-2 space-y-2">
                      {freeTickerNote && <p className="text-xs text-amber-300">{freeTickerNote}</p>}
                      {freeTickers.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-xs text-zinc-500 self-center">Free tickers (3):</span>
                          {freeTickers.map((s) => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => { setTickerManual(true); setRegisterTicker(s); }}
                              className={`rounded-md px-2.5 py-1 text-xs font-mono font-semibold border ${
                                registerTicker === s
                                  ? "bg-amber-500 border-amber-400 text-black"
                                  : "bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm text-zinc-300 block mb-2">Your primary wallet address (required)</label>
                  <Input
                    placeholder="SC1… (Carrot primary from your wallet)"
                    value={registerPrimaryAddress}
                    onChange={(e) => setRegisterPrimaryAddress(e.target.value)}
                    className="bg-zinc-950 border-zinc-600 text-zinc-100 placeholder:text-zinc-400 py-7 text-sm"
                    autoComplete="off"
                  />
                  <p className="mt-1.5 text-xs text-zinc-500">
                    The name will resolve to this address so people can pay you.
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-sm flex items-center justify-between gap-4">
                  <span className="text-zinc-400">Registration fee</span>
                  <span className="font-semibold text-amber-300">
                    {registerFeeLoading ? "…" : registerFee !== null ? `${registerFee} SAL1` : "—"}
                  </span>
                </div>
                {feeHelpText && (
                  <p className="-mt-3 text-xs text-zinc-500">{feeHelpText}</p>
                )}

                {turnstileReady && (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xs text-zinc-300 space-y-2">
                    <p className="uppercase tracking-wide text-zinc-400">Security Check</p>
                    <div ref={registerTurnstileRef} />
                  </div>
                )}
                {turnstileMisconfigured && (
                  <p className="text-xs text-red-300">Turnstile required but site key is misconfigured.</p>
                )}

                {mintError && (
                  <p className="text-sm text-red-400 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2">{mintError}</p>
                )}

                <Button
                  onClick={handleStartMint}
                  disabled={registering || mintBusy || turnstileMisconfigured}
                  className="w-full py-8 text-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40"
                >
                  {registering || mintBusy ? "Reserving…" : "Reserve & continue to payment"}
                </Button>
              </>
            )}

            {(mintStep === "pay" || mintStep === "verify") && mintReservation && (
              <>
                <div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4 text-sm space-y-2">
                  <p><strong>Name:</strong> {mintReservation.name}</p>
                  <p><strong>Ticker:</strong> {mintReservation.ticker}</p>
                  <p><strong>Fee:</strong> {mintReservation.fee} SAL1</p>
                  <p className="break-all text-xs"><strong>Pay to treasury:</strong><br />{mintReservation.treasury_address}</p>
                  <p className="text-xs text-zinc-400">Reservation: {mintReservation.reservation_id}</p>
                  {mintReservation.expires_at && (
                    <p className="text-xs text-zinc-400">Hold expires: {mintReservation.expires_at}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(String(mintReservation.treasury_address), "Treasury copied")}
                    className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium hover:bg-zinc-700"
                  >
                    Copy treasury
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(String(mintReservation.fee), "Fee copied")}
                    className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-medium hover:bg-zinc-700"
                  >
                    Copy fee amount
                  </button>
                </div>

                {Array.isArray(mintReservation.payment_outputs) && mintReservation.payment_outputs.length > 0 && (
                  <div className="rounded-lg border border-zinc-800 bg-black/40 p-3 text-xs space-y-1">
                    <p className="text-zinc-400 uppercase tracking-wide">Payment policy</p>
                    {mintReservation.payment_outputs.map((o: any, idx: number) => (
                      <p key={idx} className="text-zinc-200">
                        <strong>{o.role || o.kind}:</strong>{" "}
                        {o.amount} SAL1 via {o.kind === "protocol_burn" ? "protocol BURN (wallet burn)" : "transfer"}
                        {o.address ? ` → ${String(o.address).slice(0, 18)}…` : ""}
                      </p>
                    ))}
                    {mintReservation.operator_burn?.amount_sal > 0 && (
                      <p className="text-zinc-500 pt-1">
                        After you pay, the operator burns ~{mintReservation.operator_burn.percent}% (
                        {mintReservation.operator_burn.amount_sal} SAL1) from treasury and publishes proof — you do not need a burn-capable wallet.
                      </p>
                    )}
                  </div>
                )}

                <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-100/90">
                  This website never holds your seed or password. Pay from <strong>your own</strong> Salvium
                  wallet (desktop GUI, CLI, or another wallet you trust). Then paste the payment tx hash here.
                </div>

                <ol className="text-xs text-zinc-400 list-decimal pl-5 space-y-1">
                  <li>
                    Open <strong className="text-zinc-200">your</strong> Salvium wallet (SalPay GUI, stock GUI,
                    CLI, or webwallet).
                  </li>
                  <li>
                    Send a normal <strong className="text-zinc-200">SAL1</strong> transfer for the{" "}
                    <strong className="text-zinc-200">full fee</strong> to the treasury address above (use Copy
                    buttons). One payment only.
                  </li>
                  <li>
                    In your wallet, approve the usual <strong className="text-zinc-200">Confirm</strong> dialog
                    and enter your <strong className="text-zinc-200">wallet password</strong> if prompted.
                  </li>
                  {(mintReservation.payment_outputs || []).some((o: any) => o?.kind === "protocol_burn") && (
                    <li>
                      This reservation still asks for a user-side burn half — use a burn-capable wallet or cancel
                      and reserve again for full-treasury payment.
                    </li>
                  )}
                  <li>
                    Copy the payment <strong className="text-zinc-200">transaction hash</strong> from history,
                    paste it below, and click verify &amp; mint.
                  </li>
                </ol>

                <div>
                  <label className="text-sm text-zinc-300 block mb-2">Treasury transfer tx hash</label>
                  <Input
                    placeholder="Paste treasury payment tx hash"
                    value={paymentTxHash}
                    onChange={(e) => setPaymentTxHash(e.target.value.trim())}
                    className="bg-zinc-950 border-zinc-600 text-zinc-100 placeholder:text-zinc-400 py-7 text-sm font-mono"
                    autoComplete="off"
                    disabled={mintBusy}
                  />
                </div>

                {(mintReservation.payment_outputs || []).some((o: any) => o?.kind === "protocol_burn") && (
                  <div>
                    <label className="text-sm text-zinc-300 block mb-2">Protocol burn tx hash</label>
                    <Input
                      placeholder="Paste burn tx hash"
                      value={burnTxHash}
                      onChange={(e) => setBurnTxHash(e.target.value.trim())}
                      className="bg-zinc-950 border-zinc-600 text-zinc-100 placeholder:text-zinc-400 py-7 text-sm font-mono"
                      autoComplete="off"
                      disabled={mintBusy}
                    />
                  </div>
                )}

                {mintMessage && (
                  <p className="text-sm text-emerald-300 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2">{mintMessage}</p>
                )}
                {mintError && (
                  <p className="text-sm text-red-400 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2">{mintError}</p>
                )}

                <Button
                  onClick={handleVerifyAndExecuteMint}
                  disabled={mintBusy || paymentTxHash.length < 16}
                  className="w-full py-8 text-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40"
                >
                  {mintBusy ? "Working…" : "I paid — verify & mint"}
                </Button>
                <Button
                  onClick={resetMintWizard}
                  disabled={mintBusy}
                  className="w-full py-4 text-sm bg-zinc-800 hover:bg-zinc-700"
                >
                  Cancel / start over
                </Button>
              </>
            )}

            {mintStep === "done" && (
              <div className="space-y-4 text-sm">
                <div className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-4 space-y-2">
                  <p className="text-emerald-300 font-semibold text-lg">✓ Name minted</p>
                  <p><strong>Name:</strong> {mintReservation?.name}</p>
                  <p><strong>Ticker:</strong> {mintReservation?.ticker}</p>
                  {mintExecuteResult?.tx_hash && (
                    <p className="break-all text-xs"><strong>Mint job:</strong> {mintExecuteResult.tx_hash}</p>
                  )}
                  <p className="text-xs text-zinc-400">
                    It should resolve now. Use Direct Send below with this name, or the wallet Send tab.
                  </p>
                </div>
                {mintMessage && <p className="text-emerald-300 text-sm">{mintMessage}</p>}
                <Button onClick={resetMintWizard} className="w-full py-6 bg-amber-600 hover:bg-amber-500">
                  Mint another name
                </Button>
              </div>
            )}

            {copyFeedback && (
              <p className="text-xs text-emerald-300 rounded-lg border border-emerald-900/80 bg-emerald-900/20 px-3 py-2">
                {copyFeedback}
              </p>
            )}

            {/* Public mint treasury balance (view-only wallet on server) */}
            <div className="rounded-xl border border-zinc-800 bg-black/50 px-4 py-3 text-xs text-zinc-300 space-y-1">
              <p className="uppercase tracking-wide text-zinc-500">Mint treasury</p>
              {treasuryStats?.available ? (
                <>
                  <p className="text-sm text-emerald-300 font-semibold">
                    {treasuryStats.unlocked_balance_sal ?? "—"} {treasuryStats.asset_type || "SAL1"} unlocked
                    {treasuryStats.balance_sal != null &&
                      treasuryStats.balance_sal !== treasuryStats.unlocked_balance_sal && (
                        <span className="text-zinc-400 font-normal">
                          {" "}
                          · {treasuryStats.balance_sal} total
                        </span>
                      )}
                  </p>
                  <p className="break-all text-[11px] text-zinc-500">{treasuryStats.address}</p>
                  <p className="text-[11px] text-zinc-600">
                    Public view of registration fees (view-only). Updates about every {walletRefreshMs / 1000}s.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-zinc-400">
                    {treasuryStats?.enabled === false
                      ? "Treasury public stats disabled on this server."
                      : "Treasury balance not published yet (view-only wallet syncing or offline)."}
                  </p>
                  {treasuryStats?.address && (
                    <p className="break-all text-[11px] text-zinc-500">{treasuryStats.address}</p>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Main Send Form */}
        <Card className="bg-zinc-900 border-zinc-700 text-zinc-100 max-w-xl mx-auto">
          <CardHeader>
            <CardTitle className="text-center text-2xl text-zinc-100">Direct Send</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8 pt-4">
            <div>
              <label className="text-sm text-zinc-300 block mb-2">To (name or address)</label>
              <Input
                ref={nameInputRef}
                placeholder="alice.sal or bob.sal"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                className="bg-zinc-950 border-zinc-600 text-zinc-100 placeholder:text-zinc-400 py-7 text-lg"
                autoComplete="off"
              />
            </div>

            <div>
              <label className="text-sm text-zinc-300 block mb-2">Amount (SAL1)</label>
              <Input
                ref={amountInputRef}
                type="number"
                placeholder="10.5"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="bg-zinc-950 border-zinc-600 text-zinc-100 placeholder:text-zinc-400 py-7 text-lg"
              />
            </div>

            {turnstileReady && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 text-xs text-zinc-300 space-y-2">
                <p className="uppercase tracking-wide text-zinc-400">Security Check</p>
                <div ref={sendTurnstileRef} />
                <p className="text-zinc-500">Required before sending SAL.</p>
              </div>
            )}
            {turnstileMisconfigured && (
              <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-xs text-red-200 space-y-1">
                <p className="uppercase tracking-wide text-red-300">Turnstile config mismatch</p>
                <p>Backend requires Turnstile, but NEXT_PUBLIC_TURNSTILE_SITE_KEY is missing or still a placeholder in this frontend build.</p>
                <p>Set a real key in salpay/.env.server and rebuild frontend.</p>
              </div>
            )}
            {turnstileEnforced === false && (
              <div className="rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-3 text-xs text-amber-200 space-y-1">
                <p className="uppercase tracking-wide text-amber-300">Turnstile disabled</p>
                <p>Security widget is off for this environment.</p>
              </div>
            )}

            <Button
              onClick={handleDirectSend}
              disabled={sending || turnstileMisconfigured}
              className="w-full py-8 text-xl bg-emerald-600 hover:bg-emerald-500"
            >
              {sending ? "Sending..." : "Send / Resolve SAL1"}
            </Button>
          </CardContent>
        </Card>

        <Card className="mt-8 max-w-xl mx-auto bg-zinc-900 border-zinc-700 text-zinc-100">
          <CardHeader>
            <CardTitle className="text-center text-xl text-zinc-100">Wallet Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2 text-sm text-zinc-300">
            {walletStatusLoading ? (
              <p className="text-zinc-400">Checking wallet readiness...</p>
            ) : walletStatus?.success ? (
              walletStatus?.mode === "client_wallet" ? (
                <>
                  <div className="rounded-xl border border-zinc-800 bg-black/60 px-4 py-3">
                    <p className="font-medium text-emerald-300">Non-custodial mode enabled</p>
                    <p className="mt-1 text-xs text-zinc-400">Server wallet relay is disabled. Resolve names here, then send using your own local wallet.</p>
                  </div>
                </>
              ) : (
              <>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-black/60 px-4 py-3">
                  <span>Unlocked balance</span>
                  <span className="font-medium text-emerald-300">{walletStatus.unlocked_balance ?? "0"} SAL</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-black/60 px-4 py-3">
                  <span>Locked balance</span>
                  <span className="font-medium text-zinc-200">{lockedBalance ?? "0"} SAL</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-black/60 px-4 py-3">
                  <span>Blocks to unlock</span>
                  <span className="font-medium text-zinc-200">{walletStatus.blocks_to_unlock ?? "0"}</span>
                </div>
                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-black/60 px-4 py-3">
                  <span>Auto refresh</span>
                  <span className="font-medium text-zinc-200">{walletRefreshMs / 1000}s</span>
                </div>
                <p className="text-xs text-zinc-400">
                  {walletStatusLastUpdated ? `Last updated at ${walletStatusLastUpdated}.` : "Awaiting wallet status."}
                </p>
                <p className="text-xs text-zinc-400">Direct relay is ready when unlocked balance is available.</p>
              </>
              )
            ) : (
              <p className="text-red-400">{walletStatus?.error || "Wallet status unavailable"}</p>
            )}
          </CardContent>
        </Card>

        {/* Result */}
        {result && (
          <Card className="mt-8 max-w-xl mx-auto bg-zinc-900 border-zinc-700 text-zinc-100">
            <CardContent className="pt-8">
              {result.success ? (
                <div className="space-y-6">
                  <div className="text-emerald-400 text-2xl font-medium text-center">
                    {result.relay_mode === "client_wallet" ? "Address Resolved" : "Transfer Submitted"}
                  </div>

                  <div className="bg-black/80 p-5 rounded-xl space-y-4 text-zinc-100">
                    <p><strong>To:</strong> {result.name}</p>
                    <p><strong>Amount:</strong> {result.amount} SAL</p>
                    <p className="break-all"><strong>Final Address:</strong><br />{result.final_address}</p>
                    {result.tx_hash && <p className="break-all"><strong>Tx Hash:</strong><br />{result.tx_hash}</p>}
                    {result.fee != null && <p><strong>Fee:</strong> {result.fee}</p>}
                    <p><strong>Status:</strong> {result.relay_mode === "client_wallet" ? "Awaiting send from your wallet" : (result.tx_hash ? "Pending on chain" : "Submitted")}</p>
                  </div>

                  <Button onClick={copyAndSend} className="w-full py-7 text-lg bg-emerald-600 hover:bg-emerald-500">
                    Copy Destination Address
                  </Button>

                  <button
                    type="button"
                    onClick={() => copyText(
                      `To: ${result.name}\nAmount: ${result.amount} SAL\nDestination: ${result.final_address}\n${result.tx_hash ? `Tx Hash: ${result.tx_hash}\n` : ""}Status: ${result.tx_hash ? "Pending on chain" : "Submitted"}`,
                      "GUI send template copied"
                    )}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
                  >
                    Copy GUI Send Template
                  </button>

                  <p className="text-xs text-zinc-300 text-center">
                    The tx has been submitted directly. Use the copied address only if you want to resend manually.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 py-8 text-center">
                  <p className="text-red-400 text-lg">❌ {result.error}</p>
                  {result.hint && <p className="text-sm text-zinc-400">{result.hint}</p>}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
