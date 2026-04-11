'use client';

import { useState, useRef, useEffect } from 'react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { Chat, useChat } from '@ai-sdk/react';
import { toast } from 'sonner';
import { sendReply, patchTicket } from '@/lib/api';
import type { SupportTicket, TeamMember } from '@/lib/types';
import type { ChatMessage } from '@/lib/chatStore';

function toUIMessage(msg: ChatMessage): UIMessage {
  return {
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    parts: [{ type: 'text' as const, text: msg.content }],
  };
}

const MIN_WIDTH = 260;
const MAX_WIDTH = 900;

export function TicketDetailClient({
  ticket,
  teamMembers,
  initialChatMessages,
}: {
  ticket: SupportTicket;
  teamMembers: TeamMember[];
  initialChatMessages: ChatMessage[];
}) {
  const [reply, setReply] = useState(ticket.aiDraftReply);
  const [sending, setSending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [assigneeId, setAssigneeId] = useState(ticket.assigneeId ?? '');
  const [chatInput, setChatInput] = useState('');
  const [feedback, setFeedback] = useState<Record<string, 'good' | 'bad'>>({});
  const [reasonPicker, setReasonPicker] = useState<string | null>(null); // messageId with open picker
  const [reasonComment, setReasonComment] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const BAD_REASONS = [
    'Wrong information',
    'Violated customer constraint',
    'Unhelpful / missed the point',
    'Wrong tone',
    'Other',
  ];

  const submitFeedback = async (
    messageId: string,
    rating: 'good' | 'bad',
    reason?: string,
    comment?: string,
  ) => {
    setFeedback(prev => ({ ...prev, [messageId]: rating }));
    try {
      await fetch(`/api/tickets/${ticket.id}/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, rating, reason, comment }),
      });
    } catch {
      toast.error('Failed to save feedback');
      setFeedback(prev => { const next = { ...prev }; delete next[messageId]; return next; });
    }
  };

  const handleFeedback = (messageId: string, rating: 'good' | 'bad') => {
    if (rating === 'good') {
      setReasonPicker(null);
      submitFeedback(messageId, 'good');
    } else {
      // Open reason picker before submitting
      setReasonPicker(messageId);
      setReasonComment('');
      // Optimistically mark as bad so buttons update immediately
      setFeedback(prev => ({ ...prev, [messageId]: 'bad' }));
    }
  };

  const handleReasonSubmit = async (messageId: string, reason: string) => {
    const comment = reason === 'Other' ? reasonComment.trim() : undefined;
    setReasonPicker(null);
    await submitFeedback(messageId, 'bad', reason, comment);
    toast.success('Feedback saved');
  };

  // Split-pane state — 480 on SSR, updated to 38% of viewport after hydration
  const [panelWidth, setPanelWidth] = useState(480);
  useEffect(() => {
    setPanelWidth(Math.round(window.innerWidth * 0.38));
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      setPanelWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => { isDragging.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const handleDragStart = (e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = panelWidth;
    e.preventDefault();
  };

  const handleAssign = async (newAssigneeId: string) => {
    setAssigneeId(newAssigneeId);
    try {
      await patchTicket(ticket.id, { assigneeId: newAssigneeId || undefined });
      toast.success(newAssigneeId ? 'Ticket assigned' : 'Assignment removed');
    } catch {
      toast.error('Failed to update assignee');
      setAssigneeId(ticket.assigneeId ?? '');
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await patchTicket(ticket.id, { archived: !ticket.archived });
      toast.success(ticket.archived ? 'Ticket unarchived' : 'Ticket archived');
      window.location.href = '/tickets';
    } catch {
      toast.error('Failed to archive ticket');
      setArchiving(false);
    }
  };

  const handleSend = async () => {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await sendReply(ticket.id, reply);
      toast.success('Reply sent to Slack thread');
      window.location.reload();
    } catch {
      toast.error('Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const chatRef = useRef<Chat<UIMessage> | null>(null);
  if (!chatRef.current) {
    chatRef.current = new Chat({
      id: ticket.id,
      messages: initialChatMessages.map(toUIMessage),
      transport: new DefaultChatTransport({
        api: `/api/tickets/${ticket.id}/chat`,
      }),
    });
  }

  const { messages, sendMessage, status } = useChat({ chat: chatRef.current });
  const isStreaming = status === 'streaming' || status === 'submitted';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || isStreaming) return;
    setChatInput('');
    await sendMessage({ text });
  };

  const isResolved = ticket.status === 'resolved';
  const isWaiting = ticket.status === 'waiting_on_customer';

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-120px)]">
      {/* Header row */}
      <div className="flex items-start justify-between shrink-0">
        <div>
          <h1 className="text-xl font-bold">Ticket #{ticket.id.slice(0, 8)}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {new Date(ticket.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {teamMembers.length > 0 && (
            <select
              value={assigneeId}
              onChange={e => handleAssign(e.target.value)}
              className="border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            >
              <option value="">Unassigned</option>
              {teamMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              isResolved
                ? 'bg-green-100 text-green-800'
                : isWaiting
                ? 'bg-blue-100 text-blue-800'
                : 'bg-yellow-100 text-yellow-800'
            }`}
          >
            {isWaiting ? 'waiting on customer' : ticket.status}
          </span>
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="px-2.5 py-1 rounded-full text-xs font-medium border border-slate-300 hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            {archiving ? '...' : ticket.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
      </div>

      {/* Split pane */}
      <div className="flex flex-1 min-h-0 gap-0">

        {/* Left: Analysis panel */}
        {!collapsed && (
          <div
            className="flex-none overflow-y-auto space-y-4 pr-3"
            style={{ width: panelWidth }}
          >
            <Section title="Original Slack Message">
              <p className="text-sm bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap">
                {ticket.input.messageText}
              </p>
            </Section>

            <Section title="Extracted Question">
              <p className="text-sm font-medium">{ticket.extractedQuestion}</p>
            </Section>

            <Section title="AI Analysis">
              <div className="text-sm bg-blue-50 border border-blue-100 rounded p-4 whitespace-pre-wrap leading-relaxed">
                {ticket.aiAnalysis || (
                  <span className="text-slate-400 italic">
                    AI analysis pending — refresh in ~20 seconds.
                  </span>
                )}
              </div>
            </Section>

            <Section title="Error Replication (Staging API)">
              <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                {ticket.replicationResult}
              </pre>
            </Section>

            <Section title="Public Documentation">
              <DocsContent raw={ticket.publicDocsContent} />
            </Section>

            <Section title="Internal Documentation (Notion)">
              <DocsContent
                raw={ticket.notionContent}
                emptyMessage="No internal Notion documentation found."
              />
            </Section>

            <Section title="Reply to Customer">
              {isResolved ? (
                <div className="space-y-3">
                  {ticket.sentReply && (
                    <div className="space-y-1">
                      <p className="text-xs text-green-700 font-medium">Reply sent:</p>
                      <p className="text-sm bg-green-50 border border-green-200 rounded p-3 whitespace-pre-wrap">
                        {ticket.sentReply}
                      </p>
                    </div>
                  )}
                  {ticket.lastCustomerMessage && (
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500 font-medium">Customer resolved:</p>
                      <p className="text-sm bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap">
                        {ticket.lastCustomerMessage}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {ticket.sentReply && (
                    <div className="space-y-1">
                      <p className="text-xs text-blue-700 font-medium">
                        {isWaiting
                          ? 'Last reply sent — awaiting customer response:'
                          : 'Last reply sent:'}
                      </p>
                      <p className="text-sm bg-blue-50 border border-blue-200 rounded p-3 whitespace-pre-wrap">
                        {ticket.sentReply}
                      </p>
                    </div>
                  )}
                  {ticket.lastCustomerMessage && (
                    <div className="space-y-1">
                      <p className="text-xs text-amber-700 font-medium">Customer replied:</p>
                      <p className="text-sm bg-amber-50 border border-amber-200 rounded p-3 whitespace-pre-wrap">
                        {ticket.lastCustomerMessage}
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-slate-500">
                    {isWaiting
                      ? 'Send a follow-up if needed.'
                      : 'AI draft pre-filled. Edit freely or write your own reply.'}
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
        )}

        {/* Drag handle + collapse toggle */}
        <div
          className="relative flex-none flex items-stretch"
          style={{ width: 12 }}
        >
          {/* Draggable resize strip */}
          {!collapsed && (
            <div
              onMouseDown={handleDragStart}
              className="flex-1 cursor-col-resize bg-slate-200 hover:bg-blue-400 transition-colors"
              style={{ width: 4, marginLeft: 4 }}
            />
          )}
          {/* Collapse toggle button — centered vertically */}
          <button
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expand analysis' : 'Collapse analysis'}
            className="absolute top-1/2 -translate-y-1/2 -right-3 z-10 flex items-center justify-center w-6 h-10 rounded bg-slate-200 hover:bg-slate-300 border border-slate-300 text-slate-500 text-xs transition-colors"
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Right: Chat */}
        <div className="flex-1 flex flex-col min-w-0 bg-white border border-slate-200 rounded-lg ml-4">
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.map(msg => {
              const textPart = msg.parts.find(p => p.type === 'text');
              const text = textPart && 'text' in textPart ? textPart.text : '';
              if (!text && msg.role === 'assistant') return null;
              const isAssistant = msg.role === 'assistant';
              const msgFeedback = feedback[msg.id];
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                      isAssistant ? 'bg-slate-100 text-slate-900' : 'bg-blue-600 text-white'
                    }`}
                  >
                    {text}
                  </div>
                  {isAssistant && (
                    <div className="mt-1 ml-1">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleFeedback(msg.id, 'good')}
                          title="Good response"
                          className={`text-base leading-none transition-opacity ${
                            msgFeedback === 'good'
                              ? 'opacity-100'
                              : msgFeedback === 'bad'
                              ? 'opacity-20'
                              : 'opacity-40 hover:opacity-100'
                          }`}
                        >
                          👍
                        </button>
                        <button
                          onClick={() => handleFeedback(msg.id, 'bad')}
                          title="Bad response"
                          className={`text-base leading-none transition-opacity ${
                            msgFeedback === 'bad'
                              ? 'opacity-100'
                              : msgFeedback === 'good'
                              ? 'opacity-20'
                              : 'opacity-40 hover:opacity-100'
                          }`}
                        >
                          👎
                        </button>
                      </div>

                      {reasonPicker === msg.id && (
                        <div className="mt-2 bg-white border border-slate-200 rounded-lg p-3 shadow-sm w-64">
                          <p className="text-xs font-medium text-slate-600 mb-2">Why was this unhelpful?</p>
                          <div className="space-y-1">
                            {BAD_REASONS.map(reason => (
                              <div key={reason}>
                                <button
                                  onClick={() => reason !== 'Other' && handleReasonSubmit(msg.id, reason)}
                                  className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-slate-100 text-slate-700 transition-colors"
                                >
                                  {reason}
                                </button>
                                {reason === 'Other' && (
                                  <div className="mt-1 space-y-1">
                                    <textarea
                                      value={reasonComment}
                                      onChange={e => setReasonComment(e.target.value)}
                                      placeholder="Describe the issue..."
                                      className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                                      rows={2}
                                    />
                                    <button
                                      onClick={() => handleReasonSubmit(msg.id, 'Other')}
                                      disabled={!reasonComment.trim()}
                                      className="text-xs px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-40 hover:bg-blue-700 transition-colors"
                                    >
                                      Submit
                                    </button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          <button
                            onClick={() => { setReasonPicker(null); setFeedback(prev => { const n = { ...prev }; delete n[msg.id]; return n; }); }}
                            className="mt-2 text-xs text-slate-400 hover:text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-lg px-4 py-3 text-sm text-slate-500">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            onSubmit={handleSendChat}
            className="border-t border-slate-200 p-3 flex gap-2 shrink-0"
          >
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Ask a follow-up question..."
              disabled={isStreaming}
              className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-slate-50"
            />
            <button
              type="submit"
              disabled={!chatInput.trim() || isStreaming}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 transition-colors"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
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

function DocsContent({
  raw,
  emptyMessage = 'No documentation fetched.',
}: {
  raw: string;
  emptyMessage?: string;
}) {
  if (!raw) {
    return <p className="text-sm text-slate-400 italic">{emptyMessage}</p>;
  }

  let summary = '';
  let sources: { title: string; url: string }[] = [];

  try {
    const parsed = JSON.parse(raw);
    summary = parsed.summary ?? '';
    sources = parsed.sources ?? [];
  } catch {
    return (
      <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 overflow-auto max-h-64 whitespace-pre-wrap">
        {raw}
      </pre>
    );
  }

  if (!summary && sources.length === 0) {
    return <p className="text-sm text-slate-400 italic">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {summary && (
        <p className="text-sm text-slate-700 leading-relaxed">{summary}</p>
      )}
      {sources.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Sources</p>
          <ul className="space-y-1">
            {sources.map((s, i) => (
              <li key={i}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
