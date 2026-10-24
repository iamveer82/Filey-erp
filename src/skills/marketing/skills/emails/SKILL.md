---
name: emails
description: Write an email sequence, a cold email, or an SMS flow, and save it as a Filey template or campaign.
---

# Email and SMS

Covers emails, cold-email, and sms from [Marketing Skills](https://github.com/coreyhaines31/marketingskills) (MIT).

1. Decide the sequence: who receives it, the trigger, and the one ask in each message.
2. Draft subject and body. A cold email is short, specific, and honest about why you are writing. No fake familiarity.
3. Save a reusable message with `save_email_template`. A bulk send is `create_campaign` and still needs the user's approval before it goes out. One person is `send_gmail` or `send_whatsapp`, also with approval.
4. Follow-ups go on the calendar with `add_reminder` unless the user asked to send them now.
