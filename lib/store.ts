import type { SupportTicket } from './types';

// In-memory store — persists across requests within the same process
const tickets = new Map<string, SupportTicket>();

export const ticketStore = {
  list(): SupportTicket[] {
    return Array.from(tickets.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  },
  get(id: string): SupportTicket | undefined {
    return tickets.get(id);
  },
  create(ticket: SupportTicket): SupportTicket {
    tickets.set(ticket.id, ticket);
    return ticket;
  },
};
