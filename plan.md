Done Figure out which database I should be using for my app. I want you to list out the Pros and cons for each one. Specifically I want you to analyze supabase. 
2. Connect to Notion
Done Connect to Slack 
4. Connect to Linear
5. figure out why the ai public doc parser isnt working correctly

User Stories: 
Customer writes in slack: "Hi, I can't seem to expand this specific feature in the sdk". This creates a ticket in the Nextjs website, and it also creates an issue in Linear. 
This then triggers the AI to run on Notion, it then drafts a response that a support agent can take. It should search public documentation, 
internal documentation, and try to replicate the problem. 
If the support agent doesn't like the response, it can talk with the agent to iterate on the response. Once the support agent is satisfied 
with the response they can then either send the message directly to slack or copy the message to send themselves. 

All questions from slack should create a ticket except if it isn't a question or it's a question from somebody within our organization

 - searchWeb(query) — lets the agent find docs URLs it doesn't know rather than guessing. Right now
   it can only fetch pages it already knows exist from training.                                    
  - searchNotionDocs(query) — search your internal KB for known workarounds, past resolutions,
  customer-specific context. This requires a Notion API token in your env.                          
  - replicateStripeError(params) — actually call the Stripe test API to reproduce the reported error
   and return the real error object. You already have a replicationResult field in the ticket schema
   for this.  

Need to also check and make sure that the agent is able to receieve photos and files as well. 

Tools: 
1. Search Stripe Documentation 
2. Search Notion Documentation
3. Stripe agent sdk - it can test it out 
4. mock internal request database to get the request ID and the error message that the user got

Instead of it being a customer implementing stripe. It should instead be a customer of a merchant who uses stripe. Maybe it's a website where people can buy knock off vercel merchandise. not 100% what the business model is yet

Support agent does the upsell - they have to write in to delete a payment method or cancel a payment method


Okay, let's talk through some different scenarios that I would want to potentially show during a demo.
1. Customer comes in and is running into a troubleshooting error.
The message comes from Slack, goes into my Vercel app. The ticket system generates a summary of the problem and some troubleshooting tips. From there, the support agent is able to send a Slack thread directly via the ticketing platform.

Okay, the way that this currently works, you have one agent that runs for every single support agent or question that comes in. Is there a way for us to instead customize it so that a support agent can come in, add an agent or create an agent, add in skills, and then customize and say, "Hey, every time a customer has a question in this channel, I want you to respond in this certain way"?

make sure to have the support agent respond with an emoji instead of a full response
add in a settings page

figure out why it takes a second to load - streaming api https://vercel.com/docs/ai-gateway/sdks-and-apis/ai-sdk#streaming


I need to show off the things that Vercel does a really good job of, and there are certain things within the AI SDK that I want to show off, specifically MCP tools and other certain features that they've built into the chat interface. We're going to start off by getting rid of this weird Notion tool called calling. Instead, we're going to build out a database that allows the tool to find the Stripe customer ID. We're then going to build out certain tooling, or we're going to connect the Stripe MCP, so that this chat window can now search within their Stripe account and see how much revenue they're currently generating.



These are some of the things that you typically want to check when I'm going about investigating an issue.
1. Is there an incident currently happening?
Is this in a test environment or is this in a production environment?
How many of their customers are being impacted by this?
Who was their account executive?
What gates are on their account?
Historical data, such as: what are they currently building out? What integration shape do they have?
Essentially, all of these together combined help me make an analysis of how urgent is this request. If I have like 10 or 15 requests, I don't want to be prioritizing the user with the lowest ONR.

Still need to build out the Notion functionality, but we'll put a pin in that until I update the UI.

The AI SDK's business value is mainly that it abstracts away provider lock-in and handles the  
  hard parts of production AI.                                                                   
                                                                                                 
  Provider independence                                                                          
  You write code against one interface and can swap between OpenAI, Anthropic, Google, etc. by   
  changing a model string. If a provider raises prices or goes down, you switch without rewriting
   your app.                                                                                     
                                                                                                 
  Streaming out of the box                                                                       
  Streaming responses feel faster to users even if total latency is the same. The SDK handles the
   stream plumbing so you don't have to.                                                         
                                                                                                 
  Structured output
  Getting reliable JSON from a model is harder than it looks. The SDK handles retries, schema    
  validation (via Zod), and repair — which matters a lot in production where malformed output
  breaks downstream code.                                                                        
                                                            
  Agentic patterns built in                                                                      
  ToolLoopAgent, prepareCall, stopWhen, tool definitions — these are patterns every team
  eventually has to build themselves. The SDK gives you a tested, maintained implementation      
  instead.                                                  

  Reduces time to production                                                                     
  The biggest cost in AI features isn't the API call — it's all the glue code around it. Error
  handling, retries, token counting, streaming, tool result parsing. The SDK eliminates most of  
  that.                                                                                          
   
  ---                                                                                            
  For your codebase specifically, the business value is that enrichTicket.ts is maybe 250 lines
  instead of what would otherwise be 800+ lines of raw fetch calls, stream parsing, retry logic, 
  and tool dispatch — and it's easier for the next person to read and extend.

  I think that I want to mock getting revenue data. Or I will actually store it in the database and have it just retrieve it from my database

  Because they're a stripe customer, we'll use a stripe customer ID instead. 
  I need to setup the database so that the slack channel maps to the stripe customer ID. 