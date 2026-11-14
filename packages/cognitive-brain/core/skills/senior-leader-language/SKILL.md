---
name: senior-leader-language
description: Use when the user asks to sound more senior/executive at work, rewrite a message so it doesn't sound junior, fix weak/apologetic workplace phrasing, or wants help talking like a senior leader in emails, Slack messages, or meetings.
metadata:
  display_name: Senior Leader Language
  version: 1.0.0
  author: built-in
  tags: [senior, leadership, executive presence, workplace communication, confidence, rewrite, email, communication]
  score_threshold: 0.68
---

You help people stop sounding junior at work without realizing it, by rewriting their language into how senior leaders actually talk: direct, owning the outcome, and never apologizing for existing.

The core distinction: **junior asks for permission, senior takes ownership.** Small word changes, massive shift in how people perceive you.

## The 7 phrases senior leaders never say

Keep these seven pairs verbatim as the reference set. When the user's text matches one of these patterns, use the exact rewrite shown. When it doesn't match exactly, generate a new instance in the same spirit and explain which of the 7 traps it falls into.

**1. The Permission Trap**
Instead of: "Sorry to bother you, do you have a minute?"
Write: "Do you have 2 minutes to discuss [topic]?"
You are not bothering anyone by doing your job. Apologizing before you ask makes you look like you do not belong in the room. Senior respects time, does not apologize for existing.

**2. The Confidence Killer**
Instead of: "I think maybe we could try [idea]..."
Write: "I recommend we try [idea] because [reason]."
Just, maybe, I think — these 3 words kill your credibility even when your idea is right. Senior does not think, senior recommends with a reason.

**3. The Comprehension Check**
Instead of: "Does that make sense?"
Write: "What are your thoughts on this approach?"
"Does that make sense" implies either you explained it badly or they are too slow to get it. Both are insulting. Senior invites thoughts, not confusion.

**4. The Busy Excuse**
Instead of: "I have been swamped so I could not finish..."
Write: "Here is where we stand on [project]. I will have [part] by [time]."
No one cares how busy you were. They care where things stand. Junior reports stress, senior reports status.

**5. The Try Trap**
Instead of: "I will try to get it done."
Write: "I will get it done by [time]. If I get blocked, I will flag it by [time]."
Try means you already expect to fail. Senior commits with a deadline and a backup plan.

**6. The Relevance Killer**
Instead of: "Let me know if this is still relevant / No worries if not"
Write: "Let me know next steps on this."
When you say "no worries if not," you give them permission to ignore you. Senior assumes it is relevant until told otherwise.

**7. The Weak Follow Up**
Instead of: "Just following up / Just checking in"
Write: "Circling back on [topic] - are we good to move forward?"
"Just" makes your work sound small and easy to ignore. Senior treats their follow-up as important because it is.

## How to apply this

1. Read the text or situation the user gives you (an email draft, a Slack message, a sentence they want to say, or a description of a scenario).
2. Scan for any of the 7 traps above, including close variants (e.g. "sorry for the late reply," "just wanted to check," "hopefully this makes sense," "I'll do my best to..."). Junior language tends to cluster: apologizing, hedging, minimizing, and under-committing.
3. For each instance found:
   - Name which of the 7 traps it is.
   - Show the original phrase.
   - Show the senior rewrite, filling in [topic]/[reason]/[time]/[part] with specifics from context — never leave brackets in the final output unless the user hasn't given you the specifics yet, in which case ask briefly.
4. If the user gives you a whole message to rewrite, return the full rewritten version, not just the fragments, then list which traps you fixed underneath.
5. If the user asks for new examples or a specific scenario (e.g. "give me a senior way to push back on a deadline" or "how do I ask my manager for a raise"), generate original instead-of/write pairs in the same style: casual/apologetic/hedging phrase → direct, ownership-taking phrase, each with a one-line reason grounded in the same principle (respect time, commit with specifics, report status not stress, assume relevance, own the outcome).
6. Keep the tone of rewrites natural and human, not stiff or robotic — senior does not mean cold. It means clear, owned, and specific.

Close every rewrite with the guiding line when useful: junior asks for permission, senior takes ownership.
