//! Estado da janela e o que roda fora da thread de UI.
//!
//! Toda chamada de rede roda numa thread própria e fala com a janela por um
//! canal: a UI nunca espera o gateway. Cada evento leva o id da requisição que
//! o produziu, então o que chega de uma requisição já superada — parada, ou
//! refeita com outra URL — é descartado sem precisar matar a thread.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;

use eframe::egui::{self, Align, Button, Key, Layout, Modifiers, RichText, TextEdit};
use serde_json::{json, Value};

use crate::api::{self, Stats};
use crate::config::{self, Settings};
use crate::view;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

pub struct Message {
    pub role: Role,
    pub text: String,
    /// Medidas já formatadas: a janela redesenha a conversa inteira a cada
    /// quadro, e formatar ali seria refazer o mesmo texto sessenta vezes.
    pub stats: Option<String>,
    pub error: Option<String>,
    /// Entra no histórico enviado ao modelo. Uma pergunta cuja resposta falhou
    /// continua na tela, mas não volta para o modelo.
    in_context: bool,
}

impl Message {
    fn new(role: Role, text: String, in_context: bool) -> Self {
        Self { role, text, stats: None, error: None, in_context }
    }
}

enum Connection {
    Idle,
    Connecting,
    Ready,
    Failed(String),
}

enum WorkerEvent {
    Models(Result<Vec<String>, String>),
    KeyNotSaved(String),
    Delta(String),
    Finished(Result<Stats, String>),
}

pub struct DemoApp {
    settings: Settings,
    key: String,
    show_key: bool,
    connection: Connection,
    key_warning: Option<String>,
    models: Vec<String>,
    model_filter: String,
    messages: Vec<Message>,
    input: String,
    agent: ureq::Agent,
    tx: Sender<(u64, WorkerEvent)>,
    rx: Receiver<(u64, WorkerEvent)>,
    connect_id: u64,
    chat_id: u64,
    streaming: bool,
    cancel: Arc<AtomicBool>,
}

impl DemoApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Result<Self, String> {
        view::apply_theme(&cc.egui_ctx);
        let settings: Settings = cc
            .storage
            .and_then(|storage| eframe::get_value(storage, eframe::APP_KEY))
            .unwrap_or_default();
        let (tx, rx) = channel();
        let mut app = Self {
            settings,
            key: config::load_key(),
            show_key: false,
            connection: Connection::Idle,
            key_warning: None,
            models: Vec::new(),
            model_filter: String::new(),
            messages: Vec::new(),
            input: String::new(),
            agent: api::agent()?,
            tx,
            rx,
            connect_id: 0,
            chat_id: 0,
            streaming: false,
            cancel: Arc::new(AtomicBool::new(false)),
        };
        // Com URL e key guardadas, a janela abre já conectada.
        if !app.settings.url.is_empty() && !app.key.is_empty() {
            app.connect(&cc.egui_ctx);
        }
        Ok(app)
    }

    fn connect(&mut self, ctx: &egui::Context) {
        self.settings.url = api::normalize_base(&self.settings.url);
        self.key = self.key.trim().to_string();
        self.key_warning = None;
        if self.settings.url.is_empty() || self.key.is_empty() {
            self.connection = Connection::Failed("informe a URL e a API key".to_string());
            return;
        }
        self.connect_id += 1;
        self.connection = Connection::Connecting;
        let (id, tx, ctx) = (self.connect_id, self.tx.clone(), ctx.clone());
        let (agent, base, key) = (self.agent.clone(), self.settings.url.clone(), self.key.clone());
        std::thread::spawn(move || {
            let result = api::list_models(&agent, &base, &key);
            // Só vai para o cofre uma key que o gateway aceitou.
            if result.is_ok() {
                if let Err(warning) = config::save_key(&key) {
                    let _ = tx.send((id, WorkerEvent::KeyNotSaved(warning)));
                }
            }
            let _ = tx.send((id, WorkerEvent::Models(result)));
            ctx.request_repaint();
        });
    }

    fn can_send(&self) -> bool {
        !self.streaming
            && !self.input.trim().is_empty()
            && !self.settings.model.is_empty()
            && !self.key.trim().is_empty()
    }

    fn send(&mut self, ctx: &egui::Context) {
        if !self.can_send() {
            return;
        }
        let text = std::mem::take(&mut self.input).trim().to_string();
        self.messages.push(Message::new(Role::User, text, true));
        let history: Vec<Value> = self
            .messages
            .iter()
            .filter(|m| m.in_context)
            .map(|m| {
                let role = if m.role == Role::User { "user" } else { "assistant" };
                json!({ "role": role, "content": m.text })
            })
            .collect();
        self.messages.push(Message::new(Role::Assistant, String::new(), false));

        self.chat_id += 1;
        self.streaming = true;
        self.cancel = Arc::new(AtomicBool::new(false));
        let (id, tx, ctx, cancel) = (self.chat_id, self.tx.clone(), ctx.clone(), self.cancel.clone());
        let agent = self.agent.clone();
        let base = api::normalize_base(&self.settings.url);
        let (key, model) = (self.key.trim().to_string(), self.settings.model.clone());
        std::thread::spawn(move || {
            let result = api::stream_chat(&agent, &base, &key, &model, &history, &cancel, |text| {
                let _ = tx.send((id, WorkerEvent::Delta(text)));
                ctx.request_repaint();
            });
            let _ = tx.send((id, WorkerEvent::Finished(result)));
            ctx.request_repaint();
        });
    }

    fn stop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        // O que ainda chegar daquela thread tem o id antigo e é descartado.
        self.chat_id += 1;
        self.streaming = false;
        settle_last(&mut self.messages, Err("interrompido".to_string()));
    }

    fn drain_events(&mut self) {
        while let Ok((id, event)) = self.rx.try_recv() {
            match event {
                WorkerEvent::Models(result) if id == self.connect_id => match result {
                    Ok(models) => {
                        if !models.contains(&self.settings.model) {
                            self.settings.model = models.first().cloned().unwrap_or_default();
                        }
                        self.models = models;
                        self.connection = Connection::Ready;
                    }
                    Err(error) => self.connection = Connection::Failed(error),
                },
                WorkerEvent::KeyNotSaved(warning) if id == self.connect_id => {
                    self.key_warning = Some(warning);
                }
                WorkerEvent::Delta(text) if id == self.chat_id && self.streaming => {
                    if let Some(answer) = self.messages.last_mut() {
                        answer.text.push_str(&text);
                    }
                }
                WorkerEvent::Finished(result) if id == self.chat_id && self.streaming => {
                    self.streaming = false;
                    settle_last(&mut self.messages, result);
                }
                _ => {}
            }
        }
    }

    fn sidebar(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.add_space(4.0);
        ui.label(RichText::new("9router").size(24.0).strong().color(view::ACCENT));
        ui.label(RichText::new("chat de teste do gateway").color(view::MUTED));
        ui.add_space(18.0);

        view::section(ui, "CONEXÃO");
        ui.label("URL do gateway");
        let url = ui.add(
            TextEdit::singleline(&mut self.settings.url)
                .hint_text("http://localhost:3000")
                .desired_width(f32::INFINITY),
        );
        ui.add_space(4.0);
        ui.label("API key");
        let key = ui
            .horizontal(|ui| {
                let toggle = if self.show_key { "ocultar" } else { "mostrar" };
                let field = ui.add(
                    TextEdit::singleline(&mut self.key)
                        .password(!self.show_key)
                        .hint_text("sk-…")
                        .desired_width(ui.available_width() - 72.0),
                );
                if ui.add_sized([64.0, 28.0], Button::new(toggle)).clicked() {
                    self.show_key = !self.show_key;
                }
                field
            })
            .inner;
        ui.add_space(6.0);

        let pressed_enter = (url.lost_focus() || key.lost_focus())
            && ui.ctx().input(|i| i.key_pressed(Key::Enter));
        let connecting = matches!(self.connection, Connection::Connecting);
        let label = if connecting { "Conectando…" } else { "Conectar" };
        let clicked = ui
            .add_enabled_ui(!connecting, |ui| {
                ui.add_sized([ui.available_width(), 34.0], view::primary_button(label))
            })
            .inner
            .clicked();
        if (clicked || pressed_enter) && !connecting {
            self.connect(ctx);
        }

        match &self.connection {
            Connection::Idle => {}
            Connection::Connecting => {
                ui.horizontal(|ui| {
                    ui.spinner();
                    ui.label(RichText::new("buscando modelos…").color(view::MUTED));
                });
            }
            Connection::Ready => {
                // Sem glifo de bolinha: a fonte padrão do egui não tem U+25CF e
                // desenhava um quadrado vazio.
                let text = format!("conectado · {} modelos", self.models.len());
                ui.label(RichText::new(text).color(view::ACCENT));
            }
            Connection::Failed(error) => {
                ui.label(RichText::new(error).color(view::DANGER));
            }
        }
        if let Some(warning) = &self.key_warning {
            ui.label(RichText::new(warning).small().color(view::MUTED));
        }

        ui.add_space(20.0);
        view::section(ui, "MODELO");
        self.model_picker(ui);

        ui.add_space(20.0);
        if ui
            .add_enabled(!self.messages.is_empty(), Button::new("Nova conversa").min_size([0.0, 30.0].into()))
            .clicked()
        {
            if self.streaming {
                self.stop();
            }
            self.messages.clear();
        }

        ui.with_layout(Layout::bottom_up(Align::LEFT), |ui| {
            ui.label(RichText::new("Enter envia · Shift+Enter quebra linha").small().color(view::MUTED));
        });
    }

    fn model_picker(&mut self, ui: &mut egui::Ui) {
        if self.models.is_empty() {
            ui.add(
                TextEdit::singleline(&mut self.settings.model)
                    .hint_text("conecte para listar, ou digite")
                    .desired_width(f32::INFINITY),
            );
            return;
        }
        let selected = if self.settings.model.is_empty() { "escolha um modelo" } else { &self.settings.model };
        egui::ComboBox::from_id_salt("modelo")
            .selected_text(selected.to_string())
            .width(ui.available_width())
            .height(380.0)
            .show_ui(ui, |ui| {
                ui.add(TextEdit::singleline(&mut self.model_filter).hint_text("filtrar…"));
                let filter = self.model_filter.to_lowercase();
                for model in &self.models {
                    if filter.is_empty() || model.to_lowercase().contains(&filter) {
                        ui.selectable_value(&mut self.settings.model, model.clone(), model);
                    }
                }
            });
    }

    fn composer(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let id = egui::Id::new("composer");
        // Consumido antes do TextEdit ver a tecla, senão ele insere a quebra.
        let enter = ui.ctx().memory(|m| m.has_focus(id))
            && ui.ctx().input_mut(|i| i.consume_key(Modifiers::NONE, Key::Enter));

        ui.horizontal(|ui| {
            let hint = if self.settings.model.is_empty() {
                "Conecte e escolha um modelo para começar"
            } else {
                "Mensagem…"
            };
            ui.add(
                TextEdit::multiline(&mut self.input)
                    .id(id)
                    .hint_text(hint)
                    .desired_rows(2)
                    .desired_width(ui.available_width() - 104.0),
            );
            if self.streaming {
                if ui.add_sized([96.0, 44.0], Button::new("Parar")).clicked() {
                    self.stop();
                }
            } else {
                let can_send = self.can_send();
                let clicked = ui
                    .add_enabled_ui(can_send, |ui| ui.add_sized([96.0, 44.0], view::primary_button("Enviar")))
                    .inner
                    .clicked();
                if clicked {
                    self.send(ctx);
                    ui.ctx().memory_mut(|m| m.request_focus(id));
                }
            }
        });
        if enter {
            self.send(ctx);
        }
    }

    fn conversation(&mut self, ui: &mut egui::Ui) {
        if self.messages.is_empty() {
            view::empty_state(ui);
            return;
        }
        egui::ScrollArea::vertical()
            .stick_to_bottom(true)
            .auto_shrink(false)
            .show(ui, |ui| {
                // ponytail: a conversa inteira é diagramada a cada quadro (o egui
                // guarda o layout do texto em cache). Virtualizar com
                // `show_viewport` se conversas de milhares de mensagens importarem.
                let last = self.messages.len() - 1;
                for (index, message) in self.messages.iter().enumerate() {
                    view::message(ui, message, self.streaming && index == last);
                    ui.add_space(10.0);
                }
            });
    }
}

/// Fecha a última resposta com o resultado do worker.
fn settle_last(messages: &mut [Message], result: Result<Stats, String>) {
    let Some((answer, earlier)) = messages.split_last_mut() else {
        return;
    };
    match result {
        Ok(stats) => {
            answer.stats = Some(stats.summary());
            answer.in_context = true;
        }
        Err(error) => {
            // Um pedaço de resposta ainda é contexto útil. Nenhuma resposta não
            // é, e a pergunta sozinha repetiria a chamada que acabou de falhar.
            answer.in_context = !answer.text.is_empty();
            if !answer.in_context {
                if let Some(question) = earlier.last_mut() {
                    question.in_context = false;
                }
            }
            answer.error = Some(error);
        }
    }
}

impl eframe::App for DemoApp {
    fn logic(&mut self, _ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.drain_events();
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();
        egui::Panel::left("conexao")
            .resizable(true)
            .default_size(300.0)
            .size_range(260.0..=460.0)
            .frame(view::panel_frame())
            .show(ui,|ui| self.sidebar(ui, &ctx));
        egui::Panel::bottom("composer")
            .frame(view::composer_frame())
            .show(ui,|ui| self.composer(ui, &ctx));
        egui::CentralPanel::default()
            .frame(view::conversation_frame())
            .show(ui,|ui| self.conversation(ui));
    }

    fn save(&mut self, storage: &mut dyn eframe::Storage) {
        eframe::set_value(storage, eframe::APP_KEY, &self.settings);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exchange(answer: &str) -> Vec<Message> {
        vec![
            Message::new(Role::User, "oi".to_string(), true),
            Message::new(Role::Assistant, answer.to_string(), false),
        ]
    }

    #[test]
    fn falha_sem_texto_tira_a_pergunta_do_contexto() {
        let mut messages = exchange("");
        settle_last(&mut messages, Err("HTTP 500".to_string()));
        assert!(!messages[0].in_context);
        assert!(!messages[1].in_context);
        assert_eq!(messages[1].error.as_deref(), Some("HTTP 500"));
    }

    #[test]
    fn resposta_parcial_interrompida_continua_no_contexto() {
        let mut messages = exchange("meia resp");
        settle_last(&mut messages, Err("interrompido".to_string()));
        assert!(messages[0].in_context);
        assert!(messages[1].in_context);
    }
}
