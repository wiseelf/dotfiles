# MCP tools

- Before the first call to an MCP tool, read its input schema with `searchTools` or `describeTool`. Use only the parameter names in the schema.
- If a call fails with "does not declare" or a schema error, read the schema again. Do not guess a different name.
