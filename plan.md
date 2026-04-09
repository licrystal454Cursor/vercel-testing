1. Figure out which database I should be using for my app. I want you to list out the Pros and cons for each one. Specifically I want you to analyze supabase. 
2. Connect to Notion
3. Connect to Slack 
4. Connect to Linear

User Stories: 
Customer writes in slack: "Hi, I can't seem to expand this specific feature in the sdk". This creates a ticket in the Nextjs website, and it also creates an issue in Linear. 
This then triggers the AI to run on Notion, it then drafts a response that a support agent can take. It should search public documentation, 
internal documentation, and try to replicate the problem. 
If the support agent doesn't like the response, it can talk with the agent to iterate on the response. Once the support agent is satisfied 
with the response they can then either send the message directly to slack or copy the message to send themselves. 

All questions from slack should create a ticket except if it isn't a question or it's a question from somebody within our organization. 
