// Prevents an additional console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    if std::env::args().nth(1).as_deref() == Some("--validate-policy") {
        unsafe { windows_sys::Win32::System::Console::AttachConsole(u32::MAX); }
    }
    if let Some(code) = varve_desktop_lib::validate_policy_cli() {
        std::process::exit(code);
    }
    varve_desktop_lib::run()
}
