# Prompt for the dawoodzafar.us repo

Paste everything below the line into Claude Code, opened in the dawoodzafar.us repository. Before you do, fill in the two `<<...>>` values (Free plan and Chrome Web Store link) in the "Facts" section.

---

You are working in the repository for https://dawoodzafar.us/. Add a product section for my Chrome extension **Smart Chat Assistant**, with a pricing page and checkout through **Polar** (https://polar.sh). Work on a new branch called `feature/smart-chat-pricing`. Do not push to the main branch and do not open a pull request.

## Step 0: learn the repo first
Before writing anything, inspect the repo: framework and version, language (TypeScript or JavaScript), router, styling system, component library, layout and navigation, how pages are added, how environment variables are read, and how it is deployed. Follow its existing conventions exactly. Do not add a new framework, UI library or heavy dependency. Tell me in a few lines what you found, then continue.

## Facts
- Product: Smart Chat Assistant, a Chrome side-panel extension with five modes: Chat, Rewrite, Grammar, Summarize and Explain.
- Plans:
  - **Free**: <<describe the free plan, for example "10 chats on a small model">>.
  - **Premium Access**: $2.00 USD per month, billed monthly through Polar, cancel any time. This is the only paid plan; do not invent other tiers or an annual price. Includes access to the hosted AI models. The customer gets a **license key** by email after buying and pastes it into the extension under Settings → Paid plan.
- Payments: Polar is the merchant of record, so it handles payment and tax. Never collect card details on this site.
- Polar organization slug: `dawood-zafar`. Customer portal: `https://polar.sh/dawood-zafar/portal`. Confirm that link pattern works, and if it does not, make it a single configurable value.
- Chrome Web Store link: <<URL, or leave as a configurable placeholder until the listing exists>>.
- Support email: dawood.dixeam@gmail.com

## Build these pages (match the site's design, fully responsive, accessible)
1. `/smart-chat`: product landing page. Hero with the one-line value, the five modes as short cards, how it works in three steps (install, open the side panel, use it), a pricing summary, an FAQ, and a call to action.
2. `/smart-chat/pricing`: Free and Premium Access side by side. The Premium Access button goes to checkout (see below). Add a "Manage or cancel subscription" link to the customer portal and a "Have a license key?" help link.
3. `/smart-chat/success`: the page buyers land on after paying. Explain: (1) check your email for the license key from Polar, (2) open the extension → Settings → Paid plan, (3) paste the key and press Save and verify. Include the customer portal link for finding the key again and a support email link. Do not show or accept a license key on this page.
4. `/smart-chat/privacy`: privacy policy, reachable at exactly this path (it is the URL entered in the Chrome Web Store form, so do not rename it). Mark it as a draft for me to review. State accurately:
   - Stored locally in the browser (chrome.storage): settings, chat history (last 50 messages), the free-chat counter and, for paying users, the license key. It never leaves the device except as described below.
   - Sent to our server (hosted on Vercel) when the user sends a message: the message text and the mode instructions. The server passes them to an AI provider (OpenAI, DeepSeek, Anthropic or v0, depending on configuration) and returns the reply. Our server does not store messages. Vercel may keep standard request logs (such as IP address and timestamps), and each AI provider handles the text under its own privacy policy and retention rules; link to them.
   - The license key is sent to our server on each request and checked with Polar. Polar is the merchant of record and handles payment, so we never see or store card details.
   - The extension reads page content only when the user clicks Insert, and then only writes the reply into the field they selected. It does not read, record or transmit browsing history or page content.
   - We do not sell user data, do not use it for advertising or creditworthiness, and do not transfer it except as listed above.
   - How to clear local data (Clear chat button, or removing the extension), a contact email, and an effective date.
5. `/smart-chat/terms` and `/smart-chat/refunds`: short, plain drafts for me to review. Say Polar processes payments.

## Checkout (no secrets in the browser)
- The Polar product id is not needed for a checkout link, so do not add it to this repo.
- Phase 1, do this now: the Premium Access button is a normal link to the Polar **checkout link** URL. Read it from one environment variable (use the repo's convention for a public variable, for example `NEXT_PUBLIC_POLAR_CHECKOUT_URL`). If the variable is empty, show a disabled "Coming soon" button instead of a broken link.
- The Polar checkout link's success URL is set in the Polar dashboard to `https://dawoodzafar.us/smart-chat/success`. Document this in the README.
- Add a `NEXT_PUBLIC_POLAR_CUSTOMER_PORTAL_URL`-style variable for the portal link, with the default above.
- Do not add the Polar access token, webhook secret or any secret to this repo. If you think a server-side checkout is needed, explain why and stop; do not build it.

## Quality
- Each page has a proper title, meta description, Open Graph tags and a canonical URL. Add the pages to the sitemap if the site has one, and to the navigation or footer in the way that fits the site.
- Use real, specific copy based on the facts above. Do not invent features, testimonials, user counts or ratings. Do not mention features I did not list.
- No placeholder lorem ipsum. Any value I must supply stays as a clearly named configurable constant or environment variable in one place.
- Add `.env.example` entries and a short README section: which variables to set, how to set them in the hosting provider, and the two Polar dashboard steps (checkout link success URL, and License Keys benefit on the product).
- Run the repo's lint, type check and build, fix what fails, and show me the results. If the repo has tests, add a simple one for the pricing page's button states (link when the variable is set, disabled when empty).
- Commit in small logical commits on `feature/smart-chat-pricing`.

When done, give me: a list of the files you added or changed, the exact environment variables to set, the local URLs to preview each page, and anything you were unsure about.
