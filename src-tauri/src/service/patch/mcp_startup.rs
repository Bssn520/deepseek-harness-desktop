use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

const MCP_INDEX_JS: &str = "node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js";
const READY_ANCHOR: &str = "\tconst outcome = await connection.ready;";
const READY_PATCHED: &str = r#"	// issue #1022: non-strict MCP connections must not block Host readiness.
	if (!config.failOnStartupError) {
		connection.ready.catch((error) => ctx.logger.error(`mcp-client(${config.serverName}): background startup failed: ${String(error)}`));
		return;
	}
	const outcome = await connection.ready;"#;

fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(READY_PATCHED) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains(READY_ANCHOR) {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(source.replacen(READY_ANCHOR, READY_PATCHED, 1))
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, MCP_INDEX_JS, patch_source)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, MCP_INDEX_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readiness_patch_is_idempotent_and_preserves_surrounding_lifecycle() {
        let source = format!("ctx.effect(() => dispose, \"mcp-client.connection\");\n{READY_ANCHOR}\nif (outcome.error !== void 0 && config.failOnStartupError) throw outcome.error;");
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected patch")
        };
        assert_eq!(patched, source.replace(READY_ANCHOR, READY_PATCHED));
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
        assert_eq!(
            patch_source("upstream changed"),
            PatchOutcome::AnchorMissing
        );
    }
}
