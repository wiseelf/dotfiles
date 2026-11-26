# Tools

- Change files with the Edit and Write tools. Do not edit files with `python3 - <<EOF`, `sed -i`, or `perl -i` scripts.
- Read a file before you edit it. Read it again if a tool or a hook changed it.
- If a Python tool or package is missing, use `uvx <tool>` (for example `uvx ruff`) or `uv run --with <pkg> python ...`. Do not run `pip install`.
- macOS `sed` is BSD `sed`. If you must use `sed`, use `gsed` for GNU syntax.
- For a search or read task, use the `researcher` agent or `Explore`. They run on a smaller model. Keep `general-purpose` for tasks that change files.
