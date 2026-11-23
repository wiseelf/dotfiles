# Coding style

- Prefer immutable data. Return a new object. Do not change the object in place, unless the language idiom or performance needs it.
- KISS, DRY, YAGNI. Add an abstraction only when the repetition is real.
- Files: one feature or domain in each file. Keep a file below 800 lines and a function below 50 lines.
- Use early returns. Do not nest deeper than 4 levels.
- Use named constants for thresholds, delays, and limits.
- Handle each error explicitly. Do not swallow an error.
- Validate input at system boundaries: user input, API responses, file content.
