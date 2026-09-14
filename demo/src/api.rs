//! Cliente do gateway. Só o dialeto OpenAI (`/v1/models`,
//! `/v1/chat/completions`), que é o que o 9router expõe para clientes externos.
//!
//! Tudo aqui é bloqueante de propósito: roda numa thread de trabalho, nunca na
//! thread da janela, e uma thread por requisição é mais simples que um runtime
//! async para um cliente que faz uma chamada de cada vez.

use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

/// Tokens que o gateway reportou para uma resposta, quando reporta.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Usage {
    pub prompt: u64,
    pub completion: u64,
}

/// Medidas de uma resposta — o motivo de existir um demo em vez de um curl.
#[derive(Clone, Copy, Debug)]
pub struct Stats {
    pub first_token: Option<Duration>,
    pub total: Duration,
    pub usage: Option<Usage>,
}

impl Stats {
    pub fn summary(&self) -> String {
        let mut parts = Vec::with_capacity(4);
        if let Some(first) = self.first_token {
            parts.push(format!("1º token {}", human(first)));
        }
        parts.push(format!("total {}", human(self.total)));
        if let Some(usage) = self.usage {
            // Sem seta: a fonte padrão do egui não garante U+2192, e um glifo
            // ausente vira um quadrado vazio (como aconteceu com U+25CF).
            parts.push(format!("{} entrada / {} saída", usage.prompt, usage.completion));
            let generating = self
                .total
                .saturating_sub(self.first_token.unwrap_or_default())
                .as_secs_f64();
            if usage.completion > 0 && generating > 0.05 {
                parts.push(format!("{:.0} tok/s", usage.completion as f64 / generating));
            }
        }
        parts.join(" · ")
    }
}

fn human(duration: Duration) -> String {
    if duration.as_millis() < 1000 {
        format!("{} ms", duration.as_millis())
    } else {
        format!("{:.1} s", duration.as_secs_f64())
    }
}

/// Uma linha de SSE do stream de chat.
enum Event {
    Delta(String),
    Usage(Usage),
    Failed(String),
    Done,
    /// Keep-alive, comentário, `role` inicial — nada a mostrar.
    Ignore,
}

/// Interpreta uma linha crua do corpo `text/event-stream`.
fn parse_line(line: &str) -> Event {
    let Some(data) = line.strip_prefix("data:") else {
        return Event::Ignore;
    };
    let data = data.trim();
    if data == "[DONE]" {
        return Event::Done;
    }
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Event::Ignore;
    };
    if let Some(error) = value.get("error") {
        return Event::Failed(error_message(error));
    }
    if let Some(text) = value["choices"][0]["delta"]["content"]
        .as_str()
        .filter(|text| !text.is_empty())
    {
        return Event::Delta(text.to_string());
    }
    match (
        value["usage"]["prompt_tokens"].as_u64(),
        value["usage"]["completion_tokens"].as_u64(),
    ) {
        (Some(prompt), Some(completion)) => Event::Usage(Usage { prompt, completion }),
        _ => Event::Ignore,
    }
}

/// O gateway responde `{error:{message}}`, mas as camadas na frente dele
/// (proxy, middleware) respondem `{error:"texto"}`.
fn error_message(error: &Value) -> String {
    error["message"]
        .as_str()
        .or_else(|| error.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| error.to_string())
}

/// Aceita o que a pessoa colar: com ou sem esquema, com barra no fim, com `/v1`.
pub fn normalize_base(input: &str) -> String {
    let mut url = input.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return url;
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        // localhost sem TLS é o caso normal em dev; o resto assume https.
        let scheme = if url.starts_with("localhost") || url.starts_with("127.0.0.1") {
            "http"
        } else {
            "https"
        };
        url = format!("{scheme}://{url}");
    }
    if let Some(stripped) = url.strip_suffix("/v1") {
        url = stripped.to_string();
    }
    url
}

pub fn agent() -> Result<ureq::Agent, String> {
    let tls = native_tls::TlsConnector::new().map_err(|e| format!("TLS indisponível — {e}"))?;
    Ok(ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout_connect(Duration::from_secs(15))
        // Sem read timeout de propósito: um modelo pode ficar minutos pensando
        // antes do primeiro token.
        .build())
}

/// Erro HTTP com o corpo junto — sem ele, testar um gateway é adivinhação.
fn http_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(code, response) => {
            let body = response.into_string().unwrap_or_default();
            let detail = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| {
                    v.get("error")
                        .map(error_message)
                        .or_else(|| v["message"].as_str().map(str::to_string))
                })
                .unwrap_or_else(|| body.trim().chars().take(400).collect());
            format!("HTTP {code} — {detail}")
        }
        ureq::Error::Transport(transport) => format!("falha de conexão — {transport}"),
    }
}

pub fn list_models(agent: &ureq::Agent, base: &str, key: &str) -> Result<Vec<String>, String> {
    let body: Value = agent
        .get(&format!("{base}/v1/models"))
        .set("Authorization", &format!("Bearer {key}"))
        .call()
        .map_err(http_error)?
        .into_json()
        .map_err(|e| format!("resposta não é JSON — {e}"))?;
    let mut models: Vec<String> = body["data"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|m| m["id"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    models.sort_unstable();
    models.dedup();
    Ok(models)
}

/// Envia a conversa e entrega cada pedaço de texto a `on_delta` conforme chega.
///
/// `cancel` é lido entre linhas: parar não interrompe uma leitura já em curso,
/// por isso a janela descarta o que chegar depois em vez de esperar por isto.
pub fn stream_chat(
    agent: &ureq::Agent,
    base: &str,
    key: &str,
    model: &str,
    messages: &[Value],
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(String),
) -> Result<Stats, String> {
    let started = Instant::now();
    let response = agent
        .post(&format!("{base}/v1/chat/completions"))
        .set("Authorization", &format!("Bearer {key}"))
        .set("Accept", "text/event-stream")
        .send_json(json!({ "model": model, "messages": messages, "stream": true }))
        .map_err(http_error)?;

    let mut stats = Stats { first_token: None, total: Duration::ZERO, usage: None };
    for line in BufReader::new(response.into_reader()).lines() {
        if cancel.load(Ordering::Relaxed) {
            return Err("interrompido".to_string());
        }
        let line = line.map_err(|e| format!("stream interrompido — {e}"))?;
        match parse_line(&line) {
            Event::Delta(text) => {
                stats.first_token.get_or_insert_with(|| started.elapsed());
                on_delta(text);
            }
            Event::Usage(usage) => stats.usage = Some(usage),
            Event::Failed(message) => return Err(message),
            Event::Done => break,
            Event::Ignore => {}
        }
    }
    if stats.first_token.is_none() {
        return Err("o stream terminou sem nenhum texto".to_string());
    }
    stats.total = started.elapsed();
    Ok(stats)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_formas_de_url() {
        assert_eq!(normalize_base("http://localhost:3000/"), "http://localhost:3000");
        assert_eq!(normalize_base("localhost:3000"), "http://localhost:3000");
        assert_eq!(normalize_base("9router-new.vercel.app"), "https://9router-new.vercel.app");
        assert_eq!(
            normalize_base(" https://9router-new.vercel.app/v1/ "),
            "https://9router-new.vercel.app"
        );
        assert_eq!(normalize_base("  "), "");
    }

    #[test]
    fn extrai_delta_de_conteudo() {
        let line = r#"data: {"choices":[{"delta":{"content":"oi"}}]}"#;
        assert!(matches!(parse_line(line), Event::Delta(text) if text == "oi"));
    }

    #[test]
    fn ignora_ruido_do_stream() {
        assert!(matches!(parse_line(""), Event::Ignore));
        assert!(matches!(parse_line(": keep-alive"), Event::Ignore));
        assert!(matches!(parse_line("event: message"), Event::Ignore));
        // O primeiro chunk costuma trazer só o role.
        assert!(matches!(
            parse_line(r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#),
            Event::Ignore
        ));
    }

    #[test]
    fn reconhece_fim_erro_e_uso() {
        assert!(matches!(parse_line("data: [DONE]"), Event::Done));
        let object = r#"data: {"error":{"message":"Invalid API key"}}"#;
        assert!(matches!(parse_line(object), Event::Failed(m) if m == "Invalid API key"));
        let plain = r#"data: {"error":"API key required"}"#;
        assert!(matches!(parse_line(plain), Event::Failed(m) if m == "API key required"));
        let usage = r#"data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":80}}"#;
        assert!(matches!(
            parse_line(usage),
            Event::Usage(Usage { prompt: 12, completion: 80 })
        ));
    }

    #[test]
    fn resume_medidas() {
        let stats = Stats {
            first_token: Some(Duration::from_millis(250)),
            total: Duration::from_millis(2250),
            usage: Some(Usage { prompt: 12, completion: 100 }),
        };
        assert_eq!(stats.summary(), "1º token 250 ms · total 2.2 s · 12 entrada / 100 saída · 50 tok/s");
    }
}
