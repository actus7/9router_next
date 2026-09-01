const ANTIGRAVITY_NATIVE_TOOL_NAMES = [
  "browser_subagent",
  "command_status",
  "find_by_name",
  "generate_image",
  "grep_search",
  "list_dir",
  "list_resources",
  "mcp_sequential-thinking_sequentialthinking",
  "multi_replace_file_content",
  "notify_user",
  "read_resource",
  "read_terminal",
  "read_url_content",
  "replace_file_content",
  "run_command",
  "search_web",
  "send_command_input",
  "task_boundary",
  "view_content_chunk",
  "view_file",
  "write_to_file",
] as const;

export const AG_DECOY_TOOLS: Array<{
  name: string;
  description: string;
  parameters: { type: string; properties: Record<string, never>; required: string[] };
}> = ANTIGRAVITY_NATIVE_TOOL_NAMES.map((name) => ({
  name,
  description: "This tool is currently unavailable.",
  parameters: { type: "OBJECT", properties: {}, required: [] as string[] },
}));
