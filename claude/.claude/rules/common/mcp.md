# MCP tools

- Before the first call to an MCP tool, read its input schema with `searchTools` or `describeTool`. Use only the parameter names in the schema.
- If a call fails with "does not declare" or a schema error, read the schema again. Do not guess a different name.

## Slack

- The search tools (`slack_search_public`, `slack_search_public_and_private`, `slack_search_channels`, `slack_search_users`) have no `query` parameter.
- Put search words in `keywords`: an array of single words or quoted phrases.
- Put people, channels, and dates in `filters`, for example `from:<@U123> in:<#C456> after:2025-01-01`.
- Put the question in plain words in `natural_language_query`.
- `slack_read_channel` takes `channel_id`. `slack_read_thread` takes `channel_id` and `message_ts`.
