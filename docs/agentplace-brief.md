Here is the roadmap, split by who does what.

---

### Phase 0: Setup (You)

**You handle this entirely outside Agentplace.**

1. **Create the Vercel API.** Build a simple Next.js API route (`/api/quote`) that accepts `{ jobType, distance }` and returns `{ price }`. Deploy to Vercel.
2. **Create a Google Sheet** with columns: `Name`, `Email`, `Job Type`, `Distance`, `Price`, `Booking Status`, `Timestamp`.
3. **Create a GitHub repo** for the Vercel API and the Next.js frontend form. This is what you'll show them.
4. **Build the frontend form** (Next.js + Tailwind). Deploy it. It should POST to your Vercel API first (for price preview) and then to the Agentplace agent (for booking). For now, just build the UI and the API call.

**What Agentplace does:** Nothing yet. You're building the external pieces.

---

### Phase 1: Build the Agent (Agentplace Builder)

**You** describe the outcome in the Builder. **The Agentplace AI Builder** writes the agent code.

**What you tell the Builder (prompt):**

> "Build an agent that receives a booking request from my Next.js form. It should:
>
> 1. Call my external API at `https://your-vercel-app.vercel.app/api/quote` with the job type and distance to get a price.
> 2. Check Google Calendar for availability on the requested date.
> 3. If available, append a row to my Google Sheet with the booking details.
> 4. Send a confirmation email to the customer via Gmail.
> 5. Return a JSON response with `{ status: 'confirmed', price: X, slot: Y }`."

**What the Agentplace Builder does:**

- Writes the frontend, backend, and integration logic for the agent .
- Tests its own work by messaging the agent it just built .
- Publishes to a live URL.

**Connections (you authorize these in the dashboard):**

- **Google Calendar** → authorize your account. The agent checks availability .
- **Google Sheets** → authorize your account. The agent writes booking records .
- **Gmail** → authorize your account. The agent sends confirmation emails .
- **Your Vercel API** → Agentplace supports API integrations outside the Composio catalog. Tell the Builder: _"Call this external API endpoint."_

**Important limitation:** The published agent has restricted authority. It cannot execute shell commands or access owner contact details. It files privileged requests for the owner rather than executing them directly . For your use case, this means the agent can write to Sheets and send Gmail, but you should test thoroughly that those actions actually complete.

---

### Phase 2: Get the Code to GitHub (You + Agentplace)

**Agentplace** provides full GitHub push/pull .

**You** connect your GitHub account in Agentplace settings and push the generated agent code to a repo. Then you can open it in Cursor/VS Code, review it, and push changes back. The agent remains hosted on Agentplace, but you own the code history.

**What this gives you for the application:** A GitHub repo showing the agent's code, which proves you understand what was generated and can modify it.

---

### Phase 3: Connect the Frontend to the Agent (You)

**You** update your Next.js form to POST to the Agentplace agent's endpoint instead of just your Vercel API.

**The flow:**

1. User fills form → POST to Agentplace agent.
2. Agent calls your Vercel API for price.
3. Agent checks Calendar.
4. Agent writes to Sheet.
5. Agent sends Gmail.
6. Agent returns response to your frontend.
7. Frontend shows confirmation with price and slot.

**You test:** Submit a booking, check the Sheet, check the email, check the Calendar.

---

### Phase 4: Add the "Thinking" State (You)

**You** handle this in the frontend. When the user submits:

1. Show a live status feed using polling or SSE:
   - "Analyzing request..."
   - "Calculating price..."
   - "Checking availability..."
   - "Confirming booking..."
2. This proves you understand async agent behavior.

**Agentplace** doesn't need to do anything extra here. Your frontend polls the agent's status endpoint or your Vercel API for job status.

---

### Phase 5: Document and Submit (You)

**You write the note.** Cover:

- What you built: form → agent → Vercel API → Calendar/Sheets/Gmail.
- The external API: your Vercel pricing function, with GitHub link.
- Platform limits you hit: e.g., _"The agent couldn't directly parse the form payload without a custom API bridge, so I built the Vercel endpoint as the pricing logic layer and called it from the agent."_
- Production changes: swap Google Sheet for Postgres, add Stripe payment link, add authentication.

**You send the email** to `[EMAIL_ADDRESS]` with:

- Published agent link
- GitHub repo links (Vercel API + frontend + agent code if pushed)
- The note

---

### Summary Table

| Phase                   | Who                             | What                                    |
| ----------------------- | ------------------------------- | --------------------------------------- |
| 0. Vercel API + Form UI | You                             | Build and deploy external pieces        |
| 1. Agent build          | Agentplace Builder (you prompt) | Describe outcome, authorize connections |
| 2. Code to GitHub       | You (with Agentplace push)      | Push generated code, review in Cursor   |
| 3. Connect frontend     | You                             | POST form to agent endpoint             |
| 4. Thinking state       | You                             | Polling/SSE on frontend                 |
| 5. Note + submit        | You                             | Write engineering note, send email      |

**The key insight:** Agentplace's Builder is where the agent is _created_, but the external API and frontend are where _you_ prove you're an engineer. The GitHub push means you're not locked in. Use that in your note.
