export default {
  id: "bedrock",
  alias: "bedrock",
  display: {
    name: "Amazon Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock/",
    notice: {
      text: "Amazon Bedrock. Requires AWS credentials (Access Key ID + Secret). Configure region and model in connection settings.",
    },
  },
  category: "apikey",
  authHint: "Requires AWS Signature V4 authentication. Configure Access Key ID and Secret Access Key.",
  transport: {
    baseUrl: "https://bedrock-runtime.{region}.amazonaws.com/model/{model}/converse-stream",
    format: "openai",
  },
  models: [
    { id: "anthropic.claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "anthropic.claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "amazon.nova-pro-v1", name: "Amazon Nova Pro" },
    { id: "meta.llama3-3-70b-instruct", name: "Llama 3.3 70B Instruct" },
    { id: "deepseek.r1-v1", name: "DeepSeek R1" },
  ],
};
