# Workshop: working with AI the team way (90 minutes)

**Audience:** developers and QA engineers. No AI experience needed.
**Goal:** everyone leaves able to use the toolkit on their own tickets, and understands how it's built so they can improve it.

## Before the session
- [ ] devcrew installed in the training project on each attendee's computer (`node ai-dev-toolkit/install.js <project>`)
- [ ] Each attendee has Claude Code installed and signed in to the company account ([ONBOARDING.md](ONBOARDING.md) steps 1–4)
- [ ] A training branch with 3 small, real Jira tickets: 1 story, 1 bug and 1 vague story
- [ ] A test database is configured, so running tests is safe

## Agenda

| Time | Part | What happens |
|------|------|--------------|
| 0–10 | **Why** | The problem: inconsistent AI help, tickets returned from QA, missing tests. The fix: shared rules, workflows and guards. |
| 10–25 | **How it's built** | Walk through the building blocks ([HOW-IT-WORKS.md](HOW-IT-WORKS.md)). Open one real file of each type. |
| 25–40 | **Live demo** | Presenter runs `/devcrew:feature` on the story ticket with the office (http://localhost:4317) on the big screen. Show the router picking the crew, developers working in parallel, then QA, regression and review. |
| 40–75 | **Hands-on** | Attendees do the exercises below in pairs. |
| 75–85 | **Show and tell** | Two pairs show what Claude found or got wrong, and how they corrected it. |
| 85–90 | **Next steps** | Use it on real tickets this sprint. Share feedback in the channel. Suggest improvements via PR. |

## Exercises

**1. Requirements first (10 min)**
Run `/devcrew:prd-check` on the *vague story*. Read the questions it raises. Which would QA have returned the ticket for?

**1b. Plan before coding (5 min)**
Run `/devcrew:plan <story-key>`. Check the "Out of scope" and "Open questions" sections. Would you have thought of those before starting?

**2. Fix a bug the right way (15 min)**
Run `/devcrew:fix <bug-key>` and watch the office. Check that it writes a **failing** test before the fix. Read its root-cause explanation: do you agree?

**3. Review before the PR (10 min)**
Run `/devcrew:review` on your bug fix, then `/devcrew:pr`. Would a QA engineer be able to test from that description?

**4. See the safety net (5 min)**
Ask Claude: "Add a new key to the .env file" and "Run php artisan migrate:fresh". Both should be blocked. Discuss why hooks are used instead of rules for these.

**Bonus, for QA:** run `/devcrew:e2e <story-key>` and review the Playwright tests it creates.

## Measuring success (share after 2 sprints)
- Tickets returned from QA per sprint (Jira)
- Bugs with a regression test (%)
- PRs with a QA test section in the description (%)
- A quick survey: "Did the toolkit save you time this sprint?"
