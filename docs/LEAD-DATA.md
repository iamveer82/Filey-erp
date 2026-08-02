# Lead data — what Filey collects, and what it won't

Filey's lead tools read what a company **publishes about itself**: its own
website, its own contact page, the TRN it prints on its own invoices. That is
information a business put on the open web so customers could contact it.

Four things Filey deliberately does not do, even though the tooling would be
easy to write:

**Social profile scraping.** Harvesting Instagram / TikTok / LinkedIn / YouTube
profiles into a contact list means collecting personal data about private
individuals who never gave it to you. Under the UAE PDPL — and the GDPR, for
any EU contact — a controller needs a lawful basis for that, and "I scraped it"
is not one. It also breaks every one of those platforms' terms of use.

**LinkedIn session-cookie access.** Driving LinkedIn with a copied `li_at`
cookie is account-sharing under their user agreement. The account that gets
restricted is the customer's own, along with whatever business it was carrying.

**Email-pattern guessing.** Generating `firstname.lastname@company.com` and
similar is inventing a person's contact details, not discovering them. A guessed
address that happens to resolve belongs to someone who never opted in.

**SMTP verification probing.** Connecting to mail servers to test whether an
address exists is what bulk senders do, and receiving mail providers treat it
accordingly. At any volume it gets the sending domain reputation-flagged — for
Filey that is `gofiley.com`, the same domain that carries invoice and payment
email, so the blast radius is customers not receiving their invoices.

## What Filey does instead

- `enrich_company_website` — read a company's own site and pull the contact
  details, address and TRN it publishes there. The source URL is always
  returned, so a wrong guess is visible rather than silently saved.
- `score_lead` — rank leads from the trading history already in the books:
  invoiced value, repeat business, recency, whether you can actually reach them,
  what they owe. Deterministic and offline, so sorting by it means the same
  thing every time.

If you have consented contact data from another source, import it through the
normal customer import — Filey will store it. The line is about what Filey
goes out and *collects on your behalf*.
