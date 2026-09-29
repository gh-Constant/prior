fn main() {
    // macOS widgets share data through an App Group. Outside the Mac App Store
    // the group must be prefixed with the Developer ID team, otherwise macOS
    // denies the sandboxed widget access to the container and it shows no data.
    println!("cargo:rerun-if-env-changed=APPLE_TEAM_ID");
    let group = match std::env::var("APPLE_TEAM_ID") {
        Ok(team) if !team.trim().is_empty() => format!("{}.fr.constantsuchet.prior", team.trim()),
        _ => "group.fr.constantsuchet.prior".to_string(),
    };
    println!("cargo:rustc-env=PRIOR_APP_GROUP={group}");
    tauri_build::build()
}
