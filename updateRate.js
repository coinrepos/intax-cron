const { ethers } = require("ethers");

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
    console.log("Attempting to fetch rate from Treasury.gov API...");
    
    const response = await fetch('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/rates_of_exchange?fields=country,exchange_rate,record_date&sort=-record_date&page[size]=1');
    
    console.log("Response status:", response.status);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Full API response:", JSON.stringify(data, null, 2));
    
    // For now, still return 250 until we see the response
    return 250;
    
  } catch (error) {
    console.error("Error in getOfficialRate:", error.message);
    console.log("Stack trace:", error.stack);
    console.log("Using fallback rate: 250 basis points (2.5%)");
    return 250;
  }
}

async function main() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    const rate = await getOfficialRate();
    console.log(`Fetched rate: ${rate} basis points`);

    const tx = await contract.setTaxRate(rate);
    console.log("Transaction sent:", tx.hash);
    await tx.wait();
    console.log("✅ Tax rate updated to", rate);
  } catch (e) {
    console.error("❌ Failed:", e.message);
  }
}

main();