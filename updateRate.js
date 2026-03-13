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

const PRIVATE_KEY = PRIVATE_KEY_HEX.length === 64 
  ? `0x${PRIVATE_KEY_HEX}` 
  : `0x${PRIVATE_KEY_HEX.padEnd(64, '0')}`;

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
    console.log(`[${timestamp}] ${msg}`);
  }
  console.log(msg);
}

async function getOfficialRate() {
  logToFile("📡 Fetching US Federal Funds Rate...");
  
  const sources = [
    {
      name: 'FRED',
      url: 'https://api.stlouisfed.org/fred/series/observations',
      params: {
        'series_id': 'FEDFUNDS',
        'api_key': FRED_API_KEY,
        'file_type': 'json',
        'sort_order': 'desc',
        'limit': 1
      }
    },
    {
      name: 'Treasury',
      url: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates',
      params: {
        'fields': 'record_date,avg_interest_rate_amt',
        'filter': 'security_desc:eq:Treasury Bills',
        'sort': '-record_date',
        'page[size]': 1
      }
    }
  ];
  
  for (const source of sources) {
    try {
      logToFile(`🔍 Trying ${source.name}...`);
      
      const response = await axios.get(source.url, { 
        params: source.params,
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; InTax-Cron/1.0)',
          'Accept': 'application/json'
        },
        validateStatus: false
      });

      if (response.status === 200) {
        if (source.name === 'FRED' && response.data?.observations?.length > 0) {
          const latestObs = response.data.observations[0];
          const ratePercent = parseFloat(latestObs.value);
          const rateBasisPoints = Math.round(ratePercent * 100);
          
          logToFile(`✅ FRED success: ${ratePercent}%`);
          return {
            rateBasisPoints,
            ratePercent,
            date: latestObs.date,
            source: 'FRED'
          };
        }
        
        if (source.name === 'Treasury' && response.data?.data?.length > 0) {
          const latestEntry = response.data.data[0];
          const ratePercent = parseFloat(latestEntry.avg_interest_rate_amt);
          const rateBasisPoints = Math.round(ratePercent * 100);
          
          logToFile(`✅ Treasury success: ${ratePercent}%`);
          return {
            rateBasisPoints,
            ratePercent,
            date: latestEntry.record_date,
            source: 'Treasury'
          };
        }
      }
      
      logToFile(`⚠️ ${source.name} returned status ${response.status}`);
      
    } catch (error) {
      logToFile(`❌ ${source.name} failed: ${error.message}`);
    }
  }
  
  logToFile(`⚠️ All sources failed. Using default rate 350 (3.5%)`);
  return {
    rateBasisPoints: 350,
    ratePercent: 3.5,
    date: new Date().toISOString().split('T')[0],
    source: 'default'
  };
}

async function checkBalance(wallet) {
  const balance = await wallet.provider.getBalance(wallet.address);
  logToFile(`💰 Wallet balance: ${ethers.formatEther(balance)} RBTC`);
  return balance > ethers.parseEther("0.0001");
}

async function saveRateToFile(rateData) {
  const rateFile = {
    rate: rateData.rateBasisPoints,
    percent: rateData.ratePercent.toFixed(2),
    date: rateData.date,
    updated: new Date().toISOString(),
    source: rateData.source || 'unknown'
  };
  fs.writeFileSync('latest-rate.json', JSON.stringify(rateFile, null, 2));
  logToFile(`✅ Rate saved to latest-rate.json`);
}

async function pushToGitHub() {
  try {
    execSync('git config user.email "cron-bot@coinrepos.github.io"');
    execSync('git config user.name "Cron Bot"');
    execSync('git add latest-rate.json');
    
    const status = execSync('git status --porcelain').toString();
    if (status.includes('latest-rate.json')) {
      execSync('git commit -m "chore: update latest rate from cron job"');
      execSync('git push');
      logToFile(`✅ Pushed to GitHub`);
    }
  } catch (e) {
    logToFile(`⚠️ GitHub push failed: ${e.message}`);
  }
}

async function main() {
  logToFile("🚀 Starting InTax rate update...");
  
  try {
    const rateData = await getOfficialRate();
    await saveRateToFile(rateData);
    
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    
    if (!await checkBalance(wallet)) {
      logToFile(`⚠️ Low balance, skipping contract update`);
      await pushToGitHub();
      return;
    }
    
    // Fixed gas parameters
    const gasPrice = ethers.parseUnits("0.065", "gwei");
    const gasLimit = 150000;
    const estimatedCost = gasLimit * gasPrice;
    
    logToFile(`⛽ Gas price: 0.065 gwei`);
    logToFile(`⛽ Gas limit: ${gasLimit}`);
    logToFile(`💰 Cost: ${ethers.formatEther(estimatedCost)} RBTC`);
    
    if (estimatedCost > ethers.parseEther("0.0005")) {
      logToFile(`❌ Cost too high, aborting`);
      await pushToGitHub();
      return;
    }
    
    logToFile(`📝 Setting rate to ${rateData.rateBasisPoints} (${rateData.ratePercent}%)...`);
    const tx = await contract.setTaxRate(rateData.rateBasisPoints, {
      gasLimit,
      gasPrice
    });
    
    logToFile(`📨 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    logToFile(`✅ Updated to ${rateData.rateBasisPoints} basis points`);
    logToFile(`💸 Cost: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} RBTC`);
    
    await pushToGitHub();
    
  } catch (e) {
    logToFile(`❌ Failed: ${e.message}`);
    if (fs.existsSync('latest-rate.json')) {
      await pushToGitHub();
    }
  }
}

main();