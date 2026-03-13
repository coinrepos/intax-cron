const { ethers } = require("ethers");

// ─────────────────────────────────────────────────────────────
//  CONFIG — REPLACE THESE
// ─────────────────────────────────────────────────────────────
const RPC_URL = "https://public-node.rsk.co";
const CONTRACT_ADDRESS = "0x8F94FD728011Df4Be46828303938aA32155B7981";
const PRIVATE_KEY = "41a00b4be3155da5177389d9ad564099312b73c675b30f001eccb0a370f94acd";  // Replace with your actual key (from 0xb83b... or 0xE10a...)

// Minimal ABI for setTaxRate
const ABI = [
  "function setTaxRate(uint256 _rate) external"
];
// ─────────────────────────────────────────────────────────────

async function getOfficialRate() {
  // You will replace this with a real API call (FRED, ECB, etc.)
  // For now, it returns 250 (2.5%) as a placeholder
  // Example API: https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/rates_of_exchange
  return 250;
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