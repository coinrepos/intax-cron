const { ethers } = require("ethers");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
//  CONFIG — Using FRED API
// ─────────────────────────────────────────────────────────────
const RPC_URL = "https://public-node.rsk.co";
const CONTRACT_ADDRESS = "0x8F94FD728011Df4Be46828303938aA32155B7981";
const PRIVATE_KEY_HEX = "41a00b4be8d56193003826b1b6af2c1d6";

// Your FRED API key
const FRED_API_KEY = "4152340b8d56193003826b1b6af2c1d6";

const ABI = [
  "function setTaxRate(uint256 _rate) external"
];
// ─────────────────────────────────────────────────────────────

function logToFile(msg) {
  const timestamp = new Date().toISOString();
  const logPath = process.platform === 'win32' 
    ? path.join(__dirname, 'debug.log')
    : '/tmp/intax-debug.log';
  
  try {
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
  } catch (e) {
    console.log(`[${timestamp}] ${msg}`);
  }
  console.log(msg);
}

async function getOfficialRate() {
  logToFile("📡 Fetching US Federal Funds Rate from FRED API...");
  
  try {
    // FRED API endpoint for the Federal Funds Rate [citation:9]
    const url = 'https://api.stlouisfed.org/fred/series/observations';
    logToFile(`🔍 Full URL: ${url}`);
    
    const params = {
      'series_id': 'FEDFUNDS',
      'api_key': FRED_API_KEY,
      'file_type': 'json',
      'sort_order': 'desc',
      'limit': 1
    };
    logToFile(`🔍 Params: ${JSON.stringify(params)}`);
    
    const response = await axios.get(url, { 
      params, 
      timeout: 15000,
      validateStatus: false
    });

    logToFile(`✅ Response status: ${response.status}`);

    if (response.status !== 200) {
      logToFile(`❌ FRED API returned status ${response.status}`);
      throw new Error(`HTTP ${response.status}`);
    }

    // Parse the FRED response
    if (response.data?.observations?.length > 0) {
      const latestObs = response.data.observations[0];
      const ratePercent = parseFloat(latestObs.value);
      
      // Convert percentage to basis points (e.g., 5.25% → 525 basis points)
      const rateBasisPoints = Math.round(ratePercent * 100);
      
      logToFile(`📊 Latest observation date: ${latestObs.date}`);
      logToFile(`📊 Current Federal Funds Rate: ${ratePercent}%`);
      logToFile(`✅ Converted to basis points: ${rateBasisPoints}`);
      
      return rateBasisPoints;
    }
    
    throw new Error("No observations in FRED response");
    
  } catch (error) {
    logToFile(`❌ FRED API Error: ${error.message}`);
    if (error.response) {
      logToFile(`Status: ${error.response.status}`);
      logToFile(`Data: ${JSON.stringify(error.response.data)}`);
    }
    logToFile(`⚠️ Using fallback rate: 250 basis points (2.5%)`);
    return 250;
  }
}

async function checkBalance(wallet) {
  const balance = await wallet.provider.getBalance(wallet.address);
  logToFile(`💰 Wallet balance: ${ethers.formatEther(balance)} RBTC`);
  
  const MIN_BALANCE = ethers.parseEther("0.00005");
  if (balance < MIN_BALANCE) {
    logToFile(`❌ Insufficient balance (need >0.00005 RBTC)`);
    logToFile(`💡 Add RBTC to: ${wallet.address}`);
    return false;
  }
  return true;
}

async function main() {
  logToFile("🚀 Starting InTax rate update with FRED data...");
  
  try {
    const rate = await getOfficialRate();
    
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Create wallet with proper formatting
    let wallet;
    try {
      wallet = new ethers.Wallet(`0x${PRIVATE_KEY_HEX}`, provider);
    } catch (e) {
      logToFile(`❌ Failed to create wallet: ${e.message}`);
      return;
    }
    
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    
    if (!await checkBalance(wallet)) {
      return;
    }
    
    const gasEstimate = await contract.setTaxRate.estimateGas(rate);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("0.06", "gwei");
    
    const estimatedCost = gasEstimate * gasPrice;
    logToFile(`⛽ Estimated cost: ${ethers.formatEther(estimatedCost)} RBTC`);
    
    const MAX_COST = ethers.parseEther("0.001");
    if (estimatedCost > MAX_COST) {
      logToFile(`❌ Estimated cost too high (>0.001 RBTC). Aborting.`);
      return;
    }
    
    logToFile(`📝 Sending transaction to set rate: ${rate}...`);
    const tx = await contract.setTaxRate(rate, {
      gasLimit: gasEstimate * 120n / 100n,
      gasPrice: gasPrice
    });
    
    logToFile(`📨 Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    logToFile(`✅ Tax rate updated to ${rate} basis points (${(rate/100).toFixed(2)}%)`);
    logToFile(`💸 Actual cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} RBTC`);
    
  } catch (e) {
    logToFile(`❌ Failed: ${e.message}`);
  } finally {
    const logPath = process.platform === 'win32' 
      ? path.join(__dirname, 'debug.log')
      : '/tmp/intax-debug.log';
    
    if (fs.existsSync(logPath)) {
      const logContent = fs.readFileSync(logPath, 'utf8');
      console.log("\n" + "=".repeat(50));
      console.log("COMPLETE DEBUG LOG");
      console.log("=".repeat(50));
      console.log(logContent);
      console.log("=".repeat(50));
    }
  }
}

main();