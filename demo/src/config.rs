//! O que sobrevive entre execuções.
//!
//! URL e modelo vão para o arquivo de estado do eframe
//! (`%APPDATA%\router-demo\data\app.ron` no Windows). A API key não: ela vai
//! para o cofre do sistema — Credential Manager no Windows, Keychain no macOS,
//! Secret Service no Linux — onde fica cifrada em repouso.

use serde::{Deserialize, Serialize};

const SERVICE: &str = "router-demo";
const ACCOUNT: &str = "api-key";

#[derive(Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub url: String,
    pub model: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self { url: "http://localhost:3000".to_string(), model: String::new() }
    }
}

/// Vazio quando não há key guardada — ou quando o cofre não responde, caso em
/// que a pessoa digita de novo e `save_key` mostra o erro de verdade.
pub fn load_key() -> String {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .and_then(|entry| entry.get_password())
        .unwrap_or_default()
}

pub fn save_key(key: &str) -> Result<(), String> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .and_then(|entry| entry.set_password(key))
        .map_err(|e| format!("a key não foi guardada no cofre do sistema — {e}"))
}
