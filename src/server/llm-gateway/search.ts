// Public server API of the LLM gateway — web search & fetch modalities.
import "server-only";

export { handleSearch } from "./application/search";
export { handleFetch } from "./application/fetch";
