// scripts/create-name.js
const fs = require('fs');

const SAL_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sal$/;

const name = process.argv[2] || "testuser.sal";
const ticker = (process.argv[3] || "TEST").toUpperCase();

const metadata = {
  standard: "sal-name-v1",
  name: name,
  ticker: ticker,
  primary_address: "YOUR_TESTNET_ADDRESS_HERE",   // <- Change this!
  sub_names: {
    "shop": { "index": 42, "label": "Shop payments" },
    "pay": { "index": 5, "label": "General payments" }
  },
  records: {
    description: "Test .sal name for salpay.org",
    website: "https://salpay.org"
  },
  carrot_enabled: true,
  sparc_returns: true,
  created_at: new Date().toISOString()
};

console.log(`✅ Creating .sal name: ${name}`);
console.log(`Ticker: ${ticker}\n`);

if (!SAL_NAME_REGEX.test(name.toLowerCase())) {
  console.error("Name must be lowercase, end with .sal, contain 1-63 letters/numbers/hyphens before .sal, and start/end with a letter or number");
  process.exit(1);
}

if (!/^[A-Z0-9]{4}$/.test(ticker)) {
  console.error("Ticker must be exactly 4 uppercase letters or numbers");
  process.exit(1);
}

const metadataJson = JSON.stringify(metadata, null, 2);
fs.writeFileSync(`metadata-${name.replace('.sal', '')}.json`, metadataJson);

console.log("📄 Metadata saved!\n");
console.log(metadataJson);

console.log("\n🔗 Start wallet RPC first with: scripts\\start-wallet-rpc.bat");
console.log("Current known behavior from earlier builds: create_token may return 'Create_token is not available yet.' Re-test on v1.1.3c before relying on CLI minting.\n");

console.log("RPC request template:");
console.log(`curl.exe http://127.0.0.1:29088/json_rpc -X POST -H "Content-Type: application/json" -d '${JSON.stringify({
  jsonrpc: "2.0",
  id: "0",
  method: "create_token",
  params: {
    ticker: ticker,
    supply: 1,
    name: name,
    // token_metadata_hex: "..."   // We'll add this later
  }
})}'`);
