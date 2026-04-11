'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { AgentConfig, ChannelAssignment } from '@/lib/types';

function FileIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6L9 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M9 1v5h5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M5 9h6M5 11.5h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

export function AgentsPageClient({
  initialAgents,
  initialAssignments,
}: {
  initialAgents: AgentConfig[];
  initialAssignments: ChannelAssignment[];
}) {
  const [agents, setAgents] = useState(initialAgents);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Create form
  const [newName, setNewName] = useState('');
  const [newContent, setNewContent] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit mode for selected agent
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // Apply-to-channel for selected agent
  const [applyAssignmentId, setApplyAssignmentId] = useState('');
  const [applying, setApplying] = useState(false);

  const selectedAgent = agents.find(a => a.id === selectedId) ?? null;

  // Assignments that currently use the selected agent
  const appliedAssignments = assignments.filter(a => a.agentId === selectedId);

  // Assignments that DON'T use the selected agent (can apply to)
  const unappliedAssignments = assignments.filter(a => a.agentId !== selectedId);

  const handleCreate = async () => {
    if (!newName.trim() || !newContent.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          instructions: newContent.trim(),
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const { agent } = await res.json();
      setAgents(prev => [...prev, agent]);
      setNewName('');
      setNewContent('');
      setCreating(false);
      setSelectedId(agent.id);
      toast.success('Agent created');
    } catch {
      toast.error('Failed to create agent');
    } finally {
      setAdding(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedId || !editContent.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/agents/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: editContent.trim() }),
      });
      if (!res.ok) throw new Error('Failed');
      setAgents(prev => prev.map(a => a.id === selectedId ? { ...a, instructions: editContent.trim() } : a));
      setEditing(false);
      toast.success('Agent updated');
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setAgents(prev => prev.filter(a => a.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast.success('Agent removed');
    } catch {
      toast.error('Failed to remove agent');
    }
  };

  const handleApply = async () => {
    if (!applyAssignmentId || !selectedId) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/channel-assignments/${applyAssignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: selectedId }),
      });
      if (!res.ok) throw new Error('Failed');
      setAssignments(prev =>
        prev.map(a => a.id === applyAssignmentId ? { ...a, agentId: selectedId } : a)
      );
      setApplyAssignmentId('');
      toast.success('Agent applied to channel');
    } catch {
      toast.error('Failed to apply agent');
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveFromChannel = async (assignmentId: string) => {
    try {
      const res = await fetch(`/api/channel-assignments/${assignmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: null }),
      });
      if (!res.ok) throw new Error('Failed');
      setAssignments(prev =>
        prev.map(a => a.id === assignmentId ? { ...a, agentId: undefined } : a)
      );
      toast.success('Agent removed from channel');
    } catch {
      toast.error('Failed to remove agent from channel');
    }
  };

  const selectAgent = (id: string) => {
    setSelectedId(id);
    setCreating(false);
    setEditing(false);
    setApplyAssignmentId('');
  };

  const openCreate = () => {
    setCreating(true);
    setSelectedId(null);
    setEditing(false);
  };

  return (
    <div className="flex gap-4 items-start">
      {/* File browser */}
      <div className="w-56 shrink-0">
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Files</span>
            <button
              onClick={openCreate}
              className="text-xs text-slate-500 hover:text-slate-900 font-medium"
              title="New agent"
            >
              + New
            </button>
          </div>

          {agents.length === 0 && !creating ? (
            <p className="text-xs text-slate-400 italic px-3 py-4">No agents yet.</p>
          ) : (
            <ul className="py-1">
              {agents.map(a => (
                <li key={a.id}>
                  <button
                    onClick={() => selectAgent(a.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      selectedId === a.id
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <FileIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="truncate">{a.name}.md</span>
                  </button>
                </li>
              ))}
              {creating && (
                <li>
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50">
                    <FileIcon className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                    <span className="text-sm text-blue-600 italic truncate">
                      {newName ? `${newName}.md` : 'new-agent.md'}
                    </span>
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {/* Detail / create panel */}
      <div className="flex-1 min-w-0">
        {!selectedAgent && !creating && (
          <div className="bg-white border border-slate-200 rounded-lg p-10 flex flex-col items-center justify-center text-center">
            <FileIcon className="w-8 h-8 text-slate-300 mb-3" />
            <p className="text-sm text-slate-400">Select an agent or create a new one</p>
            <button
              onClick={openCreate}
              className="mt-4 px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-700 transition-colors"
            >
              + New agent
            </button>
          </div>
        )}

        {/* Create form */}
        {creating && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <FileIcon className="w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="agent-name"
                className="flex-1 bg-transparent text-sm text-slate-900 focus:outline-none placeholder:text-slate-400"
                autoFocus
              />
              <span className="text-sm text-slate-400">.md</span>
            </div>
            <textarea
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder={`# Agent Name\n\nDescribe what this agent should do, how it should respond, what to focus on...\n\n## Behavior\n- Focus on...\n- When you see X, do Y\n\n## Tone\n- Professional and empathetic`}
              rows={18}
              className="w-full px-4 py-3 text-sm font-mono text-slate-800 focus:outline-none resize-none leading-relaxed"
            />
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-100">
              <button
                onClick={() => { setCreating(false); setNewName(''); setNewContent(''); }}
                className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={adding || !newName.trim() || !newContent.trim()}
                className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
              >
                {adding ? 'Creating...' : 'Create agent'}
              </button>
            </div>
          </div>
        )}

        {/* Agent detail */}
        {selectedAgent && !creating && (
          <div className="space-y-4">
            {/* File viewer/editor */}
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <FileIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-sm font-medium text-slate-700">{selectedAgent.name}.md</span>
                </div>
                <div className="flex items-center gap-3">
                  {editing ? (
                    <>
                      <button
                        onClick={() => setEditing(false)}
                        className="text-xs text-slate-500 hover:text-slate-900"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEdit}
                        disabled={saving}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
                      >
                        {saving ? 'Saving...' : 'Save changes'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditing(true); setEditContent(selectedAgent.instructions); }}
                        className="text-xs text-slate-500 hover:text-slate-900"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleRemove(selectedAgent.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editing ? (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  rows={18}
                  autoFocus
                  className="w-full px-4 py-3 text-sm font-mono text-slate-800 focus:outline-none resize-none leading-relaxed"
                />
              ) : (
                <pre className="px-4 py-3 text-sm font-mono text-slate-800 whitespace-pre-wrap leading-relaxed min-h-32">
                  {selectedAgent.instructions}
                </pre>
              )}
            </div>

            {/* Channel assignment */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-800 mb-3">Applied to channels</h3>

              {appliedAssignments.length === 0 ? (
                <p className="text-sm text-slate-400 italic mb-4">Not applied to any channels yet.</p>
              ) : (
                <ul className="space-y-1.5 mb-4">
                  {appliedAssignments.map(a => (
                    <li key={a.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-700">{a.channelName}</span>
                      <button
                        onClick={() => handleRemoveFromChannel(a.id)}
                        className="text-xs text-slate-400 hover:text-red-500"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {assignments.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Set up channel routing on the{' '}
                  <a href="/team" className="underline hover:text-slate-700">Team page</a>{' '}
                  first.
                </p>
              ) : unappliedAssignments.length > 0 ? (
                <div className="flex gap-2 items-center border-t border-slate-100 pt-4">
                  <select
                    value={applyAssignmentId}
                    onChange={e => setApplyAssignmentId(e.target.value)}
                    className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  >
                    <option value="">Apply to channel...</option>
                    {unappliedAssignments.map(a => (
                      <option key={a.id} value={a.id}>{a.channelName}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleApply}
                    disabled={applying || !applyAssignmentId}
                    className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {applying ? 'Applying...' : 'Apply'}
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-400 border-t border-slate-100 pt-3">
                  Applied to all configured channels.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
