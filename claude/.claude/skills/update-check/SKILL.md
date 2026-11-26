---
name: update-check
description: Find newer versions of the Docker images, tools, and providers that a homelab IaC repo pins (Compose, Ansible, Terraform), read their release notes, and open an MR with the approved updates.
user-invocable: true
disable-model-invocation: true
argument-hint: "<repo-path> [host-group]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, WebFetch, AskUserQuestion
---

# Check a repo for updates

Find each pinned version in the target repo, compare it with the latest stable release, and show a table. Change files only after the user approves.

## Inputs

- The target repo path (the first argument). If it is missing, ask the user.
- An optional host group or directory that limits the scope.

If `<skill-dir>/presets.md` exists, read it. It names the repos, host groups, and their architectures.

## Steps

1. Examine the repo.
   - Run `git -C <repo> status -sb` and `git -C <repo> worktree list`.
   - If a `chore/update-check-*` worktree exists, ask the user if you must continue in it.
   - Run `git -C <repo> fetch origin`. Read the files from `origin/<default-branch>`, not from a stale checkout.
2. List the pinned versions. Search these forms:

   | Stack | Form |
   |---|---|
   | Compose | `image: <name>:<tag>` |
   | Ansible | `image: "{{ x_image }}:{{ x_tag }}"` in tasks; `*_version:`, `*_image_tag:` in `defaults/`, `group_vars/`, `host_vars/` |
   | Terraform/OpenTofu | `image =`, `version =` in `required_providers` and `module` blocks |

   - Connect each version variable to the `image:` line that uses it. This gives the image name.
   - Use the effective value. `host_vars/` and `group_vars/` override role `defaults/`. If host groups set different values, keep one row for each value.
   - Record the file and line of each value.
   - Do not check commented lines, `latest`, or a digest pin. List them as "not pinned".
3. Find the latest stable version of each item.
   - If the image has a GitHub source repo, run `gh api repos/<owner>/<repo>/releases/latest`. If the repo has no releases, use `gh api repos/<owner>/<repo>/tags`.
   - For Docker Hub, fetch `"https://hub.docker.com/v2/repositories/<namespace>/<name>/tags?page_size=100&ordering=last_updated"`. Official images use the namespace `library`.
   - `last_updated` order is not version order. Old branches get patches too. Sort the tags by version.
   - For other registries, use `crane ls` or `skopeo list-tags`. Run `command -v` first.
   - Keep the format of the current tag: the `v` prefix and the variant suffix (`-alpine`, `-noble`).
   - A release tag can differ from the image tag, for example `v13.3.2` and `13.3.2`. Make sure the new tag exists in the registry.
   - If a newer major exists, report the latest version in the current major and the latest major.
   - Ignore pre-releases: `rc`, `beta`, `alpha`, `dev`, `nightly`.
   - If the image is deprecated or renamed, report the new name. A comment near the value can give this fact.
4. Make sure the new tag supports each host architecture, for example `linux/arm/v6` on a Pi Zero. Read the `images[].architecture` and `variant` fields from Docker Hub, or run `docker manifest inspect`.
5. Read the release notes for each update, from the current version to the latest.
   - Use `gh api repos/<owner>/<repo>/releases --paginate`, or the changelog file of the repo.
   - Find breaking changes: "breaking", "migration", "removed", "deprecated", a changed config key, a database upgrade.
   - A major version change needs a summary of its migration steps.
6. Show one table. Sort the rows by risk: major first, then minor, then patch.

   | Item | File:line | Hosts | Current | Latest | Change | Breaking changes | Arch |
   |---|---|---|---|---|---|---|---|

   Under the table, list the "not pinned" items and the items with no data.
7. Ask the user which updates to apply. Use `AskUserQuestion` with `multiSelect: true`. Mark the patch and minor updates with no breaking changes as recommended.
8. Apply the approved updates.
   - Make a worktree with the branch `chore/update-check-<YYYY-MM-DD>`. Follow the worktree rules of the project.
   - Change each value with the Edit tool.
   - If a value is shared by several host groups, change it only for the approved hosts.
   - Run the checks of the repo that exist: `docker compose config`, `ansible-lint`, `ansible-playbook --syntax-check`, `tofu validate` or `terraform validate`.
   - Run the `mr` skill. Put the table and the breaking changes in the MR description.

## Do not

- Do not deploy: no `ansible-playbook` run, `docker compose up`, or `tofu apply`. The user deploys after the merge.
- Do not change a value that the user did not approve.
- Do not use `latest` as a new tag.
