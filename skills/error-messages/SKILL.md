---
name: error-messages
description: Write clear, helpful, user-friendly error messages in application code. Use when writing or reviewing error messages, toast notifications, alert dialogs, validation messages, error banners, snackbars, or any user-facing error/failure text in UI code. Triggers on error handling code, catch blocks with user-facing messages, form validation, API error responses shown to users, and notification/alert components.
---

# Error Messages

Every user-facing error message must follow five rules and avoid four anti-patterns.

## Five Rules

Apply all five in order. Not every message needs all five — use judgment — but always start with rules 1 and 2.

1. **Say what happened** — State the outcome clearly and specifically.
2. **Say why** — Give an honest reason. Take responsibility when it's your system.
3. **Provide reassurance** — Tell users what *wasn't* affected (e.g., their data is safe).
4. **Give a way out** — Offer a concrete next action they can take right now.
5. **Help them fix it** — Provide an escalation path if the first action doesn't work.

## Four Anti-Patterns

Never do these:

- **Inappropriate tone** — No "Whoops!", "Oops!", "Uh oh!", or overly casual language. Errors are frustrating; don't be flippant.
- **Passing the blame** — Don't say "The service you're trying to reach..." or "Your browser failed to...". Own the problem.
- **Technical jargon** — No "third-party", "API", "500", "timeout", "null", "exception" in user-facing text.
- **Generic messages** — No "Something went wrong. Try again later." Always be specific.

## Message Structure

Most UI frameworks have separate title and body fields. Use them:

- **Title** → Rule 1 (what happened)
- **Body** → Rules 2–5 (why, reassurance, way out, escalation)
- **Action buttons** → Specific verbs ("Try Again", "Contact Support"), never generic ("OK", "Close")

## Example

Bad:
```
Title:   Whoops! Something went wrong
Body:    The third-party you're trying to connect to isn't responding,
         so we can't fetch your data. Try again later.
Button:  [Close]
```
(Inappropriate tone, blames an external service, uses jargon, generic action)

Good:
```
Title:   Unable to connect your account
Body:    Your changes were saved, but we could not connect your account
         due to a technical issue on our end. Please try connecting again.
         If the issue keeps happening, contact Customer Care.
Buttons: [Cancel] [Try Again]
```
(Specific title, reassurance first, owns the problem, concrete actions)
