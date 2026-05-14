const thresholdInput = document.querySelector('#threshold');
const thresholdReadout = document.querySelector('#threshold-readout');
const refreshButton = document.querySelector('#refresh');
const statusEl = document.querySelector('#status');
const asOfEl = document.querySelector('#as-of');
const resultCountEl = document.querySelector('#result-count');
const gainersBody = document.querySelector('#gainers-body');

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});
const numberFormatter = new Intl.NumberFormat('en-US');
const percentFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

let refreshTimer;

function updateThresholdReadout() {
  thresholdReadout.textContent = `${Number(thresholdInput.value).toFixed(1)}%`;
}

function setLoading(isLoading) {
  refreshButton.disabled = isLoading;
  refreshButton.textContent = isLoading ? 'Refreshing…' : 'Refresh now';
}

function formatAsOf(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '\"': '&quot;'
  })[character]);
}

function renderEmpty(message) {
  gainersBody.innerHTML = `
    <tr>
      <td colspan="6" class="empty">${escapeHtml(message)}</td>
    </tr>
  `;
}

function renderRows(stocks) {
  if (!stocks.length) {
    renderEmpty('No S&P 500 stocks are above this gain threshold right now. Try a lower threshold.');
    return;
  }

  gainersBody.innerHTML = stocks
    .map((stock) => `
      <tr>
        <td><a href="https://finance.yahoo.com/quote/${encodeURIComponent(stock.yahooSymbol)}" target="_blank" rel="noreferrer">${escapeHtml(stock.symbol)}</a></td>
        <td>${escapeHtml(stock.company)}</td>
        <td>${currencyFormatter.format(stock.price)}</td>
        <td class="positive">${stock.change === null ? '—' : currencyFormatter.format(stock.change)}</td>
        <td><span class="gain-badge">+${percentFormatter.format(stock.changePercent)}%</span></td>
        <td>${stock.volume === null ? '—' : numberFormatter.format(stock.volume)}</td>
      </tr>
    `)
    .join('');
}

async function loadGainers() {
  const threshold = Number(thresholdInput.value);
  updateThresholdReadout();
  setLoading(true);
  statusEl.textContent = 'Loading current market data…';

  try {
    const response = await fetch(`/api/gainers?threshold=${encodeURIComponent(threshold)}&limit=100`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || payload.error || 'Market data request failed.');
    }

    renderRows(payload.gainers);
    resultCountEl.textContent = `${payload.count} ${payload.count === 1 ? 'stock' : 'stocks'}`;
    asOfEl.textContent = formatAsOf(payload.asOf);
    statusEl.textContent = `Showing stocks up at least ${payload.threshold.toFixed(1)}%.`;
  } catch (error) {
    renderEmpty('Unable to load current market data. Please try again in a moment.');
    resultCountEl.textContent = '0 stocks';
    statusEl.textContent = error.message;
  } finally {
    setLoading(false);
  }
}

thresholdInput.addEventListener('input', updateThresholdReadout);
thresholdInput.addEventListener('change', loadGainers);
refreshButton.addEventListener('click', loadGainers);

loadGainers();
refreshTimer = window.setInterval(loadGainers, 60_000);
window.addEventListener('beforeunload', () => window.clearInterval(refreshTimer));
