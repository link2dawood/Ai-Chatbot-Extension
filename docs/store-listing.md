# Chrome Web Store listing: Smart Chat Assistant

Copy each block into the matching field in the Web Store dashboard (Store listing tab). Character counts are checked.

## Name (39 characters, limit 75)
```
Smart Chat Assistant: AI Writing & Chat
```
This is the `name` in `manifest.json`. The store shows it in search results, so it carries the main keywords ("AI", "Writing", "Chat") without stuffing.

## Summary (121 characters, limit 132)
```
AI writing assistant in your side panel. Chat, rewrite, fix grammar, summarize and explain text without leaving the page.
```
This is the `description` in `manifest.json`. It is the line shown under the name in search results.

## Detailed description (2240 characters, limit 16,000)
```
Smart Chat Assistant is an AI writing and chat assistant that lives in Chrome's side panel. Ask a question, or paste text and get it rewritten, proofread, summarized or explained, while the page you are working on stays open next to it. No tab switching, no copy and paste between windows.

FIVE MODES FOR EVERYDAY WRITING
- Chat: ask questions, brainstorm ideas, draft replies and make quick plans.
- Rewrite: make your text clearer, more professional or friendlier, or shorter, while keeping your meaning, names, numbers and dates.
- Grammar: fix spelling, grammar and punctuation with a light touch that keeps your own voice.
- Summarize: turn long text, articles or email threads into short bullets or a paragraph.
- Explain: get confusing text or ideas explained in plain language, with examples.

Each mode has ready-made starter prompts, so you can get a result in one click.

BUILT FOR YOUR WORKFLOW
- Insert into page: put the reply straight into the text field you are typing in, such as an email, a document or a form.
- Copy any reply with one click.
- Your recent conversation is saved on your device, so it is there when you come back.
- Export a conversation as a text file.
- Light and dark themes.

SIMPLE AND PRIVATE
- No account to create and no API key to find. Open the side panel and start.
- Your chat history and settings are stored locally in your browser. Clear them any time with Clear chat.
- The extension does not read the pages you visit or your browsing history. It only writes to a page when you click Insert.
- Your message is sent through our server to an AI provider to produce the answer. Read the privacy policy for details: https://dawoodzafar.us/smart-chat/privacy

PRICING
Try it free with 10 chats. Premium Access is $2 per month and unlocks the hosted AI models. Cancel any time.

WHO IT IS FOR
Students, professionals, writers, job seekers, support teams and anyone who writes emails, messages and documents and wants a faster, cleaner draft.

HOW TO START
1. Click the Smart Chat Assistant icon in the toolbar to open the side panel.
2. Pick a mode: Chat, Rewrite, Grammar, Summarize or Explain.
3. Type or paste your text and press Enter.

Questions or feedback? Contact dawood.dixeam@gmail.com
```

## Other fields
- **Category:** Productivity
- **Language:** English
- **Support email / website:** dawood.dixeam@gmail.com, https://dawoodzafar.us/smart-chat
- **Privacy policy:** https://dawoodzafar.us/smart-chat/privacy

## Screenshots (1280x800 or 640x400, at least 1, up to 5)
Add a short caption in the image itself:
1. Rewrite mode: before and after text. Caption: "Rewrite any text in one click"
2. Grammar mode with a corrected sentence. Caption: "Fix grammar and keep your voice"
3. Summarize mode with bullets. Caption: "Summarize long text in seconds"
4. Insert button used in an email draft. Caption: "Insert the reply straight into the page"
5. Dark theme with Chat mode. Caption: "Light and dark themes"

Small promo tile (440x280): the logo with "AI writing and chat in your side panel".

## Keep the listing accepted
- Describe only what the extension does today. Do not add features, ratings or user counts.
- Do not repeat keywords or list them in a block. Google rejects keyword stuffing.
- Do not use other companies' names or logos (for example AI provider names) in the name, icon or screenshots.
- If you change the pricing or the free allowance, update the PRICING section and the Privacy tab answers to match.
- If paid-only access is on and free users get no chats, change "Try it free with 10 chats" to match what reviewers and users will actually see.

## Search-friendly wording for the website
Use these on the dawoodzafar.us pages. Keep to one idea per page.
- **Page title (under 60 characters):** `Smart Chat Assistant: AI Writing & Chat Side Panel`
- **Meta description (under 155 characters):** `Smart Chat Assistant is a Chrome side-panel AI that rewrites, proofreads, summarizes and explains text without leaving the page. Try it free.`
- **Headline (h1):** `AI writing and chat, right in your Chrome side panel`
- Natural phrases to use in headings and text: AI writing assistant, Chrome side panel, rewrite text, grammar checker, summarize text, explain text.

## Image files
- **Upload the PNGs in `store-assets/out/png/`.** They are 24-bit with no alpha, at the exact sizes the store asks for, and are rendered from the SVG masters. (The JPEGs in `store-assets/out/` are also accepted.)
- `store-assets/out/svg/` holds the same seven images as editable vector SVGs (no embedded bitmaps, text converted to outlines). The store does not accept SVG uploads.
- To change something, edit the SVG in Figma, Inkscape or Illustrator and save it back to the same path, then run `node store-assets/make-assets.mjs --png-only` to re-render the PNGs from your edited SVGs.
- `node store-assets/make-assets.mjs` rebuilds everything from scratch. PNG output needs ImageMagick (`convert`); the SVG step needs `pdftocairo` (poppler-utils).

## Version 2.6: changes to make in the store form
Version 2.6 lets users add their own API key. It adds three **optional** host permissions (`api.openai.com`, `api.deepseek.com`, `api.anthropic.com`), which Chrome asks the user for only when they add a key for that provider. Upload it as an update after the current version is approved, and update these:

**Optional host permissions justification**
```
Optional, and only requested when a user chooses to add their own API key in Settings, and only for the one provider they pick (api.openai.com, api.deepseek.com or api.anthropic.com). It lets the extension send that user's message directly to their chosen provider using their key. It is never requested otherwise, and removing the key removes the permission.
```
**storage justification** (replace the old one)
```
Saves data locally on the user's device in chrome.storage.local: settings (theme, mode, provider), the last 50 chat messages, a free-chat counter, the license key for paying users and, if the user adds one, their own API key. Nothing is synced. The license key is sent to our server to verify a subscription. A user's own API key is sent only to the provider they chose, never to our server.
```
**Data usage:** unchanged (Personal communications and Authentication information are already ticked). **Privacy policy:** the page must say the own key stays in the browser and goes only to the chosen provider (the site prompt now includes this).

Also add one line to the listing text under "SIMPLE AND PRIVATE": `- Prefer your own account? Add your own OpenAI, DeepSeek or Anthropic key in Settings. It stays in your browser and goes only to that provider.`

## Attachments and the server-side free allowance: store and privacy notes
These ship in the same 2.6.0 package and need **no new permissions** (the file picker works without any).
- **Privacy page:** add that Premium users may attach files; the files are sent through our server to the AI provider to answer, are not stored by us, and only the file names are kept in the local chat history. Also add that free chats are counted on our server against a random id made in the browser, plus a hashed IP address for abuse limits (kept for about two days).
- **Data usage:** unchanged. "Personal communications" already covers messages and attached files.
- **Listing text:** add under the features list: `- Premium: attach images, PDFs and text files to your chat.`
- **Storage justification:** add "a random anonymous id used to count free chats".

