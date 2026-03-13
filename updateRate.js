const { ethers } = require("ethers");
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────
const RPC_URL = "https://public-node.rsk.co";
const CONTRACT_ADDRESS = "0x8F94FD728011Df4Be46828303938aA32155B7981";
const PRIVATE_KEY_HEX = "41a00b4be8d56193003826b1b6af2c1d6";

// Fix: Pad to 64 chars if needed (32 bytes)
const PRIVATE_KEY = PRIVATE_KEY_HEX.length === 64 
  ? `0x${PRIVATE_KEY_HEX}` 
  : `0x${PRIVATE_KEY_HEX.padEnd(64, '0')}`;

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
    const url = 'https://api.stlouisfed.org/fred/series/observations';
    
    const params = {
      'series_id': 'FEDFUNDS',
      'api_key': FRED_API_KEY,
      'file_type': 'json',
      'sort_order': 'desc',
      'limit': 1
    };
    
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

    if (response.data?.observations?.length > 0) {
      const latestObs = response.data.observations[0];
      const ratePercent = parseFloat(latestObs.value);
      const rateBasisPoints = Math.round(ratePercent * 100);
      
      logToFile(`📊 Latest observation date: ${latestObs.date}`);
      logToFile(`📊 Current Federal Funds Rate: ${ratePercent}%`);
      logToFile(`✅ Converted to basis points: ${rateBasisPoints}`);
      
      return {
        rateBasisPoints,
        ratePercent,
        date: latestObs.date
      };
    }
    
    throw new Error("No observations in FRED response");
    
  } catch (error) {
    logToFile(`❌ FRED API Error: ${error.message}`);
    if (error.response) {
      logToFile(`Status: ${error.response.status}`);
      logToFile(`Data: ${JSON.stringify(error.response.data)}`);
    }
    logToFile(`⚠️ Using fallback rate: 250 basis points (2.5%)`);
    return {
      rateBasisPoints: 250,
      ratePercent: 2.5,
      date: new Date().toISOString().split('T')[0]
    };
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

async function saveRateToFile(rateData) {
  try {
    const rateFile = {
      rate: rateData.rateBasisPoints,
      percent: rateData.ratePercent.toFixed(2),
      date: rateData.date,
      updated: new Date().toISOString(),
      source: 'FRED (Federal Funds Rate)'
    };
    
    fs.writeFileSync('latest-rate.json', JSON.stringify(rateFile, null, 2));
    logToFile(`✅ Rate saved to latest-rate.json`);
    return true;
  } catch (e) {
    logToFile(`❌ Failed to save rate file: ${e.message}`);
    return false;
  }
}

async function pushToGitHub() {
  try {
    logToFile(`📤 Pushing rate file to GitHub...`);
    
    // Configure git (these are local to the action, not your global settings)
    execSync('git config user.email "cron-bot@coinrepos.github.io"');
    execSync('git config user.name "Cron Bot"');
    
    // Add, commit, and push
    execSync('git add latest-rate.json');
    
    // Only commit if there are changes
    const status = execSync('git status --porcelain').toString();
    if (status.includes('latest-rate.json')) {
      execSync('git commit -m "chore: update latest rate from cron job"');
      execSync('git push');
      logToFile(`✅ Successfully pushed to GitHub`);
    } else {
      logToFile(`ℹ️ No changes to commit`);
    }
    
    return true;
  } catch (e) {
    logToFile(`❌ GitHub push failed: ${e.message}`);
    return false;
  }
}

async function main() {
  logToFile("🚀 Starting InTax rate update with FRED data...");
  
  try {
    // Step 1: Get the rate
    const rateData = await getOfficialRate();
    
    // Step 2: Save to file (always save, even if fallback)
    await saveRateToFile(rateData);
    
    // Step 3: Create wallet and update contract
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    
    if (!await checkBalance(wallet)) {
      logToFile(`⚠️ Contract update skipped due to low balance`);
      // Still push the rate file even if contract update fails
      await pushToGitHub();
      return;
    }
    
    const gasEstimate = await contract.setTaxRate.estimateGas(rateData.rateBasisPoints);
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.parseUnits("0.06", "gwei");
    
    const estimatedCost = gasEstimate * gasPrice;
    logToFile(`⛽ Estimated cost: ${ethers.formatEther(estimatedCost)} RBTC`);
    
    const MAX_COST = ethers.parseEther("0.001");
    if (estimatedCost > MAX_COST) {
      logToFile(`❌ Estimated cost too high (>0.001 RBTC). Aborting.`);
      await pushToGitHub();
      return;
    }
    
    logToFile(`📝 Sending transaction to set rate: ${rateData.rateBasisPoints}...`);
    const tx = await contract.setTaxRate(rateData.rateBasisPoints, {
      gasLimit: gasEstimate * 120n / 100n,
      gasPrice: gasPrice
    });
    
    logToFile(`📨 Transaction sent: ${tx.hash}`);
    const receipt = await tx.wait();
    logToFile(`✅ Tax rate updated to ${rateData.rateBasisPoints} basis points (${rateData.ratePercent}%)`);
    logToFile(`💸 Actual cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} RBTC`);
    
    // Step 4: Push the rate file to GitHub
    await pushToGitHub();
    
  } catch (e) {
    logToFile(`❌ Failed: ${e.message}`);
    // Try to push anyway if we have a rate file
    if (fs.existsSync('latest-rate.json')) {
      await pushToGitHub();
    }
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