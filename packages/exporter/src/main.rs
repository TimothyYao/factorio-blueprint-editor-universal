use hyper::service::service_fn;
use hyper_staticfile::Static;
use hyper_util::rt::TokioIo;
use std::path::Path;
use std::path::PathBuf;
use tokio::net::TcpListener;

mod browser;
mod setup;

#[macro_use]
extern crate lazy_static;

static FACTORIO_VERSION: &str = "2.0.76";

lazy_static! {
    static ref DATA_DIR: PathBuf = PathBuf::from("./data");
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv()?;

    // Which pack to (re)generate. `--pack <id>` (or `--pack=<id>`) selects an
    // entry from data/output/packs.json; without it we fall back to the
    // manifest's `default: true` pack (vanilla-2.0). The pack's `mods` list
    // drives the generated mod-list.json, and the dump lands in
    // data/output/<id>/ alongside the other packs.
    let pack_arg = parse_pack_arg();
    // `--browser-only` skips the (long) editor atlas build but still runs setup /
    // download / mod-install (cached, and the dumps need the install) and the
    // browser step. `--skip-browser` is the inverse escape hatch: editor pipeline
    // only, no dump runs — the browser step's --dump-icon-sprites needs a
    // graphics backend, which a headless editor-only regen shouldn't have to
    // provide. A plain run does both.
    let browser_only = has_flag("--browser-only");
    let skip_browser = has_flag("--skip-browser");
    if browser_only && skip_browser {
        return Err("--browser-only and --skip-browser are mutually exclusive".into());
    }
    let packs_path = DATA_DIR.join("output").join("packs.json");
    let packs = setup::read_packs(&packs_path).await?;
    let pack = setup::select_pack(&packs, pack_arg.as_deref())?;
    let all_mods = setup::all_known_mods(&packs);
    println!(
        "Exporting pack '{}' (mods: {})",
        pack.id,
        pack.mods.join(", ")
    );

    let factorio_dir_name = match std::env::consts::OS {
        "linux" => "factorio",
        "windows" => &format!("Factorio_{FACTORIO_VERSION}"),
        _ => panic!("unsupported OS"),
    };
    let output_dir = DATA_DIR.join("output").join(&pack.id);
    let base_factorio_dir = DATA_DIR.join(factorio_dir_name);

    setup::download_factorio(&DATA_DIR, &base_factorio_dir, FACTORIO_VERSION, pack).await?;
    // After the game download — a build re-download wipes the install (and the
    // mods/ dir with it); portal mods then reinstall from the zip cache.
    setup::download_portal_mods(&DATA_DIR, &base_factorio_dir, pack).await?;
    if browser_only {
        // Skip the editor atlas build, but still put the export-data mod +
        // mod-list.json in place so the dump runs load exactly this pack's mods.
        setup::prepare_export_data_mod(&base_factorio_dir, pack, &all_mods).await?;
    } else {
        setup::extract(&output_dir, &base_factorio_dir, pack, &all_mods).await?;
    }
    // The browser artifact (catalog.json + icons) is produced unless skipped.
    if !skip_browser {
        browser::run_browser(
            &output_dir,
            &base_factorio_dir,
            pack,
            &all_mods,
            &packs_path,
        )
        .await?;
    }

    let static_ = Static::new(Path::new("data/output/"));

    let listener = TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], 8081))).await?;

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);

        let static_ = static_.clone();
        tokio::spawn(async move {
            if let Err(err) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service_fn(|req| static_.clone().serve(req)))
                .await
            {
                eprintln!("Error serving connection: {}", err);
            }
        });
    }
}

/// Whether a bare flag (e.g. `--browser-only`) is present in argv.
fn has_flag(flag: &str) -> bool {
    std::env::args().skip(1).any(|arg| arg == flag)
}

/// Parse `--pack <id>` / `--pack=<id>` from argv; returns `None` when absent.
fn parse_pack_arg() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--pack" {
            return args.next();
        }
        if let Some(value) = arg.strip_prefix("--pack=") {
            return Some(value.to_string());
        }
    }
    None
}
