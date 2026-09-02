// synapse: Engine determinística do Synapse (portada de https://github.com/actus7/synapse, Apache-2.0).
// Pattern-matching com capture groups, reflexão de pronomes, memória e anti-repetição.
// Retorna null quando nenhum padrão casa (para que o caller decida o fallback).

import type { SynapseDeterministicData } from "./data";

type CompiledRule = {
  pattern: RegExp;
  responses: string[];
  memFlag: boolean;
  goto: string | null;
};

type CompiledKeyword = {
  key: string;
  priority: number;
  rules: CompiledRule[];
};

type CompiledTransforms = {
  regex: RegExp;
  map: Record<string, string>;
};

export type SynapseDeterministicConfig = {
  memorySize?: number;
  noRandom?: boolean;
};

type ParsedData = Omit<SynapseDeterministicData, "keywords"> & {
  keywords: CompiledKeyword[];
  preExp: CompiledTransforms;
  postExp: CompiledTransforms;
};

export class SynapseDeterministicBot {
  private readonly config: Required<SynapseDeterministicConfig>;
  private readonly data: ParsedData;
  private memory: string[] = [];
  private lastChoices: Record<string, Record<number, number>> = {};

  constructor(
    data: SynapseDeterministicData,
    config: SynapseDeterministicConfig = {}
  ) {
    this.config = {
      memorySize: config.memorySize ?? 20,
      noRandom: config.noRandom ?? false,
    };
    this.data = this.parseData(data);
    this.reset();
  }

  reset(): void {
    this.memory = [];
    this.lastChoices = {};
    for (const keyword of this.data.keywords) {
      this.lastChoices[keyword.key] = {};
      for (let i = 0; i < keyword.rules.length; i++) {
        this.lastChoices[keyword.key][i] = -1;
      }
    }
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private parseData(data: SynapseDeterministicData): ParsedData {
    const parsed = { ...data } as unknown as ParsedData;

    if (data.keywords) {
      parsed.keywords = data.keywords.map((keyword) => {
        const compiledRules: CompiledRule[] = keyword.rules
          .map((rule) => {
            let { pattern } = rule;
            let flags = "i";

            if (pattern instanceof RegExp) {
              flags = pattern.flags;
              pattern = pattern.source;
            }

            if (pattern.startsWith("$")) {
              pattern = pattern.slice(1).trimStart();
              rule.memFlag = true;
            }

            try {
              return {
                ...rule,
                pattern: new RegExp(pattern, flags),
                responses: rule.responses || [],
                memFlag: rule.memFlag || false,
                goto: rule.goto || null,
              };
            } catch {
              return null;
            }
          })
          .filter((r): r is CompiledRule => r !== null);

        return {
          key: keyword.key,
          priority: keyword.priority,
          rules: compiledRules,
        };
      });

      parsed.keywords.sort((a, b) => b.priority - a.priority);
    }

    parsed.preExp = this.compileTransforms(data.preTransforms);
    parsed.postExp = this.compileTransforms(data.postTransforms);

    return parsed;
  }

  private compileTransforms(
    transforms: SynapseDeterministicData["preTransforms"]
  ): CompiledTransforms {
    if (!transforms || !Array.isArray(transforms)) {
      return { regex: /####/, map: {} };
    }

    const regexps: string[] = [];
    const map: Record<string, string> = {};

    for (const transform of transforms) {
      if (transform && typeof transform.from === "string") {
        regexps.push(transform.from);
        map[transform.from.toLowerCase()] = transform.to;
      }
    }

    return {
      regex: new RegExp(`\\b(${regexps.join("|")})\\b`, "gi"),
      map,
    };
  }

  /**
   * Processa input e retorna resposta, ou null se nenhum padrão casa.
   */
  transform(inputText: string): string | null {
    if (!inputText || inputText.trim() === "") {
      return null;
    }

    let text = inputText.toLowerCase();
    text = this.applyTransforms(text, this.data.preExp);
    const sentences = text.split(/[!.;?]+/);

    for (const sentence of sentences) {
      if (!sentence || sentence.trim() === "") {
        continue;
      }

      for (const keyword of this.data.keywords) {
        const keyRegex = new RegExp(
          `\\b${this.escapeRegex(keyword.key)}\\b`,
          "i"
        );
        if (keyRegex.test(sentence)) {
          for (const rule of keyword.rules) {
            const reply = this.applyRule(sentence, keyword, rule);
            if (reply) {
              return reply;
            }
          }
          break;
        }
      }
    }

    const memoryReply = this.getMemory();
    if (memoryReply) {
      return memoryReply;
    }

    return null;
  }

  private applyRule(
    sentence: string,
    keyword: CompiledKeyword,
    rule: CompiledRule
  ): string | null {
    const match = sentence.match(rule.pattern);

    if (!match) {
      return null;
    }

    if (rule.goto) {
      const nextKeyword = this.data.keywords.find((k) => k.key === rule.goto);
      if (nextKeyword) {
        for (const nextRule of nextKeyword.rules) {
          const reply = this.applyRule(sentence, nextKeyword, nextRule);
          if (reply) {
            return reply;
          }
        }
      }
      return null;
    }

    if (rule.responses.length === 0) {
      return null;
    }

    let ri = this.config.noRandom
      ? 0
      : Math.floor(Math.random() * rule.responses.length);

    if (!this.config.noRandom) {
      const ruleIdx = keyword.rules.indexOf(rule);
      if (this.lastChoices[keyword.key][ruleIdx] === ri) {
        ri = (ri + 1) % rule.responses.length;
      }
      this.lastChoices[keyword.key][ruleIdx] = ri;
    }

    const response = rule.responses[ri];

    let finalResponse = response.replace(/\((\d+)\)/g, (_m, index: string) => {
      let param = match[Number.parseInt(index, 10)] || "";
      param = this.applyTransforms(param, this.data.postExp);
      return param;
    });

    finalResponse = this.postTransform(finalResponse);

    if (rule.memFlag) {
      this.saveToMemory(finalResponse);
    }

    return finalResponse;
  }

  private applyTransforms(
    text: string,
    transforms: CompiledTransforms
  ): string {
    transforms.regex.lastIndex = 0;
    if (transforms.regex.test(text)) {
      transforms.regex.lastIndex = 0;
      let result = "";
      let lastIndex = 0;
      let match: RegExpExecArray | null = transforms.regex.exec(text);
      while (match !== null) {
        result += text.slice(lastIndex, match.index);
        result += transforms.map[match[0].toLowerCase()] || match[0];
        lastIndex = transforms.regex.lastIndex;
        match = transforms.regex.exec(text);
      }
      result += text.slice(lastIndex);
      return result;
    }
    return text;
  }

  private postTransform(text: string): string {
    let result = text.trim();
    if (!result) {
      return result;
    }

    result = result.replace(/\s+/g, " ");
    result = result.replace(/\s([!,.?])/g, "$1");
    result = result.charAt(0).toUpperCase() + result.slice(1);

    return result;
  }

  private saveToMemory(response: string): void {
    this.memory.push(response);
    if (this.memory.length > this.config.memorySize) {
      this.memory.shift();
    }
  }

  private getMemory(): string {
    if (this.memory.length === 0) {
      return "";
    }
    if (this.config.noRandom) {
      return this.memory.shift() || "";
    }

    const index = Math.floor(Math.random() * this.memory.length);
    return this.memory.splice(index, 1)[0] || "";
  }
}
