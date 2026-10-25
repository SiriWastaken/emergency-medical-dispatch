# Emergency Medical Dispatch: User Guide

A guided call-taking tool. Everything is stored on this Mac; there is no account, network use or sample data. The app starts with an empty queue.

## One continuous call

Press **New 911** (`⌘N`) and choose the incident type, or use **New 911 → EMS / PD / FD** (`⌘⇧E` / `⌘⇧P` / `⌘⇧F`) to start with it chosen. The whole call happens in one workspace (the **Call** section): the current prompt is in the middle, what you have already asked is on the left, and nothing else is shown. You never fill in a form and never switch tabs to carry on.

1. **Case entry**: four prompts, one at a time: the location, a callback number, what is happening, and the chief complaint (picked from a searchable, grouped list for that call type). Required prompts must be answered, or marked **Unknown**; the message shown when something is wrong comes from the workbook's rules. The caller's and patient's names are **not** asked; you can record them in the case summary if you want to.
2. **Key questions**: the moment the chief complaint is chosen, its question tree starts in the same screen. Each question shows its answers as large options; pick one with the mouse or **1–9** (**0** for Unknown) and the next question appears at once. Where a question needs typing, a text box appears for just that question.
3. **Complete**: at the end of the path the console says whether the workflow is **Complete**, **Incomplete** (and what is missing) or **cannot proceed**.

**What you will be asked.** After the chief complaint, EMS calls start with the life-threat questions (awake? breathing?). Unconscious and not breathing goes straight to a cardiac arrest outcome with the CPR script. Otherwise the app asks how many are hurt, age, sex and your relationship, then the questions for that complaint, and ends at a **Priority 1, 2 or 3** outcome. Police and fire calls ask their own questions (weapons, injuries, who is involved, whether anyone is trapped, and so on). A complaint without a tree of its own uses the general tree for that call type. Everything the app asks lives in `call-taking-workflow.xlsx`.

**This is roleplay content.** The questions and scripts are realistic but written for roleplay and training; they are labelled as such on screen and are not a real dispatch protocol. Do not use them for real emergencies.

**Caller instructions** (button in the stage bar, or shown automatically at some outcomes) are the scripts to read to the caller: CPR for adults and babies, choking (Heimlich and infant), bleeding, burns, childbirth, stay-safe advice for police calls, getting out of a burning building, and more. Tick **Given to the caller** to log it in the case summary.

The stage bar shows where you are. **Case summary** opens beside the question (details, what is missing, instructions given, optional details, live narrative, notes). **Call narrative** opens the finished narrative.

## Going back and correcting

- **Back** steps to the previous question (and from the first key question, back into case entry).
- Click any item in the history on the left to go back to it. Fixing a case-entry value (for example the caller's name) returns you straight to where you were, with every answer intact.
- Changing a question answer discards later answers that no longer apply (you are told), and the narrative follows. Changing the chief complaint starts the right question set and discards the old answers.
- **Continue** moves forward along answers you have already given; **Review answers** shows every question and answer.

## Answers, required questions and responses

Each question is marked **Required** or **Optional**. **Unknown**, **Unavailable** and **Not asked** are offered only where the workflow allows them, and a required question can never be skipped. If an answer is not allowed after earlier answers, it is greyed out with the reason. Typed answers are checked by the workbook's rules before you can continue.

Case entry values can be marked **Independently verified**; otherwise they are recorded as caller-reported, and the summary shows which is which.

## Call Narrative (`⌘3`)

- **EMS:** eight lines: PHONE NUMBER, CALLER'S PROBLEM DESCRIPTION IS, CALLER'S RELATIONSHIP TO PATIENT, NUMBER OF HURT/SICK, PATIENT(S) AGE IS, PATIENT(S) SEX IS, PATIENT(S) CONSCIOUS STATUS, PATIENT(S) BREATHING STATUS.
- **PD / FD:** three lines: PHONE NUMBER, CALLER'S NAME, CALLER'S PROBLEM DESCRIPTION.

It always reflects the call you have open and updates as answers are given. **Copy Narrative** (`⌘⇧C`, works anywhere) and **Save as .txt** use exactly those lines; notes are separate and never copied.

## Queue and settings

- **Incident queue (`⌘1`):** every call with its type, name, chief complaint, status and last-updated time; search by number, name, complaint, location or description; filter by type and status. Click a number to reopen it. A call reopens at its open question.
- **Settings (`⌘4`):** import workflows or extra chief complaints from `.xlsx`/`.csv` (always added as awaiting validation), and export or restore a backup.

Every question set shows a status banner (AWAITING VALIDATION, or VERIFIED SOURCE only with attested provenance). Press `?` outside a text field for all shortcuts.
