export default {
  id: "snowflake",
  alias: "snowflake",
  display: {
    name: "Snowflake Cortex",
    icon: "cloud",
    color: "#29B5E8",
    textIcon: "SF",
    website: "https://www.snowflake.com/en/data-cloud/platform/cortex/",
    notice: {
      text: "Snowflake Cortex. Configure account URL.",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://{account}.snowflakecomputing.com/api/v2/cortex/inference/complete",
    format: "openai",
  },
  models: [
    { id: "snowflake-llama-3-3-70b", name: "Snowflake Llama 3.3 70B" },
    { id: "snowflake-mistral-7b", name: "Snowflake Mistral 7B" },
  ],
};
