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
    // Using a free public API for US Federal Funds Rate
    // This returns the rate as a percentage (e.g., 5.25 for 5.25%)
    const response = await fetch('https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=0a53a7b8471a3adfc0a18e093b22b2c4&file_type=json&sort_order=desc&limit=1');
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract the latest rate from FRED response
    const latestObservation = data.observations[0];
    const ratePercent = parseFloat(latestObservation.value);
    
    // Convert percentage to basis points (e.g., 5.25% = 525 basis points)
    const rateBasisPoints = Math.round(ratePercent * 100);
    
    console.log(`Raw rate from FRED: ${ratePercent}%`);
    console.log(`Converted to basis points: ${rateBasisPoints}`);
    
    return rateBasisPoints;
  } catch (error) {
    console.error("Error fetching rate:", error.message);
    console.log("Using fallback rate: 250 basis points (2.5%)");
    return 250; // Fallback to 2.5% if API fails
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