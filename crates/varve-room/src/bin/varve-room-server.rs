//! `varve-room-server` — the self-hosted collaboration room service.
//!
//! One command, one data directory, one process per data directory (the
//! single-owner rule; two processes against one data directory is a
//! documented misconfiguration that will produce divergent rooms).
//!
//! ```text
//! varve-room-server --data-dir /var/lib/varve-rooms --listen 127.0.0.1:8790
//! varve-room-server --data-dir ... --listen 0.0.0.0:443 --expose --admin-token <secret>
//! ```
//!
//! TLS termination belongs to a reverse proxy (documented in
//! docs/architecture/collaboration-system.md); this process speaks plain
//! HTTP/WebSocket by design.

use std::net::SocketAddr;
use std::path::PathBuf;

use varve_room::{HostConfig, RoomHost};

#[tokio::main]
async fn main() {
    let mut data_dir = PathBuf::from("./varve-rooms");
    let mut listen = SocketAddr::from(([127, 0, 0, 1], 8790));
    let mut expose = false;
    let mut admin_token: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--data-dir" => {
                data_dir = PathBuf::from(args.next().unwrap_or_else(|| usage("--data-dir")));
            }
            "--listen" => {
                let value = args.next().unwrap_or_else(|| usage("--listen"));
                listen = value.parse().unwrap_or_else(|_| usage("--listen <addr>"));
            }
            "--expose" => expose = true,
            "--admin-token" => {
                admin_token = Some(args.next().unwrap_or_else(|| usage("--admin-token")));
            }
            "--help" | "-h" => {
                print_help();
                return;
            }
            other => usage(&format!("unknown argument: {other}")),
        }
    }

    if admin_token.is_none() {
        // Generated token, printed once. A restart without --admin-token
        // generates a new one (invalidating prior admin sessions), which is
        // the safe default for loopback operation.
        admin_token = Some(varve_room::token::mint_token());
        eprintln!(
            "admin token (store this; regenerates on restart unless --admin-token is given): {}",
            admin_token.as_deref().unwrap_or("")
        );
    }

    let config = HostConfig {
        allow_non_loopback: expose,
        admin_token,
        ..HostConfig::for_data_dir(data_dir)
    };
    let host = match RoomHost::open(config) {
        Ok(host) => host,
        Err(error) => {
            eprintln!("failed to open the room store: {error}");
            std::process::exit(1);
        }
    };

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let shutdown_for_main = shutdown_rx.clone();
    tokio::spawn(async move {
        let ctrl_c = tokio::signal::ctrl_c();
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            tokio::select! {
                _ = ctrl_c => {},
                _ = term.recv() => {},
            }
        }
        #[cfg(not(unix))]
        {
            let _ = ctrl_c.await;
        }
        // The journal is durable per operation; a restart resumes rooms
        // from snapshot + journal and clients reconnect with backoff.
        let _ = shutdown_tx.send(true);
    });

    if let Err(error) = varve_room::serve(host, listen, shutdown_rx).await {
        eprintln!("failed to start: {error}");
        std::process::exit(1);
    }
    // The signal task above flips the shutdown watch; park until then.
    let mut shutdown_rx2 = shutdown_for_main;
    let _ = shutdown_rx2.wait_for(|stop| *stop).await;
    eprintln!("varve-room-server stopped");
}

fn print_help() {
    println!(
        "varve-room-server — Varve collaboration room host\n\n\
         --data-dir <path>     storage directory (default ./varve-rooms)\n\
         --listen <addr:port>  bind address (default 127.0.0.1:8790; loopback unless --expose)\n\
         --expose              allow non-loopback binds (firewall/TLS configuration is yours)\n\
         --admin-token <t>     admin API token (generated + printed when absent)\n"
    );
}

fn usage(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(2);
}
