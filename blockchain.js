// blockchain.js
// Exposes window.Blockchain with methods used by dashboard.js
(function () {
  // --- Config: set your deployed contract address & ABI here ---
  const CONTRACT_ADDRESS = "0x6412FfF5217526EC596555f1BBAf2629e7D1E61C";
  const CONTRACT_ABI = [
    {
      "inputs": [
        { "internalType": "uint256", "name": "allocated", "type": "uint256" },
        { "internalType": "uint256", "name": "used", "type": "uint256" },
        { "internalType": "uint256", "name": "remaining", "type": "uint256" }
      ],
      "name": "updateEnergy",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        { "internalType": "address", "name": "user", "type": "address" }
      ],
      "name": "getEnergyData",
      "outputs": [
        { "internalType": "uint256", "name": "", "type": "uint256" },
        { "internalType": "uint256", "name": "", "type": "uint256" },
        { "internalType": "uint256", "name": "", "type": "uint256" }
      ],
      "stateMutability": "view",
      "type": "function"
    }
  ];

  // --- Private state ---
  let web3 = null;
  let contract = null;
  let account = null;

  const MIN_WRITE_GAP_MS = 10 * 1000; // 10s (adjust as needed)
  const state = {
    lastOnchainWriteAt: 0,
    lastSentTriplet: { allocated: null, used: null, remaining: null },
  };

  // simple toast (replace with UI toast if you have one)
  function showToast(msg) {
    console.log('[Blockchain]', msg);
    // small visual feedback:
    const bcStatus = document.getElementById('bcStatus');
    if (bcStatus) bcStatus.title = msg;
  }

  function pushTxHistory(txInfo) {
    console.log('txHistory push', txInfo);
    // You can save tx history in localStorage or send to backend
    try {
      const hist = JSON.parse(localStorage.getItem('txHistory') || '[]');
      hist.unshift({ when: Date.now(), ...txInfo });
      localStorage.setItem('txHistory', JSON.stringify(hist.slice(0, 50)));
    } catch (e) { /* ignore */ }
  }

  // parse "123.456 kWh" or "₹123" style text to number
  function parseDisplayedNumber(elOrText) {
    const txt = (typeof elOrText === 'string') ? elOrText : (elOrText?.textContent || '');
    return parseFloat(txt.replace(/[^\d.-]/g, '')) || 0;
  }

  // Convert decimal kWh (float) -> integer for chain
  // Many contracts store with a multiplier; here we use 1e6 to keep precision
  function toIntegerForChain(valueFloat) {
    return Math.round(Number(valueFloat) * 1e6);
  }

  function fromIntegerFromChain(intVal) {
    return Number(intVal) / 1e6;
  }

  async function initWeb3IfNeeded() {
    if (!window.ethereum) {
      throw new Error('MetaMask / window.ethereum not found');
    }
    if (!web3) web3 = new Web3(window.ethereum);
    if (!contract) contract = new web3.eth.Contract(CONTRACT_ABI, CONTRACT_ADDRESS);
  }

  async function connectWallet() {
    try {
      await initWeb3IfNeeded();
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      account = accounts[0];
      showToast('Wallet connected: ' + account);
      // update UI quickly
      const bcStatus = document.getElementById('bcStatus');
      if (bcStatus) {
        bcStatus.textContent = '🟢 Connected';
        bcStatus.classList.remove('bc-off');
        bcStatus.classList.add('bc-on');
      }
      return account;
    } catch (err) {
      showToast('connectWallet failed: ' + (err?.message || err));
      throw err;
    }
  }

  async function updateEnergyOnChain(allocatedKwh, usedKwh, remainingKwh) {
    try {
      await initWeb3IfNeeded();
      if (!account) throw new Error('Connect wallet first');

      // Allow function to accept either (allocated, used, remaining) as args or nothing - we'll attempt to read if missing
      // If single object passed:
      if (typeof allocatedKwh === 'object' && allocatedKwh !== null) {
        const obj = allocatedKwh;
        allocatedKwh = obj.allocated || 0;
        usedKwh = obj.used || 0;
        remainingKwh = obj.remaining || 0;
      }

      const aInt = toIntegerForChain(allocatedKwh || 0);
      const uInt = toIntegerForChain(usedKwh || 0);
      const rInt = toIntegerForChain(remainingKwh || 0);

      const now = Date.now();
      if (
        state.lastSentTriplet.allocated === aInt &&
        state.lastSentTriplet.used === uInt &&
        state.lastSentTriplet.remaining === rInt
      ) {
        // no change
        console.log('onchain: unchanged, skip');
        return;
      }
      if (now - state.lastOnchainWriteAt < MIN_WRITE_GAP_MS) {
        console.log('onchain: too soon since last write, skip');
        return;
      }

      showToast('Sending on-chain tx...');
      const tx = await contract.methods.updateEnergy(aInt, uInt, rInt).send({ from: account });
      state.lastOnchainWriteAt = Date.now();
      state.lastSentTriplet = { allocated: aInt, used: uInt, remaining: rInt };
      showToast('On-chain update success: ' + tx.transactionHash);
      pushTxHistory({ type: 'onchain_update', allocated: aInt, used: uInt, remaining: rInt, txHash: tx.transactionHash });
      return tx;
    } catch (err) {
      console.warn('updateEnergyOnChain error', err);
      throw err;
    }
  }

  async function getUsageFromChain() {
    try {
      await initWeb3IfNeeded();
      if (!account) throw new Error('Connect wallet first');
      const res = await contract.methods.getEnergyData(account).call();
      // res are big numbers (strings) — convert
      const allocated = fromIntegerFromChain(res[0] || 0);
      const used = fromIntegerFromChain(res[1] || 0);
      const remaining = fromIntegerFromChain(res[2] || 0);
      return { allocated, used, remaining, raw: res };
    } catch (err) {
      console.warn('getUsageFromChain error', err);
      throw err;
    }
  }

  // Expose API
  window.Blockchain = {
    connectWallet,
    updateEnergyOnChain,
    getUsageFromChain,
    // helper for dashboard init (not mandatory)
    init: async function () {
      try {
        if (window.ethereum && window.ethereum.selectedAddress) {
          account = window.ethereum.selectedAddress;
          await initWeb3IfNeeded();
        }
      } catch (e) { /* ignore */ }
    }
  };

  // Auto-init (no requests until user clicks connect)
  window.addEventListener('load', () => {
    // noop for now — will init on first connect
  });
})();
