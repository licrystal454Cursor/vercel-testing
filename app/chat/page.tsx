import Link from 'next/link';
import { ChatInterface } from '@/components/ChatInterface';

export default function ChatPage() {
  return (
    <main className="max-w-4xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">AI Assistant</h1>
        <Link
          href="/tickets"
          className="text-sm px-3 py-1 rounded-full border border-slate-300 hover:bg-slate-100"
        >
          Tickets
        </Link>
      </div>
      <ChatInterface />
    </main>
  );
}
