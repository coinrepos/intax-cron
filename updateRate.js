const { ethers } = require("ethers");
const axios = require('axios');
const fs = require('fs');

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

function logToFile(msg) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync('/tmp/intax-debug.log', `[${timestamp}] ${msg}\n`);
  console.log(msg); // Also log to console
}

async function getOfficialRate() {
  logToFile("🚀 Entering getOfficialRate function");
  
  try {
    logToFile("📡 Fetching rate from Treasury.gov API...");
    
    // Using Treasury API - no key required
    const response = await axios.get('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates', {
      params: {
        'fields': 'record_date,avg_interest_rate_amt',
        'filter': 'security_desc:eq:Treasury Bills',
        'sort': '-record_date',
        'page[size]': 1
      },
      timeout: 10000
    });
    
    logToFile(`✅ API Response received`);
    logToFile(`Response status: ${response.status}`);
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      const latestEntry = response.data.data[0];
      const rateValue = parseFloat(latestEntry.avg_interest_rate_amt);
      
      logToFile(`Latest rate date: ${latestEntry.record_date}`);
      logToFile(`Raw rate from Treasury: ${rateValue}%`);
      
      // Convert percentage to basis points
      const rateBasisPoints = Math.round(rateValue * 100);
      logToFile(`Converted to basis points: ${rateBasisPoints}`);
      
      return rateBasisPoints;
      
    } else {
      logToFile(`❌ No data in Treasury response`);
      throw new Error("No data found in Treasury API response");
    }
    
  } catch (error) {
    logToFile(`❌ Error: ${error.message}`);
    if (error.response) {
      logToFile(`Response status: ${error.response.status}`);
      logToFile(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    logToFile(`⚠️ Using fallback rate: 250 basis points (2.5%)`);
    return 250;
  }
}

async function main() {
  logToFile("🚀 Starting InTax rate update...");
  
  try {
    const rate = await getOfficialRate();
    logToFile(`📊 Final rate: ${rate} basis points`);

    // Only proceed if rate is valid and not the fallback (or forced)
    if (rate !== 250 || process.env.FORCE_UPDATE === 'true') {
        logToFile("📝 Connecting to Rootstock...");
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
        
        logToFile("📝 Sending transaction to update contract...");
        const tx = await contract.setTaxRate(rate);
        logToFile(`📨 Transaction sent: ${tx.hash}`);
        
        await tx.wait();
        logToFile(`✅ Tax rate successfully updated to ${rate} basis points`);
    } else {
        logToFile("⏸️ Using fallback rate. Transaction skipped (set FORCE_UPDATE=true to override)");
    }
    
  } catch (e) {
    logToFile(`❌ Failed: ${e.message}`);
  } finally {
    // Output the debug log for GitHub Actions to capture
    if (fs.existsSync('/tmp/intax-debug.log')) {
      const logContent = fs.readFileSync('/tmp/intax-debug.log', 'utf8');
      console.log("\n=== DEBUG LOG START ===");
      console.log(logContent);
      console.log("=== DEBUG LOG END ===\n");
    }
  }
}

main();