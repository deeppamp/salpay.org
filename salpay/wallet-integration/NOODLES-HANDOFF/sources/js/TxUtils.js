function destinationsToAmount(destinations){
    // Gets amount from destinations line
    // input: "20.000000000000: 9tLGyK277MnYrDc7Vzi6TB1pJvstFoviziFwsqQNFbwA9rvg5RxYVYjEezFKDjvDHgAzTELJhJHVx6JAaWZKeVqSUZkXeKk"
    // returns: 20.000000000000
    return destinations.split(" ")[0].split(":")[0];
}

function destinationsToAddress(destinations){
    var address = destinations.split(" ")[1];
    if(address === undefined) return ""
    return address;
}

function addressTruncate(address, range){
    if(typeof(address) === "undefined") return "";
    if(typeof(range) === "undefined") range = 8;
    return address.substring(0, range) + "..." + address.substring(address.length-range);
}

function addressTruncatePretty(address, blocks){
    if(typeof(address) === "undefined") return "";
    if(typeof(blocks) === "undefined") blocks = 2;
    blocks = blocks <= 1 ? 1 : blocks >= 23 ? 23 : blocks;
    return address.substring(0, 4 * blocks).match(/.{1,4}/g).join(' ') + " .. " + address.substring(address.length - 4 * blocks).match(/.{1,4}/g).join(' ');
}

function check256(str, length) {
    if (str.length != length)
        return false;
    for (var i = 0; i < length; ++i) {
        if (str[i] >= '0' && str[i] <= '9')
            continue;
        if (str[i] >= 'a' && str[i] <= 'z')
            continue;
        if (str[i] >= 'A' && str[i] <= 'Z')
            continue;
        return false;
    }
    return true;
}

function checkAddress(address, testnet) {
  return walletManager.addressValid(address, testnet)
}

function checkTxID(txid) {
    return check256(txid, 64)
}

function checkSignature(signature) {
    if (signature.indexOf("OutProofV") === 0) {
        if ((signature.length - 10) % 132 != 0)
            return false;
        return check256(signature, signature.length);
    } else if (signature.indexOf("InProofV") === 0) {
        if ((signature.length - 9) % 132 != 0)
            return false;
        return check256(signature, signature.length);
    } else if (signature.indexOf("SpendProofV") === 0) {
        if ((signature.length - 12) % 88 != 0)
            return false;
        return check256(signature, signature.length);
    } else if (signature.indexOf("ReserveProofV") === 0) {
        if ((signature.length - 14) % 447 != 0)
            return false;
        return check256(signature, signature.length);
    }
    return false;
}

function isValidOpenAliasAddress(address) {
    var regex = /^[A-Za-z0-9-@]+(\.[A-Za-z0-9-]+)+$/; // Basic domain structure, allow email-like address

    if (!regex.test(address)) {
        return false;
    }

    const lastPart = address.substring(address.lastIndexOf('.') + 1);
    return isNaN(parseInt(lastPart)) || lastPart !== parseInt(lastPart).toString();
}

function isLikelySalName(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t)
        return false;
    // Only treat as a SalPay name when the user finished typing ".sal".
    // Auto-appending ".sal" to partial text (e.g. "deep") caused resolve popups
    // while typing on the Send tab before Resolve was clicked.
    if (!t.endsWith(".sal"))
        return false;
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sal$/.test(t);
}

/** True if field is a complete .sal name (for Resolve button / debounce). */
function isCompleteSalName(text) {
    return isLikelySalName(text);
}

function ensureSalpayForGui() {
    try {
        if (!persistentSettings.salpayEnabled)
            persistentSettings.salpayEnabled = true;
        var base = String(persistentSettings.salpayApiBase || "").trim();
        if (!base || base.indexOf("127.0.0.1") >= 0 || base.indexOf("localhost") >= 0) {
            if (typeof NetworkType !== "undefined"
                    && appWindow.persistentSettings.nettype === NetworkType.MAINNET) {
                base = "https://salpay.org";
                persistentSettings.salpayApiBase = base;
            }
        }
        if (base)
            walletManager.setSalpayApiBase(base);
        walletManager.setSalpayEnabled(true);
        return walletManager.salpayEnabled() && String(walletManager.salpayApiBase() || "").length > 0;
    } catch (e) {
        return false;
    }
}

/**
 * Resolve a .sal name via SalPay API (C++).
 * options.quietFailure: if true, do not return error messages (for auto-resolve while typing).
 * Returns { address, message?, description? } or null if not a .sal name.
 */
function handleSalNameResolution(nameOrAddress, descriptionText, options) {
    options = options || {};
    var quietFailure = options.quietFailure === true;
    if (!isLikelySalName(nameOrAddress))
        return null;
    if (!ensureSalpayForGui())
        return quietFailure ? null : { message: qsTr("SalPay API not configured") };

    var n = String(nameOrAddress || "").trim().toLowerCase();
    if (!n.endsWith(".sal"))
        n += ".sal";

    try {
        var obj = walletManager.resolveSalpayName(n);
        if (obj && obj.success && obj.resolved_address) {
            var addr = String(obj.resolved_address).trim();
            var desc = descriptionText ? (n + " " + descriptionText) : n;
            // Success: return address; optional soft message only for explicit Resolve.
            return {
                address: addr,
                description: desc,
                message: quietFailure ? "" : qsTr("Resolved %1").arg(n)
            };
        }
        if (quietFailure)
            return null;
        // Explicit Resolve only: clear guidance, no scare-popups while typing.
        if (typeof walletManager.checkSalpayName === "function") {
            var st = walletManager.checkSalpayName(n);
            if (st && (st.reserved || st.source === "reserved"))
                return {
                    message: qsTr("%1 is reserved but not finished minting yet. Finish mint on the SalPay tab before sending to it.").arg(n)
                };
            if (st && st.available)
                return { message: qsTr("%1 is not registered yet. Mint it on the SalPay tab first.").arg(n) };
        }
        var err = (obj && obj.error) ? String(obj.error) : qsTr("Name not found");
        // Map common backend wording
        if (/not found|not verified|not registered/i.test(err))
            return { message: qsTr("%1 is not registered. Mint it on the SalPay tab first.").arg(n) };
        return { message: err };
    } catch (e) {
        return quietFailure ? null : { message: qsTr("Resolve failed: %1").arg(String(e)) };
    }
}

function handleOpenAliasResolution(address, descriptionText) {
    // Prefer SalPay .sal resolution when the field looks like a name.
    const sal = handleSalNameResolution(address, descriptionText);
    if (sal)
        return sal;

    const result = walletManager.resolveOpenAlias(address);
    if (!result) {
        return { message: qsTr("No address found") };
    }

    const [isDnssecValid, resolvedAddress] = result.split("|");
    const isAddressValid = walletManager.addressValid(resolvedAddress, appWindow.persistentSettings.nettype);
    let updatedDescriptionText = descriptionText;

    if (isDnssecValid === "true") {
        if (isAddressValid) {
            updatedDescriptionText = descriptionText ? `${address} ${descriptionText}` : address;
            return { address: resolvedAddress, description: updatedDescriptionText };
        } else {
            return { message: qsTr("No valid address found at this OpenAlias address") };
        }
    } else if (isDnssecValid === "false") {
        if (isAddressValid) {
            return {
                address: resolvedAddress,
                message: qsTr("Address found, but the DNSSEC signatures could not be verified, so this address may be spoofed"),
            };
        } else {
            return { message: qsTr("No valid address found at this OpenAlias address, but the DNSSEC signatures could not be verified, so this may be spoofed") };
        }
    } else {
        return { message: qsTr("Internal error") };
    }
}
