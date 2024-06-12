This is a script that takes a CSV export from Loops.so and converts it into an HQ-internal Airtable for analytics to track progress on programs.

To use create `.env` ands set:

```
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=

# this must be gotten by inspecting requests the browser makes to Loops.so from the browser
LOOPS_SESSION_COOKIE=

LOOPS_API_KEY=

OPENAI_API_KEY=
```