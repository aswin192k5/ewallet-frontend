// Replace with your ESP32 IP
const ESP32_IP = "http://192.168.128.147";

// Function to toggle relay
function toggleRelay(relay, state) {
  const url = `${ESP32_IP}/api/relay${relay}/${state ? "on" : "off"}`;
  console.log("Requesting:", url);

  fetch(url)
    .then(res => res.json())
    .then(data => {
      console.log(`Relay ${relay} response:`, data);
      updateRelayStatus(relay, data[`relay${relay}`]);
    })
    .catch(err => {
      console.error("Error:", err);
      alert("Failed to send command. Check ESP32 connection.");
    });
}

// Function to update relay status on UI
function updateRelayStatus(relay, status) {
  const card = document.getElementById(`relay${relay}`);
  const parentCard = card.closest('.card');

  // Remove old status if exists
  let statusLabel = parentCard.querySelector('.status');
  if (!statusLabel) {
    statusLabel = document.createElement('p');
    statusLabel.className = 'status';
    statusLabel.style.marginTop = '10px';
    statusLabel.style.fontWeight = 'bold';
    parentCard.appendChild(statusLabel);
  }

  if (status === 'on') {
    statusLabel.textContent = 'ON';
    statusLabel.style.color = '#4CAF50'; // green
  } else {
    statusLabel.textContent = 'OFF';
    statusLabel.style.color = '#F44336'; // red
  }

  // Sync checkbox with actual status
  card.checked = (status === 'on');
}

// Initial fetch to get current relay states from ESP32
function fetchRelayStatus() {
  [1, 2].forEach(relay => {
    fetch(`${ESP32_IP}/api/relay${relay}/status`)
      .then(res => res.json())
      .then(data => {
        updateRelayStatus(relay, data[`relay${relay}`]);
      })
      .catch(err => console.error(`Error fetching relay ${relay} status:`, err));
  });
}

// Run on page load
document.addEventListener('DOMContentLoaded', () => {
  fetchRelayStatus();

  // Repeat fetch every 5 seconds to keep UI updated
  setInterval(fetchRelayStatus, 5000);

  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      sessionStorage.clear();
      window.location.href = 'login.html';
    });
  }
});
