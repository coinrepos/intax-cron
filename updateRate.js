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
  const logMessage = `[${timestamp}] ${msg}\n`;
  fs.appendFileSync('/tmp/intax-debug.log', logMessage);
  console.log(msg); // Also log to console for GitHub Actions
}

async function getOfficialRate() {
  logToFile("🚀 Entering getOfficialRate function");
  
  try {
    logToFile("📡 Fetching US Federal Funds Rate from FRED API...");
    
    // Using a public FRED API endpoint for the Federal Funds Rate
    const response = await axios.get('https://api.stlouisfed.org/fred/series/observations', {
      params: {
        'series_id': 'FEDFUNDS',
        'api_key': '0a53a7b8471a3adfc0a18e093b22b2c4', // Public demo key
        'file_type': 'json',
        'sort_order': 'desc',
        'limit': 1
      },
      timeout: 10000
    });
    
    logToFile(`✅ API Response received`);
    logToFile(`Response status: ${response.status}`);
    
    if (response.data && response.data.observations && response.data.observations.length > 0) {
      const latestObservation = response.data.observations[0];
      const rateValue = parseFloat(latestObservation.value);
      
      logToFile(`Latest observation date: ${latestObservation.date}`);
      logToFile(`Raw rate from FRED: ${rateValue}%`);
      
      // Convert percentage to basis points (e.g., 5.25% = 525 basis points)
      const rateBasisPoints = Math.round(rateValue * 100);
      logToFile(`Converted to basis points: ${rateBasisPoints}`);
      
      return rateBasisPoints;
      
    } else {
      logToFile(`❌ No data in FRED response`);
      throw new Error("No data found in FRED API response");
    }
    
  } catch (error) {
    logToFile(`❌ Error: ${error.message}`);
    if (error.code) logToFile(`Error code: ${error.code}`);
    if (error.response) {
      logToFile(`Response status: ${error.response.status}`);
      logToFile(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    if (error.request) {
      logToFile(`Request was made but no response received`);
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

    // Only proceed if rate is valid and we're not in test mode
    if (rate !== 250 || process.env.FORCE_UPDATE === 'true') {
        logToFile("📝 Connecting to Rootstock...");
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
        
        logToFile("📝 Sending transaction to update contract...");
        const tx = await contract.setTaxRate(rate);
        logToFile("📨 Transaction sent:", tx.hash);
        
        await tx.wait();
        logToFile(`✅ Tax rate successfully updated to ${rate} basis points`);
    } else {
        logToFile("⏸️ Using fallback rate. Transaction skipped for now.");
    }
    
  } catch (e) {
    logToFile(`❌ Failed: ${e.message}`);
  } finally {
    // Upload the debug log as an artifact (This will be handled by the workflow)
    if (fs.existsSync('/tmp/intax-debug.log')) {
      const logContent = fs.readFileSync('/tmp/intax-debug.log', 'utf8');
      console.log("=== DEBUG LOG START ===");
      console.log(logContent);
      console.log("=== DEBUG LOG END ===");
    }
  }
}

main();