const http = require('node:http');
const path = require('node:path');
const { readFile } = require('node:fs/promises');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = __dirname;
const WIKIPEDIA_SP500_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const LARGE_GAIN_THRESHOLD = 3;

let componentsCache = { expiresAt: 0, data: [] };
const quotesCache = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function toYahooSymbol(symbol) {
  return symbol.replace(/\./g, '-');
}

function parseSp500Components(html) {
  const tableMatch = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    throw new Error('Could not find S&P 500 constituents table on Wikipedia.');
  }

  const rows = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  return rows
    .slice(1)
    .map((row) => {
      const cells = row.match(/<td[\s\S]*?<\/td>/gi) || [];
      if (cells.length < 2) return null;

      const symbol = decodeHtml(cells[0].replace(/<[^>]+>/g, '').trim());
      const company = decodeHtml(cells[1].replace(/<[^>]+>/g, '').trim());
      if (!symbol || !company) return null;

      return {
        symbol,
        yahooSymbol: toYahooSymbol(symbol),
        company
      };
    })
    .filter(Boolean);
}

async function getSp500Components() {
  const now = Date.now();
  if (componentsCache.data.length && componentsCache.expiresAt > now) {
    return componentsCache.data;
  }

  const response = await fetch(WIKIPEDIA_SP500_URL, {
    headers: {
      'User-Agent': 'sp500-large-gainers-demo/1.0 (educational project)'
    }
  });

  if (!response.ok) {
    throw new Error(`Wikipedia request failed with HTTP ${response.status}`);
  }

  const components = parseSp500Components(await response.text());
  if (components.length < 450) {
    throw new Error(`Expected S&P 500 component list, received ${components.length} symbols.`);
  }

  componentsCache = {
    data: components,
    expiresAt: now + 24 * 60 * 60 * 1000
  };

  return components;
}

function chunk(array, size) {
  const chunks = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

async function fetchYahooQuotes(symbols) {
  const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbols.join(','))}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 sp500-large-gainers-demo/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance quote request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();
  return payload?.quoteResponse?.result || [];
}

async function getQuotes(components) {
  const now = Date.now();
  const symbolsToFetch = [];

  for (const component of components) {
    const cached = quotesCache.get(component.yahooSymbol);
    if (!cached || cached.expiresAt <= now) {
      symbolsToFetch.push(component.yahooSymbol);
    }
  }

  for (const symbolChunk of chunk(symbolsToFetch, 100)) {
    const quotes = await fetchYahooQuotes(symbolChunk);
    for (const quote of quotes) {
      quotesCache.set(quote.symbol, {
        data: quote,
        expiresAt: now + 60 * 1000
      });
    }
  }

  return components.map((component) => ({
    component,
    quote: quotesCache.get(component.yahooSymbol)?.data
  }));
}

function formatQuote({ component, quote }) {
  const changePercent = Number(quote?.regularMarketChangePercent);
  const price = Number(quote?.regularMarketPrice);
  const change = Number(quote?.regularMarketChange);

  if (!Number.isFinite(changePercent) || !Number.isFinite(price)) {
    return null;
  }

  return {
    symbol: component.symbol,
    yahooSymbol: component.yahooSymbol,
    company: component.company,
    price,
    change: Number.isFinite(change) ? change : null,
    changePercent,
    volume: Number.isFinite(Number(quote.regularMarketVolume)) ? Number(quote.regularMarketVolume) : null,
    marketTime: quote.regularMarketTime ? new Date(quote.regularMarketTime * 1000).toISOString() : null,
    exchange: quote.fullExchangeName || quote.exchange || null
  };
}

async function handleGainers(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const thresholdParam = Number(url.searchParams.get('threshold'));
    const threshold = Number.isFinite(thresholdParam) ? thresholdParam : LARGE_GAIN_THRESHOLD;
    const limitParam = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100;

    const components = await getSp500Components();
    const quotes = await getQuotes(components);
    const gainers = quotes
      .map(formatQuote)
      .filter(Boolean)
      .filter((stock) => stock.changePercent >= threshold)
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, limit);

    sendJson(res, 200, {
      asOf: new Date().toISOString(),
      threshold,
      source: {
        components: WIKIPEDIA_SP500_URL,
        prices: 'Yahoo Finance quote endpoint'
      },
      count: gainers.length,
      gainers
    });
  } catch (error) {
    sendJson(res, 502, {
      error: 'Unable to load current market data.',
      detail: error.message
    });
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = path.normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/gainers')) {
    handleGainers(req, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`S&P 500 gainers site running at http://localhost:${PORT}`);
});
