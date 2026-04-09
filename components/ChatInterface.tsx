'use client';

import { useState } from 'react';
import { toast } from 'sonner';

export function ChatInterface() {
  const [input, setInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || submitting) return;

    setSubmitting(true);
    setInput('');

    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageText: text }),
      });
      if (!res.ok) throw new Error();
      toast.success('Ticket created', {
        description: 'Your message was logged as a support ticket.',
        action: { label: 'View', onClick: () => window.open('/tickets', '_blank') },
      });
    } catch {
      toast.error('Could not create ticket — please try again.');
      setInput(text);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6">
      <p className="text-sm text-slate-500 mb-4">
        Describe your issue and we'll log it as a support ticket.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="e.g. I'm getting a 402 error when I use the charges endpoint…"
          rows={5}
          disabled={submitting}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent disabled:opacity-50"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || !input.trim()}
            className="px-4 py-2 bg-slate-900 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Submitting…' : 'Submit ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
