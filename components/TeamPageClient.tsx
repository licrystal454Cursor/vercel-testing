'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { TeamMember, ChannelAssignment, AgentConfig } from '@/lib/types';

export function TeamPageClient({
  initialMembers,
  initialAssignments,
  availableChannels,
  initialAgents,
}: {
  initialMembers: TeamMember[];
  initialAssignments: ChannelAssignment[];
  availableChannels: { channelId: string; channelName: string }[];
  initialAgents: AgentConfig[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [assignments, setAssignments] = useState(initialAssignments);
  const agents = initialAgents;

  // Add member form
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  // Add channel assignment form
  const [selectedChannel, setSelectedChannel] = useState('');
  const [channelDisplayName, setChannelDisplayName] = useState('');
  const [selectedAssignee, setSelectedAssignee] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [stripeCustomerId, setStripeCustomerId] = useState('');
  const [addingAssignment, setAddingAssignment] = useState(false);

  const handleAddMember = async () => {
    if (!memberName.trim() || !memberEmail.trim()) return;
    setAddingMember(true);
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: memberName.trim(), email: memberEmail.trim() }),
      });
      if (!res.ok) throw new Error('Failed');
      const { member } = await res.json();
      setMembers(prev => [...prev, member]);
      setMemberName('');
      setMemberEmail('');
      toast.success('Team member added');
    } catch {
      toast.error('Failed to add team member');
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (id: string) => {
    try {
      const res = await fetch(`/api/team/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setMembers(prev => prev.filter(m => m.id !== id));
      setAssignments(prev => prev.filter(a => a.assigneeId !== id));
      toast.success('Team member removed');
    } catch {
      toast.error('Failed to remove team member');
    }
  };

  const handleAddAssignment = async () => {
    if (!selectedChannel || !selectedAssignee) return;
    setAddingAssignment(true);
    try {
      const res = await fetch('/api/channel-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: selectedChannel,
          channelName: channelDisplayName.trim() || selectedChannel,
          assigneeId: selectedAssignee,
          agentId: selectedAgentId || undefined,
          stripeCustomerId: stripeCustomerId.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      const { assignment } = await res.json();
      setAssignments(prev => {
        const filtered = prev.filter(a => a.channelId !== assignment.channelId);
        return [...filtered, assignment];
      });
      setSelectedChannel('');
      setChannelDisplayName('');
      setSelectedAssignee('');
      setSelectedAgentId('');
      setStripeCustomerId('');
      toast.success('Channel routing saved');
    } catch {
      toast.error('Failed to save channel routing');
    } finally {
      setAddingAssignment(false);
    }
  };

  const handleRemoveAssignment = async (id: string) => {
    try {
      const res = await fetch(`/api/channel-assignments/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setAssignments(prev => prev.filter(a => a.id !== id));
      toast.success('Channel routing removed');
    } catch {
      toast.error('Failed to remove channel routing');
    }
  };

  const getMemberName = (id: string) =>
    members.find(m => m.id === id)?.name ?? 'Unknown';

  const getAgentName = (id?: string) =>
    id ? (agents.find(a => a.id === id)?.name ?? 'Unknown') : 'Default';

  // Channels that don't already have an assignment
  const unassignedChannels = availableChannels.filter(
    c => !assignments.some(a => a.channelId === c.channelId)
  );

  return (
    <div className="space-y-8">
      {/* Team Members */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="font-semibold text-slate-800 mb-4">Team Members</h2>

        {members.length > 0 ? (
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left font-medium text-slate-500 pb-2">Name</th>
                <th className="text-left font-medium text-slate-500 pb-2">Email</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {members.map(m => (
                <tr key={m.id}>
                  <td className="py-2.5 font-medium text-slate-900">{m.name}</td>
                  <td className="py-2.5 text-slate-500">{m.email}</td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => handleRemoveMember(m.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400 italic mb-6">No team members yet.</p>
        )}

        {/* Add member form */}
        <div className="flex gap-2 items-end border-t border-slate-100 pt-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Name</label>
            <input
              type="text"
              value={memberName}
              onChange={e => setMemberName(e.target.value)}
              placeholder="Alice Smith"
              className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
            <input
              type="email"
              value={memberEmail}
              onChange={e => setMemberEmail(e.target.value)}
              placeholder="alice@company.com"
              className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <button
            onClick={handleAddMember}
            disabled={addingMember || !memberName.trim() || !memberEmail.trim()}
            className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            {addingMember ? 'Adding...' : 'Add'}
          </button>
        </div>
      </section>

      {/* Channel Routing */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="font-semibold text-slate-800 mb-1">Channel Routing</h2>
        <p className="text-sm text-slate-500 mb-4">
          Tickets from a channel will be automatically assigned to the specified team member.
        </p>

        {assignments.length > 0 ? (
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left font-medium text-slate-500 pb-2">Channel</th>
                <th className="text-left font-medium text-slate-500 pb-2">Assigned To</th>
                <th className="text-left font-medium text-slate-500 pb-2">Stripe Customer</th>
                <th className="text-left font-medium text-slate-500 pb-2">Agent</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {assignments.map(a => (
                <tr key={a.id}>
                  <td className="py-2.5">
                    <span className="font-medium text-slate-900">{a.channelName}</span>
                    <span className="text-slate-400 text-xs ml-2">{a.channelId}</span>
                  </td>
                  <td className="py-2.5 text-slate-700">{getMemberName(a.assigneeId)}</td>
                  <td className="py-2.5 text-slate-500 font-mono text-xs">{a.stripeCustomerId ?? '—'}</td>
                  <td className="py-2.5 text-slate-500 text-xs">{getAgentName(a.agentId)}</td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => handleRemoveAssignment(a.id)}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-slate-400 italic mb-6">No channel routing configured.</p>
        )}

        {members.length === 0 ? (
          <p className="text-sm text-slate-400 italic border-t border-slate-100 pt-4">
            Add team members before configuring channel routing.
          </p>
        ) : (
          <div className="flex gap-2 items-end border-t border-slate-100 pt-4">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Channel</label>
              <select
                value={selectedChannel}
                onChange={e => {
                  setSelectedChannel(e.target.value);
                  const ch = unassignedChannels.find(c => c.channelId === e.target.value);
                  setChannelDisplayName(ch?.channelName ?? '');
                }}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="">Select a channel...</option>
                {unassignedChannels.map(c => (
                  <option key={c.channelId} value={c.channelId}>
                    {c.channelName}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-36">
              <label className="block text-xs font-medium text-slate-500 mb-1">Display name</label>
              <input
                type="text"
                value={channelDisplayName}
                onChange={e => setChannelDisplayName(e.target.value)}
                placeholder="#general"
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">Assign to</label>
              <select
                value={selectedAssignee}
                onChange={e => setSelectedAssignee(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="">Select a member...</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className="block text-xs font-medium text-slate-500 mb-1">Stripe Customer ID</label>
              <input
                type="text"
                value={stripeCustomerId}
                onChange={e => setStripeCustomerId(e.target.value)}
                placeholder="cus_xxx"
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1">AI Agent</label>
              <select
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                <option value="">Default agent</option>
                {agents.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={handleAddAssignment}
              disabled={addingAssignment || !selectedChannel || !selectedAssignee}
              className="px-4 py-1.5 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              {addingAssignment ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
