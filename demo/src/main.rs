// Sem janela de console atrás da janela do app no build de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! Chat de teste para um gateway 9router, com interface nativa.

mod api;
mod app;
mod config;
mod view;

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("9router — chat de teste")
            .with_inner_size([1080.0, 720.0])
            .with_min_inner_size([680.0, 440.0]),
        // Geometria salva é restaurada com o fator de escala errado quando há
        // monitores com DPI diferente: a janela dobrava de tamanho a cada
        // execução (1080×720 → 2239×1440 pontos medidos). Abrir sempre igual.
        persist_window: false,
        centered: true,
        ..Default::default()
    };
    eframe::run_native(
        "router-demo",
        options,
        Box::new(|cc| Ok(Box::new(app::DemoApp::new(cc)?))),
    )
}
