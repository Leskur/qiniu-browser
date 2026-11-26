/// The Windows titlebar is rendered by WindowTitlebar using the sidebar palette.
#[cfg(windows)]
pub(crate) fn configure_titlebar(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.set_decorations(false)?;
    window.set_shadow(true)?;
    Ok(())
}
