const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ForexCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") || "";

const FOREX_PAIRS = {
  Asian: [
    { symbol: "USDJPY", display: "USD/JPY" },
    { symbol: "AUDJPY", display: "AUD/JPY" },
    { symbol: "NZDJPY", display: "NZD/JPY" },
    { symbol: "AUDUSD", display: "AUD/USD" },
    { symbol: "NZDUSD", display: "NZD/USD" },
  ],
  London: [
    { symbol: "EURUSD", display: "EUR/USD" },
    { symbol: "GBPUSD", display: "GBP/USD" },
    { symbol: "EURGBP", display: "EUR/GBP" },
    { symbol: "EURJPY", display: "EUR/JPY" },
    { symbol: "GBPJPY", display: "GBP/JPY" },
  ],
  "New York": [
    { symbol: "USDCAD", display: "USD/CAD" },
    { symbol: "EURUSD", display: "EUR/USD" },
    { symbol: "GBPUSD", display: "GBP/USD" },
    { symbol: "USDCHF", display: "USD/CHF" },
    { symbol: "AUDUSD", display: "AUD/USD" },
  ],
};

async function fetchForexData(
  symbol: string
): Promise<ForexCandle[]> {
  try {
    const url = `https://finnhub.io/api/forex/candle?symbol=${symbol}&resolution=5&count=50&token=${FINNHUB_API_KEY}`;

    const response = await fetch(url);
    const data = await response.json();

    if (!data.o || !Array.isArray(data.o)) {
      return [];
    }

    const candles: ForexCandle[] = [];
    for (let i = 0; i < data.o.length; i++) {
      candles.push({
        timestamp: (data.t[i] || 0) * 1000,
        open: data.o[i] || 0,
        high: data.h[i] || 0,
        low: data.l[i] || 0,
        close: data.c[i] || 0,
      });
    }

    return candles;
  } catch (error) {
    console.error(`Error fetching ${symbol}:`, error);
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol");
    const session = url.searchParams.get("session") || "Asian";

    if (!symbol) {
      return new Response(
        JSON.stringify({ error: "Symbol parameter required" }),
        {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (!FINNHUB_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Finnhub API key not configured" }),
        {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    const candles = await fetchForexData(symbol);

    return new Response(JSON.stringify({ candles, symbol, session }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
