const { ethers } = require("ethers");
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
//  CONFIG
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
  // Use platform-specific log path
  const logPath = process.platform === 'win32' 
    ? path.join(__dirname, 'debug.log')  // Windows: save in project folder
    : '/tmp/intax-debug.log';             // Linux: use /tmp
  
  try {
    fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`);
  } catch (e) {
    // If log file fails, still console log
    console.log(`[${timestamp}] ${msg}`);
  }
  console.log(msg);
}

async function getOfficialRate() {
  logToFile("📡 Fetching official ECB interest rate...");
  
  try {
    const url = 'https://data.ecb.europa.eu/data-detail/api/service/data/ECB/FM/Q.U2.EUR.4F.KR.MRR_FR.LEV';
    logToFile(`🔍 Full URL: ${url}`);
    logToFile(`🔍 Params: ${JSON.stringify({
      'format': 'jsondata',
      'startPeriod': '2020-01-01'
    })}`);
    
    const response = await axios.get(url, {
      params: {
        'format': 'jsondata',
        'startPeriod': '2020-01-01'
      },
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; InTax-Cron/1.0)'
      },
      timeout: 15000,
      validateStatus: false
    });

    logToFile(`✅ Response status: ${response.status}`);
    logToFile(`✅ Response headers: ${JSON.stringify(response.headers)}`);
    
    const responseStr = JSON.stringify(response.data).substring(0, 500);
    logToFile(`✅ Response preview: ${responseStr}...`);

    if (response.status !== 200) {
      logToFile(`❌ API returned status ${response.status}`);
      throw new Error(`HTTP ${response.status}`);
    }

    if (response.data?.data?.dataSets?.[0]?.series?.[0]?.observations) {
      const observations = response.data.data.dataSets[0].series[0].observations;
      const obsKeys = Object.keys(observations).map(Number).sort((a, b) => b - a);
      const latestObs = observations[obsKeys[0]][0];
      
      const ratePercent = parseFloat(latestObs);
      const rateBasisPoints = Math.round(ratePercent * 100);
      
      logToFile(`📊 Current ECB rate: ${ratePercent}%`);
      logToFile(`✅ Converted to basis points: ${rateBasisPoints}`);
      
      return rateBasisPoints;
    }
    
    logToFile(`❌ Could not find observations in response`);
    logToFile(`Response structure: ${Object.keys(response.data || {})}`);
    throw new Error("Could not parse ECB response");
    
  } catch (error) {
    logToFile(`❌ ECB API Error: ${error.message}`);
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
  logToFile("🚀 Starting InTax rate update with ECB data...");
  
  try {
    const rate = await getOfficialRate();
    
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
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