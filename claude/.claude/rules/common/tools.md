# Tools

- Change files with the Edit and Write tools. Do not edit files with `python3 - <<EOF` scripts.
- If a Python tool or package is missing, use `uvx <tool>` (for example `uvx ruff`) or `uv run --with <pkg> python ...`. Do not run `pip install`.
- macOS `sed` is BSD `sed`. If you must use `sed`, use `gsed` for GNU syntax.
- For YAML in Python, run `uv run --with pyyaml python ...`. The system Python has no PyYAML.
- To join or filter YAML maps, convert the file to JSON first: `yq -o json file.yaml | jq ...`.
- Use absolute paths in commands.
- Put each URL in quotes. zsh expands `?` and `*` in a URL that has no quotes.
- For a search or read task, use the `researcher` agent or `Explore`. They run on a smaller model. Keep `general-purpose` for tasks that change files.
