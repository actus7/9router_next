// Public server API of the LLM gateway — web search & fetch modalities.
import "server-only";

export { handleSearch } from "@/sse/handlers/search";
export { handleFetch } from "@/sse/handlers/fetch";
