document.addEventListener('DOMContentLoaded', () => {
  const mac = getQueryParam('mac') || sessionStorage.getItem('deviceMac');
  const username = sessionStorage.getItem('username');

  if (!username) {
    alert('Please login first.');
    window.location.href = 'login.html';
    return;
  }
  if (!mac) {
    alert('No device MAC address provided.');
    return;
  }

  sessionStorage.setItem('deviceMac', mac);
  const formattedMac = mac.replace(/-/g, ':').toUpperCase();
  const macElement = document.getElementById('macAddress');
  if (macElement) macElement.textContent = formattedMac;

  const esp32BaseUrl = "http://10.108.95.235";
  const backendBase = "https://ewallet-backend-2-6ge9.onrender.com";
  const FETCH_INTERVAL_MS = 3000;
  const TARIFF_RUPEES_PER_KWH = 8.0;   // cost per kWh
  const CONSUME_SYNC_THRESHOLD_KWH = 0.00001; // ~10 mWh threshold

  const liveEnergyEl = document.getElementById('liveEnergy');
  const voltageEl = document.getElementById('voltage');
  const currentEl = document.getElementById('current');
  const powerEl = document.getElementById('power'); // <-- new: Power card
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
  const relayStatus1 = document.getElementById('relayStatus1');
  const relayStatus2 = document.getElementById('relayStatus2');

  let energyChart = null;
  const canvas = document.getElementById('energyChart');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    energyChart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [{ label: 'Power (W)', data: [], borderColor: 'rgb(75,192,192)', tension: 0.3 }]},
      options: { responsive: true, animation: false, scales: { x: { title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'Watts' } } } }
    });
  }

  let lastFetchTime = Date.now();
  let accumulatedKwhSinceLastSync = 0;

  let localRemainingKwh = null;

  async function loadBudget() {
    try {
      const res = await fetch(`${backendBase}/api/user/budget/${encodeURIComponent(username)}`);
      if (!res.ok) {
        console.warn('Budget fetch failed:', res.status, await safeText(res));
        return;
      }
      const data = await res.json();
      const available = parseFloat(data.availableBalance || 0);
      const allocated = parseFloat(data.allocatedEnergyKwh || 0);
      const used = parseFloat(data.usedEnergyKwh || 0);
      const remaining = Math.max(0, (allocated - used));

      balanceBox && (balanceBox.textContent = available.toFixed(2));
      monthlyUsage && (monthlyUsage.textContent = allocated.toFixed(4) + ' kWh');
      totalUsed && (totalUsed.textContent = used.toFixed(4) + ' kWh');
      remainingEnergy && (remainingEnergy.textContent = remaining.toFixed(4) + ' kWh');

      localRemainingKwh = remaining;

      const backendPredict = data.predictiveBill != null ? parseFloat(data.predictiveBill) : null;
      if (backendPredict != null && !Number.isNaN(backendPredict)) {
        predictedBill && (predictedBill.textContent = '₹' + backendPredict.toFixed(2));
      } else {
        predictedBill && (predictedBill.textContent = '₹' + (used * TARIFF_RUPEES_PER_KWH).toFixed(2));
      }

      if (allocated > 0 && allocateKwhBtn) allocateKwhBtn.disabled = true;
    } catch (err) {
      console.warn('Could not load budget:', err);
    }
  }
  loadBudget();

  // ——— Razorpay Recharge flow ———
if (rechargeBtn) {
  rechargeBtn.addEventListener('click', async () => {
    const amount = parseFloat(rechargeAmountInput.value);
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount.');
      return;
    }

    try {
      // 1) Create order on backend
      const orderRes = await fetch(`${backendBase}/api/payment/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });

      if (!orderRes.ok) {
        const txt = await orderRes.text();
        console.error('Create order failed:', orderRes.status, txt);
        alert('Failed to create order.');
        return;
      }

      const orderData = await orderRes.json();

      // 2) Use backend key returned
      const options = {
        key: orderData.key, // ✅ Use backend-provided key
        amount: orderData.amount,
        currency: orderData.currency || 'INR',
        name: "IoT Smart Energy",
        description: "Recharge Wallet",
        order_id: orderData.id,
        handler: async function (response) {
          // 3) Verify payment on backend
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

          if (!verifyRes.ok) {
            const txt = await verifyRes.text();
            console.error('Verify failed:', verifyRes.status, txt);
            alert('Payment verification failed.');
            return;
          }

          const verifyData = await verifyRes.json();
          if (verifyData.availableBalance != null) {
            balanceBox.textContent = parseFloat(verifyData.availableBalance).toFixed(2);
          } else if (verifyData.newBalance != null) {
            balanceBox.textContent = parseFloat(verifyData.newBalance).toFixed(2);
          } else {
            await loadBudget(); // fallback refresh
          }

          alert('Payment successful! Balance updated.');
          rechargeAmountInput.value = '';
        },
        prefill: {
          name: username,
          email: `${username}@example.com`,
          contact: "9999999999"
        },
        theme: { color: "#3399cc" }
      };

      const rzp = new Razorpay(options);
      rzp.on('payment.failed', function(resp) {
        console.error('Payment failed', resp);
        alert('Payment failed: ' + (resp.error?.description || 'unknown'));
      });
      rzp.open();

    } catch (err) {
      console.error('Payment error', err);
      alert('Payment initialization failed.');
    }
  });
}

  // ————— end Recharge flow —————

  // ... rest of your event handlers unchanged (setMonthlyBtn, allocateKwhBtn, resetMonthlyBtn, relays, fetchLiveData etc.)
  // I intentionally left them unchanged so your original logic remains.

  if (setMonthlyBtn) setMonthlyBtn.addEventListener('click', async () => {
    const rupees = parseFloat(monthlyInput.value);
    if (isNaN(rupees) || rupees <= 0) { alert('Enter valid amount in ₹'); return; }

    const availableBalance = parseFloat(balanceBox && balanceBox.textContent || 0);
    if (rupees > availableBalance) { alert('Insufficient balance'); return; }

    const allocatedKwh = rupees / TARIFF_RUPEES_PER_KWH;
    try {
      const res = await fetch(`${backendBase}/api/user/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, amountKwh: allocatedKwh, fromBalance: true })
      });
      if (!res.ok) {
        alert('Allocation failed: ' + await safeText(res));
        return;
      }
      const data = await res.json();
      balanceBox && (balanceBox.textContent = (data.availableBalance || 0).toFixed(2));
      monthlyUsage && (monthlyUsage.textContent = parseFloat(data.allocatedEnergyKwh).toFixed(4) + ' kWh');
      remainingEnergy && (remainingEnergy.textContent = parseFloat(data.remainingEnergyKwh).toFixed(4) + ' kWh');
      localRemainingKwh = parseFloat(data.remainingEnergyKwh) || localRemainingKwh;
      if (allocateKwhBtn) allocateKwhBtn.disabled = true;
      monthlyInput.value = '';
      alert(`₹${rupees} added as ${allocatedKwh.toFixed(4)} kWh to monthly allocation.`);
    } catch (err) {
      console.error('Allocation error', err);
      alert('Allocation request failed');
    }
  });

  // ... rest of your original code (allocateKwhBtn, resetMonthlyBtn, relays, fetchLiveData)
  // For brevity, those parts are unchanged from your original file and still present below.

  if (allocateKwhBtn) allocateKwhBtn.addEventListener('click', async () => {
    const amountKwh = parseFloat(monthlyKwhInput.value);
    if (isNaN(amountKwh) || amountKwh <= 0) { alert('Enter valid kWh'); return; }
    try {
      const res = await fetch(`${backendBase}/api/user/allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, amountKwh, fromBalance: false })
      });
      if (!res.ok) {
        alert('Allocation failed: ' + await safeText(res));
        return;
      }
      const data = await res.json();
      monthlyUsage && (monthlyUsage.textContent = parseFloat(data.allocatedEnergyKwh).toFixed(4) + ' kWh');
      remainingEnergy && (remainingEnergy.textContent = parseFloat(data.remainingEnergyKwh).toFixed(4) + ' kWh');
      localRemainingKwh = parseFloat(data.remainingEnergyKwh) || localRemainingKwh;
      allocateKwhBtn.disabled = true;
      monthlyKwhInput.value = '';
      alert('Energy allocated for this month successfully.');
    } catch (err) {
      console.error('Allocation error', err);
      alert('Allocation request failed');
    }
  });

  if (resetMonthlyBtn) resetMonthlyBtn.addEventListener('click', async () => {
    if (!confirm('Reset monthly allocation?')) return;
    try {
      const res = await fetch(`${backendBase}/api/user/resetMonthly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      if (!res.ok) { alert('Reset failed: ' + await safeText(res)); return; }
      alert('Monthly allocation reset.');
      monthlyUsage && (monthlyUsage.textContent = '0.0000 kWh');
      totalUsed && (totalUsed.textContent = '0.0000 kWh');
      remainingEnergy && (remainingEnergy.textContent = '0.0000 kWh');
      predictedBill && (predictedBill.textContent = '₹0.00');
      localRemainingKwh = 0;
      if (allocateKwhBtn) allocateKwhBtn.disabled = false;
    } catch (err) {
      console.error('Reset error', err);
      alert('Reset request failed');
    }
  });

  async function controlRelay(channel, state) {
    try {
      const res = await fetch(`${esp32BaseUrl}/relay/${channel}/${state}`, { method: 'GET' });
      if (!res.ok) console.warn(`Relay ${channel} control returned ${res.status}`);
    } catch (err) {
      console.error('Relay control failed', err);
    }
  }

  if (powerOnBtn) powerOnBtn.addEventListener('click', async () => {
    const remaining = parseDisplayedKwh(remainingEnergy);
    if (remaining <= 0) { alert('Cannot turn on: No remaining energy'); return; }
    powerStatus && (powerStatus.textContent = 'Power: ON ⚡');
    await controlRelay(1, 'on'); await controlRelay(2, 'on');
    if (relaySwitch1) relaySwitch1.checked = true;
    if (relaySwitch2) relaySwitch2.checked = true;
    relayStatus1 && (relayStatus1.textContent = 'Relay 1: ON ⚡');
    relayStatus2 && (relayStatus2.textContent = 'Relay 2: ON ⚡');
  });
  if (powerOffBtn) powerOffBtn.addEventListener('click', async () => {
    powerStatus && (powerStatus.textContent = 'Power: OFF ❌');
    await controlRelay(1, 'off'); await controlRelay(2, 'off');
    if (relaySwitch1) relaySwitch1.checked = false;
    if (relaySwitch2) relaySwitch2.checked = false;
    relayStatus1 && (relayStatus1.textContent = 'Relay 1: OFF ❌');
    relayStatus2 && (relayStatus2.textContent = 'Relay 2: OFF ❌');
  });

  if (relaySwitch1) relaySwitch1.addEventListener('change', async () => {
    await controlRelay(1, relaySwitch1.checked ? 'on' : 'off');
    relayStatus1 && (relayStatus1.textContent = relaySwitch1.checked ? 'Relay 1: ON ⚡' : 'Relay 1: OFF ❌');
  });
  if (relaySwitch2) relaySwitch2.addEventListener('change', async () => {
    await controlRelay(2, relaySwitch2.checked ? 'on' : 'off');
    relayStatus2 && (relayStatus2.textContent = relaySwitch2.checked ? 'Relay 2: ON ⚡' : 'Relay 2: OFF ❌');
  });

  async function fetchLiveData() {
    try {
      const response = await fetch(`${esp32BaseUrl}/data`, { cache: "no-store" });
      if (!response.ok) { console.warn('ESP32 fetch failed', response.status); return; }
      const data = await response.json();

      const voltage = safeParseNumber(data.voltage, 0); // volts
      const currentA = safeParseNumber(data.current, 0); // amps
      const espPower = data.power != null ? safeParseNumber(data.power, voltage * currentA) : (voltage * currentA); // watts

      voltageEl && (voltageEl.textContent = voltage.toFixed(2) + ' V');
      currentEl && (currentEl.textContent = (currentA * 1000).toFixed(2) + ' mA');
      liveEnergyEl && (liveEnergyEl.textContent = (espPower / 1000).toFixed(4) + ' kW (' + espPower.toFixed(2) + ' W)');
      powerEl && (powerEl.textContent = espPower.toFixed(2) + ' W');

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

      if (localRemainingKwh == null) {
        localRemainingKwh = parseDisplayedKwh(remainingEnergy);
      }
      if (localRemainingKwh != null) {
        localRemainingKwh = Math.max(0, localRemainingKwh - consumedKwh);
        remainingEnergy && (remainingEnergy.textContent = localRemainingKwh.toFixed(4) + ' kWh');
      }

      if (accumulatedKwhSinceLastSync >= CONSUME_SYNC_THRESHOLD_KWH) {
        const res = await fetch(`${backendBase}/api/user/consume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, consumedKwh: accumulatedKwhSinceLastSync })
        });

        const body = res.headers.get('content-type') && res.headers.get('content-type').includes('application/json') ? await res.json() : null;

        if (!res.ok) {
          console.warn('Backend consume failed:', res.status, await safeText(res));
        } else {
          const used = parseFloat((body && body.usedEnergyKwh) || 0);
          const remaining = parseFloat((body && body.remainingEnergyKwh) || 0);
          const backendPredict = body && body.predictiveBill != null ? parseFloat(body.predictiveBill) : (used * TARIFF_RUPEES_PER_KWH);

          totalUsed && (totalUsed.textContent = used.toFixed(4) + ' kWh');
          remainingEnergy && (remainingEnergy.textContent = remaining.toFixed(4) + ' kWh');
          predictedBill && (predictedBill.textContent = '₹' + backendPredict.toFixed(2));

          localRemainingKwh = remaining;
          accumulatedKwhSinceLastSync = 0;

          if (remaining <= 0) {
            await controlRelay(1, 'off'); await controlRelay(2, 'off');
            if (relaySwitch1) relaySwitch1.checked = false;
            if (relaySwitch2) relaySwitch2.checked = false;
            relayStatus1 && (relayStatus1.textContent = 'Relay 1: OFF ❌');
            relayStatus2 && (relayStatus2.textContent = 'Relay 2: OFF ❌');
            powerStatus && (powerStatus.textContent = 'Power: OFF ❌');
            alert('Remaining energy reached 0 — system turned off.');
          } else {
            powerStatus && (powerStatus.textContent = 'Power: ON ⚡');
            if (relaySwitch1 && !relaySwitch1.checked) { await controlRelay(1, 'on'); relaySwitch1.checked = true; relayStatus1 && (relayStatus1.textContent = 'Relay 1: ON ⚡'); }
            if (relaySwitch2 && !relaySwitch2.checked) { await controlRelay(2, 'on'); relaySwitch2.checked = true; relayStatus2 && (relayStatus2.textContent = 'Relay 2: ON ⚡'); }
          }
        }
      }

    } catch (err) {
      console.warn('⚠️ Live fetch failed:', err);
    }
  }

  lastFetchTime = Date.now();
  fetchLiveData();
  setInterval(fetchLiveData, FETCH_INTERVAL_MS);
  setInterval(loadBudget, 10000);

  function safeParseNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseDisplayedKwh(el) {
    if (!el) return 0;
    const txt = (el.textContent || el.innerText || '').toString().trim();
    const num = parseFloat(txt.replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? num : 0;
  }

  async function safeText(response) {
    try {
      return await response.text();
    } catch (e) {
      return String(e);
    }
  }

});

// helper
function getQueryParam(param) { return new URLSearchParams(window.location.search).get(param); }
