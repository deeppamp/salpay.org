# Making salpay.org public on GitHub

Use this before flipping the repo from private -> public.

## Already safe in git (as of public-ready commits)

- Backend/frontend/deploy templates  
- Docs and wallet integration guides  
- Treasury-view **install scripts** (require secrets via env, not embedded)  
- No `.env.server`, no OPS keys, no view-balance secrets, no user wallet `.keys`  
- No wallet-rpc `.login` passwords (example file only)  
- Git history rewritten so old VPS host/user/local paths and RPC passwords are not on `main`

## Must stay only on your machines / VPS

| Item | Location (examples) |
|------|---------------------|
| `.env.server` | VPS `/home/.../salpay/.env.server` |
| OPS_API_KEY | same env + local private note |
| Treasury view-balance secret | offline / password manager |
| Treasury view `.keys` | VPS `treasury-view/`, Windows `private/treasury-view/` |
| Test wallets `salpaytest*` | local disk (gitignored) |
| Cloudflare Turnstile secret | server env only |

## GitHub UI: make public

1. Open https://github.com/deeppamp/salpay.org  
2. **Settings** -> **General** -> **Danger Zone** -> **Change repository visibility** -> **Public**  
3. Confirm.  

Optional after public:

- Add topics: `salvium`, `salpay`, `names`, `wallet`  
- Pin `README.md` and `salpay/docs/WALLET-INTEGRATION-SIMPLE.md`  
- Enable Issues if you want third-party wallets to report bugs  

## After going public

1. Rotate any credential that ever appeared in chat/logs if unsure.  
2. Confirm GitHub file search shows **no** private keys (search for `BEGIN`, `.keys`, `OPS_API_KEY=`).  
3. Point Noodles/Whisky to the public docs URL:  
   `https://github.com/deeppamp/salpay.org/blob/main/salpay/docs/WALLET-INTEGRATION-SIMPLE.md`

## Separate: wallet GUI binary

The downloadable wallet is **not** this repo alone. It is built from the private/local tree  
`salvium-gui-salpay-mainnet-vX.Y.Z`. Ship that as a **release asset** (zip) if you want; do not put user wallets or treasury keys in the zip.

See `UPGRADE-AND-FORK.md` for version bumps.
