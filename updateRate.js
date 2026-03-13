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
const FRED_API_KEY = "4152340b8d56193003826b1b6af2c1d6";

const PRIVATE_KEY = PRIVATE_KEY_HEX.startsWith('0x') ? PRIVATE_KEY_HEX : `0x${PRIVATE_KEY_HEX}`;

const ABI = [
  "function setTaxRate(uint256 _rate) external"
];

function logToFile(msg) {
  const timestamp = new Date().toISOString();
  const logPath = process.platform === 'win32' 
    ? path.join(__dirname, 'debug.log')
    : '/tmp/intax-debug.log';
  
  try {
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
  } catch (e) {
    console.log(msg);
  }
  console.log(msg);
}

async function getOfficialRate() {
  logToFile("🔍 DEBUG: Entering getOfficialRate function.");
  
  try {
    const url = 'https://api.stlouisfed.org/fred/series/observations';
    logToFile(`🔍 DEBUG: FRED URL: ${url}`);
    
    const params = {
      'series_id': 'FEDFUNDS',
      'api_key': FRED_API_KEY,
      'file_type': 'json',
      'sort_order': 'desc',
      'limit': 1
    };
    logToFile(`🔍 DEBUG: FRED Params: ${JSON.stringify(params)}`);

    const response = await axios.get(url, { 
      params, 
      timeout: 15000,
      validateStatus: false
    });

    logToFile(`🔍 DEBUG: FRED Response Status: ${response.status}`);
    
    if (response.status !== 200) {
        logToFile(`🔍 DEBUG: FRED Response Data: ${JSON.stringify(response.data)?.substring(0, 500)}`);
        throw new Error(`FRED API returned status ${response.status}`);
    }

    if (response.data?.observations?.length > 0) {
      const latestObs = response.data.observations[0];
      logToFile(`🔍 DEBUG: FRED Observation: ${JSON.stringify(latestObs)}`);
      
      const ratePercent = parseFloat(latestObs.value);
      const rateBasisPoints = Math.round(ratePercent * 100);
      
      logToFile(`📊 SUCCESS: Fed Rate: ${ratePercent}% on ${latestObs.date}`);
      return {
        rateBasisPoints,
        ratePercent,
        date: latestObs.date,
        source: 'FRED'
      };
    } else {
        logToFile(`🔍 DEBUG: No observations found in FRED response.`);
        throw new Error("No observations in FRED response");
    }
    
  } catch (error) {
    logToFile(`❌ CRITICAL: Rate fetch failed: ${error.message}`);
    if (error.response) {
      logToFile(`Response status: ${error.response.status}`);
      logToFile(`Response data: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      logToFile(`Request was made but no response received. Network issue?`);
    }
    
    logToFile(`⚠️ Using hardcoded fallback rate: 450 basis points (4.5%)`);
    return {
      rateBasisPoints: 450,
      ratePercent: 4.5,
      date: new Date().toISOString().split('T')[0],
      source: 'fallback'
    };
  }
}

async function saveRateToFile(rateData) {
  try {
    const rateFile = {
      rate: rateData.rateBasisPoints,
      percent: rateData.ratePercent.toFixed(2),
      date: rateData.date,
      updated: new Date().toISOString(),
      source: rateData.source || 'unknown'
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
    execSync('git config user.email "cron-bot@coinrepos.github.io"');
    execSync('git config user.name "Cron Bot"');
    execSync('git add latest-rate.json');
    
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
  logToFile("🚀 Starting InTax rate update with SIMPLIFIED logic...");
  
  try {
    const rateData = await getOfficialRate();
    await saveRateToFile(rateData);
    
    logToFile("🔌 Connecting to Rootstock...");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    
    const balance = await provider.getBalance(wallet.address);
    logToFile(`💰 Wallet balance: ${ethers.formatEther(balance)} RBTC`);
    
    const gasPrice = ethers.parseUnits("0.065", "gwei");
    const gasLimit = 150000;
    const estimatedCost = gasLimit * gasPrice;
    
    logToFile(`⛽ Fixed Gas Price: 0.065 Gwei`);
    logToFile(`⛽ Fixed Gas Limit: ${gasLimit}`);
    logToFile(`💰 Estimated Cost: ${ethers.formatEther(estimatedCost)} RBTC`);

    if (estimatedCost > ethers.parseEther("0.001")) {
        logToFile(`❌ Estimated cost > 0.001 RBTC, aborting for safety.`);
        await pushToGitHub();
        return;
    }
    
    if (balance < estimatedCost * 2n) {
        logToFile(`❌ Insufficient balance. Have ${ethers.formatEther(balance)}, need ~${ethers.formatEther(estimatedCost * 2n)}. Aborting.`);
        await pushToGitHub();
        return;
    }
    
    logToFile(`📝 Sending transaction to set rate: ${rateData.rateBasisPoints} (${rateData.ratePercent}%)...`);
    const tx = await contract.setTaxRate(rateData.rateBasisPoints, {
      gasLimit: gasLimit,
      gasPrice: gasPrice
    });
    
    logToFile(`📨 Transaction sent: ${tx.hash}`);
    logToFile(`⏳ Waiting for confirmation...`);
    
    const receipt = await tx.wait();
    logToFile(`✅ Tax rate updated to ${rateData.rateBasisPoints} basis points (${rateData.ratePercent}%)`);
    logToFile(`📦 Block: ${receipt.blockNumber}`);
    logToFile(`💸 Actual cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} RBTC`);
    
    await pushToGitHub();
    
  } catch (e) {
    logToFile(`❌ MAIN FUNCTION FAILED: ${e.message}`);
    console.error(e);
    if (fs.existsSync('latest-rate.json')) {
      await pushToGitHub();
    }
  }
}

main();