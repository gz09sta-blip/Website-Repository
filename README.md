# S&P 500 Large Gainers Today

A lightweight Node-powered website that shows S&P 500 stocks whose regular-market gains are above a configurable threshold.

## How it works

- The server fetches the current S&P 500 constituent list from Wikipedia and caches it for 24 hours.
- It fetches quote data from Yahoo Finance's quote endpoint and caches quotes for 60 seconds.
- The browser calls `/api/gainers`, renders stocks sorted by percentage gain, and refreshes once per minute.

## Run locally

```bash
npm start
```

Then open <http://localhost:3000>.

## Checks

```bash
npm run check
```
