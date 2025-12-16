// dashboard.js
document.addEventListener('DOMContentLoaded', () => {
  // --- Basic config ---
  const mac = getQueryParam('mac') || sessionStorage.getItem('deviceMac');
  const username = sessionStorage.getItem('username') || 'demo_user'; // fallback for dev

  if (!username) {
    alert('Please login first.');
    window.location.href = 'login.html';
    return;
  }
  if (!mac) {
    console.warn('No MAC provided in query or sessionStorage.');
    // Not fatal; continuing
  } else {
    sessionStorage.setItem('deviceMac', mac);
    const formattedMac = mac.replace(/-/g, ':').toUpperCase();
    const macElement = document.getElementById('macAddress');
    if (macElement) macElement.textContent = 'Device MAC: ' + formattedMac;
  }

  const esp32BaseUrl = "http://10.108.95.235";
  const backendBase = "https://ewallet-backend-2-6ge9.onrender.com";
  const FETCH_INTERVAL_MS = 3000;
  const TARIFF_RUPEES_PER_KWH = 8.0;
  const CONSUME_SYNC_THRESHOLD_KWH = 0.00001;
let espOnline = false;
let espFailCount = 0;
const ESP_FAIL_LIMIT = 3; // 3 failed fetches = offline
const espStatusEl = document.getElementById("espStatus");

function setEspStatus(isOnline) {
  if (!espStatusEl) return;

  if (isOnline) {
    espStatusEl.textContent = "ESP Status: 🟢 Online";
    espStatusEl.style.color = "green";
  } else {
    espStatusEl.textContent = "ESP Status: 🔴 Offline";
    espStatusEl.style.color = "red";
  }
}

  // DOM elements
  const liveEnergyEl = document.getElementById('liveEnergy');
  const voltageEl = document.getElementById('voltage');
  const currentEl = document.getElementById('current');
  const powerEl = document.getElementById('power');
  const balanceBox = document.getElementById('balanceBox');
  const monthlyUsage = document.getElementById('monthlyUsage');
  const totalUsed = document.getElementById('totalUsed');
  const remainingEnergy = document.getElementById('remainingEnergy');
  const predictedBill = document.getElementById('predictedBill');

  const rechargeAmountInput = document.getElementById('rechargeAmount');
  const rechargeBtn = document.getElementById('rechargeBtn');

  const monthlyInput = document.getElementById('monthlyInput');
  const setMonthlyBtn = document.getElementById('setMonthlyBtn');

  const monthlyKwhInput = document.getElementById('monthlyKwhInput');
  const allocateKwhBtn = document.getElementById('allocateKwhBtn');
  const resetMonthlyBtn = document.getElementById('resetMonthlyBtn');

  const powerOnBtn = document.getElementById('powerOnBtn');
  const powerOffBtn = document.getElementById('powerOffBtn');
  const powerStatus = document.getElementById('powerStatus');

  const relaySwitch1 = document.getElementById('relaySwitch1');
  const relaySwitch2 = document.getElementById('relaySwitch2');

  const bcStatusEl = document.getElementById('bcStatus');
  const connectWalletBtn = document.getElementById('connectWalletBtn');
  const syncBcBtn = document.getElementById('syncBcBtn');
  const readBcBtn = document.getElementById('readBcBtn');

  // Chart
  let energyChart = null;
  const canvas = document.getElementById('energyChart');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    energyChart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Power (W)', data: [], tension: 0.3 }]},
      options: { responsive: true, animation: false, scales: { x: { title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'Watts' } } } }
    });
  }

  // State
  let lastFetchTime = Date.now();
  let accumulatedKwhSinceLastSync = 0;
  let localRemainingKwh = null;

  // load budget from backend
  async function loadBudget() {
    try {
      const res = await fetch(`${backendBase}/api/user/budget/${encodeURIComponent(username)}`);
      if (!res.ok) {
        console.warn('Budget fetch failed:', res.status);
        return;
      }
      const data = await res.json();
      const available = parseFloat(data.availableBalance || 0);
      const allocated = parseFloat(data.allocatedEnergyKwh || 0);
      const used = parseFloat(data.usedEnergyKwh || 0);
      const remaining = Math.max(0, (allocated - used));

      balanceBox.textContent = available.toFixed(2);
      monthlyUsage.textContent = allocated.toFixed(4) + ' kWh';
      totalUsed.textContent = used.toFixed(4) + ' kWh';
      remainingEnergy.textContent = remaining.toFixed(4) + ' kWh';

      localRemainingKwh = remaining;

      const backendPredict = data.predictiveBill != null ? parseFloat(data.predictiveBill) : (used * TARIFF_RUPEES_PER_KWH);
      predictedBill.textContent = '₹' + backendPredict.toFixed(2);

      if (allocated > 0) allocateKwhBtn.disabled = true;
    } catch (err) {
      console.warn('Could not load budget:', err);
    }
  }
  loadBudget();

  // Razorpay flow (unchanged)
  if (rechargeBtn) {
    rechargeBtn.addEventListener('click', async () => {
      const amount = parseFloat(rechargeAmountInput.value);
      if (isNaN(amount) || amount <= 0) { alert('Enter valid amount.'); return; }
      try {
        const orderRes = await fetch(`${backendBase}/api/payment/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount })
        });
        if (!orderRes.ok) { alert('Order creation failed.'); return; }
        const orderData = await orderRes.json();
        const options = {
          key: orderData.key,
          amount: orderData.amount,
          currency: orderData.currency || 'INR',
          name: "IoT Smart Energy",
          description: "Recharge Wallet",
          order_id: orderData.id,
          handler: async function (response) {
            const verifyRes = await fetch(`${backendBase}/api/payment/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                username,
                amount,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature
              })
            });
            if (!verifyRes.ok) { alert('Payment verification failed.'); return; }
            const verifyData = await verifyRes.json();
            balanceBox.textContent = parseFloat(verifyData.availableBalance).toFixed(2);
            alert('Recharge successful!');
            rechargeAmountInput.value = '';
          }
        };
        const rzp = new Razorpay(options);
        rzp.open();
      } catch (err) {
        console.error(err);
        alert('Recharge init failed.');
      }
    });
  }

  if (allocateKwhBtn) {
  allocateKwhBtn.addEventListener('click', async () => {

    // User enters ₹ amount
    const rupees = parseFloat(monthlyKwhInput.value);
    if (isNaN(rupees) || rupees <= 0) {
      alert('Enter valid amount in ₹');
      return;
    }

    // Current available balance
    const availableBalance = parseFloat(
      balanceBox.textContent.replace(/[^\d.-]/g, "")
    );

    if (rupees > availableBalance) {
      alert('Insufficient balance. Please recharge.');
      return;
    }

    // Convert ₹ → kWh
    const amountKwh = rupees / TARIFF_RUPEES_PER_KWH;

    try {
      const res = await fetch(`${backendBase}/api/user/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          amountKwh,
          fromBalance: true   // 🔥 THIS IS IMPORTANT
        })
      });

      if (!res.ok) {
        alert('Allocation failed.');
        return;
      }

      const data = await res.json();

      // Update UI
      balanceBox.textContent = data.availableBalance.toFixed(2);
      monthlyUsage.textContent =
        data.allocatedEnergyKwh.toFixed(4) + ' kWh';
      remainingEnergy.textContent =
        data.remainingEnergyKwh.toFixed(4) + ' kWh';

      allocateKwhBtn.disabled = true;
      monthlyKwhInput.value = '';

    } catch (err) {
      console.error(err);
      alert('Error allocating energy.');
    }
  });
}
if (setMonthlyBtn) {
  setMonthlyBtn.addEventListener('click', async () => {

    const rupees = parseFloat(monthlyInput.value);
    if (isNaN(rupees) || rupees <= 0) {
      alert('Enter valid amount in ₹');
      return;
    }

    const availableBalance = parseFloat(
      balanceBox.textContent.replace(/[^\d.-]/g, "")
    );

    if (rupees > availableBalance) {
      alert('Insufficient balance. Please recharge.');
      return;
    }

    const addKwh = rupees / TARIFF_RUPEES_PER_KWH;

    try {
      const res = await fetch(`${backendBase}/api/user/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          amountKwh: addKwh,
          fromBalance: true
        })
      });

      if (!res.ok) {
        alert('Failed to add energy.');
        return;
      }

      const data = await res.json();

      balanceBox.textContent = data.availableBalance.toFixed(2);
      monthlyUsage.textContent = data.allocatedEnergyKwh.toFixed(4) + ' kWh';
      remainingEnergy.textContent = data.remainingEnergyKwh.toFixed(4) + ' kWh';

      // Predictive bill (SAFE)
      const usedKwh = parseDisplayedKwh(totalUsed);
      predictedBill.textContent = '₹' + (usedKwh * TARIFF_RUPEES_PER_KWH).toFixed(2);

      monthlyInput.value = '';
      alert('Energy added successfully ⚡');

    } catch (err) {
      console.error(err);
      alert('Error adding energy.');
    }
  });
}
  if (resetMonthlyBtn) {
    resetMonthlyBtn.addEventListener('click', async () => {
      if (!confirm("Reset allocation?")) return;
      const res = await fetch(`${backendBase}/api/user/resetMonthly`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username })
      });
      if (!res.ok) { alert("Reset failed"); return; }
      monthlyUsage.textContent = "0.0000 kWh";
      remainingEnergy.textContent = "0.0000 kWh";
      totalUsed.textContent = "0.0000 kWh";
      predictedBill.textContent = "₹0.00";
      allocateKwhBtn.disabled = false;
    });
  }

 async function controlRelay(channel, state) {
  if (!espOnline) {
    alert("ESP not detected ❌");
    return;
  }

  try {
    await fetch(`${backendBase}/api/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        espMac: sessionStorage.getItem("deviceMac"),
        relay1: channel === 1 ? state : null,
        relay2: channel === 2 ? state : null
      })
    });
  } catch (err) {
    console.error("Relay command failed:", err);
  }
}



  if (powerOnBtn) powerOnBtn.addEventListener('click', async () => {
    if (parseDisplayedKwh(remainingEnergy) <= 0) { alert("No energy left"); return; }
    powerStatus.textContent = "Power: ON ⚡";
    await controlRelay(1, 'on');
    await controlRelay(2, 'on');
    if (relaySwitch1) relaySwitch1.checked = true;
    if (relaySwitch2) relaySwitch2.checked = true;
  });

  if (powerOffBtn) powerOffBtn.addEventListener('click', async () => {
    powerStatus.textContent = "Power: OFF ❌";
    await controlRelay(1, 'off');
    await controlRelay(2, 'off');
    if (relaySwitch1) relaySwitch1.checked = false;
    if (relaySwitch2) relaySwitch2.checked = false;
  });

  if (relaySwitch1) relaySwitch1.addEventListener('change', () => controlRelay(1, relaySwitch1.checked ? 'on' : 'off'));
  if (relaySwitch2) relaySwitch2.addEventListener('change', () => controlRelay(2, relaySwitch2.checked ? 'on' : 'off'));

  // Fetch live data
  async function fetchLiveData() {
    try {
      const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);

const res = await fetch(`${esp32BaseUrl}/data`, {
  cache: "no-store",
  signal: controller.signal
});

      if (!res.ok) return;
      const data = await res.json();

      const voltage = safeParseNumber(data.voltage, 0);
      const currentA = safeParseNumber(data.current, 0);
      const espPower = data.power != null ? safeParseNumber(data.power) : voltage * currentA;

      voltageEl.textContent = voltage.toFixed(2) + ' V';
      currentEl.textContent = (currentA * 1000).toFixed(2) + ' mA';
      liveEnergyEl.textContent = (espPower / 1000).toFixed(4) + ' kW (' + espPower.toFixed(2) + ' W)';
      powerEl.textContent = espPower.toFixed(2) + ' W';

      if (energyChart) {
        const now = new Date().toLocaleTimeString();
        if (energyChart.data.labels.length >= 20) {
          energyChart.data.labels.shift();
          energyChart.data.datasets[0].data.shift();
        }
        energyChart.data.labels.push(now);
        energyChart.data.datasets[0].data.push(espPower);
        energyChart.update();
      }

      const nowTs = Date.now();
      const elapsedSec = Math.max(0.001, (nowTs - lastFetchTime) / 1000.0);
      lastFetchTime = nowTs;

      const consumedKwh = (espPower * elapsedSec) / 3600000.0;
      accumulatedKwhSinceLastSync += consumedKwh;

      if (localRemainingKwh != null) {
        localRemainingKwh = Math.max(0, localRemainingKwh - consumedKwh);
        remainingEnergy.textContent = localRemainingKwh.toFixed(4) + " kWh";
      }

      if (accumulatedKwhSinceLastSync >= CONSUME_SYNC_THRESHOLD_KWH) {
        const resp = await fetch(`${backendBase}/api/user/consume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, consumedKwh: accumulatedKwhSinceLastSync })
        });

        if (resp.ok) {
          const body = await resp.json();
          totalUsed.textContent = body.usedEnergyKwh.toFixed(4) + " kWh";
          remainingEnergy.textContent = body.remainingEnergyKwh.toFixed(4) + " kWh";
          predictedBill.textContent = "₹" + (body.predictiveBill).toFixed(2);

          localRemainingKwh = body.remainingEnergyKwh;
          accumulatedKwhSinceLastSync = 0;

         if (localRemainingKwh <= 0) {
  localRemainingKwh = 0;

  await controlRelay(1, 'off');
  await controlRelay(2, 'off');

  if (relaySwitch1) relaySwitch1.checked = false;
  if (relaySwitch2) relaySwitch2.checked = false;

  powerStatus.textContent = "Power: OFF ❌";
  document.getElementById('relayStatus1').textContent = "Relay 1: OFF ❌";
  document.getElementById('relayStatus2').textContent = "Relay 2: OFF ❌";

  alert("Energy exhausted. System turned OFF automatically ⚠️");
}

        }
      }

   } catch (err) {
  console.warn("ESP fetch failed:", err);
  espFailCount++;

  if (espFailCount >= ESP_FAIL_LIMIT) {
    setEspStatus(false);
    powerStatus.textContent = "Power: OFF ❌ (ESP Offline)";

    if (relaySwitch1) relaySwitch1.checked = false;
    if (relaySwitch2) relaySwitch2.checked = false;
  }
}


  }

  lastFetchTime = Date.now();
  fetchLiveData();
  setInterval(fetchLiveData, FETCH_INTERVAL_MS);
  setInterval(loadBudget, 10000);
// ESP recovered


  // small helper functions
  function safeParseNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseDisplayedKwh(el) {
    const txt = el?.textContent || "0";
    return parseFloat(txt.replace(/[^\d.-]/g, "")) || 0;
  }

  // ----- Blockchain UI handlers (use window.Blockchain) -----
  function setBcStatus(on) {
    if (!bcStatusEl) return;
    if (on) {
      bcStatusEl.textContent = "🟢 Connected";
      bcStatusEl.classList.remove("bc-off");
      bcStatusEl.classList.add("bc-on");
    } else {
      bcStatusEl.textContent = "🔴 Not Connected";
      bcStatusEl.classList.remove("bc-on");
      bcStatusEl.classList.add("bc-off");
    }
  }

  if (connectWalletBtn) {
    connectWalletBtn.addEventListener('click', async () => {
      if (!espOnline) {
  alert("ESP not detected. Cannot turn ON power ❌");
  return;
}

      try {
        if (!window.Blockchain) throw new Error('Blockchain module not loaded');
        const acc = await window.Blockchain.connectWallet();
        setBcStatus(!!acc);
      } catch (err) {
        alert('MetaMask connection failed: ' + (err?.message || err));
        setBcStatus(false);
      }
    });
  }

  if (syncBcBtn) {
    syncBcBtn.addEventListener('click', async () => {
      const allocated = parseDisplayedKwh(monthlyUsage);
      const used = parseDisplayedKwh(totalUsed);
      const remaining = parseDisplayedKwh(remainingEnergy);
      try {
        await window.Blockchain.updateEnergyOnChain(allocated, used, remaining);
        alert('Blockchain synced successfully');
      } catch (err) {
        console.error(err);
        alert('Blockchain sync failed: ' + (err?.message || err));
      }
    });
  }

  if (readBcBtn) {
    readBcBtn.addEventListener('click', async () => {
      try {
        const data = await window.Blockchain.getUsageFromChain();
        alert(`On-chain energy data\nAllocated: ${data.allocated} kWh\nUsed: ${data.used} kWh\nRemaining: ${data.remaining} kWh`);
      } catch (err) {
        alert('Failed to read on-chain usage: ' + (err?.message || err));
      }
    });
  }

  // auto-sync every 30s but guarded inside blockchain.js (it also checks last write time)
  setInterval(async () => {
    try {
      if (!window.Blockchain) return;
      const allocated = parseDisplayedKwh(monthlyUsage);
      const used = parseDisplayedKwh(totalUsed);
      const remaining = parseDisplayedKwh(remainingEnergy);
      await window.Blockchain.updateEnergyOnChain(allocated, used, remaining);
    } catch (err) { /* ignore */ }
  }, 30000);

}); // end DOMContentLoaded

// helper globally
function getQueryParam(param) { 
  return new URLSearchParams(window.location.search).get(param); 
}
