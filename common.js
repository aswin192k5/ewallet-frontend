// Utility to simulate random live data
function simulateLiveData(elementId, min, max, unit = '') {
  const el = document.getElementById(elementId);
  if (!el) return;
  const value = (Math.random() * (max - min) + min).toFixed(2);
  el.textContent = `${value} ${unit}`;
}
