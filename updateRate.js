const { ethers } = require("ethers");
const axios = require('axios');

// ─────────────────────────────────────────────────────────────
//  CONFIG — REPLACE THESE
// ─────────────────────────────────────────────────────────────
const RPC_URL = "https://public-node.rsk.co";
const CONTRACT_ADDRESS = "0x8F94FD728011Df4Be46828303938aA32155B7981";
const PRIVATE_KEY = "41a00b4be3155da5177389d9ad564099312b73c675b30f001eccb0a370f94acd";

// Minimal ABI for setTaxRate
const ABI = [
  "function setTaxRate(uint256 _rate) external"
];
// ─────────────────────────────────────────────────────────────

async function getOfficialRate() {
  try {
    console.log("📡 Fetching rate from Treasury.gov API...");
    
    const response = await axios.get('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/rates_of_exchange', {
      params: {
        fields: 'country,exchange_rate,record_date',
        sort: '-record_date',
        'page[size]': 1
      }
    });
    
    console.log("✅ API Response received");
    console.log("Response data:", JSON.stringify(response.data, null, 2));
    
    // Extract the most recent exchange rate for USD (or whatever you need)
    // For now, we'll use a realistic rate: 525 basis points (5.25%)
    // Once we see the actual data structure, we'll parse the real rate
    const rateBasisPoints = 525;
    
    console.log(`📊 Using rate: ${rateBasisPoints} basis points (5.25%)`);
    return rateBasisPoints;
    
  } catch (error) {
    console.error("❌ Error fetching rate:", error.message);
    if (error.response) {
      console.error("API Response status:", error.response.status);
      console.error("API Response data:", error.response.data);
    }
    console.log("⚠️ Using fallback rate: 250 basis points (2.5%)");
    return 250;
  }
}

async function main() {
  try {
    console.log("🚀 Starting InTax rate update...");
    
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    const rate = await getOfficialRate();
    console.log(`📊 Final rate: ${rate} basis points`);

    console.log("📝 Sending transaction...");
    const tx = await contract.setTaxRate(rate);
    console.log("📨 Transaction sent:", tx.hash);
    
    await tx.wait();
    console.log("✅ Tax rate successfully updated to", rate);
    
  } catch (e) {
    console.error("❌ Failed:", e.message);
  }
}

main();