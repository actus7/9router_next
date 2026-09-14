//! Aparência: paleta, tema e o balão de mensagem.
//!
//! Um tema escuro só, de propósito — é uma ferramenta de teste, não um produto
//! com preferência de usuário.

use eframe::egui::{
    self, Align, Button, Color32, CornerRadius, FontId, Frame, Label, Layout, Margin, RichText, Stroke,
    TextStyle, Theme,
};

use crate::app::{Message, Role};

pub const BG: Color32 = Color32::from_rgb(0x0d, 0x0f, 0x13);
pub const PANEL: Color32 = Color32::from_rgb(0x13, 0x16, 0x1c);
pub const SURFACE: Color32 = Color32::from_rgb(0x1a, 0x1e, 0x26);
pub const BORDER: Color32 = Color32::from_rgb(0x29, 0x2e, 0x39);
pub const TEXT: Color32 = Color32::from_rgb(0xe7, 0xe9, 0xee);
pub const MUTED: Color32 = Color32::from_rgb(0x8f, 0x97, 0xaa);
pub const ACCENT: Color32 = Color32::from_rgb(0x46, 0xd9, 0xa4);
pub const DANGER: Color32 = Color32::from_rgb(0xf2, 0x70, 0x70);
const USER_BUBBLE: Color32 = Color32::from_rgb(0x17, 0x33, 0x2b);
const USER_BORDER: Color32 = Color32::from_rgb(0x24, 0x52, 0x44);

pub fn apply_theme(ctx: &egui::Context) {
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = PANEL;
    visuals.window_fill = SURFACE;
    visuals.window_stroke = Stroke::new(1.0, BORDER);
    visuals.extreme_bg_color = BG;
    visuals.faint_bg_color = SURFACE;
    visuals.hyperlink_color = ACCENT;
    visuals.selection.bg_fill = Color32::from_rgb(0x1c, 0x5a, 0x46);
    visuals.selection.stroke = Stroke::new(1.0, ACCENT);
    visuals.widgets.noninteractive.fg_stroke = Stroke::new(1.0, TEXT);
    visuals.widgets.noninteractive.bg_stroke = Stroke::new(1.0, BORDER);
    visuals.widgets.inactive.weak_bg_fill = SURFACE;
    visuals.widgets.inactive.bg_fill = SURFACE;
    visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, BORDER);
    visuals.widgets.hovered.weak_bg_fill = Color32::from_rgb(0x22, 0x27, 0x31);
    visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, USER_BORDER);
    for widget in [
        &mut visuals.widgets.inactive,
        &mut visuals.widgets.hovered,
        &mut visuals.widgets.active,
        &mut visuals.widgets.open,
    ] {
        widget.corner_radius = CornerRadius::same(7);
    }

    ctx.set_theme(Theme::Dark);
    ctx.set_visuals_of(Theme::Dark, visuals);
    ctx.style_mut_of(Theme::Dark, |style| {
        style.spacing.item_spacing = egui::vec2(8.0, 6.0);
        style.spacing.button_padding = egui::vec2(12.0, 6.0);
        style.text_styles.insert(TextStyle::Body, FontId::proportional(14.5));
        style.text_styles.insert(TextStyle::Button, FontId::proportional(14.0));
    });
}

pub fn panel_frame() -> Frame {
    Frame::new().fill(PANEL).inner_margin(Margin::same(18))
}

pub fn composer_frame() -> Frame {
    Frame::new().fill(PANEL).inner_margin(Margin::symmetric(20, 14))
}

pub fn conversation_frame() -> Frame {
    Frame::new().fill(BG).inner_margin(Margin::symmetric(28, 18))
}

pub fn section(ui: &mut egui::Ui, title: &str) {
    ui.label(RichText::new(title).size(11.0).strong().color(MUTED));
    ui.add_space(2.0);
}

pub fn primary_button(label: &str) -> Button<'static> {
    Button::new(RichText::new(label).strong().color(BG)).fill(ACCENT)
}

pub fn empty_state(ui: &mut egui::Ui) {
    ui.centered_and_justified(|ui| {
        ui.label(
            RichText::new("Nenhuma mensagem ainda.\nConecte ao gateway, escolha um modelo e mande a primeira.")
                .color(MUTED),
        );
    });
}

pub fn message(ui: &mut egui::Ui, message: &Message, pending: bool) {
    let from_user = message.role == Role::User;
    let layout = if from_user { Layout::right_to_left(Align::TOP) } else { Layout::left_to_right(Align::TOP) };
    let (fill, border) = match (from_user, message.error.is_some()) {
        (_, true) => (SURFACE, DANGER),
        (true, false) => (USER_BUBBLE, USER_BORDER),
        (false, false) => (SURFACE, BORDER),
    };
    ui.with_layout(layout, |ui| {
        let max_width = (ui.available_width() * 0.8).max(260.0);
        Frame::new()
            .fill(fill)
            .stroke(Stroke::new(1.0, border))
            .corner_radius(CornerRadius::same(12))
            .inner_margin(Margin::symmetric(14, 10))
            .show(ui, |ui| {
                ui.set_max_width(max_width);
                ui.with_layout(Layout::top_down(Align::LEFT), |ui| body(ui, message, pending));
            });
    });
}

fn body(ui: &mut egui::Ui, message: &Message, pending: bool) {
    if message.text.is_empty() && pending {
        ui.horizontal(|ui| {
            ui.spinner();
            ui.label(RichText::new("aguardando o primeiro token…").color(MUTED));
        });
    } else if !message.text.is_empty() {
        ui.add(Label::new(RichText::new(message.text.as_str()).color(TEXT)).wrap());
    }
    if let Some(error) = &message.error {
        ui.label(RichText::new(error).color(DANGER));
    }
    if message.role == Role::Assistant && !pending && !message.text.is_empty() {
        ui.horizontal(|ui| {
            if let Some(stats) = &message.stats {
                ui.label(RichText::new(stats).monospace().size(11.5).color(MUTED));
            }
            if ui.small_button("copiar").clicked() {
                ui.ctx().copy_text(message.text.clone());
            }
        });
    }
}
