fn main() {
    // tauri-build's default manifest (Common Controls v6) reaches only the app exe; test binaries
    // got none, so a v6-only import such as TaskDialogIndirect (tauri's window menus) killed them at
    // load with STATUS_ENTRYPOINT_NOT_FOUND. The same manifest is linked into every target instead.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        return tauri_build::build();
    }
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest();
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("tauri build");
}
