export default {
  id: "stepfun",
  alias: "stepfun",
  display: {
    name: "StepFun",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "SF",
    website: "https://stepfun.com",
    notice: {
      apiKeyUrl: "https://stepfun.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.stepfun.com/v1/chat/completions",
    format: "openai",
  },
};
