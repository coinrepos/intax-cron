const { ethers } = require("ethers");
const axios = require('axios');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────
//  CONFIG — Double-checked and safe
// ─────────────────────────────────────────────────────────────
const RPC_URL = "https://public-node.rsk.co";
const CONTRACT_ADDRESS = "0x8F94FD728011Df4Be46828303938aA32155B7981";
const PRIVATE_KEY = "41a00b4be8d56193003826b1b6af2c1d6";

const ABI = [
  "function setTaxRate(uint256 _rate) external"
];
// ─────────────────────────────────────────────────────────────

function logToFile(msg) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync('/tmp/intax-debug.log', `[${timestamp}] ${msg}\n`);
  console.log(msg);
}

async function getOfficialRate() {
  logToFile("📡 Fetching official ECB interest rate...");
  
  try {
    // ✅ ECB official API - NO API KEY NEEDED, completely free
    // This endpoint retrieves the main refinancing operations rate
    const response = await axios.get(
      'https://data.ecb.europa.eu/data-detail/api/service/data/ECB/FM/Q.U2.EUR.4F.KR.MRR_FR.LEV',
      {
        params: {
          'format': 'jsondata',
          'startPeriod': '2020-01-01' // Get data from 2020 onwards
        },
        headers: {
          'Accept': 'application/json'
        },
        timeout: 15000
      }
    );

    logToFile(`✅ ECB API Response received`);

    // Parse the ECB's SDMX-ML JSON structure
    // This navigates to the observations array where the rate values live
    if (response.data?.data?.dataSets?.[0]?.series?.[0]?.observations) {
      const observations = response.data.data.dataSets[0].series[0].observations;
      
      // Get the most recent observation (latest date has highest index)
      const obsKeys = Object.keys(observations).map(Number).sort((a, b) => b - a);
      const latestObs = observations[obsKeys[0]][0];
      
      // ECB rates are in percentage points (e.g., 2.15 for 2.15%)
      const ratePercent = parseFloat(latestObs);
      const rateBasisPoints = Math.round(ratePercent * 100);
      
      logToFile(`📊 Current ECB rate: ${ratePercent}%`);
      logToFile(`✅ Converted to basis points: ${rateBasisPoints}`);
      
      return rateBasisPoints;
    }
    
    throw new Error("Could not parse ECB response");
    
  } catch (error) {
    logToFile(`❌ ECB API Error: ${error.message}`);
    if (error.response) {
      logToFile(`Status: ${error.response.status}`);
    }
    logToFile(`⚠️ Using fallback rate: 250 basis points (2.5%)`);
    return 250;
  }
}

async function checkBalance(wallet) {
  const balance = await wallet.provider.getBalance(wallet.address);
  logToFile(`💰 Wallet balance: ${ethers.formatEther(balance)} RBTC`);
  
  // ✅ Won't send if balance is below 0.00005 RBTC (enough for ~2-3 transactions)
  const MIN_BALANCE = ethers.parseEther("0.00005");
  if (balance < MIN_BALANCE) {
    logToFile(`❌ Insufficient balance (need >0.00005 RBTC)`);
    logToFile(`💡 Add RBTC to: ${wallet.address}`);
    return false;
  }
  return true;
}

async function main() {
  logToFile("🚀 Starting InTax rate update with ECB data...");
  
  try {
    // Step 1: Get the rate (FREE - no RBTC cost)
    const rate = await getOfficialRate();
    
    // Step 2: Connect to blockchain
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    
    // Step 3: Check balance (FREE - read only)
    if (!await checkBalance(wallet)) {
      return;
    }
    
    // Step 4: Estimate gas (FREE - simulation only)
    const gasEstimate = await contract.setTaxRate.estimateGas(rate);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("0.06", "gwei");
    
    const estimatedCost = gasEstimate * gasPrice;
    logToFile(`⛽ Estimated cost: ${ethers.formatEther(estimatedCost)} RBTC`);
    
    // Step 5: Safety check - abort if cost is too high
    const MAX_COST = ethers.parseEther("0.001"); // Max 0.001 RBTC per tx
    if (estimatedCost > MAX_COST) {
      logToFile(`❌ Estimated cost too high (>0.001 RBTC). Aborting.`);
      return;
    }
    
    // Step 6: Send transaction (THIS IS THE ONLY COSTLY STEP)
    logToFile(`📝 Sending transaction to set rate: ${rate}...`);
    const tx = await contract.setTaxRate(rate, {
      gasLimit: gasEstimate * 120n / 100n, // 20% buffer for safety
      gasPrice: gasPrice
    });
    
    logToFile(`📨 Transaction sent: ${tx.hash}`);
    logToFile(`⏳ Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    logToFile(`✅ Tax rate successfully updated to ${rate} basis points (${(rate/100).toFixed(2)}%)`);
    logToFile(`📦 Block: ${receipt.blockNumber}`);
    logToFile(`💸 Actual cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} RBTC`);
    
  } catch (e) {
    logToFile(`❌ Failed: ${e.message}`);
    if (e.code === 'INSUFFICIENT_FUNDS') {
      logToFile(`💡 Add RBTC to your wallet to cover gas costs`);
    }
  } finally {
    // Always output the debug log for GitHub Actions
    if (fs.existsSync('/tmp/intax-debug.log')) {
      const logContent = fs.readFileSync('/tmp/intax-debug.log', 'utf8');
      console.log("\n" + "=".repeat(50));
      console.log("COMPLETE DEBUG LOG");
      console.log("=".repeat(50));
      console.log(logContent);
      console.log("=".repeat(50));
    }
  }
}

main();