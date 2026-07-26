# Name Standard

This document defines the SalPay application-level naming policy for `.sal` names.

## Scope

Salvium currently enforces the token asset type (`ticker`) more strictly than the human-readable token `name` field.
That means SalPay must define and enforce the `.sal` name standard consistently across:

- backend mint/reserve/register flows
- website registration UX
- wallet GUI mint flows
- local tooling and helper scripts

## `.sal` name rule

A valid SalPay name must:

- end with `.sal`
- use a base name length between `1` and `63` characters
- use only lowercase letters `a-z`, digits `0-9`, and hyphen `-`
- start with a letter or digit
- end with a letter or digit

Allowed examples:

- `a.sal`
- `bob.sal`
- `pay-1.sal`
- `merchant42.sal`

Rejected examples:

- `Bob.sal` : uppercase not allowed
- `-shop.sal` : cannot start with hyphen
- `shop-.sal` : cannot end with hyphen
- `shop_.sal` : underscore not allowed
- `shop..sal` : invalid characters/format
- names with more than 63 characters before `.sal`

## Canonical regex

Use this exact application policy regex:

```text
^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sal$
```

## Fee tiers

Fee tiers are based on the number of characters before `.sal`:

- `1-4` characters: `2000 SAL`
- `5-6` characters: `500 SAL`
- `7-63` characters: `100 SAL`

## Ticker rule

The Salvium token asset type used for minting must:

- be exactly `4` characters
- contain only uppercase letters `A-Z` and digits `0-9`

Salvium wallet `create_token` also rejects asset types that:

- **start with `SAL`** (e.g. `SALT`, `SALP`, `SAL1` -- any 4-char `SAL*`)
- equal reserved values such as `SAL`, `SAL1`, `SAL2`, or `BURN`

SalPay enforces this in:

- backend `isChainReservedTicker` / ticker suggestions / reserve+quote validation  
- GUI local ticker chips (never suggest `SAL*`)  

Auto stems for names like `salt.sal` become e.g. `XT0`/`XNAM` variants instead of `SALT`.

## Mainnet readiness note

If this policy ever changes, backend, frontend, GUI, and helper scripts must all be updated together before mainnet use.
Do not rely on UI-only validation.
