import { MarketSession } from './types';

const CURRENCY_PAIRS = {
  Asian: [
    { symbol: 'USDJPY', display: 'USD/JPY' },
    { symbol: 'AUDJPY', display: 'AUD/JPY' },
    { symbol: 'NZDJPY', display: 'NZD/JPY' },
    { symbol: 'AUDUSD', display: 'AUD/USD' },
    { symbol: 'NZDUSD', display: 'NZD/USD' },
  ],
  London: [
    { symbol: 'EURUSD', display: 'EUR/USD' },
    { symbol: 'GBPUSD', display: 'GBP/USD' },
    { symbol: 'EURGBP', display: 'EUR/GBP' },
    { symbol: 'EURJPY', display: 'EUR/JPY' },
    { symbol: 'GBPJPY', display: 'GBP/JPY' },
  ],
  'New York': [
    { symbol: 'USDCAD', display: 'USD/CAD' },
    { symbol: 'EURUSD', display: 'EUR/USD' },
    { symbol: 'GBPUSD', display: 'GBP/USD' },
    { symbol: 'USDCHF', display: 'USD/CHF' },
    { symbol: 'AUDUSD', display: 'AUD/USD' },
  ],
};

interface PriceData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

class ForexDataProvider {
  private cache: Map<string, PriceData[]> = new Map();
  private cacheTimestamp: Map<string, number> = new Map();
  private readonly CACHE_DURATION = 60000; // 1 minute cache

  async getPriceHistory(pairDisplay: string, symbol: string, periods: number = 50): Promise<PriceData[]> {
    const cached = this.cache.get(symbol);
    const cachedTime = this.cacheTimestamp.get(symbol) || 0;

    if (cached && Date.now() - cachedTime < this.CACHE_DURATION) {
      return cached.slice(-periods);
    }

    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/fetch-forex-data?symbol=${symbol}`;

      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch forex data');
      }

      const data = await response.json();
      const candles = data.candles || [];

      this.cache.set(symbol, candles);
      this.cacheTimestamp.set(symbol, Date.now());

      return candles.slice(-periods);
    } catch (error) {
      console.error(`Error fetching ${symbol}:`, error);
      return cached || [];
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheTimestamp.clear();
  }
}

const dataProvider = new ForexDataProvider();

function calculateRSI(prices: PriceData[], period: number = 14): number {
  const closes = prices.map(p => p.close);
  const changes = [];

  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  const gains = changes.filter(c => c > 0).slice(-period);
  const losses = changes.filter(c => c < 0).map(c => Math.abs(c)).slice(-period);

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b) / period : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b) / period : 0;

  if (avgLoss === 0) return avgGain > 0 ? 100 : 0;

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

function calculateMACD(prices: PriceData[]): { macd: number; signal: number; histogram: number } {
  const closes = prices.map(p => p.close);

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;

  const macdValues = [];
  for (let i = 0; i < closes.length; i++) {
    const e12 = calculateEMA(closes.slice(0, i + 1), 12);
    const e26 = calculateEMA(closes.slice(0, i + 1), 26);
    macdValues.push(e12 - e26);
  }

  const signal = calculateEMA(macdValues, 9);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

function calculateEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;

  const multiplier = 2 / (period + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * multiplier + ema * (1 - multiplier);
  }

  return ema;
}

function calculateMovingAverages(prices: PriceData[]): { sma20: number; sma50: number; ema9: number } {
  const closes = prices.map(p => p.close);

  const sma20 = closes.slice(-20).reduce((a, b) => a + b) / 20;
  const sma50 = closes.slice(-50).reduce((a, b) => a + b) / Math.min(50, closes.length);
  const ema9 = calculateEMA(closes, 9);

  return { sma20, sma50, ema9 };
}

function calculateStochastic(prices: PriceData[], period: number = 14): { k: number; d: number } {
  const recent = prices.slice(-period);
  let high = recent[0].high, low = recent[0].low;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > high) high = recent[i].high;
    if (recent[i].low < low) low = recent[i].low;
  }

  const current = recent[recent.length - 1].close;
  const k = high === low ? 50 : ((current - low) / (high - low)) * 100;
  const d = (k + (prices.length > 1 ? k : 0) + (prices.length > 2 ? k : 0)) / 3;

  return { k, d };
}

function calculateBollingerBands(prices: PriceData[], period: number = 20): { upper: number; middle: number; lower: number } {
  const closes = prices.map(p => p.close);
  const lastCloses = closes.slice(-period);

  const middle = lastCloses.reduce((a, b) => a + b) / period;
  const variance = lastCloses.reduce((sum, val) => sum + Math.pow(val - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + (stdDev * 2),
    middle,
    lower: middle - (stdDev * 2)
  };
}

function calculateATR(prices: PriceData[], period: number = 14): number {
  let sum = 0, count = 0;

  for (let i = Math.max(1, prices.length - period); i < prices.length; i++) {
    const current = prices[i];
    const previous = prices[i - 1];

    const tr1 = current.high - current.low;
    const tr2 = Math.abs(current.high - previous.close);
    const tr3 = Math.abs(current.low - previous.close);

    sum += Math.max(tr1, tr2, tr3);
    count++;
  }

  return count > 0 ? sum / count : 0;
}

function detectSupportResistance(prices: PriceData[]): { support: number; resistance: number } {
  const highs = prices.map(p => p.high);
  const lows = prices.map(p => p.low);

  const resistance = Math.max(...highs);
  const support = Math.min(...lows);

  return { support, resistance };
}

export function getCurrentSession(): MarketSession {
  const now = new Date();
  const hour = now.getUTCHours();

  if (hour >= 0 && hour < 8) {
    return { name: 'Asian', active: true, pairs: CURRENCY_PAIRS.Asian };
  } else if (hour >= 8 && hour < 16) {
    return { name: 'London', active: true, pairs: CURRENCY_PAIRS.London };
  } else {
    return { name: 'New York', active: true, pairs: CURRENCY_PAIRS['New York'] };
  }
}

export function getNextFiveMinuteInterval(): { start: Date; end: Date } {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();

  const alignedMinute = Math.ceil(minutes / 5) * 5;
  const nextInterval = new Date(now);

  if (alignedMinute === 60) {
    nextInterval.setHours(nextInterval.getHours() + 1);
    nextInterval.setMinutes(0);
  } else {
    nextInterval.setMinutes(alignedMinute);
  }

  nextInterval.setSeconds(0);
  nextInterval.setMilliseconds(0);

  if (seconds === 0 && milliseconds === 0 && minutes % 5 === 0) {
    nextInterval.setMinutes(minutes + 5);
    if (nextInterval.getMinutes() === 65) {
      nextInterval.setHours(nextInterval.getHours() + 1);
      nextInterval.setMinutes(5);
    }
  }

  const endInterval = new Date(nextInterval);
  endInterval.setMinutes(nextInterval.getMinutes() + 5);

  return { start: nextInterval, end: endInterval };
}

export async function analyzePattern(pair: { symbol: string; display: string }): Promise<{ action: 'BUY' | 'SELL'; confidence: number }> {
  const priceHistory = await dataProvider.getPriceHistory(pair.display, pair.symbol, 50);
  if (priceHistory.length < 30) {
    return { action: 'BUY', confidence: 0 };
  }

  const rsi = calculateRSI(priceHistory);
  const { macd, signal, histogram } = calculateMACD(priceHistory);
  const { sma20, sma50, ema9 } = calculateMovingAverages(priceHistory);
  const { k: stoch_k, d: stoch_d } = calculateStochastic(priceHistory);
  const { upper, middle, lower } = calculateBollingerBands(priceHistory);
  const atr = calculateATR(priceHistory);
  const { support, resistance } = detectSupportResistance(priceHistory);

  const currentPrice = priceHistory[priceHistory.length - 1].close;
  const lastPrice = priceHistory[priceHistory.length - 2].close;
  const priceChange = ((currentPrice - lastPrice) / lastPrice) * 100;

  const recentClose = priceHistory.slice(-5).map(p => p.close);
  const isConsecutiveGain = recentClose[0] < recentClose[1] && recentClose[1] < recentClose[2];
  const isConsecutiveLoss = recentClose[0] > recentClose[1] && recentClose[1] > recentClose[2];

  let bullishSignals = 0;
  let bearishSignals = 0;
  let totalSignals = 0;

  // Extreme RSI readings = high conviction (M5 sensitive)
  if (rsi < 25) bullishSignals += 3;
  else if (rsi < 35) bullishSignals += 2.5;
  else if (rsi < 50) bullishSignals += 1.2;
  else if (rsi > 75) bearishSignals += 3;
  else if (rsi > 65) bearishSignals += 2.5;
  else if (rsi > 50) bearishSignals += 1.2;
  totalSignals += 3;

  // MACD crossovers with histogram strength
  const histogramStrength = Math.abs(histogram);
  if (histogram > 0 && macd > signal) {
    bullishSignals += 2.5 + (histogramStrength > 0.015 ? 1.5 : histogramStrength > 0.005 ? 0.8 : 0);
  } else if (histogram < 0 && macd < signal) {
    bearishSignals += 2.5 + (histogramStrength > 0.015 ? 1.5 : histogramStrength > 0.005 ? 0.8 : 0);
  }
  totalSignals += 2.5;

  // MA alignment (strong signals for aligned MAs)
  if (currentPrice > sma20 && sma20 > sma50) bullishSignals += 2.5;
  else if (currentPrice > sma20 && currentPrice > sma50) bullishSignals += 1.5;
  else if (currentPrice < sma20 && sma20 < sma50) bearishSignals += 2.5;
  else if (currentPrice < sma20 && currentPrice < sma50) bearishSignals += 1.5;
  totalSignals += 2.5;

  // EMA proximity (M5 tight EMA distances mean strong direction)
  const distToEma = Math.abs(currentPrice - ema9) / ema9;
  if (currentPrice > ema9 && distToEma < 0.005) bullishSignals += 2;
  else if (currentPrice > ema9 && distToEma < 0.015) bullishSignals += 1.3;
  else if (currentPrice < ema9 && distToEma < 0.005) bearishSignals += 2;
  else if (currentPrice < ema9 && distToEma < 0.015) bearishSignals += 1.3;
  totalSignals += 2;

  // Consecutive patterns (strong for M5)
  if (isConsecutiveGain && currentPrice > support) bullishSignals += 2.5;
  else if (isConsecutiveLoss && currentPrice < resistance) bearishSignals += 2.5;
  totalSignals += 2.5;

  // Stochastic K%D (sensitive M5 indicator)
  if (stoch_k < 15) bullishSignals += 2.2;
  else if (stoch_k < 30) bullishSignals += 1.5;
  else if (stoch_k > 85) bearishSignals += 2.2;
  else if (stoch_k > 70) bearishSignals += 1.5;

  if (stoch_k > stoch_d) bullishSignals += 1.2;
  else bearishSignals += 1.2;
  totalSignals += 2.2;

  // Bollinger Bands (extremes = high confidence)
  const bandPosition = (currentPrice - lower) / (upper - lower);
  if (currentPrice < lower) bullishSignals += 2.5;
  else if (bandPosition < 0.15) bullishSignals += 1.8;
  else if (currentPrice > upper) bearishSignals += 2.5;
  else if (bandPosition > 0.85) bearishSignals += 1.8;

  if (currentPrice > middle && bandPosition > 0.5) bullishSignals += 0.8;
  else if (currentPrice < middle && bandPosition < 0.5) bearishSignals += 0.8;
  totalSignals += 2.5;

  // Volatility analysis
  const recentHigh = Math.max(...priceHistory.slice(-5).map(p => p.high));
  const recentLow = Math.min(...priceHistory.slice(-5).map(p => p.low));
  const volatility = recentHigh - recentLow;
  const volatilityRatio = atr / (volatility || 0.001);

  if (volatilityRatio > 1.2) bullishSignals += 0.8;
  else if (volatilityRatio > 0.8) bearishSignals += 0.8;
  totalSignals += 0.8;

  // Price momentum (M5 requires bigger moves)
  if (priceChange > 0.08 && rsi < 70) bullishSignals += 1.5;
  if (priceChange < -0.08 && rsi > 30) bearishSignals += 1.5;
  totalSignals += 1.5;

  const bullishPercentage = (bullishSignals / totalSignals) * 100;
  const action = bullishSignals > bearishSignals ? 'BUY' : 'SELL';

  const confirmationStrength = Math.abs(bullishSignals - bearishSignals);
  const baseConfidence = bullishPercentage;
  const confidence = Math.round((baseConfidence * (confirmationStrength / totalSignals)) * 3.5);

  return { action, confidence: Math.min(99, Math.max(45, confidence)) };
}

async function analyzeMultiTimeframe(pair: { symbol: string; display: string }, priceHistory: PriceData[]): Promise<number> {
  const shortTerm = priceHistory.slice(-20);
  if (shortTerm.length < 10) return 0;

  const short_rsi = calculateRSI(shortTerm);
  const short_trend = shortTerm[shortTerm.length - 1].close > shortTerm[0].close ? 1 : -1;
  const short_momentum = (shortTerm[shortTerm.length - 1].close - shortTerm[0].close) / shortTerm[0].close;

  const allPrices = priceHistory;
  const medium_rsi = calculateRSI(allPrices);
  const medium_trend = allPrices[allPrices.length - 1].close > allPrices[0].close ? 1 : -1;
  const medium_momentum = (allPrices[allPrices.length - 1].close - allPrices[0].close) / allPrices[0].close;

  let mtfScore = 0;

  if (short_trend === medium_trend) {
    mtfScore += 1.2;
  } else {
    mtfScore += 0.1;
  }

  if (Math.abs(short_momentum) > 0.01) {
    mtfScore += 0.4;
  }

  if (Math.abs(medium_momentum) > 0.02) {
    mtfScore += 0.4;
  }

  if (Math.abs(short_rsi - medium_rsi) > 20) {
    mtfScore += 0.2;
  } else if (Math.abs(short_rsi - medium_rsi) < 5) {
    mtfScore += 0.3;
  }

  return Math.min(1.2, mtfScore);
}

export async function generateSignal(thresholdOverride?: number) {
  const session = getCurrentSession();
  const pairs = session.pairs;

  let threshold = thresholdOverride ?? 65;
  if (thresholdOverride === undefined) {
    const savedSettings = localStorage.getItem('tradingSettings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      threshold = settings.confidenceThreshold ?? 65;
    }
  }

  const { start: startTime, end: endTime } = getNextFiveMinuteInterval();

  let attempts = 0;
  const maxAttempts = 50;
  let validSignals: Array<{ signal: any; confidence: number }> = [];

  while (attempts < maxAttempts) {
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const priceHistory = await dataProvider.getPriceHistory(pair.display, pair.symbol, 50);

    if (priceHistory.length < 30) {
      attempts++;
      continue;
    }

    const { action, confidence } = await analyzePattern(pair);
    const mtf = await analyzeMultiTimeframe(pair, priceHistory);
    const mtfBoost = mtf > 1 ? (mtf - 1) * 8 : mtf * 4;
    const finalConfidence = Math.min(99, Math.round(confidence + mtfBoost));

    if (finalConfidence >= threshold) {
      validSignals.push({
        signal: {
          pair: pair.display,
          action,
          confidence: finalConfidence,
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
          session: session.name
        },
        confidence: finalConfidence
      });

      if (validSignals.length >= 3) {
        break;
      }
    }

    attempts++;
  }

  if (validSignals.length === 0) {
    return null;
  }

  const bestValid = validSignals.reduce((best, current) =>
    current.confidence > best.confidence ? current : best
  );

  return bestValid.signal;
}

export function getTimeUntilNextInterval(): number {
  const now = new Date();
  const { start } = getNextFiveMinuteInterval();
  return start.getTime() - now.getTime();
}
