// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = varve_desktop_lib::validate_policy_cli() {
        std::process::exit(code);
    }
    varve_desktop_lib::run()
}
