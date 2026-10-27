//! Small text helpers shared by the rest of the core.

use once_cell::sync::Lazy;
use regex::Regex;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// 85000 as "85,000".
/// When a usage limit resets, in this computer's own time and as a wait, so it reads the same
/// everywhere: "at 9:00 AM (in about 3 hours)".
pub fn reset_time(at: chrono::DateTime<chrono::Utc>, now: chrono::DateTime<chrono::Utc>) -> String {
    let mins = (at - now).num_minutes().max(1);
    let wait = match mins {
        m if m < 60 => format!("{m} minute{}", if m == 1 { "" } else { "s" }),
        m if m < 90 => "an hour".to_string(),
        m if m < 36 * 60 => format!("{} hours", (m + 30) / 60),
        m => format!("{} days", (m + 720) / 1440),
    };
    let day = if at.with_timezone(&chrono::Local).date_naive() == now.with_timezone(&chrono::Local).date_naive() { "" } else { " %a" };
    format!("at {} (in about {wait})", at.with_timezone(&chrono::Local).format(&format!("%-I:%M %p{day}")))
}

pub fn thousands(n: i64) -> String {
    let d = n.abs().to_string();
    let mut out = String::new();
    for (i, c) in d.chars().enumerate() {
        if i > 0 && (d.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 { format!("-{out}") } else { out }
}

/// Readable plain text from job-board HTML (lists become "- " lines, entities decoded).
pub fn html_to_text(raw: &str) -> String {
    static BREAKS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<(br|/p|/li|/h\d|/div)[^>]*>").unwrap());
    static ITEMS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)<li[^>]*>").unwrap());
    static TAGS: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").unwrap());
    static SPACES: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]+").unwrap());
    static GAPS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n\s*\n+").unwrap());
    // Greenhouse escapes its HTML once more ("&lt;p&gt;…"), so decode that first. Not otherwise:
    // "&lt; 5 years" in real HTML is text, and decoding it early would make it look like a tag.
    let text = if !raw.contains('<') && raw.contains("&lt;") { unescape(raw) } else { raw.to_string() };
    let text = BREAKS.replace_all(&text, "\n");
    let text = ITEMS.replace_all(&text, "\n- ");
    let text = TAGS.replace_all(&text, "");
    let text = unescape(&text);
    let text = SPACES.replace_all(&text, " ");
    GAPS.replace_all(&text, "\n\n").trim().to_string()
}

/// Decode XML/HTML character references.
pub fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    static ENT: Lazy<Regex> = Lazy::new(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);").unwrap());
    ENT.replace_all(s, |c: &regex::Captures| {
        let e = &c[1];
        let ch = if let Some(h) = e.strip_prefix("#x") {
            u32::from_str_radix(h, 16).ok().and_then(char::from_u32)
        } else if let Some(d) = e.strip_prefix('#') {
            d.parse::<u32>().ok().and_then(char::from_u32)
        } else {
            match e {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                "ndash" => Some('–'),
                "mdash" => Some('—'),
                "rsquo" | "lsquo" => Some('\''),
                "rdquo" | "ldquo" => Some('"'),
                "bull" => Some('•'),
                "hellip" => Some('…'),
                _ => None,
            }
        };
        ch.map(|c| c.to_string()).unwrap_or_else(|| c[0].to_string())
    })
    .into_owned()
}

/// Escape text for an XML text node.
pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// "Senior TPM, Payments" at "Big Bank" -> "big-bank-senior-tpm-payments"
pub fn slug(s: &str, max: usize) -> String {
    let mut out = String::new();
    for c in s.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out = out.trim_matches('-');
    out.chars().take(max).collect::<String>().trim_end_matches('-').to_string()
}

/// A short stable id from any text.
pub fn short_hash(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(s.as_bytes());
    d.iter().take(6).map(|b| format!("{b:02x}")).collect()
}

/// Standard base64, for callers without the base64 crate (the desktop app).
pub fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Where your files are (CVs, tailored applications, backups): the folder named in the data
/// folder's files-folder.txt, chosen at setup or in Settings, or the data folder itself.
pub fn files_dir(data: &std::path::Path) -> std::path::PathBuf {
    std::fs::read_to_string(data.join(FILES_POINTER)).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        .map(std::path::PathBuf::from).unwrap_or_else(|| data.to_path_buf())
}
pub const FILES_POINTER: &str = "files-folder.txt";

/// Words for a file name as people write them ("Ibrahim Al-Taha", "Smith & Co."): only the characters
/// Windows doesn't allow in file names become spaces, runs of spaces become one, and no dot ends it.
pub fn file_words(s: &str) -> String {
    let w: String = s.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { ' ' } else { c }).collect();
    w.split_whitespace().collect::<Vec<_>>().join(" ").trim_end_matches(['.', ' ']).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html() {
        let raw = "&lt;p&gt;Lead &lt;b&gt;delivery&lt;/b&gt;.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;UAT &amp;amp; release&lt;/li&gt;&lt;/ul&gt;";
        assert_eq!(html_to_text(raw), "Lead delivery.\n\n- UAT & release");
    }

    #[test]
    fn pdf_follows_word_edits() {
        let dir = std::env::temp_dir().join(format!("jh-pdf-{}", short_hash(&now())));
        std::fs::create_dir_all(&dir).unwrap();
        let docx = dir.join("CV.docx");
        std::fs::write(&docx, "word").unwrap();
        assert!(pdf_stale(&docx), "no PDF yet");
        std::fs::write(dir.join("CV.pdf"), "pdf").unwrap();
        assert!(!pdf_stale(&docx));
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(60);
        std::fs::File::options().write(true).open(&docx).unwrap().set_modified(later).unwrap();
        assert!(pdf_stale(&docx), "changed in Word after the PDF was made");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn helpers() {
        assert_eq!(slug("Big Bank  Senior TPM, Payments!", 60), "big-bank-senior-tpm-payments");
        assert_eq!(file_words("Mary-Jane  O'Neil"), "Mary-Jane O'Neil");
        assert_eq!(file_words("Smith/Jones: Tax & Co."), "Smith Jones Tax & Co");
        assert_eq!(unescape("A &amp; B &#8211; &#x2019;"), "A & B – \u{2019}");
        assert_eq!(escape("a<b & c"), "a&lt;b &amp; c");
    }
}

/// Whether the PDF next to a Word file is missing or older than it (you changed it in Word).
pub fn pdf_stale(docx: &std::path::Path) -> bool {
    let modified = |p: &std::path::Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
    match (modified(docx), modified(&docx.with_extension("pdf"))) {
        (Some(d), Some(p)) => p < d,
        (_, None) => true,
        (None, Some(_)) => false,
    }
}

/// The PDF of a Word file, made again first when the Word file changed since.
pub fn pdf_of(docx: &std::path::Path) -> crate::R<std::path::PathBuf> {
    if pdf_stale(docx) {
        return docx_to_pdf(docx);
    }
    Ok(docx.with_extension("pdf"))
}

/// Save a PDF copy next to a Word file (same name, .pdf) using Microsoft Word, or LibreOffice when Word
/// isn't installed. Returns the PDF's path; an error means neither is available or the conversion failed.
pub fn docx_to_pdf(docx: &std::path::Path) -> crate::R<std::path::PathBuf> {
    use std::process::{Command, Stdio};
    let pdf = docx.with_extension("pdf");
    if cfg!(test) {
        return Err(crate::Error("no PDFs in tests".into()));
    }
    let _ = std::fs::remove_file(&pdf);
    let hide = |c: &mut Command| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        c.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    };
    if cfg!(windows) {
        // Word through PowerShell; paths go in environment variables so no quoting can break.
        let script = "$ErrorActionPreference='Stop'; $w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0; \
            try { $d = $w.Documents.Open($env:JH_IN, $false, $true); $d.ExportAsFixedFormat($env:JH_OUT, 17); $d.Close(0) } finally { $w.Quit() }";
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).env("JH_IN", docx).env("JH_OUT", &pdf);
        hide(&mut c);
        if c.status().map(|s| s.success()).unwrap_or(false) && pdf.exists() {
            return Ok(pdf);
        }
    }
    let mut office: Vec<std::path::PathBuf> = vec!["soffice".into()];
    for base in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(b) = std::env::var_os(base) {
            office.push(std::path::PathBuf::from(b).join("LibreOffice").join("program").join("soffice.exe"));
        }
    }
    let dir = docx.parent().unwrap_or(std::path::Path::new("."));
    for prog in office {
        let mut c = Command::new(&prog);
        c.args(["--headless", "--convert-to", "pdf", "--outdir"]).arg(dir).arg(docx);
        hide(&mut c);
        if c.status().map(|s| s.success()).unwrap_or(false) && pdf.exists() {
            return Ok(pdf);
        }
    }
    Err(crate::Error("Couldn't make a PDF: Microsoft Word or LibreOffice is needed.".into()))
}
