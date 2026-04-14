'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SimulatePage() {
  const router = useRouter();
  const [messageText, setMessageText] = useState('');
  const [multiAgent, setMultiAgent] = useState(true);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!messageText.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText, channelId: 'C0ASUJE9N48', multiAgent }),
      });
      const { ticket } = await res.json();
      router.push(`/tickets/${ticket.id}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Simulate Message</h1>
        <Link href="/tickets" className="text-sm px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-100">
          ← Tickets
        </Link>
      </div>
      <p className="text-slate-500 text-sm mb-6">
        Simulates an incoming Slack message and triggers the full enrichment agent flow.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <textarea
          autoFocus
          value={messageText}
          onChange={e => setMessageText(e.target.value)}
          placeholder="Hey, I can't attach a payment method to customer cus_123…"
          rows={6}
          className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={multiAgent}
              onChange={e => setMultiAgent(e.target.checked)}
              className="w-4 h-4 accent-slate-900"
            />
            Multi-agent mode
            <span className="text-slate-400">({multiAgent ? 'parallel sub-agents' : 'single agent'})</span>
          </label>
          <button
            type="submit"
            disabled={loading || !messageText.trim()}
            className="px-5 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Sending…' : 'Send message'}
          </button>
        </div>
      </form>
    </main>
  );
}
