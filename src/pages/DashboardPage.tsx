import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { TradingSignal } from '../lib/types';
import { generateSignal, getCurrentSession, getTimeUntilNextInterval } from '../lib/signalGenerator';
import SignalCard from '../components/SignalCard';
import SessionIndicator from '../components/SessionIndicator';
import StatsCard from '../components/StatsCard';
import ControlsPanel from '../components/ControlsPanel';
import { Activity, AlertCircle } from 'lucide-react';

export default function DashboardPage() {
  const [signals, setSignals] = useState<TradingSignal[]>([]);
  const [currentSignal, setCurrentSignal] = useState<TradingSignal | null>(null);
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [session, setSession] = useState(getCurrentSession());
  const [nextSignalIn, setNextSignalIn] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [noSignalMessage, setNoSignalMessage] = useState('');

  useEffect(() => {
    loadSignals();

    const subscription = supabase
      .channel('trading_signals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trading_signals' }, () => {
        loadSignals();
      })
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setSession(getCurrentSession());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let timeout: NodeJS.Timeout;

    if (isAutoMode) {
      const scheduleNextSignal = () => {
        const timeUntil = getTimeUntilNextInterval();

        const updateCountdown = () => {
          const remaining = getTimeUntilNextInterval();
          const seconds = Math.floor(remaining / 1000);
          const minutes = Math.floor(seconds / 60);
          const secs = seconds % 60;
          setNextSignalIn(`${minutes}:${secs.toString().padStart(2, '0')}`);
        };

        interval = setInterval(updateCountdown, 1000);
        updateCountdown();

        timeout = setTimeout(async () => {
          await generateAndSaveSignal();
          scheduleNextSignal();
        }, timeUntil);
      };

      scheduleNextSignal();
    }

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      setNextSignalIn('');
    };
  }, [isAutoMode]);

  const loadSignals = async () => {
    const { data, error } = await supabase
      .from('trading_signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(6);

    if (!error && data) {
      setSignals(data);
      if (data.length > 0) {
        const latest = data[0];
        const now = new Date();
        const endTime = new Date(latest.end_time);
        if (now < endTime) {
          setCurrentSignal(latest);
        } else {
          setCurrentSignal(null);
        }
      }
    }
  };

  const sendToTelegram = async (signal: TradingSignal) => {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-telegram-signal`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ signal }),
      });

      if (!response.ok) {
        console.error('Failed to send Telegram notification');
      }
    } catch (error) {
      console.error('Telegram error:', error);
    }
  };

  const generateAndSaveSignal = async () => {
    setIsGenerating(true);
    setNoSignalMessage('');
    const newSignal = generateSignal();

    if (newSignal && newSignal.confidence > 0) {
      const { data, error } = await supabase
        .from('trading_signals')
        .insert([newSignal])
        .select()
        .single();

      if (!error && data) {
        setCurrentSignal(data);
        await sendToTelegram(data);
      }
    } else {
      const savedSettings = localStorage.getItem('tradingSettings');
      const threshold = savedSettings ? JSON.parse(savedSettings).confidenceThreshold ?? 88 : 88;
      setNoSignalMessage(`No signals met the ${threshold}% confidence threshold. The market may not have strong enough signals right now.`);
    }
    setIsGenerating(false);
  };

  const clearHistory = async () => {
    const confirmed = window.confirm('Are you sure you want to clear all signal history?');
    if (confirmed) {
      await supabase.from('trading_signals').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      setSignals([]);
      setCurrentSignal(null);
    }
  };

  const toggleMode = () => {
    setIsAutoMode(!isAutoMode);
  };

  const totalSignals = signals.length;
  const buySignals = signals.filter(s => s.action === 'BUY').length;
  const sellSignals = signals.filter(s => s.action === 'SELL').length;

  return (
    <main className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <SessionIndicator session={session} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatsCard
          label="Recent Signals"
          value={totalSignals}
          icon="signals"
          theme="blue"
        />
        <StatsCard
          label="Buy Signals"
          value={buySignals}
          icon="trending"
          theme="emerald"
          change={{ value: Math.round((buySignals / Math.max(totalSignals, 1)) * 100), trend: 'up' }}
        />
        <StatsCard
          label="Sell Signals"
          value={sellSignals}
          icon="success"
          theme="orange"
          change={{ value: Math.round((sellSignals / Math.max(totalSignals, 1)) * 100), trend: 'up' }}
        />
      </div>

      <div>
        <div className="mb-8">
          <ControlsPanel
            isAutoMode={isAutoMode}
            nextSignalIn={nextSignalIn}
            isGenerating={isGenerating}
            onToggleMode={toggleMode}
            onGenerateSignal={generateAndSaveSignal}
            onClearHistory={clearHistory}
          />
        </div>

        <div>
          {noSignalMessage && (
            <div className="mb-8 bg-amber-50 border border-amber-200 rounded-xl p-6 flex items-center gap-4">
              <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0" />
              <div>
                <p className="font-semibold text-amber-900">{noSignalMessage}</p>
              </div>
            </div>
          )}

          {currentSignal && (
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-5">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                  <h2 className="text-2xl font-bold text-slate-900">Active Signal</h2>
                </div>
                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700">LIVE</span>
              </div>
              <SignalCard signal={currentSignal} />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-2xl font-bold text-slate-900">Recent Signals</h2>
            </div>
            {signals.length === 0 ? (
              <div className="bg-white rounded-xl p-16 text-center border border-slate-200 shadow-sm">
                <Activity className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                <p className="text-slate-500 text-lg">No signals generated yet</p>
                <p className="text-slate-400 text-sm mt-2">Start generating signals to see them here</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {signals.map((signal) => (
                  <SignalCard key={signal.id} signal={signal} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
