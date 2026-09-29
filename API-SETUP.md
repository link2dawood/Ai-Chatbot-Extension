# API setup

## Runtime connection
The extension calls:

`https://ai-chatbot-extension.vercel.app/api/chat`

The Vercel serverless function then calls the OpenAI Responses API. The Chrome extension never receives the OpenAI secret.

## Required Vercel environment variables
Set these in the Vercel project settings:

- `OPENAI_API_KEY` — required
- `OPENAI_MODEL` — optional, defaults to `gpt-5-mini`

The v0/Vercel access token is a deployment/tooling credential. It is **not** a runtime chat API key and should not be embedded in the extension.

## Connection check
Open the extension → Settings → **Check connection**. A successful check now requires both:

1. the Vercel function to be reachable, and
2. the Vercel function to authenticate successfully to OpenAI.

It will display `Connected: Vercel + OpenAI` only when both checks pass.

## Free quota
The extension includes 10 successful free chats per Chrome profile. Failed requests do not consume a chat. This quota is local by design because the project has no database or account system.
