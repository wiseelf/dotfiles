# Coding style

- Prefer immutable data. Return a new object. Do not change the object in place, unless the language idiom or performance needs it.
- Use meaningful names. Follow the best practices of the language.
- KISS, DRY, YAGNI. Add an abstraction only when the repetition is real.
- Files: one feature or domain in each file. Keep a file below 800 lines and a function below 50 lines.
- Use early returns. Do not nest deeper than 4 levels.
- Use named constants for thresholds, delays, and limits.
- Handle each error explicitly. Do not swallow an error.
- Validate input at system boundaries: user input, API responses, file content.

## Scope of a change
- Change only the lines that the task needs. Each changed line must trace to the request.
- Do not refactor, reformat, or "improve" code that the task does not touch.
- Use the existing style of the file, even if you prefer a different style.
- If you find unrelated dead code, report it. Do not remove it.
- Remove the imports, variables, and functions that your change made unused. Keep the dead code that was there before.
- Do not add error handling for a case that cannot occur.

## Checks
- For a task with several steps, give each step a check that shows that the step works.
- For a bug fix, first write a test that shows the bug. Then make the test pass.
- For a refactor, run the tests before and after the change. The results must be the same.
