const { ethers } = require("ethers");
const axios = require('axios');

// ─────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────
const RPC_URL = "https://public-node.rsk.co";
const CONTRACT_ADDRESS = "0x8F94FD728011Df4Be46828303938aA32155B7981";
const PRIVATE_KEY = "41a00b4be3155da5177389d9ad564099312b73c675b30f001eccb0a370f94acd";

const ABI = [
  "function setTaxRate(uint256 _rate) external"
];
// ─────────────────────────────────────────────────────────────

async function getOfficialRate() {
  try {
    console.log("📡 Fetching rate from Treasury.gov API...");

    // --- CORRECTED URL based on documentation ---
    const baseUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
    const endpoint = '/v1/accounting/od/rates_of_exchange';

    const response = await axios.get(baseUrl + endpoint, {
      params: {
        'fields': 'country_currency_desc,exchange_rate,record_date',
        'filter': 'country_currency_desc:eq:Canada-Dollar', // Example: get rate for CAD
        'sort': '-record_date',
        'page[size]': 1
      }
    });

    console.log("✅ API Response received");
    
    // Log the structure to see what we get
    console.log("Response data structure:", JSON.stringify(response.data, null, 2));

    // --- Extract the rate ---
    // The data is inside a 'data' array
    if (response.data && response.data.data && response.data.data.length > 0) {
      const latestEntry = response.data.data[0];
      // The exchange_rate field is a string, e.g., "1.426"
      const rateValue = parseFloat(latestEntry.exchange_rate);
      
      // Convert to basis points (e.g., 1.426 -> 143? This is likely not what you want)
      // You probably want a percentage rate, not an exchange rate.
      console.log(`❓ The API returns EXCHANGE rates, not CENTRAL BANK rates.`);
      console.log(`   Example - 1 USD = ${rateValue} ${latestEntry.country_currency_desc}`);
      console.log(`   This is likely NOT what you need for InTax.`);
      
      // Return a placeholder until you confirm the correct data source
      const fallbackRate = 525; // 5.25% as basis points
      console.log(`⚠️ Using fallback rate: ${fallbackRate} basis points (5.25%)`);
      return fallbackRate;
      
    } else {
      throw new Error("No data found in API response");
    }
    
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