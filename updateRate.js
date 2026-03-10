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
  console.log("🚀 Entering getOfficialRate function");
  
  try {
    console.log("📡 Fetching rate from Treasury.gov API...");
    
    const baseUrl = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
    const endpoint = '/v1/accounting/od/rates_of_exchange';
    const fullUrl = baseUrl + endpoint;
    
    console.log("Full URL:", fullUrl);
    
    const response = await axios.get(fullUrl, {
      params: {
        'fields': 'country_currency_desc,exchange_rate,record_date',
        'filter': 'country_currency_desc:eq:Canada-Dollar',
        'sort': '-record_date',
        'page[size]': 1
      },
      timeout: 10000 // 10 second timeout
    });
    
    console.log("✅ API Response received");
    console.log("Response status:", response.status);
    console.log("Response headers:", response.headers);
    console.log("Response data structure:", JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      const latestEntry = response.data.data[0];
      console.log("Latest entry:", JSON.stringify(latestEntry, null, 2));
      
      const rateValue = parseFloat(latestEntry.exchange_rate);
      console.log(`Exchange rate: ${rateValue}`);
      
      // For now, return a test value so we can see the logs
      console.log("⚠️ Returning test rate 525 for now");
      return 525;
      
    } else {
      console.log("❌ No data in response");
      throw new Error("No data found in API response");
    }
    
  } catch (error) {
    console.error("❌ Error in getOfficialRate:", error.message);
    if (error.code) console.error("Error code:", error.code);
    if (error.response) {
      console.error("Response status:", error.response.status);
      console.error("Response data:", error.response.data);
    }
    if (error.request) {
      console.error("Request was made but no response received");
      console.error("Request details:", error.request._currentUrl || error.request);
    }
    console.log("⚠️ Using fallback rate: 250 basis points (2.5%)");
    return 250;
  }
}

async function main() {
  try {
    console.log("🚀 Starting InTax rate update...");
    console.log("Node version:", process.version);
    console.log("Axios version:", axios.VERSION);
    
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