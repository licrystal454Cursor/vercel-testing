'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { sendReply } from '@/lib/api';
import type { SupportTicket } from '@/lib/types';

export function TicketDetailClient({ ticket }: { ticket: SupportTicket }) {
  const [reply, setReply] = useState(ticket.aiDraftReply);
  const [sending, setSending] = useState(false);
  const isResolved = ticket.status === 'resolved';

  const handleSend = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await sendReply(ticket.id, reply);
      toast.success('Reply sent to Slack thread');
      // Refresh the page to show resolved state
      window.location.reload();
    } catch {
      toast.error('Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">
            Ticket #{ticket.id.slice(0, 8)}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {new Date(ticket.createdAt).toLocaleString()}
          </p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
            isResolved
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}
        >
          {ticket.status}
        </span>
      </div>

      {/* Original message */}
      <Section title="Original Slack Message">
        <p className="text-sm bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap">
          {ticket.input.messageText}
        </p>
      </Section>

      {/* Extracted question */}
      <Section title="Extracted Question">
        <p className="text-sm font-medium">{ticket.extractedQuestion}</p>
      </Section>

      {/* AI analysis */}
      <Section title="AI Analysis">
        <div className="text-sm bg-blue-50 border border-blue-100 rounded p-4 whitespace-pre-wrap leading-relaxed">
          {ticket.aiAnalysis}
        </div>
      </Section>

      {/* Replication results */}
      <Section title="Error Replication (Staging API)">
        <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
          {ticket.replicationResult}
        </pre>
      </Section>

      {/* Public docs — collapsible */}
      <Section title="Public Documentation">
        <details className="group">
          <summary className="cursor-pointer text-sm text-slate-600 select-none list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Show fetched documentation
          </summary>
          <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
            {ticket.publicDocsContent}
          </pre>
        </details>
      </Section>

      {/* Notion docs — collapsible */}
      <Section title="Notion Documentation">
        <details className="group">
          <summary className="cursor-pointer text-sm text-slate-600 select-none list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Show Notion findings
          </summary>
          <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
            {ticket.notionContent || 'No Notion content found.'}
          </pre>
        </details>
      </Section>

      {/* Reply form */}
      <Section title="Reply to Customer">
        {isResolved ? (
          <div className="space-y-2">
            <p className="text-xs text-green-700 font-medium">Reply sent:</p>
            <p className="text-sm bg-green-50 border border-green-200 rounded p-3 whitespace-pre-wrap">
              {ticket.sentReply}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              AI draft pre-filled. Edit freely or write your own reply.
            </p>
            <textarea
              className="w-full min-h-[160px] p-3 border border-slate-300 rounded text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder="Type your reply..."
            />
            <div className="flex gap-3">
              <button
                onClick={handleSend}
                disabled={sending || !reply.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
              >
                {sending ? 'Sending...' : 'Send to Slack Thread'}
              </button>
              <button
                onClick={() => setReply(ticket.aiDraftReply)}
                className="px-4 py-2 bg-slate-100 rounded text-sm hover:bg-slate-200 transition-colors"
              >
                Reset to AI Draft
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <h2 className="font-semibold text-sm text-slate-700 mb-3">{title}</h2>
      {children}
    </section>
  );
}
