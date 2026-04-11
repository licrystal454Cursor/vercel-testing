import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  const { messageId, rating, reason, comment } = await req.json() as {
    messageId: string;
    rating: 'good' | 'bad';
    reason?: string;
    comment?: string;
  };

  if (!messageId || !['good', 'bad'].includes(rating)) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { error } = await supabase
    .from('chat_feedback')
    .upsert(
      { ticket_id: ticketId, message_id: messageId, rating, reason: reason ?? null, comment: comment ?? null },
      { onConflict: 'ticket_id,message_id' }
    );

  if (error) return Response.json({ error: error.message }, { status: 500 });

  console.log('[feedback]', rating, reason ? `| reason: ${reason}` : '', '| ticket:', ticketId, '| message:', messageId);
  return Response.json({ ok: true });
}
