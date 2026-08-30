export default {
  id: "charm-hyper",
  alias: "charm",
  display: {
    name: "Charm Hyper",
    icon: "bolt",
    color: "#A855F7",
    textIcon: "CH",
    website: "https://hyper.charm.land",
    notice: "100 Hypercredits/mês grátis no signup",
  },
  category: "apikey",
  passthroughModels: true,
  transport: {
    baseUrl: "https://hyper.charm.land/v1/chat/completions",
    format: "openai",
    validateUrl: "https://hyper.charm.land/v1/models",
    modelsFetcher: { url: "https://hyper.charm.land/v1/models", type: "openai" },
  },
  models: [],
};
