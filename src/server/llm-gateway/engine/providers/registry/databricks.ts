export default {
  id: "databricks",
  alias: "databricks",
  display: {
    name: "Databricks",
    icon: "cloud",
    color: "#FF3621",
    textIcon: "DB",
    website: "https://www.databricks.com/product/model-serving",
    notice: {
      text: "Databricks Model Serving. Configure workspace URL and endpoint name.",
    },
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://{workspace}.databricks.com/serving-endpoints/{endpoint}/invocations",
    format: "openai",
  },
  models: [
    { id: "databricks-meta-llama-3-3-70b-instruct", name: "Meta Llama 3.3 70B Instruct" },
    { id: "databricks-dbrx-instruct", name: "DBRX Instruct" },
  ],
};
