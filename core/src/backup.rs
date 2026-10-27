//! Backups of everything Job Hunt keeps (the database, your CVs, every application's files and your
//! signature) as one zip file, and restoring from one.
//!
//! A backup is a consistent snapshot taken by the app, so the backup folder can safely be a OneDrive,
//! Google Drive or Synology share. A restore is staged and applied on the next start, before the
//! database is opened, so nothing is half-replaced while Job Hunt is running.

use crate::pipeline::Agent;
use crate::{Error, R};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// Settings that are secrets: kept out of backups unless you choose to include them.
pub const SECRET_KEYS: [&str; 9] = ["claude.key", "google.token", "google.client", "adzuna.key", "jsearch.key", "jooble.key", "apify.key", "remote.password", "remote.sessions"];

/// Files in the data folder that belong to this computer only and are never replaced by a restore.
pub const LOCAL_ONLY: [&str; 2] = ["device.json", "sync-state.json"];

/// Backups kept in the folder; older ones are deleted.
pub const KEEP: usize = 14;

const PREFIX: &str = "JobHunt backup ";
const PENDING: &str = "restore-pending.zip";

/// Where backups go: your chosen folder, or "backups" in the data folder.
pub fn folder(agent: &Agent) -> PathBuf {
    let dir = agent.secret("backup.dir");
    if dir.trim().is_empty() { agent.data.join("backups") } else { PathBuf::from(dir.trim()) }
}

/// Make a backup now. Returns the zip's path.
pub fn create(agent: &Agent) -> R<PathBuf> {
    let dir = folder(agent);
    std::fs::create_dir_all(&dir).map_err(|e| Error(format!("Couldn't use the backup folder {}: {e}", dir.display())))?;
    let stamp = chrono::Local::now().format("%Y-%m-%d %H%M%S").to_string();
    let out = dir.join(format!("{PREFIX}{stamp}.zip"));
    write_snapshot(agent, &out, agent.secret("backup.secrets") == "1")?;
    prune(&dir)?;
    agent.db().set("last.backup", &crate::util::now())?;
    // When you sync with Google Drive, a copy goes there too.
    if let Err(e) = crate::sync::backup_to_drive(agent, &out) {
        let _ = agent.db().log(None, "backup:error", &format!("not copied to Google Drive: {}", e.0));
    }
    Ok(out)
}

/// Everything Job Hunt keeps, as one zip at `out`. Written to a temporary name first and renamed,
/// so a sync tool never copies half a file.
pub fn write_snapshot(agent: &Agent, out: &Path, secrets: bool) -> R<()> {
    let stamp = crate::util::short_hash(&format!("{}{}", out.display(), crate::util::now()));
    let tmp_db = agent.data.join(format!("snapshot-{stamp}.db"));
    let tmp_zip = out.with_extension("zip.part");
    let _ = std::fs::remove_file(&tmp_db);
    agent.db().snapshot(&tmp_db)?;
    let result = (|| {
        if !secrets {
            let snap = crate::db::Db::open(&tmp_db)?;
            for k in SECRET_KEYS {
                snap.delete(k)?;
            }
        }
        let file = std::fs::File::create(&tmp_zip)?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("jobhunt.db", opts)?;
        zip.write_all(&std::fs::read(&tmp_db)?)?;
        for sub in ["cv", "applications"] {
            add_dir(&mut zip, &agent.data, &agent.data.join(sub), opts)?;
        }
        for sig in ["signature.png", "signature.jpeg"] {
            let p = agent.data.join(sig);
            if p.is_file() {
                zip.start_file(sig, opts)?;
                zip.write_all(&std::fs::read(&p)?)?;
            }
        }
        zip.finish()?;
        std::fs::rename(&tmp_zip, out)?;
        Ok::<_, Error>(())
    })();
    for ext in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{ext}", tmp_db.display()));
    }
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_zip);
    }
    result
}

fn add_dir<W: Write + std::io::Seek>(zip: &mut zip::ZipWriter<W>, root: &Path, dir: &Path, opts: zip::write::SimpleFileOptions) -> R<()> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(()) };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            add_dir(zip, root, &p, opts)?;
        } else if p.is_file() {
            let name = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            zip.start_file(name, opts)?;
            zip.write_all(&std::fs::read(&p)?)?;
        }
    }
    Ok(())
}

/// The backups in the folder, newest first: (file name, size in bytes).
pub fn list(dir: &Path) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    (name.starts_with(PREFIX) && name.ends_with(".zip")).then(|| (name, e.metadata().map(|m| m.len()).unwrap_or(0)))
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.0.cmp(&a.0)); // names carry the date and time
    out
}

fn prune(dir: &Path) -> R<()> {
    for (name, _) in list(dir).into_iter().skip(KEEP) {
        let _ = std::fs::remove_file(dir.join(name));
    }
    Ok(())
}

/// Whether a daily backup is due.
pub fn due(agent: &Agent) -> bool {
    match chrono::DateTime::parse_from_rfc3339(&agent.secret("last.backup")) {
        Ok(t) => (chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_hours() >= 24,
        Err(_) => true,
    }
}

/// Check a backup and set it to be restored the next time Job Hunt starts.
pub fn stage_restore(data: &Path, zip_bytes: &[u8]) -> R<()> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).map_err(|_| Error("That isn't a Job Hunt backup (not a zip file).".into()))?;
    let mut head = [0u8; 16];
    z.by_name("jobhunt.db")
        .map_err(|_| Error("That zip isn't a Job Hunt backup (no database in it).".into()))?
        .read_exact(&mut head)
        .map_err(|_| Error("The backup's database is damaged.".into()))?;
    if &head != b"SQLite format 3\0" {
        return Err(Error("The backup's database is damaged.".into()));
    }
    for i in 0..z.len() {
        let f = z.by_index(i)?;
        if f.enclosed_name().is_none() {
            return Err(Error("That backup has unsafe file names, so it wasn't used.".into()));
        }
    }
    std::fs::create_dir_all(data)?;
    std::fs::write(data.join(PENDING), zip_bytes)?;
    Ok(())
}

/// Apply a staged restore. Call before opening the database. The current data is kept in a
/// "before-restore" folder, so a restore can be undone by hand. Returns true if one was applied.
pub fn apply_pending(data: &Path) -> R<bool> {
    let pending = data.join(PENDING);
    if !pending.is_file() {
        return Ok(false);
    }
    let bytes = std::fs::read(&pending)?;
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(&bytes))?;
    let keep = data.join(format!("before-restore {}", chrono::Local::now().format("%Y-%m-%d %H%M%S")));
    std::fs::create_dir_all(&keep)?;
    for name in ["jobhunt.db", "jobhunt.db-wal", "jobhunt.db-shm", "cv", "applications", "signature.png", "signature.jpeg"] {
        let p = data.join(name);
        if p.exists() {
            std::fs::rename(&p, keep.join(name))?;
        }
    }
    for i in 0..z.len() {
        let mut f = z.by_index(i)?;
        let Some(rel) = f.enclosed_name() else { continue };
        let out = data.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut buf = vec![];
        f.read_to_end(&mut buf)?;
        std::fs::write(&out, buf)?;
    }
    std::fs::remove_file(&pending)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::setup;

    #[test]
    fn backup_and_restore_round_trip() {
        let s = setup();
        let dir = tempfile::tempdir().unwrap();
        s.agent.db().set("backup.dir", &dir.path().to_string_lossy()).unwrap();
        s.agent.db().set("claude.key", "sk-secret").unwrap();
        s.agent.search(Some(vec![crate::testkit::posting("Technical Program Manager", "1")])).unwrap();
        assert!(due(&s.agent));

        let zip = create(&s.agent).unwrap();
        assert!(!due(&s.agent), "just backed up");
        assert_eq!(list(dir.path()).len(), 1);
        let bytes = std::fs::read(&zip).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        assert!(z.by_name("jobhunt.db").is_ok());
        assert!((0..z.len()).any(|i| z.by_index(i).unwrap().name().starts_with("cv/")));
        assert!((0..z.len()).any(|i| z.by_index(i).unwrap().name().starts_with("applications/")), "tailored files are in it");

        // Restore into a fresh data folder: the job is there, the key isn't (secrets were left out).
        let fresh = tempfile::tempdir().unwrap();
        assert!(stage_restore(fresh.path(), b"not a zip").is_err());
        stage_restore(fresh.path(), &bytes).unwrap();
        assert!(apply_pending(fresh.path()).unwrap());
        assert!(!apply_pending(fresh.path()).unwrap(), "applied once");
        let db = crate::db::Db::open(&fresh.path().join("jobhunt.db")).unwrap();
        assert!(db.job("test:1").unwrap().is_some());
        assert_eq!(db.get("claude.key").unwrap(), None);
        assert!(fresh.path().join("cv").is_dir());

        // With secrets included, the key travels too.
        s.agent.db().set("backup.secrets", "1").unwrap();
        let zip2 = create(&s.agent).unwrap();
        let again = tempfile::tempdir().unwrap();
        stage_restore(again.path(), &std::fs::read(zip2).unwrap()).unwrap();
        apply_pending(again.path()).unwrap();
        let db2 = crate::db::Db::open(&again.path().join("jobhunt.db")).unwrap();
        assert_eq!(db2.get("claude.key").unwrap().as_deref(), Some("sk-secret"));
    }

    #[test]
    fn old_backups_are_pruned() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..20 {
            std::fs::write(dir.path().join(format!("{PREFIX}2026-01-{:02} 000000.zip", i + 1)), b"x").unwrap();
        }
        prune(dir.path()).unwrap();
        let left = list(dir.path());
        assert_eq!(left.len(), KEEP);
        assert!(left[0].0.contains("2026-01-20"), "newest kept");
    }
}
