//! 官方调度层必须先插入条目，桌面调度层的禁用补丁才能命中；共享加载入口也覆盖热重载。

use std::path::Path;

use crate::utils::{patch_core_file, patch_dsh, PatchOutcome};

const APP_BOOT_JS: &str = "node_modules/@deepseek-ai/dsh-app-boot/lib/index.js";
const BUNDLE_LOOP: &str = "\tfor (const packageName of bundles) try {";
const PATCH_MARKER: &str = "const dshTauriOrderedBundles = [...bundles];";
const ORDERED_LOOP: &str = r#"	const dshTauriOrderedBundles = [...bundles];
	const dshTauriSchedulerIndex = dshTauriOrderedBundles.indexOf("dsh-tauri-scheduler");
	const dshOfficialScheduleIndex = dshTauriOrderedBundles.indexOf("@deepseek-ai/dsh-experimental-schedule-bundle");
	if (dshTauriSchedulerIndex >= 0 && dshOfficialScheduleIndex > dshTauriSchedulerIndex) {
		dshTauriOrderedBundles.splice(dshTauriSchedulerIndex, 0, ...dshTauriOrderedBundles.splice(dshOfficialScheduleIndex, 1));
	}
	for (const packageName of dshTauriOrderedBundles) try {"#;

fn patch_source(source: &str) -> PatchOutcome {
    if source.contains(PATCH_MARKER) {
        return PatchOutcome::AlreadyPatched;
    }
    if !source.contains("function loadProfileDirectory(")
        || source.matches(BUNDLE_LOOP).count() != 1
    {
        return PatchOutcome::AnchorMissing;
    }
    PatchOutcome::Patched(source.replacen(BUNDLE_LOOP, ORDERED_LOOP, 1))
}

pub fn apply_at(core_dir: &Path) -> Result<(), String> {
    patch_core_file(core_dir, APP_BOOT_JS, patch_source)
}

pub fn apply(app_handle: &tauri::AppHandle) -> Result<(), String> {
    patch_dsh(app_handle, APP_BOOT_JS, patch_source)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_bundle_loop_once_and_preserves_other_source() {
        let source = format!("function loadProfileDirectory() {{\n{BUNDLE_LOOP}\n}}\n");
        let PatchOutcome::Patched(patched) = patch_source(&source) else {
            panic!("expected patched profile loader");
        };
        assert_eq!(
            patched,
            format!("function loadProfileDirectory() {{\n{ORDERED_LOOP}\n}}\n")
        );
        assert_eq!(patch_source(&patched), PatchOutcome::AlreadyPatched);
    }

    #[test]
    fn skips_missing_or_ambiguous_bundle_loop() {
        for source in [
            String::new(),
            BUNDLE_LOOP.to_owned(),
            "function loadProfileDirectory() {}".to_owned(),
            format!("function loadProfileDirectory() {{\n{BUNDLE_LOOP}\n{BUNDLE_LOOP}\n}}"),
        ] {
            assert_eq!(patch_source(&source), PatchOutcome::AnchorMissing);
        }
    }
}
