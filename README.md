# Support Dashboard

Internal support operations app built with Next.js 16, React 19, and the Vercel AI SDK. It ingests Slack support threads, creates tickets, runs AI-powered research across Stripe docs, internal Notion guidance, and optional Stripe account context, then helps a human teammate review, respond, and resolve the issue.

## What It Does

- Creates support tickets from Slack events and thread activity.
- Runs an enrichment pipeline that produces:
  - a normalized question
  - public docs findings
  - internal Notion guidance
  - Stripe/account investigation notes
  - an AI analysis and draft reply
- Provides a ticket workspace with:
  - assignment
  - archive/unarchive
  - manual resolve
  - an interactive AI chat for follow-up investigation
  - reply-to-Slack actions
- Posts an internal debrief to Notion `Agent Notes` pages when a ticket is resolved.
- Includes a `/simulate` screen for testing the full workflow without waiting for a live Slack message.

## Main Product Areas

- `app/tickets`: ticket list and ticket detail workflow
- `app/team`: team members and channel assignment management
- `app/agents`: per-channel AI instruction / skill management
- `app/simulate`: manual ticket creation for local testing
- `app/api/slack/events/route.ts`: Slack ingestion and resolution detection
- `app/api/tickets/[id]/chat/route.ts`: interactive ticket chat agent
- `lib/runEnrichmentAgent.ts`: top-level enrichment orchestration

## Architecture Summary

This app uses the App Router and stores operational data in Supabase-backed stores under `lib/`. A new support request enters through Slack, gets saved as a `SupportTicket`, then is enriched by AI before being shown in the dashboard.

The enrichment flow is split into focused modules under `lib/enrichment/`. Those modules coordinate specialized research steps, gather structured findings, and synthesize the final diagnosis and reply draft.

The interactive ticket assistant is separate from the asynchronous enrichment flow. It loads the saved ticket context, tool access, and prior internal chat history, then streams follow-up answers in the ticket detail UI.

## Key Integrations

- Slack: inbound events, thread replies, and outbound support replies
- Supabase: persistence for tickets, chat history, team members, agents, and docs cache
- Vercel AI SDK: `generateText`, agent/tool orchestration, and streaming chat
- AI Gateway: model access configured in `lib/provider.ts`
- Stripe Agent Toolkit: Stripe/account investigation tools
- Notion API: internal guidance lookup and resolved-ticket debrief appends

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
AI_GATEWAY_KEY=
SLACK_SIGNING_SECRET=
SLACK_BOT_TOKEN=
NOTION_API_KEY=
```

3. Start the app:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000).

## Available Scripts

- `npm run dev`: start the Next.js dev server
- `npm run build`: create a production build
- `npm run start`: run the production server
- `npm run lint`: run ESLint
- `npm run eval`: run evaluation cases
- `npm run eval:case`: run a single evaluation case

## Typical Workflow

1. A Slack message or mention creates or updates a ticket.
2. The enrichment agent gathers public docs, internal docs, and account context.
3. A teammate reviews the ticket in the dashboard.
4. The teammate can ask the interactive chat agent follow-up questions.
5. The teammate replies in Slack, archives the ticket, or marks it resolved.
6. On resolution, the app appends a concise debrief to Notion.
