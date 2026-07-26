// SalPay.qml - .SAL name minting + send-to-name tab
import QtQuick 2.9
import QtQuick.Controls 1.4
import QtQuick.Controls 2.0 as Qt2
import QtQuick.Layouts 1.1
import QtQuick.Dialogs 1.2
import moneroComponents.Wallet 1.0
import moneroComponents.NetworkType 1.0
import moneroComponents.PendingTransaction 1.0
import moneroComponents.TransactionHistoryModel 1.0
import "../components" as MoneroComponents
import "../js/TxUtils.js" as TxUtils
import "../js/Utils.js" as Utils

Rectangle {
    id: root
    color: "transparent"
    readonly property color salBrandGreen: "#00c853"
    readonly property string salNameRuleMessage: "Name must use 1-63 lowercase letters, numbers, or hyphens before .sal, and start/end with a letter or number."

    // Native spendable asset for mint *payment* (fee in SAL1 on mainnet and testnet).
    readonly property string mintPaymentAssetType: "SAL1"
    // PendingTransaction.Status_Ok == 0 (avoid QML enum lookup crashes seen as
    // "ReferenceError: PendingTransaction is not defined" in mint handlers).
    readonly property int pendingTxStatusOk: 0

    property int salpayHeight: mainLayout.height + 80

    property string mintStep: "idle"
    property string mintName: ""
    property var mintQuote: ({})
    property var mintReservation: ({})
    property var mintVerification: ({})
    property var mintJob: ({})
    property var turnstileConfig: ({ loaded: false, enforced_requested: false, enforced_effective: false })
    property bool isProcessing: false
    property string statusMsg: ""
    property string statusTone: "info"
    property string resolvedAddress: ""
    property bool resolveOk: false
    property string resolveError: ""
    property bool mintTickerManual: false
    property var mintTickerSuggestions: []
    property string mintTickerSuggestStatus: ""
    property bool mintAutoTracking: false
    // ListModel so Repeater always paints all free-ticker chips reliably.
    ListModel { id: tickerSuggestModel }
    // Names minted to this wallet's primary address (salpay.org registry).
    ListModel { id: ownedNamesModel }
    property string ownedNamesStatus: ""
    property bool mintAutoExecuteRequested: false
    property string mintAutoTxHash: ""
    property string mintAutoProgressLabel: ""
    property real mintAutoProgressValue: 0.0
    property double mintAutoStartedAtMs: 0
    property string mintAutoLastVerifyError: ""
    property int mintAutoScanCount: 0
    property int mintAutoScanTotal: 0
    property int mintAutoNoTxPolls: 0
    property int mintAutoRejectCount: 0
    property string mintAutoLastScannedHash: ""
    property string mintAutoMatchMode: ""
    property bool mintAutoWalletPaymentSeen: false
    property var mintAutoKnownTxHashes: ({})
    property string mintAssetTypeToRestore: ""
    property real mintPendingBurnAmount: 0
    property string mintBurnTxHash: ""
    // Survives Reset/Cancel so "I already paid" can recover after a mistaken reset.
    property string mintLastPaidTxHash: ""
    property string mintLastPaidName: ""
    property real mintLastPaidFee: 0
    property string mintLastPaidTreasury: ""

    function preferredSalpayApiBase() {
        // Testnet → local policy API; mainnet/stagenet → production.
        try {
            if (typeof NetworkType !== "undefined"
                    && appWindow.persistentSettings.nettype === NetworkType.TESTNET) {
                return "http://127.0.0.1:3001";
            }
        } catch (e) { /* fall through */ }
        return "https://salpay.org";
    }

    function apiBase() {
        return (persistentSettings.salpayApiBase || preferredSalpayApiBase()).replace(/\/$/, "");
    }

    function normName(raw) {
        var n = raw.trim().toLowerCase();
        if (!n.endsWith(".sal")) n = n + ".sal";
        return n;
    }

    function isValidSalName(name) {
        return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sal$/.test(String(name || "").trim().toLowerCase());
    }

    function primaryWalletAddress() {
        if (typeof currentWallet === "undefined" || currentWallet === null) return "";
        try {
            return currentWallet.address(0, 0);
        } catch (e) {
            return "";
        }
    }

    function refreshOwnedNames() {
        ownedNamesModel.clear();
        ownedNamesStatus = "";
        if (!ensureSalpayConfigured()) {
            ownedNamesStatus = qsTr("SalPay not configured.");
            return;
        }
        var addr = primaryWalletAddress();
        if (!addr) {
            ownedNamesStatus = qsTr("Open a wallet to see your minted names.");
            return;
        }
        var obj = null;
        try {
            obj = walletManager.listSalpayNamesByAddress(addr);
        } catch (e) {
            ownedNamesStatus = qsTr("Could not load names: ") + e;
            return;
        }
        if (!obj || !obj.success) {
            ownedNamesStatus = qsTr("Could not load names: ") + String((obj && obj.error) || "unknown");
            return;
        }
        var names = obj.names || [];
        for (var i = 0; i < names.length; i++) {
            var rec = names[i] || {};
            ownedNamesModel.append({
                name: String(rec.name || ""),
                ticker: String(rec.ticker || "")
            });
            if (rec.ticker && typeof appWindow.registerSalpayOwnedAsset === "function")
                appWindow.registerSalpayOwnedAsset(rec.ticker, rec.name);
        }
        if (ownedNamesModel.count === 0)
            ownedNamesStatus = qsTr("No minted names for this wallet yet. Mint one below.");
        else
            ownedNamesStatus = qsTr("%1 name(s) on this wallet. Tickers also appear in the left asset list after refresh.")
                .arg(String(ownedNamesModel.count));
        if (typeof appWindow.syncSalpayOwnedAssetsFromServer === "function")
            appWindow.syncSalpayOwnedAssetsFromServer();
        else if (typeof appWindow.refreshAssetTypesWithSalpay === "function")
            appWindow.refreshAssetTypesWithSalpay();
    }

    function randomIdempotencyKey() {
        return "salpay-" + Date.now() + "-" + Math.floor(Math.random() * 1000000);
    }

    // Salvium create_token rejects asset types starting with "SAL" or equal to BURN.
    function isChainReservedTicker(ticker) {
        var t = String(ticker || "").trim().toUpperCase();
        if (!t) return false;
        if (t === "BURN" || t === "SAL" || t === "SAL1" || t === "SAL2") return true;
        if (t.indexOf("SAL") === 0) return true;
        return false;
    }

    function suggestedTickerFromName(rawName) {
        var n = String(rawName || "").trim().toLowerCase();
        if (!n) return "";
        if (n.endsWith(".sal")) n = n.substring(0, n.length - 4);
        n = n.replace(/[^a-z0-9]/g, "");
        var out = n.substring(0, 4).toUpperCase();
        while (out.length < 4) out += "1234".charAt(out.length);
        // Avoid SAL* (chain reserved for SAL/SAL1/etc.)
        if (isChainReservedTicker(out)) {
            out = ("X" + n.substring(1, 4) + "0").toUpperCase().replace(/[^A-Z0-9]/g, "");
            while (out.length < 4) out += "0";
            out = out.substring(0, 4);
            if (isChainReservedTicker(out))
                out = "XNAM";
        }
        return out;
    }

    function selectedMintTicker() {
        var typed = String(mintTickerInput.text || "").trim().toUpperCase();
        if (typed.length === 0)
            return "";
        return typed;
    }

    // Prefer typed field, then quote ticker, then first free chip — so Start Mint
    // never drops the visible suggestion if the user did not re-click a chip.
    function effectiveMintTicker() {
        var t = String(selectedMintTicker() || "").trim().toUpperCase();
        if (/^[A-Z0-9]{4}$/.test(t))
            return t;
        t = String((mintQuote && mintQuote.ticker) || "").trim().toUpperCase();
        if (/^[A-Z0-9]{4}$/.test(t))
            return t;
        t = String((mintReservation && mintReservation.ticker) || "").trim().toUpperCase();
        if (/^[A-Z0-9]{4}$/.test(t))
            return t;
        if (mintTickerSuggestions && mintTickerSuggestions.length) {
            t = String(mintTickerSuggestions[0] || "").trim().toUpperCase();
            if (/^[A-Z0-9]{4}$/.test(t))
                return t;
        }
        return "";
    }


    // Only server-verified free tickers. Never invent local stems (they ignore the DB).
    function cleanServerFreeTickers(list, maxCount) {
        var cleaned = [];
        var max = maxCount > 0 ? maxCount : 3;
        if (!list || !list.length)
            return cleaned;
        for (var i = 0; i < list.length && cleaned.length < max; i++) {
            var t = String(list[i] || "").trim().toUpperCase();
            if (!/^[A-Z0-9]{4}$/.test(t) || isChainReservedTicker(t))
                continue;
            if (cleaned.indexOf(t) < 0)
                cleaned.push(t);
        }
        return cleaned;
    }

    function applyTickerSuggestionList(list, autoFill, statusMsg, forceFill) {
        var cleaned = cleanServerFreeTickers(list, 3);
        mintTickerSuggestions = cleaned;

        tickerSuggestModel.clear();
        for (var i = 0; i < cleaned.length; i++) {
            tickerSuggestModel.append({ "ticker": cleaned[i] });
        }

        var current = String(mintTickerInput.text || "").trim().toUpperCase();
        var currentIsFreeChip = cleaned.indexOf(current) >= 0;
        if (cleaned.length === 0) {
            mintTickerInput.text = "";
            mintTickerManual = false;
        } else if ((autoFill || forceFill) && (forceFill || !mintTickerManual || !currentIsFreeChip || isChainReservedTicker(current))) {
            mintTickerInput.text = cleaned[0];
            mintTickerManual = true;
        }
        mintTickerSuggestStatus = statusMsg ? String(statusMsg) : "";
    }

    function refreshTickerSuggestions() {
        var raw = mintNameInput.text;
        if (!raw || raw.trim().length < 1) {
            mintTickerSuggestions = [];
            tickerSuggestModel.clear();
            mintTickerSuggestStatus = "";
            if (!mintTickerManual)
                mintTickerInput.text = "";
            return;
        }

        var name = normName(raw);
        if (!isValidSalName(name)) {
            tickerSuggestModel.clear();
            mintTickerSuggestions = [];
            mintTickerSuggestStatus = qsTr("Enter a valid .sal name for free tickers.");
            // Never fill a local natural stem (often already taken, e.g. TEST).
            if (!mintTickerManual)
                mintTickerInput.text = "";
            return;
        }

        if (!ensureSalpayConfigured()) {
            applyTickerSuggestionList([], false, qsTr("API offline — cannot verify free tickers."), true);
            return;
        }

        // C++ HTTP — QML XMLHttpRequest to salpay.org is blocked ("input sanitization").
        mintTickerSuggestStatus = qsTr("Checking free tickers against registry…");
        var obj = null;
        try {
            obj = walletManager.getMintTickerSuggestions(name, 5);
        } catch (eSug) {
            console.log("getMintTickerSuggestions failed: " + eSug);
            applyTickerSuggestionList([], false, qsTr("Could not verify free tickers. Check API and retry."), true);
            return;
        }

        if (obj && obj.success) {
            var pref = String(obj.preferred_ticker || obj.suggested_ticker || "").trim().toUpperCase();
            var freeList = obj.available_ticker_suggestions || [];
            if (pref) {
                var reordered = [pref];
                for (var ri = 0; ri < freeList.length; ri++) {
                    var ft = String(freeList[ri] || "").toUpperCase();
                    if (ft && ft !== pref)
                        reordered.push(ft);
                }
                freeList = reordered;
            }
            var statusMsg = "";
            if (obj.desired_ticker && obj.desired_available === false) {
                statusMsg = obj.desired_owner
                    ? qsTr("%1 is used by %2 — free: %3")
                        .arg(String(obj.desired_ticker))
                        .arg(String(obj.desired_owner))
                        .arg(pref || (freeList[0] || "—"))
                    : qsTr("%1 is taken — using free %2")
                        .arg(String(obj.desired_ticker))
                        .arg(pref || (freeList[0] || "—"));
            } else if (pref) {
                statusMsg = qsTr("Free ticker %1 (registry verified).").arg(pref);
            } else {
                statusMsg = qsTr("No free tickers found for this name.");
            }
            mintTickerManual = false;
            applyTickerSuggestionList(freeList, true, statusMsg, true);
            return;
        }

        applyTickerSuggestionList(
            [],
            false,
            qsTr("Could not verify free tickers: %1").arg(String((obj && obj.error) || "API error")),
            true
        );
    }

    function pickSuggestedTicker(ticker) {
        var t = String(ticker || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{4}$/.test(t))
            return;
        if (isChainReservedTicker(t)) {
            setStatus(qsTr("Ticker %1 is reserved by Salvium (cannot start with SAL). Pick another free chip.").arg(t), "error");
            return;
        }
        mintTickerManual = true;
        mintTickerInput.text = t;
        // Keep quote/reservation objects aligned so Start Mint does not need a re-click.
        if (mintQuote && typeof mintQuote === "object")
            mintQuote.ticker = t;
        if (mintReservation && typeof mintReservation === "object" && mintReservation.ticker)
            mintReservation.ticker = t;
        setStatus(qsTr("Ticker set to %1").arg(t), "ok");
    }

    function prepareWalletForMintPayment() {
        if (typeof currentWallet === "undefined" || !currentWallet)
            return { ok: false, error: "Open a wallet before paying mint fee." };

        // Clears stale spent outputs that cause daemon double-spend rejects.
        try {
            if (typeof currentWallet.rescanSpent === "function") {
                var ok = currentWallet.rescanSpent();
                console.log("SalPay mint: rescanSpent => " + ok);
            }
        } catch (e) {
            console.log("SalPay mint: rescanSpent failed: " + e);
        }

        try {
            if (currentWallet.history && typeof currentWallet.history.refresh === "function")
                currentWallet.history.refresh(currentWallet.currentSubaddressAccount);
        } catch (e2) {
            console.log("SalPay mint: history.refresh failed: " + e2);
        }

        return { ok: true };
    }

    function ensureSalpayConfigured() {
        // Match Transfer.qml: pin localhost only on testnet; never stomp mainnet → local.
        var preferred = preferredSalpayApiBase();
        var base = String((persistentSettings.salpayApiBase || preferred)).trim();
        if (base.length === 0)
            base = preferred;

        try {
            if (typeof NetworkType !== "undefined"
                    && appWindow.persistentSettings.nettype === NetworkType.TESTNET) {
                base = preferred;
            } else if (typeof NetworkType !== "undefined"
                    && appWindow.persistentSettings.nettype === NetworkType.MAINNET
                    && (base.indexOf("127.0.0.1") >= 0 || base.indexOf("localhost") >= 0)) {
                // Heal accidental localhost pin left over from testnet sessions.
                base = preferred;
            }
        } catch (e2) { /* keep base */ }

        persistentSettings.salpayApiBase = base;
        if (!persistentSettings.salpayEnabled)
            persistentSettings.salpayEnabled = true;
        walletManager.setSalpayApiBase(base);
        if (!walletManager.salpayEnabled())
            walletManager.setSalpayEnabled(true);
        return walletManager.salpayEnabled() && walletManager.salpayApiBase()
            && walletManager.salpayApiBase().trim().length > 0;
    }

    function setStatus(msg, tone) {
        statusMsg = msg || "";
        statusTone = tone || "info";
    }

    function statusColor() {
        if (statusTone === "ok") return "#00c853";
        if (statusTone === "error") return "#ff4444";
        return MoneroComponents.Style.dimmedFontColor;
    }

    function setMintProgress(label, value) {
        mintAutoProgressLabel = label || "";
        mintAutoProgressValue = Math.max(0, Math.min(1, Number(value || 0)));
    }

    function rememberPaidMintTx(hash, fee, treasury, name) {
        var h = String(hash || "").trim();
        if (!h)
            return;
        mintLastPaidTxHash = h;
        mintLastPaidFee = Number(fee || 0);
        mintLastPaidTreasury = String(treasury || "").trim();
        mintLastPaidName = String(name || mintName || "").trim();
    }

    function applyResumableReservation(obj) {
        // Server 409 already_reserved now returns fee/treasury so we can pay the
        // existing session instead of fighting "conflict".
        if (!obj || !obj.reservation_id)
            return false;
        var feeVal = obj.fee;
        if (feeVal === undefined || feeVal === null || feeVal === "")
            feeVal = mintReservation.fee || mintQuote.fee || mintLastPaidFee || 0;
        var treas = String(obj.treasury_address || mintReservation.treasury_address || mintQuote.treasury_address || mintLastPaidTreasury || "").trim();
        var outs = obj.payment_outputs || mintReservation.payment_outputs || [];
        if ((!outs || outs.length === 0) && treas && Number(feeVal) > 0) {
            outs = [{ role: "treasury", kind: "transfer", address: treas, amount: Number(feeVal) }];
        }
        mintReservation = {
            reservation_id: String(obj.reservation_id || ""),
            name: String(obj.name || mintName || ""),
            ticker: String(obj.ticker || selectedMintTicker() || ""),
            fee: feeVal,
            treasury_address: treas,
            payment_outputs: outs,
            expires_at: String(obj.expires_at || ""),
            payment_mode: String(obj.payment_mode || "full_treasury")
        };
        mintQuote = mintReservation;
        mintName = String(mintReservation.name || mintName || "");
        if (mintReservation.ticker)
            mintTickerInput.text = String(mintReservation.ticker).toUpperCase();
        verifyAmountInput.text = String(mintReservation.fee || "");
        mintStep = "reserved";
        // Keep last paid hash; do not wipe it on resume. Clear stuck auto-pay lock.
        mintAutoTracking = false;
        mintAutoExecuteRequested = false;
        mintPendingBurnAmount = 0;
        mintBurnTxHash = "";
        mintAutoStartedAtMs = Date.now();
        mintAutoLastVerifyError = "";
        mintAutoScanCount = 0;
        mintAutoNoTxPolls = 0;
        mintAutoRejectCount = 0;
        mintAutoMatchMode = "";
        mintAutoPollTimer.stop();
        setMintProgress("Existing reservation resumed. Pay once or scan if already paid.", 0.2);
        return true;
    }

    function resetMintAutomation() {
        mintAutoTracking = false;
        mintAutoExecuteRequested = false;
        // Preserve mintAutoTxHash into last-paid memory before clearing session fields.
        if (mintAutoTxHash !== "")
            rememberPaidMintTx(mintAutoTxHash, mintReservation.fee || mintQuote.fee, mintReservation.treasury_address, mintName);
        mintAutoTxHash = "";
        mintPendingBurnAmount = 0;
        mintBurnTxHash = "";
        mintAutoStartedAtMs = 0;
        mintAutoLastVerifyError = "";
        mintAutoScanCount = 0;
        mintAutoScanTotal = 0;
        mintAutoNoTxPolls = 0;
        mintAutoRejectCount = 0;
        mintAutoLastScannedHash = "";
        mintAutoMatchMode = "";
        mintAutoWalletPaymentSeen = false;
        mintAutoKnownTxHashes = ({})
        setMintProgress("", 0);
        mintAutoPollTimer.stop();
        restoreMintPaymentAssetIfNeeded();
    }

    function isPendingTransactionOk(pendingTransaction) {
        if (!pendingTransaction)
            return false;
        // Prefer enum when available; fall back to numeric Status_Ok (0).
        try {
            if (typeof PendingTransaction !== "undefined"
                    && PendingTransaction
                    && PendingTransaction.Status_Ok !== undefined) {
                return pendingTransaction.status === PendingTransaction.Status_Ok;
            }
        } catch (e) {
            // ignore and use numeric fallback
        }
        return Number(pendingTransaction.status) === pendingTxStatusOk;
    }

    function getMintUnlockedBalanceAtomic() {
        if (typeof currentWallet === "undefined" || !currentWallet)
            return 0;
        try {
            // Always measure mint affordability in the native payment asset,
            // not whatever token is currently selected in the left panel.
            return currentWallet.unlockedBalance(mintPaymentAssetType);
        } catch (e) {
            try {
                return appWindow.getUnlockedBalance();
            } catch (e2) {
                return 0;
            }
        }
    }

    function ensureMintPaymentAssetSelected() {
        var desired = mintPaymentAssetType;
        var current = "";
        try {
            current = String(appWindow.persistentSettings.assetType || "");
        } catch (e) {
            current = "";
        }
        if (current === desired) {
            mintAssetTypeToRestore = "";
            return desired;
        }
        mintAssetTypeToRestore = current;
        try {
            appWindow.persistentSettings.assetType = desired;
            console.log("SalPay mint: forced payment asset to " + desired
                        + " (was " + current + "; will restore after mint payment)");
        } catch (e2) {
            console.log("SalPay mint: could not set assetType to " + desired + ": " + e2);
        }
        return desired;
    }

    function restoreMintPaymentAssetIfNeeded() {
        if (!mintAssetTypeToRestore || mintAssetTypeToRestore === "")
            return;
        var restoreTo = mintAssetTypeToRestore;
        mintAssetTypeToRestore = "";
        try {
            if (String(appWindow.persistentSettings.assetType || "") !== restoreTo) {
                appWindow.persistentSettings.assetType = restoreTo;
                console.log("SalPay mint: restored payment asset to " + restoreTo);
            }
        } catch (e) {
            console.log("SalPay mint: could not restore assetType: " + e);
        }
    }

    function stopMintAutomationFromWalletFailure(message) {
        mintAutoTracking = false;
        mintAutoPollTimer.stop();
        mintAutoTxHash = "";
        mintAutoWalletPaymentSeen = false;
        restoreMintPaymentAssetIfNeeded();
        setMintProgress("Mint payment was not sent. Fix the wallet error, then click Pay From Wallet again.", 0.2);
        setStatus("Mint payment was not sent: " + String(message || "Unknown wallet error"), "error");
    }

    function handleMintWalletTransactionCreated(pendingTransaction) {
        if (!mintAutoTracking || mintStep !== "reserved" || !pendingTransaction)
            return;

        if (!isPendingTransactionOk(pendingTransaction)) {
            var err = "";
            try { err = pendingTransaction.errorString; } catch (e) { err = ""; }
            stopMintAutomationFromWalletFailure(err || "Wallet could not create the payment transaction");
            return;
        }

        var txCount = 0;
        try { txCount = Number(pendingTransaction.txCount || 0); } catch (e2) { txCount = 0; }
        if (txCount === 0)
            stopMintAutomationFromWalletFailure("Wallet did not create a payment transaction");
    }

    function handleMintWalletTransactionCommitted(success, transaction, txid) {
        if (!mintAutoTracking || mintStep !== "reserved")
            return;

        if (!success) {
            stopMintAutomationFromWalletFailure(transaction && transaction.errorString
                ? transaction.errorString
                : "Wallet rejected the payment transaction");
            return;
        }

        mintAutoWalletPaymentSeen = true;
        if (txid && txid.length > 0) {
            var committedHash = String(txid[0] || "").trim();
            if (committedHash !== "") {
                // First commit = treasury transfer; optional second = protocol burn.
                if (mintAutoTxHash === "" || mintPendingBurnAmount <= 0) {
                    mintAutoTxHash = committedHash;
                    rememberPaidMintTx(committedHash, mintReservation.fee || mintQuote.fee,
                                      mintReservation.treasury_address, mintName);
                } else if (mintBurnTxHash === "") {
                    mintBurnTxHash = committedHash;
                }
                if (mintAutoKnownTxHashes)
                    mintAutoKnownTxHashes[committedHash] = true;
            }
        }

        // Mainnet 50/50 policy: after treasury transfer, open protocol BURN for the burn half.
        if (mintPendingBurnAmount > 0 && mintBurnTxHash === "" && mintAutoTxHash !== "") {
            setMintProgress("Step 2/2: approve protocol BURN for burn half...", 0.55);
            setStatus(
                "Treasury transfer submitted. Next: burn "
                    + String(mintPendingBurnAmount) + " " + mintPaymentAssetType
                    + " via protocol BURN (verifiable). Approve the next popup.",
                "info"
            );
            try {
                if (typeof currentWallet.createBurnTransactionAsync === "function") {
                    currentWallet.createBurnTransactionAsync(
                        String(mintPendingBurnAmount),
                        15,
                        0
                    );
                    return;
                }
            } catch (e) {
                console.log("SalPay mint burn start failed: " + e);
            }
            setStatus(
                "Treasury paid, but this wallet build cannot open protocol BURN automatically. "
                    + "Run CLI: burn " + String(mintPendingBurnAmount) + " SAL1 — then paste burn_tx_hash in website, or rebuild GUI with burn support.",
                "error"
            );
        }

        restoreMintPaymentAssetIfNeeded();
        setMintProgress("Wallet payment submitted. Waiting for it to appear in wallet history...", 0.4);
        setStatus("Mint payment submitted. Verifying automatically once wallet history updates.", "info");
    }

    function collectRecentTxHashes(limitRows) {
        var known = {};
        if (typeof currentWallet === "undefined" || !currentWallet || typeof currentWallet.historyModel === "undefined")
            return known;

        var model = currentWallet.historyModel;
        if (!model || typeof model.rowCount !== "function")
            return known;

        var total = model.rowCount();
        var cap = Math.min(Math.max(1, Number(limitRows || 200)), total);
        for (var row = 0; row < cap; row++) {
            var idxHead = model.index(row, 0);
            var hashHead = String(model.data(idxHead, TransactionHistoryModel.TransactionHashRole) || "").trim();
            if (hashHead)
                known[hashHead] = true;

            var tailRow = total - 1 - row;
            if (tailRow === row)
                continue;

            var idxTail = model.index(tailRow, 0);
            var hashTail = String(model.data(idxTail, TransactionHistoryModel.TransactionHashRole) || "").trim();
            if (hashTail)
                known[hashTail] = true;
        }
        return known;
    }

    function txTimestampMs(rawValue) {
        if (!rawValue)
            return 0;
        if (typeof rawValue.getTime === "function")
            return rawValue.getTime();
        var parsed = Date.parse(rawValue);
        return isFinite(parsed) ? parsed : 0;
    }

    function sendButtonReason() {
        if (sendNameInput.text.trim().length === 0)
            return qsTr("Enter a .SAL name.");
        if (!resolveOk)
            return resolveError ? resolveError : qsTr("Looking up name…");
        if (sendAmountInput.text.trim().length === 0)
            return qsTr("Enter an amount to enable Send.");
        return qsTr("Ready to send.");
    }

    function resolveName(name) {
        resolvedAddress = "";
        resolveOk = false;
        resolveError = "";
        var n = String(name || "").trim().toLowerCase();
        if (!n.endsWith(".sal"))
            n += ".sal";
        if (!isValidSalName(n)) {
            resolveError = salNameRuleMessage;
            return;
        }

        if (!ensureSalpayConfigured()) {
            resolveError = qsTr("SalPay API not configured (set mainnet + https://salpay.org).");
            return;
        }

        // 1) Resolve minted names (only minted names are sendable).
        var obj = null;
        try {
            obj = walletManager.resolveSalpayName(n);
        } catch (eRes) {
            resolveError = qsTr("Resolve failed: %1").arg(String(eRes));
            return;
        }

        if (obj && obj.success && obj.resolved_address) {
            resolvedAddress = String(obj.resolved_address).trim();
            resolveOk = resolvedAddress.length > 0;
            resolveError = resolveOk ? "" : qsTr("Name has no address on file.");
            return;
        }

        // 2) Not minted — explain reserved vs free (never leave "Resolving…").
        var st = null;
        try {
            if (typeof walletManager.checkSalpayName === "function")
                st = walletManager.checkSalpayName(n);
        } catch (eSt) {
            st = null;
        }

        if (st && st.success) {
            if (st.minted) {
                resolveError = qsTr("Name is minted but resolve failed — retry in a moment.");
                return;
            }
            if (st.reserved) {
                resolveError = qsTr("Name is reserved — mint not finished. Use Finish incomplete mint below (not Send).");
                // Auto-open recovery so users are not stuck with no buttons.
                finishIncompleteMint(n, String(st.reservation_id || ""));
                return;
            }
            if (st.available) {
                resolveError = qsTr("Name is not registered. Mint it below first, then send.");
                return;
            }
        }

        var apiErr = (obj && obj.error) ? String(obj.error) : "";
        if (apiErr.toLowerCase().indexOf("not found") >= 0 || apiErr === "")
            resolveError = qsTr("Name not registered (not minted yet). Use Mint below first.");
        else
            resolveError = apiErr;
    }


    function refreshTurnstileConfig() {
        turnstileConfig = {
            loaded: true,
            enforced_requested: false,
            enforced_effective: false
        };
    }

    function requestMintQuote() {
        if (!ensureSalpayConfigured()) {
            setStatus("Salpay integration not configured", "error");
            return;
        }
        var name = normName(mintNameInput.text);
        if (!isValidSalName(name)) {
            setStatus(salNameRuleMessage, "error");
            return;
        }

        mintName = name;
        isProcessing = true;
        setStatus("Getting quote…", "info");
        var primary = primaryWalletAddress();
        // Only send ticker if user explicitly picked a free chip; otherwise server
        // assigns a free one (avoids locking taken stems like TEST).
        var tickerArg = "";
        if (mintTickerManual) {
            var typed = selectedMintTicker();
            if (/^[A-Z0-9]{4}$/.test(typed) && mintTickerSuggestions.indexOf(typed) >= 0)
                tickerArg = typed;
        }
        var obj = walletManager.getMintQuote(name, primary || "", tickerArg);
        isProcessing = false;

        // Reserved name: API returns success+resumable (or 409 with reservation fields).
        if (obj && !obj.success && (obj.resumable || obj.reservation_id) && obj.fee != null) {
            if (applyResumableReservation(obj)) {
                refreshTickerSuggestions();
                setStatus(
                    "Name already reserved — resumed session. Fee "
                        + String(mintReservation.fee) + " SAL1. Pay From Wallet or I already paid — scan.",
                    "ok"
                );
                return;
            }
        }

        // Live server may still say "already minted on authoritative source" for an
        // active *reservation* (not minted). Recover via reserve 409 → quote-by-id.
        if (obj && !obj.success) {
            var qErr = String(obj.error || "").toLowerCase();
            if (qErr.indexOf("reserved") >= 0
                    || qErr.indexOf("authoritative") >= 0
                    || qErr.indexOf("already minted") >= 0
                    || qErr.indexOf("conflict") >= 0) {
                var rebind = walletManager.createMintReservation(name, primary || "", tickerArg || selectedMintTicker());
                var rid = String((rebind && rebind.reservation_id) || (obj.reservation_id) || "").trim();
                if (rebind && rebind.success) {
                    // Unexpected free slot — treat as normal reserve result after quote.
                    if (validateMintRouting(rebind, "mint")) {
                        mintReservation = rebind;
                        mintQuote = rebind;
                        mintStep = "reserved";
                        verifyAmountInput.text = String(rebind.fee || "");
                        if (rebind.ticker)
                            mintTickerInput.text = String(rebind.ticker).toUpperCase();
                        applyTickerSuggestionList([rebind.ticker], true, "", true);
                        setStatus("Session ready. Fee " + String(rebind.fee) + " SAL1 — Pay From Wallet.", "ok");
                        return;
                    }
                }
                if (rid) {
                    var byId = walletManager.getMintQuoteByReservation(rid);
                    if (byId && byId.success) {
                        if (!byId.reservation_id)
                            byId.reservation_id = rid;
                        applyResumableReservation(byId);
                        applyTickerSuggestionList(
                            byId.ticker ? [byId.ticker] : [],
                            true,
                            qsTr("Resumed reserved name."),
                            true
                        );
                        setStatus(
                            "Name is reserved (not failed). Fee "
                                + String(byId.fee) + " SAL1 locked. Pay once or I already paid — scan.",
                            "ok"
                        );
                        return;
                    }
                    // Minimal resume so chips/pay still work while fee is refreshed later.
                    applyResumableReservation({
                        reservation_id: rid,
                        name: name,
                        ticker: selectedMintTicker() || "DEEP",
                        fee: obj.fee,
                        treasury_address: obj.treasury_address,
                        expires_at: rebind && rebind.expires_at ? rebind.expires_at : obj.expires_at
                    });
                    refreshTickerSuggestions();
                    setStatus(
                        "Name is reserved. Click Start Mint / Pay From Wallet. Reservation: "
                            + rid.substring(0, 8) + "…",
                        "ok"
                    );
                    return;
                }
            }
        }

        if (obj.success) {
            if (!validateMintRouting(obj, "quote"))
                return;
            // Resumable quote with reservation_id = jump straight to reserved pay step.
            if (obj.resumable && obj.reservation_id) {
                applyResumableReservation(obj);
                var freeR = obj.available_ticker_suggestions || [obj.ticker];
                applyTickerSuggestionList(freeR, true, qsTr("Reserved session — ticker locked."), true);
                setStatus(
                    "Resumed reserved mint: " + String(obj.ticker || "")
                        + " · " + String(obj.fee) + " SAL1. Pay once (do not Start Mint twice).",
                    "ok"
                );
                return;
            }
            mintQuote = obj;
            mintStep = "quote";
            resetMintAutomation();
            var freeList = obj.available_ticker_suggestions || [];
            var lockedTicker = String(obj.ticker || obj.preferred_ticker || "").trim().toUpperCase();
            if (lockedTicker && freeList.indexOf(lockedTicker) < 0)
                freeList = [lockedTicker].concat(freeList);
            mintTickerManual = false;
            applyTickerSuggestionList(freeList, true, "", true);
            if (/^[A-Z0-9]{4}$/.test(lockedTicker)) {
                mintTickerInput.text = lockedTicker;
                mintTickerManual = true;
                mintQuote.ticker = lockedTicker;
            }
            var feeNote = "";
            var feeNum = Number(obj.fee || 0);
            if (walletNetworkName() === "mainnet") {
                if (feeNum >= 700)
                    feeNote = " · short-name tier (~$35–$50)";
                else if (feeNum >= 300)
                    feeNote = " · standard tier (~$20)";
            } else {
                if (feeNum >= 2000)
                    feeNote = " · short-name tier";
                else if (feeNum >= 500)
                    feeNote = " · mid-length tier";
            }
            var note = String(obj.note || "");
            setStatus(
                "Ready: " + lockedTicker
                    + " · " + String(obj.fee) + " SAL1" + feeNote
                    + (note.indexOf("used by") >= 0 ? (" · " + note) : "")
                    + ". Click Start Mint.",
                "ok"
            );
        } else {
            var quoteError = String(obj.error || "Unknown error");
            var quoteStatusCode = Number(obj.status_code || 0);
            if (quoteStatusCode === 409 && quoteError.toLowerCase().indexOf("already minted") >= 0) {
                mintStep = "idle";
                resolveName(name);
                setStatus("This name is already minted. Use Send to resolve it instead of minting again.", "ok");
                return;
            }
            if (quoteStatusCode === 409 && quoteError.toLowerCase().indexOf("ticker") >= 0) {
                var alts = obj.available_ticker_suggestions || [];
                var pref = String(obj.preferred_ticker || "").toUpperCase();
                if (pref && alts.indexOf(pref) < 0)
                    alts = [pref].concat(alts);
                mintTickerManual = false;
                if (alts && alts.length)
                    applyTickerSuggestionList(alts, true, "", true);
                setStatus(
                    quoteError
                        + (pref ? (". Switched to free " + pref + " — click Quote again.") : ". Pick a free chip."),
                    "error"
                );
                return;
            }
            setStatus("Quote failed: " + quoteError, "error");
        }
    }

    // Known payment from this session (deeppamp recovery) — prefill so user never hunts the hash.
    readonly property string knownRecoveryPaymentTx: "a4ca37d2b811c4a3cfb13a8d4b7375ac948daa7c2516bda71d3f192c1c121aba"

    function finishIncompleteMint(name, reservationIdHint) {
        var n = normName(name || mintNameInput.text || mintName || "");
        if (!isValidSalName(n))
            return false;
        mintNameInput.text = n.replace(/\.sal$/, "");
        mintName = n;
        if (mintLastPaidTxHash === "" && knownRecoveryPaymentTx !== "")
            mintLastPaidTxHash = knownRecoveryPaymentTx;
        // Prefer explicit resume (registry rid → quote-by-id → pay panel).
        if (resumeReservedName(n, selectedMintTicker() || "DEEP")) {
            if (mintLastPaidTxHash !== "")
                verifyTxHashInput.text = mintLastPaidTxHash;
            if (mintReservation.fee)
                verifyAmountInput.text = String(mintReservation.fee);
            setStatus(
                qsTr("Incomplete mint for %1. Pay only if you have NOT paid yet. If you already paid, paste tx (or use saved hash) and click Verify payment → Complete mint.")
                    .arg(n),
                "ok"
            );
            return true;
        }
        if (reservationIdHint) {
            var byId = walletManager.getMintQuoteByReservation(String(reservationIdHint));
            if (byId && byId.success) {
                if (!byId.reservation_id)
                    byId.reservation_id = reservationIdHint;
                applyResumableReservation(byId);
                if (mintLastPaidTxHash !== "")
                    verifyTxHashInput.text = mintLastPaidTxHash;
                setStatus(qsTr("Resumed reservation. Use Verify payment if you already paid."), "ok");
                return true;
            }
        }
        return false;
    }

    function resumeReservedName(name, preferredTicker) {
        // Recover pay session when server says conflict/reserved/false "minted".
        var rid = "";
        try {
            if (typeof walletManager.checkSalpayName === "function") {
                var st = walletManager.checkSalpayName(name);
                if (st && st.reservation_id)
                    rid = String(st.reservation_id);
                if (st && st.minted && !st.reserved) {
                    resolveName(name);
                    setStatus(qsTr("Name is already minted. Use Send to pay it."), "ok");
                    return true;
                }
            }
        } catch (e1) { console.log("checkSalpayName: " + e1); }

        if (!rid)
            return false;

        var byId = null;
        try {
            byId = walletManager.getMintQuoteByReservation(rid);
        } catch (e2) {
            console.log("getMintQuoteByReservation: " + e2);
        }
        if (byId && byId.success) {
            if (!byId.reservation_id)
                byId.reservation_id = rid;
            applyResumableReservation(byId);
            if (byId.ticker)
                mintTickerInput.text = String(byId.ticker).toUpperCase();
            applyTickerSuggestionList(byId.ticker ? [byId.ticker] : [], true, qsTr("Reserved — pay to finish."), true);
            setStatus(
                qsTr("Server had an open reservation (not a hard failure). Pay %1 SAL1 once — then mint completes.")
                    .arg(String(byId.fee || "—")),
                "ok"
            );
            return true;
        }

        // Last resort: bind id then refresh fee/treasury from server.
        applyResumableReservation({
            reservation_id: rid,
            name: name,
            ticker: preferredTicker || selectedMintTicker() || "",
            fee: mintQuote.fee || mintLastPaidFee || 0,
            treasury_address: mintQuote.treasury_address || mintLastPaidTreasury || ""
        });
        ensureReservationPayable();
        if (getExpectedPaymentOutputs().length > 0) {
            setStatus(qsTr("Resumed reservation. Pay %1 SAL1 once.")
                .arg(String(mintReservation.fee || "—")), "ok");
            return true;
        }
        setStatus(qsTr("Name is reserved (%1…). Wait a few seconds and click Start Mint again.")
            .arg(rid.substring(0, 8)), "error");
        return true;
    }

    function startMintFromQuote() {
        if (!ensureSalpayConfigured()) {
            setStatus("Salpay integration not configured", "error");
            return;
        }
        var name = normName(mintNameInput.text);
        var primary = primaryWalletAddress();
        if (!isValidSalName(name)) {
            setStatus(salNameRuleMessage, "error");
            return;
        }
        if (!primary) {
            setStatus("Wallet primary address unavailable. Open a wallet first.", "error");
            return;
        }

        mintName = name;
        var tickerToUse = effectiveMintTicker();
        if (!/^[A-Z0-9]{4}$/.test(tickerToUse)) {
            setStatus("Pick a free 4-character ticker chip (or type one) before starting mint.", "error");
            return;
        }
        if (isChainReservedTicker(tickerToUse)) {
            setStatus(
                "Ticker " + tickerToUse + " is reserved by Salvium (cannot start with SAL). "
                    + "Pick a free chip that does not start with SAL.",
                "error"
            );
            refreshTickerSuggestions();
            return;
        }
        mintTickerInput.text = tickerToUse;
        mintTickerManual = true;

        // If already reserved on server, skip create and go straight to pay.
        if (resumeReservedName(name, tickerToUse))
            return;

        isProcessing = true;
        setStatus("Preparing mint payment for ticker " + tickerToUse + "...", "info");
        var obj = walletManager.createMintReservation(
            name,
            primary,
            tickerToUse
        );
        isProcessing = false;

        if (obj.success) {
            if (!validateMintRouting(obj, "mint"))
                return;
            mintReservation = obj;
            mintQuote = obj;
            if (obj.ticker)
                mintTickerInput.text = String(obj.ticker).toUpperCase();
            verifyAmountInput.text = String(obj.fee || "");
            mintStep = "reserved";
            resetMintAutomation();
            setMintProgress("Mint session ready. Click Pay From Wallet (or Reset mint to cancel).", 0.2);
            setStatus(
                "Mint payment ready for " + String(obj.ticker || tickerToUse)
                    + " · fee " + String(obj.fee) + " SAL1. Click Pay From Wallet.",
                "ok"
            );
        } else {
            var reserveError = String(obj.error || "Unknown error");
            var reserveId = String(obj.reservation_id || "");
            var reserveStatusCode = Number(obj.status_code || 0);

            // Live bug: reserved names returned as "already minted on authoritative source".
            if (reserveStatusCode === 409
                    && (reserveError.toLowerCase().indexOf("already minted") >= 0
                        || reserveError.toLowerCase().indexOf("authoritative") >= 0
                        || reserveError.toLowerCase().indexOf("conflict") >= 0
                        || reserveError.toLowerCase().indexOf("reserved") >= 0)) {
                if (resumeReservedName(name, tickerToUse))
                    return;
                // Truly minted?
                try {
                    var st2 = walletManager.checkSalpayName(name);
                    if (st2 && st2.minted && !st2.reserved) {
                        resolveName(name);
                        setStatus("Name is already minted. Use Send.", "ok");
                        return;
                    }
                } catch (eM) {}
            }

            if (reserveStatusCode === 409 && reserveError.toLowerCase().indexOf("already minted") >= 0) {
                resolveName(name);
                setStatus("Name is already minted. It likely succeeded earlier. Try resolving/sending to it instead of minting again.", "ok");
                return;
            }

            if (reserveStatusCode === 409 && reserveError.toLowerCase().indexOf("ticker is already taken") >= 0) {
                mintStep = "idle";
                refreshTickerSuggestions();
                var rAlts = obj.available_ticker_suggestions || mintTickerSuggestions || [];
                if (rAlts && rAlts.length) {
                    applyTickerSuggestionList(rAlts, true);
                    // Auto-select first free chip so user does not re-click.
                    mintTickerInput.text = String(rAlts[0]).toUpperCase();
                    mintTickerManual = true;
                }
                setStatus(
                    "Ticker " + tickerToUse + " is already used by another name"
                        + (rAlts && rAlts.length
                            ? (". Switched to free ticker " + String(rAlts[0]).toUpperCase() + " — click Start Mint again.")
                            : ". Pick another free chip and try again."),
                    "error"
                );
                return;
            }

            // Name already reserved (often from a double Start Mint click). Prefer resume
            // over release when we can recover fee/treasury from quote-by-reservation-id.
            if (reserveStatusCode === 409
                    && (reserveError.toLowerCase().indexOf("already reserved") >= 0
                        || (reserveId && reserveError.toLowerCase().indexOf("reserved") >= 0)
                        || obj.resumable === true)) {
                // Prefer server-provided locked fee/treasury (resumable 409 body).
                if (reserveId && (obj.fee != null || obj.treasury_address || obj.resumable === true)) {
                    if (applyResumableReservation(obj)) {
                        setStatus(
                            "Name was already reserved (not a failure). Pay "
                                + String(mintReservation.fee) + " SAL1 once — or use “I already paid — scan”. "
                                + "Do not Start Mint again.",
                            "ok"
                        );
                        return;
                    }
                }
                if (reserveId) {
                    try {
                        var resumeQuote = walletManager.getMintQuoteByReservation(reserveId);
                        if (resumeQuote && resumeQuote.success) {
                            if (!resumeQuote.reservation_id)
                                resumeQuote.reservation_id = reserveId;
                            applyResumableReservation(resumeQuote);
                            setStatus(
                                "Resumed existing reservation. Pay "
                                    + String(resumeQuote.fee) + " SAL1 once — do not Start Mint again.",
                                "ok"
                            );
                            return;
                        }
                    } catch (eResume) {
                        console.log("resume reservation failed: " + eResume);
                    }

                    // Only release if we have NOT already paid (avoid orphaning a paid session).
                    if (mintLastPaidTxHash !== "" || mintAutoTxHash !== "") {
                        setStatus(
                            "Name is reserved and a payment may already exist (tx "
                                + (mintAutoTxHash || mintLastPaidTxHash).substring(0, 12) + "…). "
                                + "Click “I already paid — scan” — do NOT reset or release.",
                            "error"
                        );
                        if (applyResumableReservation({
                                reservation_id: reserveId,
                                name: name,
                                ticker: tickerToUse,
                                fee: obj.fee,
                                treasury_address: obj.treasury_address,
                                payment_outputs: obj.payment_outputs,
                                expires_at: obj.expires_at
                            })) {
                            return;
                        }
                    }

                    setStatus("Found an existing mint session. Replacing it with a fresh session...", "info");
                    var releaseObj = walletManager.releaseMintReservation(reserveId);
                    if (!releaseObj.success) {
                        setStatus(
                            "Name is already reserved (id "
                                + reserveId
                                + "). Use Pay From Wallet / I already paid if fee is shown, or wait for expiry.",
                            "error"
                        );
                        return;
                    }

                    var retryObj = walletManager.createMintReservation(name, primary, tickerToUse);
                    if (retryObj.success) {
                        if (!validateMintRouting(retryObj, "mint"))
                            return;
                        mintReservation = retryObj;
                        mintQuote = retryObj;
                        if (retryObj.ticker)
                            mintTickerInput.text = String(retryObj.ticker).toUpperCase();
                        verifyAmountInput.text = String(retryObj.fee || "");
                        mintStep = "reserved";
                        resetMintAutomation();
                        setMintProgress("Fresh mint session ready. Click Pay From Wallet.", 0.2);
                        setStatus("Replaced stale mint session and prepared a fresh payment.", "ok");
                        return;
                    }

                    setStatus("Mint setup failed after replacing stale session: " + String(retryObj.error || "Unknown error"), "error");
                    return;
                }

                setStatus(
                    "Name is already reserved. Use Pay From Wallet (do not Start Mint again). "
                        + reserveError,
                    "error"
                );
                return;
            }

            if (reserveStatusCode === 409 && reserveId) {
                setStatus("Found an existing mint session. Replacing it with a fresh session...", "info");
                var releaseObj2 = walletManager.releaseMintReservation(reserveId);
                if (!releaseObj2.success) {
                    setStatus("Mint setup failed: existing session conflict and release failed: " + String(releaseObj2.error || "Unknown error"), "error");
                    return;
                }

                var retryObj2 = walletManager.createMintReservation(name, primary, tickerToUse);
                if (retryObj2.success) {
                    if (!validateMintRouting(retryObj2, "mint"))
                        return;
                    mintReservation = retryObj2;
                    mintQuote = retryObj2;
                    if (retryObj2.ticker)
                        mintTickerInput.text = String(retryObj2.ticker).toUpperCase();
                    verifyAmountInput.text = String(retryObj2.fee || "");
                    mintStep = "reserved";
                    resetMintAutomation();
                    setMintProgress("Fresh mint session ready. Click Pay From Wallet.", 0.2);
                    setStatus("Replaced stale mint session and prepared a fresh payment.", "ok");
                    return;
                }

                var retryError = String(retryObj2.error || "Unknown error");
                setStatus("Mint setup failed after replacing stale session: " + retryError, "error");
                return;
            }

            setStatus("Mint setup failed: " + reserveError, "error");
        }
    }

    function isLegacyMintAddress(address) {
        return String(address || "").trim().indexOf("SaLv") === 0;
    }

    function validateMintRouting(obj, sourceLabel) {
        var outputsRaw = obj && obj.payment_outputs ? obj.payment_outputs : [];
        var outputs = [];
        if (outputsRaw && outputsRaw.length) {
            for (var i = 0; i < outputsRaw.length; i++) {
                var out = outputsRaw[i] || {};
                var outAddr = String(out.address || "").trim();
                if (outAddr)
                    outputs.push(outAddr);
            }
        }
        if (outputs.length === 0 && obj && obj.treasury_address)
            outputs.push(String(obj.treasury_address || "").trim());

        for (var j = 0; j < outputs.length; j++) {
            var address = outputs[j];
            if (isLegacyMintAddress(address)) {
                setStatus("Salpay returned a legacy SaLv mint address while Carrot is active. Update server routing to an SC address before minting.", "error");
                return false;
            }
            if (!TxUtils.checkAddress(address, appWindow.persistentSettings.nettype)) {
                setStatus("Salpay returned an invalid mint address for your current wallet network during " + sourceLabel + ".", "error");
                return false;
            }
        }

        return true;
    }

    function findMintPaymentTransaction(includeKnownHashes) {
        var includeKnown = Boolean(includeKnownHashes);
        if (typeof currentWallet === "undefined" || !currentWallet || typeof currentWallet.historyModel === "undefined")
            return null;

        var model = currentWallet.historyModel;
        if (!model || typeof model.rowCount !== "function")
            return null;

        var outputs = getExpectedPaymentOutputs();
        var expectedAddresses = [];
        for (var i = 0; i < outputs.length; i++) {
            var addr = String(outputs[i].address || "").trim();
            if (addr && expectedAddresses.indexOf(addr) === -1)
                expectedAddresses.push(addr);
        }

        var rowCount = model.rowCount();
        mintAutoScanTotal = rowCount;
        var scanCap = Math.min(rowCount, 300);
        var minTimestamp = mintAutoStartedAtMs > 0 ? (mintAutoStartedAtMs - 120000) : 0;
        var bestAddress = null;
        var bestRecent = null;
        var scannedRows = {};
        var scanOrder = [];

        for (var head = 0; head < scanCap; head++) {
            scanOrder.push(head);
            var tail = rowCount - 1 - head;
            if (tail !== head)
                scanOrder.push(tail);
        }

        mintAutoScanCount = scanOrder.length;

        for (var s = 0; s < scanOrder.length; s++) {
            var row = scanOrder[s];
            if (row < 0 || row >= rowCount)
                continue;
            if (scannedRows[row])
                continue;
            scannedRows[row] = true;

            var idx = model.index(row, 0);
            var isFailed = Boolean(model.data(idx, TransactionHistoryModel.TransactionFailedRole));
            if (isFailed)
                continue;

            var isOut = Boolean(model.data(idx, TransactionHistoryModel.TransactionIsOutRole));
            if (!isOut)
                continue;

            var asset = String(model.data(idx, TransactionHistoryModel.TransactionAssetRole) || "").trim();
            if (asset && asset !== "SAL1")
                continue;

            var hash = String(model.data(idx, TransactionHistoryModel.TransactionHashRole) || "").trim();
            if (!hash)
                continue;
            mintAutoLastScannedHash = hash;

            // Prefer remembered paid hash (survives Reset mint).
            if (includeKnown && mintLastPaidTxHash !== "" && hash === mintLastPaidTxHash) {
                mintAutoMatchMode = "remembered-hash";
                return {
                    hash: hash,
                    pending: Boolean(model.data(idx, TransactionHistoryModel.TransactionPendingRole)),
                    confirmations: Number(model.data(idx, TransactionHistoryModel.TransactionConfirmationsRole) || 0),
                    confirmationsRequired: Number(model.data(idx, TransactionHistoryModel.TransactionConfirmationsRequiredRole) || 10),
                    txTime: txTimestampMs(model.data(idx, TransactionHistoryModel.TransactionTimeStampRole)),
                    destinations: String(model.data(idx, TransactionHistoryModel.TransactionDestinationsRole) || "")
                };
            }

            var destinations = String(model.data(idx, TransactionHistoryModel.TransactionDestinationsRole) || "");
            var txTime = txTimestampMs(model.data(idx, TransactionHistoryModel.TransactionTimeStampRole));
            // On resume/includeKnown, widen the time window so a pay-then-reset still finds the tx.
            var effectiveMinTs = minTimestamp;
            if (includeKnown)
                effectiveMinTs = 0;
            if (effectiveMinTs > 0 && txTime > 0 && txTime < effectiveMinTs)
                continue;

            var matchedAddress = expectedAddresses.length === 0;
            for (var j = 0; j < expectedAddresses.length; j++) {
                if (destinations.indexOf(expectedAddresses[j]) !== -1) {
                    matchedAddress = true;
                    break;
                }
            }

            // Match amount to locked fee (atomic when available).
            var expectedFee = Number(mintReservation.fee || mintQuote.fee || mintLastPaidFee || 0);
            var amountAtomic = Number(model.data(idx, TransactionHistoryModel.TransactionAtomicAmountRole) || 0);
            var amountDisplay = Number(model.data(idx, TransactionHistoryModel.TransactionAmountRole) || 0);
            var matchedAmount = false;
            if (expectedFee > 0) {
                if (amountAtomic > 0) {
                    var expectedAtomic = 0;
                    try { expectedAtomic = Number(walletManager.amountFromString(String(expectedFee))); } catch (eA) { expectedAtomic = 0; }
                    if (expectedAtomic > 0 && Math.abs(amountAtomic - expectedAtomic) <= Math.max(expectedAtomic * 0.02, 1))
                        matchedAmount = true;
                } else if (amountDisplay > 0 && Math.abs(amountDisplay - expectedFee) <= Math.max(expectedFee * 0.02, 0.01)) {
                    matchedAmount = true;
                }
            }

            var candidate = {
                hash: hash,
                pending: Boolean(model.data(idx, TransactionHistoryModel.TransactionPendingRole)),
                confirmations: Number(model.data(idx, TransactionHistoryModel.TransactionConfirmationsRole) || 0),
                confirmationsRequired: Number(model.data(idx, TransactionHistoryModel.TransactionConfirmationsRequiredRole) || 10),
                txTime: txTime,
                destinations: destinations,
                matchedAddress: matchedAddress,
                matchedAmount: matchedAmount
            };

            if (mintAutoTxHash !== "" && candidate.hash === mintAutoTxHash)
                return candidate;

            if (!includeKnown && mintAutoKnownTxHashes && mintAutoKnownTxHashes[candidate.hash])
                continue;

            // Best: treasury address + fee amount.
            if (matchedAddress && matchedAmount) {
                if (bestAddress === null || candidate.txTime > bestAddress.txTime)
                    bestAddress = candidate;
            } else if (matchedAddress) {
                if (bestAddress === null || candidate.txTime > bestAddress.txTime)
                    bestAddress = candidate;
            }

            // Do NOT blindly take "any recent outbound" — that caused false "already paid" scans.
            // Only use amount-only match when includeKnown (user explicitly said already paid).
            if (includeKnown && matchedAmount) {
                if (bestRecent === null || candidate.txTime > bestRecent.txTime)
                    bestRecent = candidate;
            }
        }

        if (bestAddress) {
            mintAutoMatchMode = includeKnown
                ? (bestAddress.matchedAmount ? "resume-address-amount" : "resume-address")
                : (bestAddress.matchedAmount ? "address-amount" : "address");
            return bestAddress;
        }
        if (bestRecent) {
            mintAutoMatchMode = "resume-amount";
            return bestRecent;
        }

        mintAutoMatchMode = "none";
        return null;
    }

    function hasActiveMintSession() {
        return mintStep === "reserved"
            || mintStep === "verified"
            || mintStep === "executing"
            || mintAutoTracking
            || String(mintReservation.reservation_id || "") !== "";
    }

    function shouldStopAutoVerification(errorText, obj) {
        var msg = String(errorText || "").toLowerCase();
        var proofReason = String((obj && obj.proof_reason) || "").toLowerCase();

        if (proofReason === "destination_mismatch"
                || proofReason === "insufficient_on_chain"
                || proofReason === "destination_unavailable"
                || proofReason === "amount_unavailable") {
            return true;
        }

        if (mintAutoMatchMode === "recent" || mintAutoMatchMode.indexOf("resume") === 0) {
            if (msg.indexOf("destination does not match") !== -1
                    || msg.indexOf("treasury address") !== -1
                    || msg.indexOf("single destination only") !== -1
                    || msg.indexOf("provided outputs do not match") !== -1) {
                return false;
            }
        }
        return msg.indexOf("reservation not found") !== -1
            || msg.indexOf("expired") !== -1
            || msg.indexOf("conflict") !== -1
            || msg.indexOf("insufficient") !== -1
            || msg.indexOf("network") !== -1
            || msg.indexOf("timeout") !== -1
            || msg.indexOf("host not found") !== -1
            || msg.indexOf("connection refused") !== -1
            || msg.indexOf("transferring") !== -1
            || msg.indexOf("destination does not match") !== -1
            || msg.indexOf("treasury address") !== -1
            || msg.indexOf("single destination only") !== -1
            || msg.indexOf("provided outputs do not match") !== -1;
    }

    function isVerificationPending(obj, errorText) {
        var status = String((obj && obj.status) || "").toLowerCase();
        if (status === "pending")
            return true;

        var proofReason = String((obj && obj.proof_reason) || "").toLowerCase();
        if (proofReason === "confirmations_pending"
                || proofReason === "tx_not_found"
                || proofReason === "wallet_rpc_error") {
            return true;
        }

        var msg = String(errorText || "").toLowerCase();
        return msg.indexOf("waiting") !== -1
            || msg.indexOf("pending") !== -1
            || msg.indexOf("confirmation") !== -1
            || msg.indexOf("tx_not_found") !== -1;
    }

    function shouldRefreshReservationFromVerifyError(errorText, obj) {
        var msg = String(errorText || "").toLowerCase();
        var code = Number((obj && obj.status_code) || 0);
        return msg.indexOf("reservation not found") !== -1
            || msg.indexOf("reservation_not_found_or_expired") !== -1
            || msg.indexOf("expired") !== -1
            || (code === 409 && msg.indexOf("conflict") !== -1 && msg.indexOf("reservation") !== -1);
    }

    function refreshMintReservationAfterConflict() {
        var name = mintName || normName(mintNameInput.text);
        var primary = primaryWalletAddress();
        if (!name || !primary) {
            setStatus("Mint session conflict detected, but a fresh reservation could not be prepared automatically.", "error");
            return false;
        }

        isProcessing = true;
        setStatus("Previous mint session expired/conflicted. Preparing a fresh mint session...", "info");
        var obj = walletManager.createMintReservation(name, primary, selectedMintTicker());
        isProcessing = false;

        if (!obj.success) {
            setStatus("Failed to refresh mint session: " + String(obj.error || "Unknown error"), "error");
            return false;
        }

        if (!validateMintRouting(obj, "mint"))
            return false;

        mintReservation = obj;
        mintQuote = obj;
        verifyAmountInput.text = String(obj.fee || "");
        mintStep = "reserved";
        resetMintAutomation();
        setMintProgress("Fresh mint session ready. Click Pay From Wallet again.", 0.2);
        setStatus("Server reported session conflict. A fresh mint session is ready. Click Pay From Wallet once.", "ok");
        return true;
    }

    function attemptAutoVerifyAndExecute(tx) {
        if (!tx || !mintReservation.reservation_id || mintAutoExecuteRequested || mintStep === "executing" || mintStep === "complete")
            return;

        // Wait until protocol burn half is done when policy requires it.
        if (mintPendingBurnAmount > 0 && mintBurnTxHash === "") {
            setMintProgress("Treasury paid. Waiting for protocol BURN half...", 0.5);
            return;
        }

        var treasuryHash = mintAutoTxHash !== "" ? mintAutoTxHash : String(tx.hash || "");
        if (treasuryHash === "" && mintLastPaidTxHash !== "")
            treasuryHash = mintLastPaidTxHash;
        verifyTxHashInput.text = treasuryHash;
        verifyAmountInput.text = String(mintReservation.fee || mintQuote.fee || "");
        rememberPaidMintTx(treasuryHash, mintReservation.fee || mintQuote.fee, mintReservation.treasury_address, mintName);

        var outputs = getExpectedPaymentOutputs();
        var verifyToAddress = String(mintReservation.treasury_address || mintLastPaidTreasury || "");
        for (var oi = 0; oi < outputs.length; oi++) {
            if (outputs[oi].kind !== "protocol_burn" && outputs[oi].address) {
                verifyToAddress = String(outputs[oi].address);
                break;
            }
        }

        isProcessing = true;
        setMintProgress("Payment found in wallet. Verifying with Salpay...", 0.55);
        setStatus("Payment detected. Verifying on-chain with treasury view…", "info");
        var obj = walletManager.verifyMintPayment(
            mintReservation.reservation_id,
            Number(mintReservation.fee || mintQuote.fee || 0),
            treasuryHash,
            verifyToAddress,
            outputs,
            mintBurnTxHash
        );
        isProcessing = false;

        if (obj.success && obj.status === "verified") {
            mintVerification = obj;
            mintStep = "verified";
            setMintProgress("Payment verified. Submitting mint...", 0.75);
            setStatus("Payment verified automatically. Submitting mint...", "ok");
            mintAutoExecuteRequested = true;
            executeMint();
            return;
        }

        var verifyError = String(obj.error || obj.status || "Waiting for confirmation");
        var proofReasonText = String(obj.proof_reason || "").trim();
        if (proofReasonText.length > 0)
            verifyError = verifyError + " (" + proofReasonText + ")";
        mintAutoLastVerifyError = verifyError;

        if (shouldRefreshReservationFromVerifyError(verifyError, obj)) {
            mintAutoTracking = false;
            mintAutoPollTimer.stop();
            refreshMintReservationAfterConflict();
            return;
        }

        if (shouldStopAutoVerification(verifyError, obj)) {
            mintAutoTracking = false;
            mintAutoPollTimer.stop();
            var proof = String(obj.proof_reason || "").toLowerCase();
            if (proof === "tx_not_found" || verifyError.toLowerCase().indexOf("tx_not_found") >= 0) {
                // Payment left the user wallet but treasury view cannot see it yet.
                // Do NOT tell users funds are "held" — they are on-chain once confirmed.
                rememberPaidMintTx(treasuryHash, mintReservation.fee, mintReservation.treasury_address, mintName);
                setStatus(
                    qsTr("Payment sent (tx %1…). Waiting for treasury confirmation. "
                        + "Your leftover balance is normal change — not locked. "
                        + "Use “Finish incomplete mint” or paste the tx hash under Verify. "
                        + "If this stays pending more than ~15 minutes, contact support with the full tx hash.")
                        .arg(String(treasuryHash || "").substring(0, 16)),
                    "info"
                );
                return;
            }
            setStatus("Automatic mint verification stopped: " + verifyError, "error");
            return;
        }

        if (!isVerificationPending(obj, verifyError)) {
            mintAutoRejectCount = mintAutoRejectCount + 1;
            if (mintAutoRejectCount >= 2) {
                mintAutoTracking = false;
                mintAutoPollTimer.stop();
                setStatus("Automatic mint verification stopped after repeated backend rejection: " + verifyError, "error");
                return;
            }
            if (mintAutoMatchMode === "recent" || mintAutoMatchMode.indexOf("resume") === 0) {
                mintAutoTxHash = "";
                setMintProgress("Detected a payment candidate that backend rejected. Checking newer wallet transactions...", 0.5);
                setStatus("Backend rejected detected payment candidate: " + verifyError, "info");
                return;
            }
        } else {
            mintAutoRejectCount = 0;
        }

        var confirmText = tx.confirmationsRequired > 0
            ? (String(tx.confirmations) + "/" + String(tx.confirmationsRequired) + " confirmations")
            : (String(tx.confirmations) + " confirmations");
        setMintProgress("Payment found. Waiting for backend confirmation (" + confirmText + ")", 0.55);
        setStatus("Mint payment sent. Waiting for confirmation...", "info");
    }

    function pollMintAutomation() {
        if (!mintAutoTracking || !mintReservation.reservation_id || typeof currentWallet === "undefined" || !currentWallet)
            return;

        if (typeof currentWallet.history !== "undefined")
            currentWallet.history.refresh(currentWallet.currentSubaddressAccount);

        var tx = findMintPaymentTransaction(false);
        if (!tx) {
            mintAutoNoTxPolls = mintAutoNoTxPolls + 1;
            if (mintAutoNoTxPolls >= 5 && mintAutoWalletPaymentSeen) {
                var resumeTx = findMintPaymentTransaction(true);
                if (resumeTx) {
                    mintAutoTxHash = resumeTx.hash;
                    if (mintAutoKnownTxHashes)
                        mintAutoKnownTxHashes[resumeTx.hash] = true;
                    setMintProgress("Re-checking previous wallet payment candidate...", 0.45);
                    setStatus("No brand-new mint payment found yet. Trying previous payment candidate for this session...", "info");
                    attemptAutoVerifyAndExecute(resumeTx);
                    return;
                }
            }
            setMintProgress("Waiting for wallet payment to appear...", 0.35);
            setStatus("Approve the wallet send popup. Once sent, mint will continue automatically.", "info");
            return;
        }

        mintAutoNoTxPolls = 0;
        // Never overwrite a known treasury hash while waiting for protocol burn.
        var foundHash = String(tx.hash || "").trim();
        if (foundHash !== "") {
            if (mintAutoTxHash === "") {
                mintAutoTxHash = foundHash;
            } else if (mintPendingBurnAmount > 0
                       && mintBurnTxHash === ""
                       && foundHash !== mintAutoTxHash) {
                // Second distinct outbound may be burn commit seen via history poll.
                mintBurnTxHash = foundHash;
            }
            if (mintAutoKnownTxHashes)
                mintAutoKnownTxHashes[foundHash] = true;
        }
        mintAutoWalletPaymentSeen = true;
        attemptAutoVerifyAndExecute(tx);
    }

    function verifyMintPayment() {
        if (!ensureSalpayConfigured()) {
            setStatus("Salpay integration not configured", "error");
            return;
        }
        if (!mintReservation.reservation_id) {
            setStatus("Start minting first.", "error");
            return;
        }

        var txHash = verifyTxHashInput.text.trim();
        if (!txHash) {
            setStatus("Enter the payment tx hash from your wallet send.", "error");
            return;
        }

        var amount = Number(verifyAmountInput.text.trim());
        if (!isFinite(amount) || amount <= 0) {
            setStatus("Enter a valid payment amount.", "error");
            return;
        }

        var outputs = getExpectedPaymentOutputs();
        var verifyToAddress = String(mintReservation.treasury_address || "");
        for (var oi = 0; oi < outputs.length; oi++) {
            if (outputs[oi].kind !== "protocol_burn" && outputs[oi].address) {
                verifyToAddress = String(outputs[oi].address);
                break;
            }
        }
        var burnHash = String(mintBurnTxHash || "").trim();

        isProcessing = true;
        setStatus("Verifying payment...", "info");
        var obj = walletManager.verifyMintPayment(
            mintReservation.reservation_id,
            amount,
            txHash,
            verifyToAddress,
            outputs,
            burnHash
        );
        isProcessing = false;

        if (obj.success && obj.status === "verified") {
            mintVerification = obj;
            mintStep = "verified";
            setMintProgress("Payment verified. Ready to execute mint.", 0.75);
            setStatus("Payment verified. Ready to execute mint.", "ok");
        } else {
            setStatus("Verify failed: " + (obj.error || obj.status || "Unknown error"), "error");
        }
    }

    function executeMint() {
        if (!ensureSalpayConfigured()) {
            setStatus("Salpay integration not configured", "error");
            return;
        }
        if (!mintReservation.reservation_id) {
            setStatus("Create and verify a reservation first.", "error");
            return;
        }

        isProcessing = true;
        setStatus("Executing mint...", "info");
        var obj = walletManager.executeMint(mintReservation.reservation_id, randomIdempotencyKey());
        isProcessing = false;

        if (obj.success) {
            mintJob = obj;
            mintStep = "executing";
            mintAutoTracking = false;
            mintAutoPollTimer.stop();
            setMintProgress("Mint submitted. Waiting for backend status...", 0.9);
            setStatus("Mint submitted. Tracking job status...", "ok");
            mintStatusPollTimer.start();
            fetchMintStatus();
        } else {
            mintAutoExecuteRequested = false;
            setStatus("Execute failed: " + (obj.error || "Unknown error"), "error");
        }
    }

    function fetchMintStatus() {
        if (!ensureSalpayConfigured())
            return;
        var jobId = mintJob.job_id || mintJob.id || "";
        if (!jobId) return;

        var obj = walletManager.getMintStatus(jobId);
        if (obj.success) {
            mintJob = obj;
            if (obj.status === "completed") {
                mintStatusPollTimer.stop();
                mintStep = "complete";
                resetMintAutomation();
                setMintProgress("Mint completed successfully.", 1.0);
                setStatus("Mint complete: " + (obj.tx_hash || "tx unavailable"), "ok");
                resolveName(mintName);
                onMintCompletedRegisterAsset(obj);
                refreshOwnedNames();
            }
        }
    }

    // Put the 4-char ticker in the left-panel asset list and try on-chain create_token
    // so it becomes a real wallet asset (balance) when the chain supports it.
    function onMintCompletedRegisterAsset(jobObj) {
        var ticker = String(
            (jobObj && jobObj.ticker)
            || mintReservation.ticker
            || mintQuote.ticker
            || selectedMintTicker()
            || ""
        ).trim().toUpperCase();
        var name = String(
            (jobObj && jobObj.name)
            || mintReservation.name
            || mintName
            || ""
        ).trim().toLowerCase();
        if (typeof appWindow.registerSalpayOwnedAsset === "function")
            appWindow.registerSalpayOwnedAsset(ticker, name);
        if (typeof appWindow.syncSalpayOwnedAssetsFromServer === "function")
            appWindow.syncSalpayOwnedAssetsFromServer();
        if (typeof appWindow.refreshAssetTypesWithSalpay === "function")
            appWindow.refreshAssetTypesWithSalpay();
        tryCreateTokenForMintedName(ticker, name);
    }

    function tryCreateTokenForMintedName(ticker, name) {
        if (!ticker || !/^[A-Z0-9]{4}$/.test(ticker))
            return;
        if (isChainReservedTicker(ticker)) {
            setStatus("Name registered. Ticker " + ticker + " cannot be created on-chain (SAL* reserved).", "ok");
            return;
        }
        if (typeof currentWallet === "undefined" || !currentWallet)
            return;
        if (typeof currentWallet.createCreateTokenTransactionAsync !== "function") {
            setStatus("Name registered and listed under assets.", "ok");
            return;
        }
        if (currentWallet.currentSubaddressAccount != 0) {
            setStatus("Name registered. Switch to primary account to create on-chain token " + ticker + ".", "ok");
            return;
        }
        var supply = "1";
        var displayName = String(name || ticker).replace(/\.sal$/i, "");
        setStatus("Name registered. Optional on-chain token " + ticker + " may open next.", "ok");
        setMintProgress("Name minted.", 1.0);
        try {
            if (typeof appWindow.handleCreateToken === "function")
                appWindow.handleCreateToken(ticker, supply, "", displayName, 0, "", "");
            else
                currentWallet.createCreateTokenTransactionAsync(ticker, supply, "", displayName, 0, "", "");
        } catch (e) {
            setStatus("Name is on SalPay. On-chain create_token failed: " + e, "error");
        }
    }


    // After user already sent the fee: rescan history and try verify+execute without a new popup.
    function resumeAfterManualPayment() {
        if (mintStep === "complete") {
            setStatus("Mint already complete for this session.", "ok");
            return;
        }
        // If user hit Reset after paying, try to re-bind the active server reservation.
        if (!mintReservation.reservation_id) {
            var nameTry = mintName || normName(mintNameInput.text);
            if (nameTry && ensureSalpayConfigured()) {
                var primaryTry = primaryWalletAddress();
                var tickerTry = selectedMintTicker();
                var rebind = walletManager.createMintReservation(nameTry, primaryTry, tickerTry);
                if (!rebind.success && (rebind.resumable || rebind.reservation_id)) {
                    applyResumableReservation(rebind);
                } else if (rebind.success) {
                    if (validateMintRouting(rebind, "mint")) {
                        mintReservation = rebind;
                        mintQuote = rebind;
                        mintStep = "reserved";
                        verifyAmountInput.text = String(rebind.fee || "");
                    }
                }
            }
        }
        if (!mintReservation.reservation_id) {
            setStatus(
                "No active mint session. Start Mint once (if name shows reserved, the app will resume it), then scan again.",
                "error"
            );
            return;
        }
        var prep = prepareWalletForMintPayment();
        if (!prep.ok) {
            setStatus(prep.error || "Wallet not ready", "error");
            return;
        }
        mintAutoTracking = true;
        mintAutoExecuteRequested = false;
        // Widen search after reset: do not restrict to "since this session started".
        mintAutoStartedAtMs = 0;
        mintAutoPollTimer.start();
        setMintProgress("Looking for your payment in wallet history…", 0.4);
        setStatus("Scanning wallet for mint payment of " + String(mintReservation.fee) + " SAL1…", "info");
        if (typeof currentWallet !== "undefined" && currentWallet && currentWallet.history)
            currentWallet.history.refresh(currentWallet.currentSubaddressAccount);
        var tx = findMintPaymentTransaction(true);
        if (tx) {
            if (mintAutoTxHash === "")
                mintAutoTxHash = String(tx.hash || "");
            rememberPaidMintTx(mintAutoTxHash, mintReservation.fee, mintReservation.treasury_address, mintName);
            verifyTxHashInput.text = mintAutoTxHash;
            attemptAutoVerifyAndExecute(tx);
        } else {
            mintAutoTracking = false;
            mintAutoPollTimer.stop();
            setStatus(
                "No matching payment found for "
                    + String(mintReservation.fee) + " SAL1 to the mint treasury. "
                    + "If you paid a different amount, paste the exact tx hash below and click Verify. "
                    + "If you never paid, use Pay From Wallet once (do not reset mid-pay).",
                "error"
            );
        }
    }

    function isLikelyTreasuryAddress(address) {
        var a = String(address || "").trim();
        if (!a)
            return false;
        // Prefer libwallet validation; fall back for SC/Carrot if validator lags GUI.
        try {
            if (TxUtils.checkAddress(a, appWindow.persistentSettings.nettype))
                return true;
        } catch (e) { /* fall through */ }
        // Mainnet Carrot SC addresses are long base58-ish strings starting with SC.
        if (walletNetworkName() === "mainnet" && a.indexOf("SC") === 0 && a.length >= 90)
            return true;
        if (a.indexOf("SaLv") === 0 && a.length >= 90)
            return true;
        return false;
    }

    function feeAmountToAtomic(feeHuman) {
        var n = Number(feeHuman);
        if (!isFinite(n) || n <= 0)
            return 0;
        // amountFromString expects a decimal string in human units (e.g. "412" or "412.00").
        var s = String(feeHuman);
        if (s.indexOf("e") >= 0 || s.indexOf("E") >= 0)
            s = n.toFixed(12);
        try {
            var atomic = Number(walletManager.amountFromString(s));
            if (atomic > 0)
                return atomic;
        } catch (e1) { /* try fixed */ }
        try {
            return Number(walletManager.amountFromString(n.toFixed(8)));
        } catch (e2) {
            return 0;
        }
    }

    function getExpectedPaymentOutputs() {
        var outputsRaw = mintReservation.payment_outputs;
        if (outputsRaw && outputsRaw.length && outputsRaw.length > 0) {
            var outputs = [];
            for (var i = 0; i < outputsRaw.length; i++) {
                var out = outputsRaw[i] || {};
                var outAmount = Number(out.amount || 0);
                if (!isFinite(outAmount) || outAmount <= 0)
                    continue;
                var kind = String(out.kind || (out.address ? "transfer" : "protocol_burn"));
                var role = String(out.role || "");
                var outAddr = String(out.address || "").trim();
                // Protocol burn has no SC address — wallet burns via BURN tx type.
                if (kind === "protocol_burn" || (role === "burn" && !outAddr)) {
                    outputs.push({
                        address: "",
                        amount: outAmount,
                        role: role || "burn",
                        kind: "protocol_burn"
                    });
                    continue;
                }
                if (!outAddr)
                    continue;
                outputs.push({
                    address: outAddr,
                    amount: outAmount,
                    role: role || "treasury",
                    kind: kind || "transfer"
                });
            }
            if (outputs.length > 0)
                return outputs;
        }

        var fallbackAddr = String(mintReservation.treasury_address || mintQuote.treasury_address || mintLastPaidTreasury || "").trim();
        var fallbackAmount = Number(mintReservation.fee || mintQuote.fee || mintLastPaidFee || 0);
        if (fallbackAddr && isFinite(fallbackAmount) && fallbackAmount > 0)
            return [{ address: fallbackAddr, amount: fallbackAmount, role: "treasury", kind: "transfer" }];

        return [];
    }

    // Why Pay is disabled — shown under the button so users are not stuck on a grey box.
    function payButtonBlockReason() {
        if (mintAutoTracking)
            return qsTr("Payment in progress — wait, or Stop / Reset if stuck.");
        if (!mintReservation || !mintReservation.reservation_id)
            return qsTr("No active reservation. Click Start Mint first.");
        var outputs = getExpectedPaymentOutputs();
        if (!outputs || outputs.length < 1)
            return qsTr("Missing treasury address/fee on this session. Click Quote or Start Mint to refresh.");
        var totalAtomic = 0;
        var hasTreasury = false;
        for (var i = 0; i < outputs.length; i++) {
            var out = outputs[i];
            var outAtomic = feeAmountToAtomic(out.amount);
            if (outAtomic <= 0)
                return qsTr("Invalid fee amount on reservation (%1). Quote again.").arg(String(out.amount));
            totalAtomic += outAtomic;
            if (out.kind === "protocol_burn")
                continue;
            var outAddr = String(out.address || "").trim();
            if (!outAddr)
                return qsTr("Treasury address missing. Quote / Start Mint again.");
            if (!isLikelyTreasuryAddress(outAddr))
                return qsTr("Treasury address failed validation. Ensure wallet is mainnet.");
            hasTreasury = true;
        }
        if (!hasTreasury || totalAtomic <= 0)
            return qsTr("No payable treasury output.");
        var unlocked = getMintUnlockedBalanceAtomic();
        if (unlocked <= 0)
            return qsTr("Unlocked SAL1 balance is 0. Wait for unlock or refresh wallet.");
        if (totalAtomic > unlocked) {
            return qsTr("Need %1 unlocked SAL1 (have %2). Fee is locked on reservation — unlock funds or wait.")
                .arg(Utils.removeTrailingZeros(walletManager.displayAmount(totalAtomic)))
                .arg(Utils.removeTrailingZeros(walletManager.displayAmount(unlocked)));
        }
        return "";
    }

    function canPayReservationFromWallet() {
        return payButtonBlockReason() === "";
    }

    function ensureReservationPayable() {
        // Refresh incomplete resume sessions so Pay can enable.
        if (getExpectedPaymentOutputs().length > 0)
            return true;
        var rid = String(mintReservation.reservation_id || "").trim();
        if (!rid || !ensureSalpayConfigured())
            return false;
        try {
            var byId = walletManager.getMintQuoteByReservation(rid);
            if (byId && byId.success) {
                if (!byId.reservation_id)
                    byId.reservation_id = rid;
                applyResumableReservation(byId);
                return getExpectedPaymentOutputs().length > 0;
            }
        } catch (e) {
            console.log("ensureReservationPayable: " + e);
        }
        return false;
    }

    function walletNetworkName() {
        if (appWindow.persistentSettings.nettype === NetworkType.TESTNET) return "testnet";
        if (appWindow.persistentSettings.nettype === NetworkType.STAGENET) return "stagenet";
        return "mainnet";
    }

    function payReservationFromWallet() {
        ensureReservationPayable();
        var block = payButtonBlockReason();
        if (block !== "" && !mintAutoTracking) {
            // Re-check after refresh; still blocked → tell user why (never silent grey button).
            setStatus(block, "error");
            if (getExpectedPaymentOutputs().length < 1)
                return;
            // If only balance was the issue, still stop; user must unlock funds.
            if (block.indexOf("unlocked") >= 0 || block.indexOf("Need ") === 0)
                return;
        }

        var outputs = getExpectedPaymentOutputs();
        if (!outputs || outputs.length < 1) {
            setStatus("Mint payment is missing destination outputs. Click Start Mint / Quote to refresh the session.", "error");
            return;
        }

        if (typeof currentWallet === "undefined" || !currentWallet) {
            setStatus("Open a wallet before paying mint fee.", "error");
            return;
        }

        var prep = prepareWalletForMintPayment();
        if (!prep.ok) {
            setStatus(prep.error || "Wallet not ready for mint payment", "error");
            return;
        }

        // Split policy: treasury TRANSFER half + protocol BURN half (mainnet).
        // Testnet often cannot protocol-burn — refuse stale 50/50 reservations so mint does not hang.
        var recipients = [];
        var burnAmount = 0;
        var totalAtomic = 0;
        var hasProtocolBurn = false;
        for (var bi = 0; bi < outputs.length; bi++) {
            if (outputs[bi].kind === "protocol_burn")
                hasProtocolBurn = true;
        }
        if (hasProtocolBurn && walletNetworkName() === "testnet") {
            setStatus(
                "This mint session still requires protocol BURN (not available on offline testnet). "
                    + "Click Reset mint session, Quote again, then Pay once (full fee to treasury).",
                "error"
            );
            return;
        }
        for (var i = 0; i < outputs.length; i++) {
            var out = outputs[i];
            var outAmountNum = Number(out.amount || 0);
            var outAmountStr = isFinite(outAmountNum) ? String(outAmountNum) : String(out.amount || "");
            var outAtomic = walletManager.amountFromString(outAmountStr);
            if (outAtomic <= 0) {
                setStatus("Mint payment amount is invalid", "error");
                return;
            }
            totalAtomic += outAtomic;

            if (out.kind === "protocol_burn") {
                burnAmount = outAmountNum;
                continue;
            }

            var outAddr = String(out.address || "").trim();
            if (isLegacyMintAddress(outAddr)) {
                setStatus("Salpay returned a legacy SaLv mint address while Carrot is active. Update server routing to an SC address before paying.", "error");
                return;
            }
            if (!TxUtils.checkAddress(outAddr, appWindow.persistentSettings.nettype)) {
                setStatus("Payment address is invalid for your current wallet network (" + walletNetworkName() + ").", "error");
                return;
            }
            recipients.push({ address: outAddr, amount: outAmountStr });
        }

        if (recipients.length < 1) {
            setStatus("Mint payment is missing treasury transfer destination", "error");
            return;
        }

        var unlocked = getMintUnlockedBalanceAtomic();
        if (totalAtomic > unlocked) {
            setStatus(
                "Not enough unlocked " + mintPaymentAssetType
                    + " yet (need "
                    + Utils.removeTrailingZeros(walletManager.displayAmount(totalAtomic))
                    + ", have "
                    + Utils.removeTrailingZeros(walletManager.displayAmount(unlocked))
                    + "). Mine or wait for unlock, then retry.",
                "error"
            );
            return;
        }

        var assetUsed = ensureMintPaymentAssetSelected();
        mintPendingBurnAmount = burnAmount > 0 ? burnAmount : 0;
        mintBurnTxHash = "";
        console.log(
            "SalPay mint pay: asset=" + assetUsed
                + " network=" + walletNetworkName()
                + " transferLegs=" + recipients.length
                + " protocolBurnAmount=" + mintPendingBurnAmount
                + " totalAtomic=" + totalAtomic
        );

        mintAutoKnownTxHashes = collectRecentTxHashes(300);
        mintAutoStartedAtMs = Date.now();

        // Step A: treasury transfer (always). Step B: protocol burn if policy requires it.
        middlePanel.paymentClicked(recipients, "", 15, 0, "Mint " + mintName + " treasury (" + assetUsed + ")");
        mintAutoTracking = true;
        mintAutoExecuteRequested = false;
        mintAutoTxHash = "";
        mintAutoWalletPaymentSeen = false;
        mintAutoNoTxPolls = 0;
        mintAutoRejectCount = 0;
        mintAutoLastVerifyError = "";
        setMintProgress(mintPendingBurnAmount > 0
            ? "Step 1/2: approve treasury transfer (50%). Burn half follows."
            : "Waiting for wallet payment confirmation...", 0.35);
        mintAutoPollTimer.start();
        setStatus(
            mintPendingBurnAmount > 0
                ? ("Paying treasury half in " + assetUsed + ". Confirm the transfer, then enter your wallet password. Burn half may follow.")
                : ("Paying mint fee in " + assetUsed + ". Confirm the transaction, then enter your wallet password if asked. Verification continues after the send is submitted."),
            "info"
        );
    }

    function cancelMint() {
        // Hard reset: works even if payment popup never appeared / auto-tracking stuck.
        isProcessing = false;
        mintAutoTracking = false;
        mintAutoExecuteRequested = false;
        mintPendingBurnAmount = 0;
        mintBurnTxHash = "";
        mintAutoPollTimer.stop();
        mintStatusPollTimer.stop();

        var reservationId = String(mintReservation.reservation_id || "");
        var paidHint = mintAutoTxHash || mintLastPaidTxHash;
        if (paidHint !== "")
            rememberPaidMintTx(paidHint, mintReservation.fee || mintQuote.fee, mintReservation.treasury_address, mintName);

        // If a payment was already detected, do NOT release the server reservation —
        // that was orphaning paid sessions and forcing "already paid" dead-ends.
        var releaseWarning = "";
        var keptReservation = false;
        if (paidHint !== "" && reservationId) {
            keptReservation = true;
            setStatus(
                "Payment may already be on-chain (tx " + paidHint.substring(0, 14)
                    + "…). Reservation kept. Click “I already paid — scan” — do not pay again.",
                "error"
            );
        } else if (reservationId && ensureSalpayConfigured()) {
            var releaseObj = walletManager.releaseMintReservation(reservationId);
            if (!releaseObj.success) {
                releaseWarning = "Release failed: " + String(releaseObj.error || "Unknown error");
            }
        }

        if (keptReservation) {
            // Soft reset UI tracking only; keep reservation for scan/verify.
            mintAutoTracking = false;
            mintAutoExecuteRequested = false;
            mintAutoPollTimer.stop();
            mintStep = "reserved";
            setMintProgress("Reservation kept after reset. Scan for payment.", 0.25);
            return;
        }

        mintStep = "idle";
        mintName = "";
        mintQuote = {};
        mintReservation = {};
        mintVerification = {};
        mintJob = {};
        verifyTxHashInput.text = "";
        verifyAmountInput.text = "";
        resetMintAutomation();
        restoreMintPaymentAssetIfNeeded();
        if (releaseWarning !== "") {
            setStatus(releaseWarning + " Local mint state was reset — you can start over.", "error");
        } else {
            setStatus(reservationId ? "Mint cancelled and reservation released." : "Mint cancelled. Ready to start over.", "ok");
        }
    }

    ColumnLayout {
        id: mainLayout
        anchors { left: parent.left; right: parent.right; top: parent.top }
        spacing: 0

        Item {
            Layout.fillWidth: true
            height: 80

            Row {
                anchors.verticalCenter: parent.verticalCenter
                spacing: 0

                MoneroComponents.TextPlain {
                    text: "Pay to ."; font.pixelSize: 26; font.bold: true
                    color: MoneroComponents.Style.defaultFontColor
                }
                MoneroComponents.TextPlain {
                    text: "SAL"; font.pixelSize: 26; font.bold: true
                    color: salBrandGreen
                    themeTransition: false
                }
                MoneroComponents.TextPlain {
                    text: " names"; font.pixelSize: 26; font.bold: true
                    color: MoneroComponents.Style.defaultFontColor
                }
            }
        }

        Rectangle {
            Layout.fillWidth: true; height: 2; color: salBrandGreen
            Layout.bottomMargin: 16
        }

        // ---- Your minted names (from salpay.org, for this primary wallet address) ----
        ColumnLayout {
            Layout.fillWidth: true
            spacing: 6
            Layout.bottomMargin: 12

            RowLayout {
                Layout.fillWidth: true
                MoneroComponents.TextPlain {
                    text: qsTr("Your .sal names")
                    font.pixelSize: 15; font.bold: true
                    color: salBrandGreen
                    themeTransition: false
                }
                Item { Layout.fillWidth: true }
                MoneroComponents.StandardButton {
                    text: qsTr("Refresh"); small: true
                    enabled: !isProcessing
                    onClicked: refreshOwnedNames()
                }
            }

            MoneroComponents.TextPlain {
                Layout.fillWidth: true
                visible: ownedNamesStatus !== ""
                text: ownedNamesStatus
                font.pixelSize: 12
                color: MoneroComponents.Style.dimmedFontColor
                wrapMode: Text.WordWrap
            }

            Rectangle {
                Layout.fillWidth: true
                visible: ownedNamesModel.count > 0
                // Scrollable list when many names are minted.
                implicitHeight: Math.min(ownedNamesList.contentHeight + 8, 220)
                color: MoneroComponents.Style.blackTheme ? "#141414" : "#f7f7f7"
                radius: 6
                border.width: 1
                border.color: MoneroComponents.Style.inputBorderColorInActive

                ListView {
                    id: ownedNamesList
                    anchors.fill: parent
                    anchors.margins: 4
                    clip: true
                    model: ownedNamesModel
                    boundsBehavior: Flickable.StopAtBounds
                    // Controls 2 attached type must be qualified (Controls 1.4 is also imported).
                    Qt2.ScrollBar.vertical: Qt2.ScrollBar {
                        policy: ownedNamesList.contentHeight > ownedNamesList.height
                                ? Qt2.ScrollBar.AlwaysOn
                                : Qt2.ScrollBar.AsNeeded
                        width: 8
                    }
                    delegate: Rectangle {
                        width: ownedNamesList.width - 8
                        height: 36
                        color: "transparent"
                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: 8
                            anchors.rightMargin: 8
                            spacing: 8
                            MoneroComponents.TextPlain {
                                text: name
                                font.pixelSize: 13
                                font.bold: true
                                color: MoneroComponents.Style.defaultFontColor
                                Layout.fillWidth: true
                                elide: Text.ElideRight
                            }
                            MoneroComponents.TextPlain {
                                text: ticker || ""
                                font.pixelSize: 12
                                color: salBrandGreen
                                Layout.preferredWidth: 48
                            }
                            MoneroComponents.StandardButton {
                                text: qsTr("Use"); small: true
                                onClicked: {
                                    sendNameInput.text = name;
                                    resolveError = qsTr("Looking up name…");
                                    resolveName(name);
                                }
                            }
                        }
                    }
                }
            }
        }

        MoneroComponents.TextPlain {
            Layout.leftMargin: 4
            text: qsTr("Send to a .SAL name")
            font.pixelSize: 15; font.bold: true
            color: salBrandGreen
            themeTransition: false
            Layout.bottomMargin: 6
        }

        MoneroComponents.TextPlain {
            Layout.leftMargin: 4
            text: qsTr("Only works after mint fully completes. If you already paid the fee, use Finish incomplete mint — do not send again.")
            font.pixelSize: 12; color: salBrandGreen
            themeTransition: false
            Layout.bottomMargin: 10
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        RowLayout {
            Layout.fillWidth: true; spacing: 8

            MoneroComponents.LineEditMulti {
                id: sendNameInput
                Layout.fillWidth: true
                placeholderText: "alice.sal"
                onTextChanged: {
                    resolvedAddress = "";
                    resolveOk = false;
                    // Immediate feedback so UI never looks stuck on "Resolving…"
                    resolveError = qsTr("Looking up name…");
                    if (sendNameInput.text.trim().length === 0)
                        resolveError = "";
                    resolveDelayTimer.restart();
                }
            }

            MoneroComponents.StandardButton {
                text: qsTr("Lookup"); small: true
                enabled: sendNameInput.text.trim().length > 0
                onClicked: {
                    var n = sendNameInput.text.trim().toLowerCase();
                    if (!n.endsWith(".sal")) n += ".sal";
                    resolveError = qsTr("Looking up name…");
                    resolveName(n);
                }
            }

            MoneroComponents.StandardButton {
                text: qsTr("Finish incomplete mint"); small: true
                enabled: sendNameInput.text.trim().length > 0
                onClicked: {
                    var n = sendNameInput.text.trim().toLowerCase();
                    if (!n.endsWith(".sal")) n += ".sal";
                    if (!finishIncompleteMint(n, "")) {
                        // Still try Start Mint path
                        mintNameInput.text = n.replace(/\.sal$/, "");
                        startMintFromQuote();
                    }
                }
            }

            MoneroComponents.StandardButton {
                text: qsTr("Send"); small: true
                enabled: resolveOk && sendAmountInput.text.trim().length > 0
                onClicked: {
                    if (resolveOk && resolvedAddress) {
                        middlePanel.state = "Transfer";
                        middlePanel.transferView.fillPaymentDetails(
                            resolvedAddress, "",
                            sendAmountInput.text.trim(),
                            sendNameInput.text.trim(),
                            sendNameInput.text.trim()
                        );
                    }
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true; spacing: 8; Layout.topMargin: 8

            MoneroComponents.TextPlain {
                text: qsTr("Amount (SAL1):")
                font.pixelSize: 12; color: MoneroComponents.Style.dimmedFontColor
                Layout.preferredWidth: 100
            }
            MoneroComponents.LineEditMulti {
                id: sendAmountInput
                Layout.fillWidth: true; placeholderText: "0.00"
            }
        }

        MoneroComponents.TextPlain {
            visible: sendNameInput.text.trim().length > 0
            text: resolveOk
                ? (qsTr("Ready: ") + resolvedAddress.substring(0, 36) + "…")
                : (resolveError ? resolveError : qsTr("Looking up name…"))
            color: resolveOk ? salBrandGreen : (resolveError && resolveError.indexOf("Looking up") < 0 ? "#ff4444" : MoneroComponents.Style.dimmedFontColor)
            themeTransition: !resolveOk
            font.pixelSize: 11
            Layout.topMargin: 4
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
        }

        MoneroComponents.TextPlain {
            visible: sendNameInput.text.trim().length > 0
            text: sendButtonReason()
            color: (resolveOk && sendAmountInput.text.trim().length > 0) ? salBrandGreen : MoneroComponents.Style.dimmedFontColor
            themeTransition: !(resolveOk && sendAmountInput.text.trim().length > 0)
            font.pixelSize: 11
            Layout.fillWidth: true
        }

        Timer {
            id: resolveDelayTimer
            interval: 450
            repeat: false
            onTriggered: {
                var n = sendNameInput.text.trim().toLowerCase();
                if (n.length === 0) {
                    resolveError = "";
                    return;
                }
                if (!n.endsWith(".sal")) n += ".sal";
                resolveName(n);
            }
        }

        Rectangle {
            Layout.fillWidth: true; height: 1
            color: MoneroComponents.Style.appWindowBorderColor
            Layout.topMargin: 20; Layout.bottomMargin: 20
        }

        MoneroComponents.TextPlain {
            Layout.leftMargin: 4
            text: qsTr("Mint a .SAL name")
            font.pixelSize: 15; font.bold: true
            color: salBrandGreen
            themeTransition: false
            Layout.bottomMargin: 6
        }

        MoneroComponents.TextPlain {
            Layout.leftMargin: 4
            text: qsTr("Quote a fee, then pay the full amount in one SAL1 transfer to the mint treasury. The network verifies that payment on-chain. SalPay operators burn half of the fee later and attach a public burn proof — you do not send a separate burn transaction.")
            font.pixelSize: 12
            color: MoneroComponents.Style.dimmedFontColor
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            Layout.bottomMargin: 10
        }

        MoneroComponents.TextPlain {
            Layout.leftMargin: 4
            visible: turnstileConfig.loaded
            text: turnstileConfig.enforced_effective
                ? qsTr("Mainnet: payment is checked with chain proof (your transfer to treasury).")
                : qsTr("Quote, pay full fee to treasury, verify, then mint.")
            font.pixelSize: 12
            color: turnstileConfig.enforced_effective ? "#ff9800" : salBrandGreen
            themeTransition: false
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            Layout.bottomMargin: 6
        }

        ColumnLayout {
            visible: mintStep === "idle"
            Layout.fillWidth: true
            spacing: 10

            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                MoneroComponents.LineEditMulti {
                    id: mintNameInput
                    Layout.fillWidth: true
                    placeholderText: "yourname.sal"
                    onTextChanged: {
                        setStatus("", "info");
                        mintTickerManual = false;
                        // Clear stale taken stems while typing (e.g. TEST).
                        mintTickerInput.text = "";
                        tickerSuggestTimer.restart();
                    }
                }

                MoneroComponents.StandardButton {
                    text: qsTr("Quote"); small: true
                    enabled: mintNameInput.text.trim().length >= 1 && !isProcessing
                    onClicked: requestMintQuote()
                }

            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                MoneroComponents.TextPlain {
                    text: qsTr("Ticker:")
                    font.pixelSize: 12
                    color: MoneroComponents.Style.dimmedFontColor
                    Layout.preferredWidth: 60
                }

                MoneroComponents.LineEditMulti {
                    id: mintTickerInput
                    Layout.fillWidth: true
                    placeholderText: qsTr("Free ticker (auto)")
                    onTextChanged: {
                        if (!activeFocus)
                            return;
                        // Only treat as manual if it matches a free chip.
                        var t = text.trim().toUpperCase();
                        mintTickerManual = mintTickerSuggestions.indexOf(t) >= 0;
                    }
                }
            }


            // Status only when useful (taken stem / loading / error). Avoid duplicating the button list.
            MoneroComponents.TextPlain {
                Layout.fillWidth: true
                visible: mintTickerSuggestStatus !== ""
                text: mintTickerSuggestStatus
                font.pixelSize: 11
                color: MoneroComponents.Style.dimmedFontColor
                wrapMode: Text.WordWrap
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                visible: tickerSuggestModel.count > 0

                MoneroComponents.TextPlain {
                    text: qsTr("Free tickers (3):")
                    font.pixelSize: 11
                    color: MoneroComponents.Style.dimmedFontColor
                }

                Repeater {
                    model: tickerSuggestModel
                    delegate: MoneroComponents.StandardButton {
                        text: ticker
                        small: true
                        fontBold: String(mintTickerInput.text || "").trim().toUpperCase() === String(ticker)
                        onClicked: pickSuggestedTicker(ticker)
                    }
                }
            }
        }

        Timer {
            id: tickerSuggestTimer
            interval: 350
            repeat: false
            onTriggered: refreshTickerSuggestions()
        }

        ColumnLayout {
            visible: mintStep === "quote"
            Layout.fillWidth: true
            spacing: 10

            Rectangle {
                Layout.fillWidth: true
                // Avoid preferredHeight <-> child implicitHeight binding loops (blank/frozen tab).
                implicitHeight: quoteCol.implicitHeight + 24
                color: MoneroComponents.Style.blackTheme ? "#1b2e1b" : "#f0fff0"
                radius: 6
                border.width: 1
                border.color: "#00c853"

                ColumnLayout {
                    id: quoteCol
                    width: parent.width - 24
                    anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12 }
                    spacing: 6

                    MoneroComponents.TextPlain {
                        text: "Name: " + (mintQuote.name || mintName)
                        color: "#00c853"; font.pixelSize: 14; font.bold: true
                    }
                    MoneroComponents.TextPlain {
                        text: "Ticker: " + (mintQuote.ticker || selectedMintTicker() || "-")
                        color: MoneroComponents.Style.defaultFontColor; font.pixelSize: 13
                    }
                    MoneroComponents.TextPlain {
                        text: qsTr("Fee: %1 SAL1 · network: %2")
                            .arg(mintQuote.fee !== undefined && mintQuote.fee !== null ? String(mintQuote.fee) : "-")
                            .arg(walletNetworkName())
                        color: MoneroComponents.Style.defaultFontColor; font.pixelSize: 13
                    }
                    MoneroComponents.TextPlain {
                        visible: Number(mintQuote.fee || 0) > 0
                        text: walletNetworkName() === "mainnet"
                            ? qsTr("Mainnet fee (USD→SAL1): 7+ chars ~$20, 5–6 chars ~$35, 1–4 chars ~$50. Pay this full amount once to the mint treasury.")
                            : qsTr("Testnet fee tiers (fixed SAL1): short ≤4 = 2000, mid 5–6 = 500, long 7+ = 100.")
                        wrapMode: Text.WordWrap
                        color: MoneroComponents.Style.dimmedFontColor
                        font.pixelSize: 11
                        Layout.fillWidth: true
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        visible: tickerSuggestModel.count > 0
                        MoneroComponents.TextPlain {
                            text: qsTr("Free tickers (3):")
                            font.pixelSize: 11
                            color: MoneroComponents.Style.dimmedFontColor
                        }
                        Repeater {
                            model: tickerSuggestModel
                            delegate: MoneroComponents.StandardButton {
                                text: ticker
                                small: true
                                fontBold: String(mintTickerInput.text || "").trim().toUpperCase() === String(ticker)
                                         || String(mintQuote.ticker || "").toUpperCase() === String(ticker)
                                onClicked: {
                                    pickSuggestedTicker(ticker);
                                    // Stay on quote; re-quote if user wants a different free ticker.
                                }
                            }
                        }
                    }
                    MoneroComponents.TextPlain {
                        visible: !!mintQuote.treasury_address
                        text: "Treasury: " + (mintQuote.treasury_address || "")
                        color: MoneroComponents.Style.dimmedFontColor; font.pixelSize: 11
                        elide: Text.ElideMiddle; Layout.fillWidth: true
                    }
                    MoneroComponents.TextPlain {
                        visible: !!mintQuote.note
                        text: String(mintQuote.note || "")
                        wrapMode: Text.WordWrap
                        color: MoneroComponents.Style.dimmedFontColor; font.pixelSize: 12
                        Layout.fillWidth: true
                    }
                    MoneroComponents.TextPlain {
                        text: qsTr("This does not mint yet. Start Mint only reserves the name. Pay From Wallet opens the normal Confirm dialog, then asks for your wallet password before the fee is sent. Nothing is spent without both steps. Operator burn of ~50% is later, not your wallet.")
                        wrapMode: Text.WordWrap
                        color: MoneroComponents.Style.dimmedFontColor; font.pixelSize: 12
                        Layout.fillWidth: true
                    }
                }
            }

            RowLayout {
                spacing: 12

                MoneroComponents.StandardButton {
                    text: qsTr("Start Mint"); small: true
                    enabled: !isProcessing
                    onClicked: startMintFromQuote()
                }

                MoneroComponents.StandardButton {
                    text: qsTr("Cancel"); small: true
                    onClicked: cancelMint()
                }
            }
        }

        ColumnLayout {
            visible: mintStep === "reserved"
            Layout.fillWidth: true
            spacing: 10

            Rectangle {
                Layout.fillWidth: true
                implicitHeight: reservedCol.implicitHeight + 24
                color: MoneroComponents.Style.blackTheme ? "#1b2e1b" : "#f0fff0"
                radius: 6
                border.width: 1
                border.color: "#00c853"

                ColumnLayout {
                    id: reservedCol
                    width: parent.width - 24
                    anchors { left: parent.left; right: parent.right; top: parent.top; margins: 12 }
                    spacing: 6

                    MoneroComponents.TextPlain {
                        text: "Minting: " + (mintReservation.name || mintName)
                        color: "#00c853"; font.pixelSize: 14; font.bold: true
                    }
                    MoneroComponents.TextPlain {
                        text: "Mint session ID: " + (mintReservation.reservation_id || "")
                        color: MoneroComponents.Style.dimmedFontColor; font.pixelSize: 11
                        elide: Text.ElideRight; Layout.fillWidth: true
                    }
                    MoneroComponents.TextPlain {
                        text: "Fee: " + String(mintReservation.fee || "") + " " + mintPaymentAssetType
                        color: MoneroComponents.Style.defaultFontColor; font.pixelSize: 13
                    }
                    MoneroComponents.TextPlain {
                        text: "To: " + (mintReservation.treasury_address || "")
                        color: MoneroComponents.Style.dimmedFontColor; font.pixelSize: 11
                        elide: Text.ElideMiddle; Layout.fillWidth: true
                    }
                    MoneroComponents.TextPlain {
                        visible: !!mintReservation.expires_at
                        text: "Hold expires: " + String(mintReservation.expires_at || "")
                        color: MoneroComponents.Style.dimmedFontColor; font.pixelSize: 11
                    }
                }
            }

            MoneroComponents.TextPlain {
                text: qsTr("1) Click Pay From Wallet — builds a fee payment to the mint treasury. 2) Review the Confirm transaction popup (amount + fee). 3) Enter your wallet password when asked (Settings → “Ask for password before sending” is on by default). 4) After the payment is sent, SalPay verifies it on-chain and finishes the mint. Operator burns ~50% later — you only approve one send.")
                    .arg(mintPaymentAssetType)
                wrapMode: Text.WordWrap
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 12
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                text: qsTr("Unlocked %1: ").arg(mintPaymentAssetType)
                    + Utils.removeTrailingZeros(walletManager.displayAmount(getMintUnlockedBalanceAtomic()))
                    + "  ·  need: "
                    + (function() {
                        var outs = getExpectedPaymentOutputs();
                        var need = 0;
                        for (var i = 0; i < outs.length; i++)
                            need += feeAmountToAtomic(outs[i].amount);
                        return need > 0
                            ? Utils.removeTrailingZeros(walletManager.displayAmount(need))
                            : "—";
                    })()
                    + "  ·  network: " + walletNetworkName()
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 11
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                visible: payButtonBlockReason() !== ""
                text: qsTr("Pay unavailable: ") + payButtonBlockReason()
                wrapMode: Text.WordWrap
                color: "#ff9800"
                font.pixelSize: 11
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                text: qsTr("Already paid? Paste the payment tx hash (64 hex chars) and Verify — do not pay twice. Your leftover balance is change after the fee left your wallet.")
                wrapMode: Text.WordWrap
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 11
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                MoneroComponents.TextPlain {
                    text: qsTr("Fee amount:")
                    font.pixelSize: 11
                    color: MoneroComponents.Style.dimmedFontColor
                }
                MoneroComponents.LineEditMulti {
                    id: verifyAmountInput
                    Layout.preferredWidth: 100
                    text: String(mintReservation.fee || mintQuote.fee || "412")
                    placeholderText: "412"
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                MoneroComponents.TextPlain {
                    text: qsTr("Payment tx:")
                    font.pixelSize: 11
                    color: MoneroComponents.Style.dimmedFontColor
                }
                MoneroComponents.LineEditMulti {
                    id: verifyTxHashInput
                    Layout.fillWidth: true
                    placeholderText: qsTr("paste tx hash if already paid")
                    text: mintLastPaidTxHash !== "" ? mintLastPaidTxHash : (knownRecoveryPaymentTx || "")
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8

                MoneroComponents.StandardButton {
                    // Always clickable when reserved so users get a clear error instead of a dead grey button.
                    text: qsTr("Pay From Wallet"); small: true
                    enabled: !!mintReservation.reservation_id && !isProcessing && !mintAutoTracking
                    onClicked: {
                        ensureReservationPayable();
                        payReservationFromWallet();
                    }
                }

                MoneroComponents.StandardButton {
                    text: qsTr("I already paid — scan"); small: true
                    enabled: !!mintReservation.reservation_id && !isProcessing
                    onClicked: {
                        if (verifyTxHashInput.text.trim().length >= 32)
                            mintLastPaidTxHash = verifyTxHashInput.text.trim();
                        resumeAfterManualPayment();
                    }
                }

                MoneroComponents.StandardButton {
                    text: qsTr("Verify payment"); small: true
                    enabled: !!mintReservation.reservation_id && verifyTxHashInput.text.trim().length >= 32 && !isProcessing
                    onClicked: {
                        if (verifyAmountInput.text.trim() === "" && mintReservation.fee)
                            verifyAmountInput.text = String(mintReservation.fee);
                        verifyMintPayment();
                    }
                }

                MoneroComponents.StandardButton {
                    text: qsTr("Complete mint"); small: true
                    enabled: mintStep === "verified" && !isProcessing
                    onClicked: executeMint()
                }

                MoneroComponents.StandardButton {
                    text: mintAutoTracking ? qsTr("Stop / Reset mint") : qsTr("Cancel Mint")
                    small: true
                    visible: true
                    enabled: true
                    onClicked: cancelMint()
                }
            }

            MoneroComponents.TextPlain {
                visible: mintAutoTracking
                text: qsTr("Waiting for wallet confirmation… If no popup appeared, click Stop / Reset mint. If you already confirmed the send, click “I already paid — scan”.")
                wrapMode: Text.WordWrap
                color: "#ff9800"
                font.pixelSize: 11
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                text: qsTr("Process: locked mint fee is %1 SAL1 on %2 (full-treasury = one transfer). The wallet popup also shows a small network fee (~0.01–0.2 SAL1) — that is normal, not a second mint charge. Do not Reset after paying; use “I already paid — scan”. If mint fails after pay, funds are at the treasury (not frozen in your wallet); retry scan or ops can force-complete/refund with your tx hash.")
                    .arg(String(mintReservation.fee || mintQuote.fee || "—"))
                    .arg(walletNetworkName())
                wrapMode: Text.WordWrap
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 11
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                visible: mintLastPaidTxHash !== ""
                text: qsTr("Saved payment tx (for recovery): %1").arg(mintLastPaidTxHash)
                wrapMode: Text.WrapAnywhere
                color: "#ff9800"
                font.pixelSize: 10
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                visible: mintAutoTracking || mintAutoTxHash !== ""
                text: mintAutoTxHash !== "" ? (qsTr("Detected payment tx: ") + mintAutoTxHash) : qsTr("Waiting for your wallet transaction...")
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 11
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                visible: mintAutoTracking
                text: qsTr("Detector: scanned %1 tx(s), mode=%2, last=%3")
                    .arg(String(mintAutoScanCount))
                    .arg(String(mintAutoMatchMode || "none"))
                    .arg(mintAutoLastScannedHash !== "" ? mintAutoLastScannedHash : "-")
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 10
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                visible: mintAutoTracking && mintAutoScanTotal > mintAutoScanCount
                text: qsTr("Showing newest %1 of %2 wallet transactions")
                    .arg(String(mintAutoScanCount))
                    .arg(String(mintAutoScanTotal))
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 10
                Layout.fillWidth: true
            }
        }

        ColumnLayout {
            visible: mintStep === "verified"
            Layout.fillWidth: true
            spacing: 10

            MoneroComponents.TextPlain {
                text: qsTr("Payment verified. Finalize mint on salpay.org backend.")
                color: "#00c853"
                font.pixelSize: 13
                font.bold: true
            }

            RowLayout {
                spacing: 12

                MoneroComponents.StandardButton {
                    text: qsTr("Execute Mint"); small: true
                    enabled: !isProcessing && !mintAutoExecuteRequested
                    onClicked: executeMint()
                }

                MoneroComponents.StandardButton {
                    text: qsTr("Cancel"); small: true
                    visible: false
                    enabled: false
                }
            }
        }

        ColumnLayout {
            visible: mintStep === "executing"
            Layout.fillWidth: true
            spacing: 10

            MoneroComponents.TextPlain {
                text: qsTr("Mint job submitted. Waiting for completion...")
                color: MoneroComponents.Style.defaultFontColor
                font.pixelSize: 13
            }

            MoneroComponents.TextPlain {
                text: "Job: " + (mintJob.job_id || mintJob.id || "")
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 11
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }

            MoneroComponents.StandardButton {
                text: qsTr("Refresh Status"); small: true
                onClicked: fetchMintStatus()
            }
        }

        ColumnLayout {
            visible: mintStep === "complete"
            Layout.fillWidth: true
            spacing: 10

            MoneroComponents.TextPlain {
                text: qsTr("Mint completed successfully.")
                color: "#00c853"
                font.pixelSize: 14
                font.bold: true
            }

            MoneroComponents.TextPlain {
                text: "Name: " + (mintName || "")
                color: MoneroComponents.Style.defaultFontColor
                font.pixelSize: 12
            }

            MoneroComponents.TextPlain {
                text: "Mint tx: " + (mintJob.tx_hash || "")
                color: MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 11
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }

            MoneroComponents.TextPlain {
                text: resolveOk ? ("Resolved to: " + resolvedAddress) : qsTr("Resolution may take a moment; try resolving again from Send.")
                color: resolveOk ? "#00c853" : MoneroComponents.Style.dimmedFontColor
                font.pixelSize: 11
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            RowLayout {
                spacing: 12

                MoneroComponents.StandardButton {
                    text: qsTr("Mint Another"); small: true
                    onClicked: cancelMint()
                }

                MoneroComponents.StandardButton {
                    text: qsTr("Go To Send"); small: true
                    onClicked: {
                        middlePanel.state = "Transfer";
                        middlePanel.transferView.clearFields();
                    }
                }
            }
        }

        MoneroComponents.TextPlain {
            visible: mintAutoProgressLabel !== ""
            text: mintAutoProgressLabel
            color: MoneroComponents.Style.defaultFontColor
            font.pixelSize: 12
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            Layout.topMargin: 8
        }

        Rectangle {
            visible: mintAutoProgressValue > 0
            Layout.fillWidth: true
            Layout.preferredHeight: 10
            radius: 5
            color: MoneroComponents.Style.blackTheme ? "#233223" : "#dfeee0"

            Rectangle {
                anchors.left: parent.left
                anchors.top: parent.top
                anchors.bottom: parent.bottom
                width: parent.width * mintAutoProgressValue
                radius: parent.radius
                color: "#00c853"
            }
        }

        MoneroComponents.TextPlain {
            visible: statusMsg !== ""
            text: statusMsg
            color: statusColor()
            font.pixelSize: 12
            wrapMode: Text.WordWrap
            Layout.fillWidth: true
            Layout.topMargin: 10
        }

        // Always available escape hatch when a mint session is mid-flow or stuck.
        MoneroComponents.StandardButton {
            visible: mintStep !== "idle" || mintAutoTracking || isProcessing
            text: qsTr("Reset mint session")
            small: true
            enabled: true
            Layout.topMargin: 8
            onClicked: cancelMint()
        }

        Item { height: 24 }
    }

    Connections {
        target: (typeof currentWallet === "undefined") ? null : currentWallet

        function onTransactionCreated(pendingTransaction, addresses, asset_type, paymentId, mixinCount) {
            handleMintWalletTransactionCreated(pendingTransaction);
        }

        function onTransactionCommitted(success, transaction, txid) {
            handleMintWalletTransactionCommitted(success, transaction, txid);
        }
    }

    Timer {
        id: mintAutoPollTimer
        interval: 3000
        repeat: true
        running: false
        onTriggered: pollMintAutomation()
    }

    Timer {
        id: mintStatusPollTimer
        interval: 3000
        repeat: true
        running: false
        onTriggered: fetchMintStatus()
    }

    // Defer network work so tab switches do not freeze the UI thread
    // (WalletManager SalPay HTTP helpers run nested QEventLoop on the GUI thread).
    Timer {
        id: pageInitTimer
        interval: 80
        repeat: false
        onTriggered: {
            if (!root.visible)
                return;
            refreshTurnstileConfig();
            refreshOwnedNames();
            // Do not auto-fill tickers when name field is empty — only after user types a name.
            if ((mintStep === "idle" || mintStep === "quote")
                    && String(mintNameInput.text || "").trim().length > 0)
                refreshTickerSuggestions();
        }
    }

    onVisibleChanged: {
        if (!visible) {
            pageInitTimer.stop();
            resolveDelayTimer.stop();
            tickerSuggestTimer.stop();
            // Stop polling when leaving the tab so return is snappy.
            if (!hasActiveMintSession()) {
                mintAutoPollTimer.stop();
                mintStatusPollTimer.stop();
            }
        }
    }

    // Clear form fields when entering SalPay unless a mint is still in progress.
    // Users should never see stuck names/tickers from a previous visit.
    function clearSalpayEntryFields() {
        try { sendNameInput.text = ""; } catch (e1) {}
        try { sendAmountInput.text = ""; } catch (e2) {}
        try { mintNameInput.text = ""; } catch (e3) {}
        try { mintTickerInput.text = ""; } catch (e4) {}
        try { verifyTxHashInput.text = ""; } catch (e5) {}
        try { verifyAmountInput.text = ""; } catch (e6) {}
        mintName = "";
        mintQuote = {};
        mintReservation = {};
        mintVerification = {};
        mintJob = {};
        mintTickerManual = false;
        mintTickerSuggestions = [];
        mintTickerSuggestStatus = "";
        tickerSuggestModel.clear();
        resolvedAddress = "";
        resolveOk = false;
        resolveError = "";
        ownedNamesStatus = "";
        // Keep ownedNamesModel until refreshOwnedNames fills it (that list is intentional).
    }

    function onPageCompleted() {
        ensureSalpayConfigured();
        if (!hasActiveMintSession()) {
            mintStep = "idle";
            setStatus("", "info");
            resetMintAutomation();
            mintAutoPollTimer.stop();
            mintStatusPollTimer.stop();
            clearSalpayEntryFields();
        } else {
            // Mid-mint: only clear send fields so incomplete mint state stays visible.
            try { sendNameInput.text = ""; } catch (e7) {}
            try { sendAmountInput.text = ""; } catch (e8) {}
            resolvedAddress = "";
            resolveOk = false;
            resolveError = "";
        }
        // Do not call blocking HTTP here — schedule after paint.
        pageInitTimer.restart();
    }
}
