# Tools

- Change files with the Edit and Write tools. Do not edit files with `python3 - <<EOF`, `sed -i`, or `perl -i` scripts.
- Read a file before you edit it. Read it again if a tool or a hook changed it.
- If a Python tool or package is missing, use `uvx <tool>` (for example `uvx ruff`) or `uv run --with <pkg> python ...`. Do not run `pip install`.
- macOS `sed` is BSD `sed`. If you must use `sed`, use `gsed` for GNU syntax.
- For YAML in Python, run `uv run --with pyyaml python ...`. The system Python has no PyYAML.
- To join or filter YAML maps, convert the file to JSON first: `yq -o json file.yaml | jq ...`.
- Use absolute paths in commands. Before you work in a repo, run `git worktree list` to find the correct checkout.
- Put each URL in quotes. zsh expands `?` and `*` in a URL that has no quotes.
- If a GitHub repo has no releases, get the versions with `gh api repos/<owner>/<repo>/tags`.
- In the REPL, await each `$` call. Give a long command a `.timeout()`, so that it moves to the background and does not stop the script.
- For a search or read task, use the `researcher` agent or `Explore`. They run on a smaller model. Keep `general-purpose` for tasks that change files.
