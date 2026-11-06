# Inline image previews — historical implementation plan

The July 2026 implementation is complete. This archive is not an execution
plan; its earlier sample code and sizing assumptions have been superseded.

The local MCP server adds previews to successful image-producing tool results
while retaining the original text and full-resolution output links. Users can
disable previews with `SOGNI_MCP_NO_INLINE_IMAGES=1`.

Read the maintained implementation and tests for current behavior:

- [Preview selection and formatting](../../../desktop-extension/server/inline-images.mjs)
- [Preview input handling](../../../desktop-extension/server/preview-source.mjs)
- [Protocol and preview tests](../../../test/desktop-extension.test.mjs)
- [Source handling tests](../../../test/preview-source.test.mjs)
- [Extension usage](../../../desktop-extension/README.md)

The hosted Sogni MCP connection is a separate deployment; see the
[MCP guide](https://docs.sogni.ai/agents/mcp/).
