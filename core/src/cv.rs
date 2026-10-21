//! Read a .docx CV and write a tailored copy that keeps the original's formatting.
//!
//! A .docx is a zip; the text is in word/document.xml as paragraphs (<w:p>) made of runs (<w:r>).
//! Claude sees the CV as numbered paragraphs with bold runs marked **like this** and returns new
//! text for some of them. Each edit rebuilds one paragraph from that paragraph's own run formatting
//! (plain and bold), so fonts, sizes and bullet numbering stay exactly as they were.
//!
//! Guardrails: only the headline, summary and skills sections and bullet points can change; an
//! edit that adds a figure the CV never states, or grows a paragraph a lot, is rejected.

use crate::db::Change;
use crate::util::{escape, unescape};
use crate::{err, R};
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};
use std::path::Path;

/// Sections whose prose may be reworded in full.
const REWRITE_SECTIONS: [&str; 13] = ["SUMMARY", "PROFILE", "ABOUT", "OBJECTIVE", "OVERVIEW", "COMPETENC", "SKILL", "EXPERTISE",
    "HIGHLIGHTS", "TECHNOLOG", "TOOLS", "STRENGTHS", "QUALIFICATION"];
/// Sections that are never changed.
const PROTECTED_SECTIONS: [&str; 13] = ["EDUCATION", "CERTIFICAT", "LICEN", "LANGUAGE", "REFERENCE", "PUBLICATION", "AWARD",
    "HONOUR", "HONOR", "INTEREST", "HOBBIES", "TRAINING", "PERSONAL"];
/// Other common section names (bullet points under them may be reworded).
const OTHER_SECTIONS: [&str; 9] = ["EXPERIENCE", "EMPLOYMENT", "WORK HISTORY", "CAREER", "PROJECTS", "VOLUNTEER", "BACKGROUND",
    "ACHIEVEMENTS", "ACCOMPLISHMENTS"];

/// A typed bullet at the start of a paragraph: "• ", "- ", "▪\t", "o\t"...
static BULLET_PREFIX: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\s*(?:[•◦▪‣\-–—*·●■□➢➤►✓✔]|o\t)[ \t\u{a0}]*").unwrap());
static CONTACT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)@|linkedin|https?://|www\.|github\.com|\+?\d[\d ().-]{7,}\d").unwrap());

#[derive(Clone, Debug)]
pub struct Run {
    pub rpr: String,
    pub text: String,
    pub bold: bool,
    /// The run's original XML, for runs that are kept as they are.
    pub xml: String,
}

#[derive(Clone, Debug)]
pub struct Para {
    pub index: usize,
    /// Byte range of the whole <w:p> element in document.xml.
    pub start: usize,
    pub end: usize,
    pub open_tag: String,
    pub ppr: String,
    pub runs: Vec<Run>,
    /// The paragraph style id, e.g. "Heading1" or "ListBullet".
    pub style: String,
    pub bullet: bool,
    pub editable: bool,
}

impl Para {
    pub fn plain(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }

    /// Text with bold runs marked **like this**.
    pub fn marked(&self) -> String {
        let mut s = String::new();
        for r in &self.runs {
            if r.text.is_empty() {
                continue;
            }
            if r.bold && !r.text.trim().is_empty() {
                s.push_str("**");
                s.push_str(&r.text);
                s.push_str("**");
            } else {
                s.push_str(&r.text);
            }
        }
        s.replace("****", "")
    }
}

pub struct Doc {
    pub zip_bytes: Vec<u8>,
    pub xml: String,
    pub paras: Vec<Para>,
}

// --- XML scanning -----------------------------------------------------------------------------

/// True if `xml[i..]` opens element `name` (exactly, not a longer name like w:pPr for w:p).
fn opens(xml: &str, i: usize, name: &str) -> bool {
    let b = xml.as_bytes();
    let tag = format!("<{name}");
    xml[i..].starts_with(&tag) && matches!(b.get(i + tag.len()), Some(b'>') | Some(b' ') | Some(b'/') | Some(b'\t') | Some(b'\n') | Some(b'\r'))
}

/// End (exclusive) of the element `name` opening at `start`, counting nested elements of the same name.
fn element_end(xml: &str, start: usize, name: &str) -> Option<usize> {
    let close = format!("</{name}>");
    let first_gt = start + xml[start..].find('>')?;
    if xml.as_bytes()[first_gt - 1] == b'/' {
        return Some(first_gt + 1);
    }
    let mut depth = 1;
    let mut i = first_gt + 1;
    while i < xml.len() {
        let next = xml[i..].find('<')? + i;
        if xml[next..].starts_with(&close) {
            depth -= 1;
            if depth == 0 {
                return Some(next + close.len());
            }
            i = next + close.len();
        } else if opens(xml, next, name) {
            let gt = next + xml[next..].find('>')?;
            if xml.as_bytes()[gt - 1] != b'/' {
                depth += 1;
            }
            i = gt + 1;
        } else {
            i = next + 1;
        }
    }
    None
}

/// First child element `name` inside `xml` (whole element text), searching from the start.
fn child(xml: &str, name: &str) -> Option<(usize, usize)> {
    let mut i = 0;
    while let Some(off) = xml[i..].find(&format!("<{name}")) {
        let at = i + off;
        if opens(xml, at, name) {
            return element_end(xml, at, name).map(|e| (at, e));
        }
        i = at + 1;
    }
    None
}

static TOKENS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<w:t(?:\s[^>]*)?>([^<]*)</w:t>|<w:t\s*/>|<w:tab\s*/>|<w:br\s*/>|<w:cr\s*/>"#).unwrap()
});
static BOLD: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<w:b(\s+w:val="([^"]*)")?\s*/>"#).unwrap());
static PSTYLE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<w:pStyle\s+w:val="([^"]*)""#).unwrap());

fn parse_run(xml: &str) -> Run {
    let rpr = child(xml, "w:rPr").map(|(a, b)| xml[a..b].to_string()).unwrap_or_default();
    let mut text = String::new();
    for c in TOKENS.captures_iter(xml) {
        let tok = &c[0];
        if let Some(t) = c.get(1) {
            text.push_str(&unescape(t.as_str()));
        } else if tok.starts_with("<w:tab") {
            text.push('\t');
        } else if tok.starts_with("<w:br") || tok.starts_with("<w:cr") {
            text.push('\n');
        }
    }
    let bold = BOLD.captures(&rpr).map(|c| !matches!(c.get(2).map(|v| v.as_str()), Some("0") | Some("false") | Some("off"))).unwrap_or(false);
    Run { rpr, text, bold, xml: xml.to_string() }
}

fn parse_para(xml: &str, start: usize, end: usize, index: usize) -> Para {
    let el = &xml[start..end];
    let gt = el.find('>').unwrap_or(0);
    let open_tag = el[..=gt].to_string();
    let self_closing = open_tag.ends_with("/>");
    let inner = if self_closing { "" } else { &el[gt + 1..el.len() - "</w:p>".len()] };
    let ppr = child(inner, "w:pPr").map(|(a, b)| inner[a..b].to_string()).unwrap_or_default();
    let mut runs = vec![];
    let mut i = 0;
    while let Some(off) = inner[i..].find("<w:r") {
        let at = i + off;
        if opens(inner, at, "w:r") {
            if let Some(e) = element_end(inner, at, "w:r") {
                runs.push(parse_run(&inner[at..e]));
                i = e;
                continue;
            }
        }
        i = at + 1;
    }
    let style = PSTYLE.captures(&ppr).map(|c| c[1].to_string()).unwrap_or_default();
    let plain: String = runs.iter().map(|r: &Run| r.text.as_str()).collect();
    let bullet = ppr.contains("<w:numPr") || style.starts_with("List") || BULLET_PREFIX.is_match(&plain);
    Para {
        index,
        start,
        end,
        open_tag: if self_closing { open_tag.trim_end_matches("/>").to_string() + ">" } else { open_tag },
        ppr,
        runs,
        style,
        bullet,
        editable: false,
    }
}

pub fn is_heading(text: &str) -> bool {
    let t = text.trim();
    let letters: Vec<char> = t.chars().filter(|c| c.is_alphabetic()).collect();
    !letters.is_empty() && letters.iter().all(|c| c.is_uppercase()) && t.chars().count() < 60
}

/// Is this paragraph a section heading? Index 0 (usually your name) never is.
fn is_section_heading(p: &Para) -> bool {
    let plain = p.plain();
    let t = plain.trim();
    let words = t.split_whitespace().count();
    if p.index == 0 || t.is_empty() || plain.contains('\t') || t.chars().count() > 60 || words > 6 {
        return false;
    }
    if let Some(i) = t.find(':') {
        if i + 1 < t.len() {
            return false; // "Skills: SQL, Excel" is a line of content
        }
    }
    let letters: Vec<char> = t.chars().filter(|c| c.is_alphabetic()).collect();
    let caps = letters.len() >= 3 && letters.iter().all(|c| c.is_uppercase());
    let styled = p.style.starts_with("Heading") || p.style.contains("heading") || p.style.contains("Heading");
    let up = t.to_uppercase();
    let known = REWRITE_SECTIONS.iter().chain(PROTECTED_SECTIONS.iter()).chain(OTHER_SECTIONS.iter()).any(|k| up.contains(k));
    let all_bold = p.runs.iter().filter(|r| !r.text.trim().is_empty()).all(|r| r.bold) && p.runs.iter().any(|r| !r.text.trim().is_empty());
    caps || styled || (known && (all_bold || t.ends_with(':') || words <= 3))
}

/// The paragraph's text without a typed bullet in front.
fn without_bullet(text: &str) -> &str {
    match BULLET_PREFIX.find(text) {
        Some(m) => &text[m.end()..],
        None => text,
    }
}

/// Every paragraph in the document body, including those inside tables (many CV templates use
/// tables for layout), in reading order, with what may be reworded decided.
pub fn paragraphs(xml: &str) -> R<Vec<Para>> {
    let Some(body_at) = xml.find("<w:body") else { return err("This doesn't look like a Word document (no body).") };
    let body_start = body_at + xml[body_at..].find('>').unwrap_or(0) + 1;
    let body_end = xml.rfind("</w:body>").unwrap_or(xml.len());
    let mut out = vec![];
    let mut i = body_start;
    while let Some(off) = xml[i..body_end].find("<w:p") {
        let at = i + off;
        if opens(xml, at, "w:p") {
            let Some(end) = element_end(xml, at, "w:p") else { break };
            out.push(parse_para(xml, at, end, out.len()));
            i = end; // a paragraph inside a text box stays part of its outer paragraph
        } else {
            i = at + 4;
        }
    }

    let first_heading = out.iter().position(is_section_heading);
    let mut section: Option<String> = None;
    let mut heading_flags = vec![false; out.len()];
    for (k, p) in out.iter().enumerate() {
        heading_flags[k] = is_section_heading(p);
    }
    for (k, p) in out.iter_mut().enumerate() {
        let plain = p.plain();
        if heading_flags[k] {
            section = Some(plain.trim().to_uppercase());
            continue;
        }
        let body = without_bullet(plain.trim());
        let prose = !body.trim().is_empty() && !body.contains('\t') && !CONTACT.is_match(body);
        let before_first = first_heading.map(|f| k < f).unwrap_or(true);
        let editable = match &section {
            // The headline area under your name (not your name, not contact lines).
            None => prose && p.index > 0 && before_first,
            Some(s) if PROTECTED_SECTIONS.iter().any(|w| s.contains(w)) => false,
            Some(s) if REWRITE_SECTIONS.iter().any(|w| s.contains(w)) => prose,
            Some(_) => prose && p.bullet,
        };
        p.editable = editable && body.trim().chars().count() > 25;
    }
    Ok(out)
}

pub fn open(path: &Path) -> R<Doc> {
    let zip_bytes = std::fs::read(path).map_err(|e| crate::Error(format!("Couldn't read {}: {e}", path.display())))?;
    from_bytes(zip_bytes)
}

pub fn from_bytes(zip_bytes: Vec<u8>) -> R<Doc> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(&zip_bytes)).map_err(|_| crate::Error("That file isn't a Word .docx document.".into()))?;
    let mut xml = String::new();
    z.by_name("word/document.xml")
        .map_err(|_| crate::Error("That file isn't a Word .docx document.".into()))?
        .read_to_string(&mut xml)?;
    let paras = paragraphs(&xml)?;
    Ok(Doc { zip_bytes, xml, paras })
}

impl Doc {
    pub fn plain_text(&self) -> String {
        self.paras.iter().map(|p| p.plain()).filter(|t| !t.trim().is_empty()).collect::<Vec<_>>().join("\n")
    }

    /// Paragraphs as Claude sees them: "[index|edit] text" or "[index|fixed] text".
    pub fn numbered(&self) -> String {
        self.paras
            .iter()
            .filter(|p| !p.plain().trim().is_empty())
            .map(|p| format!("[{}|{}] {}", p.index, if p.editable { "edit" } else { "fixed" }, p.marked()))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// A copy of the document with `document.xml` replaced.
    fn with_xml(&self, xml: &str) -> R<Vec<u8>> {
        self.with_image(xml, None)
    }

    /// The document with new body XML and, optionally, one image part (file name, bytes, relationship id).
    fn with_image(&self, xml: &str, image: Option<(&str, &[u8], &str)>) -> R<Vec<u8>> {
        let mut src = zip::ZipArchive::new(std::io::Cursor::new(&self.zip_bytes))?;
        let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut has_rels = false;
        for i in 0..src.len() {
            let mut f = src.by_index(i)?;
            let name = f.name().to_string();
            if name == "word/document.xml" {
                out.start_file(name, opts)?;
                out.write_all(xml.as_bytes())?;
            } else if f.is_dir() {
                out.add_directory(name, opts)?;
            } else {
                let mut buf = vec![];
                f.read_to_end(&mut buf)?;
                if let Some((file, _, id)) = image {
                    let ext = file.rsplit('.').next().unwrap_or("png");
                    if name == "word/_rels/document.xml.rels" {
                        has_rels = true;
                        let t = String::from_utf8_lossy(&buf).replace(
                            "</Relationships>",
                            &format!(r#"<Relationship Id="{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{file}"/></Relationships>"#),
                        );
                        buf = t.into_bytes();
                    } else if name == "[Content_Types].xml" {
                        let t = String::from_utf8_lossy(&buf).to_string();
                        if !t.to_lowercase().contains(&format!("extension=\"{ext}\"")) {
                            let ctype = if ext == "png" { "image/png" } else { "image/jpeg" };
                            buf = t.replacen("<Default ", &format!(r#"<Default Extension="{ext}" ContentType="{ctype}"/><Default "#), 1).into_bytes();
                        }
                    }
                }
                out.start_file(name, opts)?;
                out.write_all(&buf)?;
            }
        }
        if let Some((file, bytes, id)) = image {
            out.start_file(format!("word/media/{file}"), opts)?;
            out.write_all(bytes)?;
            if !has_rels {
                out.start_file("word/_rels/document.xml.rels", opts)?;
                out.write_all(format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="{id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{file}"/></Relationships>"#).as_bytes())?;
            }
        }
        Ok(out.finish()?.into_inner())
    }
}

// --- how an applicant tracking system reads it --------------------------------------------------

/// Things in a CV's Word file that applicant tracking systems often misread, from what's in it:
/// the body's XML, the text of its page headers and footers, and its plain text.
pub fn ats_issues(body_xml: &str, headers: &[String], text: &str) -> Vec<serde_json::Value> {
    use serde_json::json;
    static EMAIL: Lazy<Regex> = Lazy::new(|| Regex::new(r"[\w.+-]+@[\w-]+\.[\w.-]+").unwrap());
    static PHONE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}").unwrap());
    static COLS: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<w:cols\s[^>]*w:num="([2-9])""#).unwrap());
    let mut out = vec![];
    let mut add = |level: &str, text: &str| out.push(json!({ "level": level, "text": text }));
    let head = headers.join("\n");
    if EMAIL.is_match(&head) || PHONE.is_match(&head) {
        add("problem", "Your contact details are in the page header or footer. Many tracking systems skip those, so put your email and phone in the body, under your name.");
    }
    if body_xml.contains("<w:txbxContent") {
        add("problem", "Some text is in text boxes, which many tracking systems skip entirely. Move it into normal paragraphs (or use Convert to an editable copy in CV & career).");
    }
    if COLS.is_match(body_xml) {
        add("problem", "The CV uses newspaper-style columns, which tracking systems often read across, mixing the two columns' lines.");
    }
    if body_xml.contains("<w:tbl>") || body_xml.contains("<w:tbl ") {
        add("tip", "Part of the CV is laid out in a table. Most systems read simple tables, but older ones jumble them; plain paragraphs are safest.");
    }
    if body_xml.contains("<w:drawing") || body_xml.contains("<w:pict") {
        add("tip", "There's a picture (a photo, logo or icon). Screening systems ignore pictures. In North America and the UK a photo is best left off; in the Gulf and parts of Europe one is common.");
    }
    let low = text.to_lowercase();
    if !EMAIL.is_match(text) {
        add("problem", "There's no email address in the body of the CV.");
    }
    let has = |words: &[&str]| words.iter().any(|w| low.contains(w));
    let mut missing = vec![];
    if !has(&["experience", "employment", "work history", "career history"]) {
        missing.push("Experience");
    }
    if !has(&["education", "academic", "qualifications"]) {
        missing.push("Education");
    }
    if !has(&["skills", "competencies", "expertise", "technical"]) {
        missing.push("Skills");
    }
    if !missing.is_empty() {
        add("tip", &format!("Use standard section names so systems file your details correctly; none found for: {}.", missing.join(", ")));
    }
    let words = text.split_whitespace().count();
    if words > 1400 {
        add("tip", &format!("At about {words} words it runs past three pages; two pages is usual for most roles."));
    }
    out
}

/// The ATS check for a Word file.
pub fn ats_check(doc: &Doc) -> Vec<serde_json::Value> {
    let mut headers = vec![];
    if let Ok(mut z) = zip::ZipArchive::new(std::io::Cursor::new(doc.zip_bytes.as_slice())) {
        let names: Vec<String> = z.file_names().filter(|n| n.starts_with("word/header") || n.starts_with("word/footer")).map(String::from).collect();
        for n in names {
            if let Ok(mut f) = z.by_name(&n) {
                let mut xml = String::new();
                if std::io::Read::read_to_string(&mut f, &mut xml).is_ok() {
                    headers.push(TOKENS.captures_iter(&xml).filter_map(|c| c.get(1).map(|t| unescape(t.as_str()))).collect::<Vec<_>>().join(" "));
                }
            }
        }
    }
    ats_issues(&doc.xml, &headers, &doc.plain_text())
}

// --- editing ------------------------------------------------------------------------------------

static NUMBER: Lazy<Regex> = Lazy::new(|| Regex::new(r"\d[\d,.]*").unwrap());

/// Reject edits that introduce figures the CV never states, or blow up a paragraph. Returns a reason.
pub fn check_edit(original: &str, new: &str, known: &HashSet<String>) -> Option<String> {
    for m in NUMBER.find_iter(new) {
        let n = m.as_str();
        if !known.contains(n) && !known.contains(n.trim_end_matches(['.', ','])) {
            return Some(format!("adds the figure “{n}”, which isn't in your CV"));
        }
    }
    let plain = new.replace("**", "");
    if plain.trim().chars().count() < 10 {
        return Some("the replacement is empty".into());
    }
    let (o, n) = (original.chars().count() as f64, new.chars().count() as f64);
    if n > (o * 1.6).max(o + 160.0) {
        return Some("the replacement is much longer than the original".into());
    }
    if plain.contains('\t') || plain.contains('\n') {
        return Some("the replacement has tabs or line breaks".into());
    }
    None
}

fn add_bold(rpr: &str) -> String {
    if rpr.is_empty() {
        return "<w:rPr><w:b/></w:rPr>".into();
    }
    if BOLD.is_match(rpr) {
        return BOLD.replace(rpr, "<w:b/>").into_owned();
    }
    // Schema order inside rPr: rStyle, rFonts, then b. Insert after whichever of the first two exist.
    let mut at = rpr.find('>').map(|x| x + 1).unwrap_or(0);
    for name in ["w:rStyle", "w:rFonts"] {
        if let Some((_, e)) = child(rpr, name) {
            at = at.max(e);
        }
    }
    format!("{}<w:b/>{}", &rpr[..at], &rpr[at..])
}

fn remove_bold(rpr: &str) -> String {
    static BCS: Lazy<Regex> = Lazy::new(|| Regex::new(r#"<w:bCs(\s+w:val="[^"]*")?\s*/>"#).unwrap());
    let s = BOLD.replace_all(rpr, "");
    BCS.replace_all(&s, "").into_owned()
}

fn run_xml(rpr: &str, text: &str) -> String {
    format!(r#"<w:r>{rpr}<w:t xml:space="preserve">{}</w:t></w:r>"#, escape(text))
}

/// New XML for paragraph `p` with `marked` text (bold marked **like this**).
fn rebuild(p: &Para, marked: &str) -> String {
    let all: Vec<&Run> = p.runs.iter().filter(|r| !r.text.is_empty()).collect();
    // A typed bullet ("•", "-", a tab) stays exactly as it was.
    let plain = p.plain();
    let prefix = BULLET_PREFIX.find(&plain).map(|m| m.as_str().to_string()).unwrap_or_default();
    let mut marked = {
        let m = marked.trim_start();
        let m2 = m.trim_start_matches("**");
        match BULLET_PREFIX.find(m2) {
            Some(b) if !prefix.is_empty() => format!("{}{}", &m[..m.len() - m2.len()], &m2[b.end()..]),
            _ => m.to_string(),
        }
    };
    let mut kept_prefix: Vec<&Run> = vec![];
    let mut runs: Vec<&Run> = all.clone();
    if !prefix.is_empty() {
        let mut acc = String::new();
        let mut n = 0;
        for r in &all {
            if acc.len() + r.text.len() > prefix.len() || !prefix.starts_with(&(acc.clone() + &r.text)) {
                break;
            }
            acc.push_str(&r.text);
            n += 1;
        }
        if acc == prefix {
            kept_prefix = all[..n].to_vec();
            runs = all[n..].to_vec();
        } else {
            marked = format!("{prefix}{marked}"); // the bullet shares a run with the text
        }
    }
    // Competency lines are "Label: items" with a bold label run; keep the label exactly as it is.
    let keep_label = runs.len() >= 2 && runs[0].bold && runs[0].text.trim_end().ends_with(':');
    let body: Vec<&Run> = if keep_label {
        let label = regex::escape(runs[0].text.trim());
        let re = Regex::new(&format!(r"^\s*(\*\*)?{label}(\*\*)?\s*")).unwrap();
        if let Some(m) = re.find(&marked) {
            marked = marked[m.end()..].to_string();
        }
        runs[1..].to_vec()
    } else {
        runs.clone()
    };
    let plain_rpr = body.iter().find(|r| !r.bold).map(|r| r.rpr.clone())
        .or_else(|| body.first().map(|r| remove_bold(&r.rpr)))
        .unwrap_or_default();
    let bold_rpr = body.iter().find(|r| r.bold).map(|r| r.rpr.clone()).unwrap_or_else(|| add_bold(&plain_rpr));

    let mut xml = String::new();
    xml.push_str(&p.open_tag);
    xml.push_str(&p.ppr);
    for r in &kept_prefix {
        xml.push_str(&r.xml);
    }
    if keep_label {
        xml.push_str(&runs[0].xml);
    }
    static PART: Lazy<Regex> = Lazy::new(|| Regex::new(r"\*\*(.+?)\*\*").unwrap());
    let mut last = 0;
    for c in PART.captures_iter(&marked) {
        let m = c.get(0).unwrap();
        let before = marked[last..m.start()].replace("**", "");
        if !before.is_empty() {
            xml.push_str(&run_xml(&plain_rpr, &before));
        }
        xml.push_str(&run_xml(&bold_rpr, &c[1]));
        last = m.end();
    }
    let rest = marked[last..].replace("**", "");
    if !rest.is_empty() {
        xml.push_str(&run_xml(&plain_rpr, &rest));
    }
    xml.push_str("</w:p>");
    xml
}

pub struct Applied {
    pub bytes: Vec<u8>,
    pub changes: Vec<Change>,
    pub rejected: Vec<String>,
}

/// A copy of the CV with the given paragraph replacements, plus what changed and what was refused.
pub fn apply_edits(doc: &Doc, edits: &BTreeMap<usize, String>) -> R<Applied> {
    apply_checked(doc, edits, true)
}

/// Your own wording, applied as you wrote it: the checks against invented figures and long
/// paragraphs are for Claude's edits, not yours.
pub fn apply_own_edits(doc: &Doc, edits: &BTreeMap<usize, String>) -> R<Applied> {
    apply_checked(doc, edits, false)
}

fn apply_checked(doc: &Doc, edits: &BTreeMap<usize, String>, check: bool) -> R<Applied> {
    let full: String = doc.paras.iter().map(|p| p.plain()).collect::<Vec<_>>().join("\n");
    let known: HashSet<String> = NUMBER.find_iter(&full).map(|m| m.as_str().to_string()).collect();
    let mut changes = vec![];
    let mut rejected = vec![];
    let mut replace: Vec<(usize, usize, String)> = vec![];
    for (&i, new) in edits {
        let Some(p) = doc.paras.get(i) else {
            rejected.push(format!("paragraph {i}: doesn't exist"));
            continue;
        };
        if check && !p.editable {
            rejected.push(format!("paragraph {i}: can't be changed"));
            continue;
        }
        if new.replace("**", "").trim() == p.plain().trim() {
            continue; // nothing actually changed
        }
        if let Some(why) = check.then(|| check_edit(&p.marked(), new, &known)).flatten() {
            rejected.push(format!("paragraph {i}: {why}"));
            continue;
        }
        replace.push((p.start, p.end, rebuild(p, new)));
        changes.push(Change { before: p.plain(), after: new.replace("**", "") });
    }
    let mut xml = doc.xml.clone();
    for (s, e, new) in replace.into_iter().rev() {
        xml.replace_range(s..e, &new);
    }
    Ok(Applied { bytes: doc.with_xml(&xml)?, changes, rejected })
}

/// A cover letter in the CV's own letterhead, fonts and page setup.
/// The document as simple blocks for an on-screen preview: text with **bold** marked, and its kind.
pub fn preview(doc: &Doc) -> Vec<serde_json::Value> {
    doc.paras
        .iter()
        .map(|p| {
            let text = p.marked();
            let first = doc.paras.iter().find(|q| !q.plain().trim().is_empty()).map(|q| q.index) == Some(p.index);
            let kind = if text.trim().is_empty() {
                "blank"
            } else if first {
                "name"
            } else if p.bullet {
                "bullet"
            } else if is_heading(&p.plain()) || p.style.to_lowercase().starts_with("heading") {
                "heading"
            } else {
                "para"
            };
            serde_json::json!({ "text": text, "kind": kind, "center": p.ppr.contains(r#"w:jc w:val="center""#) })
        })
        .collect()
}

/// The file extension and pixel size of a PNG or JPEG, or None for anything else.
pub fn image_info(b: &[u8]) -> Option<(&'static str, u32, u32)> {
    let be32 = |i: usize| b.get(i..i + 4).map(|x| u32::from_be_bytes([x[0], x[1], x[2], x[3]]));
    let be16 = |i: usize| b.get(i..i + 2).map(|x| u16::from_be_bytes([x[0], x[1]]) as u32);
    if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(("png", be32(16)?, be32(20)?)).filter(|(_, w, h)| *w > 0 && *h > 0);
    }
    if b.starts_with(&[0xFF, 0xD8]) {
        let mut i = 2;
        while i + 9 < b.len() && b[i] == 0xFF {
            let m = b[i + 1];
            if (0xC0..=0xCF).contains(&m) && ![0xC4, 0xC8, 0xCC].contains(&m) {
                return Some(("jpeg", be16(i + 7)?, be16(i + 5)?)).filter(|(_, w, h)| *w > 0 && *h > 0);
            }
            i += 2 + be16(i + 2)? as usize;
        }
    }
    None
}

// Plain names, like Word's own: nothing in the file says which program made it.
const SIGNATURE_REL: &str = "rId9001";

/// A paragraph holding the signature image, about half an inch tall.
fn signature_para(ppr: &str, w: u32, h: u32, ext: &str) -> String {
    const EMU_IN: f64 = 914_400.0;
    let (mut cy, mut cx) = (0.55 * EMU_IN, 0.55 * EMU_IN * w as f64 / h as f64);
    if cx > 2.5 * EMU_IN {
        cy *= 2.5 * EMU_IN / cx;
        cx = 2.5 * EMU_IN;
    }
    let (cx, cy) = (cx.round() as u64, cy.round() as u64);
    format!(
        r#"<w:p>{ppr}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="9001" name="Signature"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9001" name="signature.{ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{SIGNATURE_REL}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#
    )
}

/// The cover letter on the CV's letterhead. A PNG or JPEG `signature` goes just above the last line (your name).
pub fn cover_letter(doc: &Doc, text: &str, signature: Option<&[u8]>) -> R<Vec<u8>> {
    let sig = signature.and_then(|b| image_info(b).map(|i| (b, i)));
    let xml = &doc.xml;
    let body_at = xml.find("<w:body").unwrap_or(0);
    let body_start = body_at + xml[body_at..].find('>').unwrap_or(0) + 1;
    let body_end = xml.rfind("</w:body>").unwrap_or(xml.len());
    let sect = xml[..body_end].rfind("<w:sectPr").map(|s| &xml[s..body_end]).unwrap_or("");

    // Letterhead: your name and the contact lines above the first heading.
    let first_heading = doc.paras.iter().position(|p| is_heading(&p.plain())).unwrap_or(0);
    let mut head = String::new();
    for p in doc.paras.iter().take(first_heading) {
        let t = p.plain();
        if p.index == 0 || t.contains('@') || t.to_lowercase().contains("linkedin.com") {
            head.push_str(&xml[p.start..p.end]);
        }
    }
    // Letter paragraphs take the formatting of the summary paragraph (or the first prose paragraph).
    let tpl = doc.paras.iter().find(|p| p.editable && !p.bullet && p.index > 1)
        .or_else(|| doc.paras.iter().find(|p| !p.plain().trim().is_empty() && p.index > 0));
    let (ppr, rpr) = tpl
        .map(|p| (p.ppr.clone(), p.runs.iter().find(|r| !r.bold && !r.text.is_empty()).map(|r| r.rpr.clone()).unwrap_or_default()))
        .unwrap_or_default();
    // "- " lines are bullets with a hanging indent; **text** is bold.
    static IND: Lazy<Regex> = Lazy::new(|| Regex::new(r"<w:ind\b[^>]*/>").unwrap());
    let bullet_ppr = {
        let ind = r#"<w:ind w:left="360" w:hanging="240"/>"#;
        let p = IND.replace_all(&ppr, "").to_string();
        if p.contains("<w:pPr>") { p.replacen("<w:pPr>", &format!("<w:pPr>{ind}"), 1) } else { format!("<w:pPr>{ind}</w:pPr>") }
    };
    let bold_rpr = if rpr.contains("<w:rPr>") { rpr.replacen("<w:rPr>", "<w:rPr><w:b/>", 1) } else { "<w:rPr><w:b/></w:rPr>".to_string() };
    let runs = |line: &str| -> String {
        line.split("**").enumerate().filter(|(_, t)| !t.is_empty()).map(|(i, t)| run_xml(if i % 2 == 1 { &bold_rpr } else { &rpr }, t)).collect()
    };
    let mut body = head;
    body.push_str("<w:p/>");
    let blocks: Vec<&str> = text.split("\n\n").map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
    for (b, block) in blocks.iter().enumerate() {
        let mut lines: Vec<&str> = vec![];
        let flush = |lines: &mut Vec<&str>, body: &mut String| {
            if lines.is_empty() {
                return;
            }
            body.push_str("<w:p>");
            body.push_str(&ppr);
            for (k, line) in lines.iter().enumerate() {
                if k > 0 {
                    body.push_str(&format!("<w:r>{rpr}<w:br/></w:r>"));
                }
                body.push_str(&runs(line));
            }
            body.push_str("</w:p>");
            lines.clear();
        };
        let all: Vec<&str> = block.lines().map(|l| l.trim_end()).filter(|l| !l.trim().is_empty()).collect();
        for (k, line) in all.iter().copied().enumerate() {
            if let (Some((_, (ext, w, h))), true) = (sig, b + 1 == blocks.len() && k + 1 == all.len()) {
                flush(&mut lines, &mut body);
                body.push_str(&signature_para(&ppr, w, h, ext));
            }
            match line.trim_start().strip_prefix("- ").or_else(|| line.trim_start().strip_prefix("• ")) {
                Some(item) => {
                    flush(&mut lines, &mut body);
                    body.push_str(&format!("<w:p>{bullet_ppr}{}{}</w:p>", run_xml(&rpr, "•\t"), runs(item.trim())));
                }
                None => lines.push(line),
            }
        }
        flush(&mut lines, &mut body);
    }
    body.push_str(sect);
    let mut head_xml = xml[..body_start].to_string();
    let Some((bytes, (ext, _, _))) = sig else {
        return doc.with_xml(&format!("{head_xml}{body}{}", &xml[body_end..]));
    };
    // The drawing needs the wp and r prefixes declared on the document element.
    if let Some(open) = head_xml.find("<w:document") {
        let end = open + head_xml[open..].find('>').unwrap_or(0);
        for (prefix, uri) in [
            ("wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"),
            ("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships"),
        ] {
            if !head_xml[open..end].contains(&format!("xmlns:{prefix}=")) {
                head_xml.insert_str(end, &format!(r#" xmlns:{prefix}="{uri}""#));
            }
        }
    }
    let new_xml = format!("{head_xml}{body}{}", &xml[body_end..]);
    doc.with_image(&new_xml, Some((&format!("image9001.{ext}"), bytes, SIGNATURE_REL)))
}

fn norm(s: &str) -> String {
    let t: String = s.to_lowercase().chars().map(|c| if c.is_alphanumeric() || "+#&".contains(c) { c } else { ' ' }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Share of keywords that appear in text (case and punctuation-insensitive), and the misses.
pub fn keyword_coverage(text: &str, keywords: &[String]) -> (f64, Vec<String>) {
    if keywords.is_empty() {
        return (1.0, vec![]);
    }
    let hay = format!(" {} ", norm(text));
    let missing: Vec<String> = keywords.iter().filter(|k| !hay.contains(&format!(" {} ", norm(k)))).cloned().collect();
    let share = 1.0 - missing.len() as f64 / keywords.len() as f64;
    ((share * 1000.0).round() / 1000.0, missing)
}

// --- building a CV ------------------------------------------------------------------------

/// A clean, editable Word CV from structured content (used for PDF and text CVs). Section headings are
/// capitals, role lines put dates on a right tab, and bullets use real Word numbering, so Job Hunt's
/// tailoring recognises every part.
pub fn build_docx(cv: &crate::claude::StructuredCv) -> R<Vec<u8>> {
    let run = |text: &str, rpr: &str| format!(r#"<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{}</w:t></w:r>"#, escape(text));
    let para = |ppr: &str, runs: String| format!("<w:p><w:pPr>{ppr}</w:pPr>{runs}</w:p>");
    let mut body = String::new();
    body.push_str(&para(r#"<w:jc w:val="center"/><w:spacing w:after="40"/>"#, run(cv.name.trim(), r#"<w:b/><w:sz w:val="36"/>"#)));
    if !cv.headline.trim().is_empty() {
        body.push_str(&para(r#"<w:jc w:val="center"/><w:spacing w:after="40"/>"#, run(cv.headline.trim(), r#"<w:b/><w:sz w:val="21"/>"#)));
    }
    for line in cv.contact.iter().filter(|l| !l.trim().is_empty()) {
        body.push_str(&para(r#"<w:jc w:val="center"/><w:spacing w:after="0"/>"#, run(line.trim(), r#"<w:sz w:val="18"/>"#)));
    }
    static LABEL: Lazy<Regex> = Lazy::new(|| Regex::new(r"^([^:]{2,40}:)\s*(.+)$").unwrap());
    for sec in &cv.sections {
        body.push_str(&para(
            r#"<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="2F4FC4"/></w:pBdr><w:spacing w:before="220" w:after="80"/>"#,
            run(&sec.heading.trim().to_uppercase(), r#"<w:b/><w:color w:val="2F4FC4"/><w:sz w:val="22"/>"#),
        ));
        for item in &sec.items {
            if !item.title.trim().is_empty() || !item.dates.trim().is_empty() {
                let mut runs = run(item.title.trim(), "<w:b/>");
                if !item.dates.trim().is_empty() {
                    runs.push_str(r#"<w:r><w:tab/></w:r>"#);
                    runs.push_str(&run(item.dates.trim(), "<w:b/>"));
                }
                body.push_str(&para(r#"<w:tabs><w:tab w:val="right" w:pos="10080"/></w:tabs><w:spacing w:before="120" w:after="0"/>"#, runs));
            }
            if !item.subtitle.trim().is_empty() {
                body.push_str(&para(r#"<w:spacing w:after="40"/>"#, run(item.subtitle.trim(), "<w:i/>")));
            }
            for line in item.text.lines().map(str::trim).filter(|l| !l.is_empty()) {
                let runs = match LABEL.captures(line) {
                    Some(c) => format!("{}{}", run(&format!("{} ", &c[1]), "<w:b/>"), run(&c[2], "")),
                    None => run(line, ""),
                };
                body.push_str(&para(r#"<w:spacing w:after="60"/>"#, runs));
            }
            for b in item.bullets.iter().map(|b| b.trim()).filter(|b| !b.is_empty()) {
                body.push_str(&para(r#"<w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="40"/>"#, run(b, "")));
            }
        }
    }
    let document = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>"#
    );
    let styles = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-CA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="270"/></w:pPr></w:style></w:styles>"#;
    let numbering = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="270"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>"#;
    let types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>"#;
    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#;
    let doc_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#;
    let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, data) in [
        ("[Content_Types].xml", types),
        ("_rels/.rels", rels),
        ("word/_rels/document.xml.rels", doc_rels),
        ("word/document.xml", document.as_str()),
        ("word/styles.xml", styles),
        ("word/numbering.xml", numbering),
    ] {
        out.start_file(name, opts)?;
        out.write_all(data.as_bytes())?;
    }
    Ok(out.finish()?.into_inner())
}

/// Writing that reads as the candidate's, not an AI's: invisible characters (zero-width spaces,
/// soft hyphens, direction marks, unusual spaces) are always removed, and em dashes, spaced en
/// dashes and the usual AI words are replaced, unless `keep_from` (your own CV) uses them too.
pub fn humanize(text: &str, keep_from: &str) -> String {
    let mut s: String = text
        .chars()
        .filter_map(|c| match c {
            '\u{200B}'..='\u{200F}' | '\u{2060}'..='\u{2064}' | '\u{FEFF}' | '\u{00AD}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' => None,
            '\u{00A0}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => Some(' '),
            c => Some(c),
        })
        .collect();
    let own = keep_from.to_lowercase();
    if !keep_from.contains('\u{2014}') {
        // A dash between numbers is a range; anywhere else it becomes a comma.
        let range = regex::Regex::new(r"(\d)\s*\u{2014}\s*(\d)").unwrap();
        s = range.replace_all(&s, "$1\u{2013}$2").into_owned();
        let at_end = regex::Regex::new(r"[ \t]*\u{2014}[ \t]*(\n|$)").unwrap();
        s = at_end.replace_all(&s, "$1").into_owned();
        let mid = regex::Regex::new(r"[ \t]*\u{2014}[ \t]*").unwrap();
        s = mid.replace_all(&s, ", ").into_owned();
    }
    if !keep_from.contains(" \u{2013} ") {
        let spaced = regex::Regex::new(r"([^\d\s]) \u{2013} ").unwrap();
        s = spaced.replace_all(&s, "$1, ").into_owned();
    }
    const PLAIN: [(&str, &str); 16] = [
        ("spearheaded", "led"), ("spearheading", "leading"), ("spearheads", "leads"), ("spearhead", "lead"),
        ("utilized", "used"), ("utilizing", "using"), ("utilizes", "uses"), ("utilize", "use"),
        ("utilised", "used"), ("utilising", "using"), ("utilise", "use"),
        ("seamlessly", "smoothly"), ("seamless", "smooth"), ("cutting-edge", "modern"),
        ("results-driven", "results-focused"), ("ever-evolving", "changing"),
    ];
    for (from, to) in PLAIN {
        if own.contains(from) {
            continue;
        }
        let re = regex::Regex::new(&format!(r"(?i)\b{}\b", regex::escape(from))).unwrap();
        s = re
            .replace_all(&s, |c: &regex::Captures| {
                let m = &c[0];
                if m.chars().next().is_some_and(|x| x.is_uppercase()) {
                    let mut t = to.chars();
                    t.next().map(|f| f.to_uppercase().collect::<String>() + t.as_str()).unwrap_or_default()
                } else {
                    to.to_string()
                }
            })
            .into_owned();
    }
    // Tidy what the swaps can leave behind.
    let tidy = regex::Regex::new(r",\s*([,.;:!?)])").unwrap();
    tidy.replace_all(&s, "$1").into_owned()
}

/// A minimal CV with the same structure as a real one, for tests.
#[doc(hidden)]
pub fn sample_docx() -> Vec<u8> {
    let p = |t: &str| format!("<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", escape(t));
    let bullet = |runs: &[(&str, bool)]| {
        let mut s = String::from("<w:p><w:pPr><w:pStyle w:val=\"ListBullet\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>");
        for (t, b) in runs {
            let rpr = if *b { "<w:rPr><w:rFonts w:ascii=\"Calibri\"/><w:b/><w:sz w:val=\"20\"/></w:rPr>" } else { "<w:rPr><w:rFonts w:ascii=\"Calibri\"/><w:sz w:val=\"20\"/></w:rPr>" };
            s.push_str(&format!("<w:r>{rpr}<w:t xml:space=\"preserve\">{}</w:t></w:r>", escape(t)));
        }
        s + "</w:p>"
    };
    let body = [
        p("Jane Candidate"),
        p("Technical Program Manager · Financial Systems"),
        p("Toronto, ON • jane@example.com"),
        p("PROFESSIONAL SUMMARY"),
        p("Program manager for regulated financial platforms, delivering payment systems end to end."),
        p("CORE COMPETENCIES"),
        "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space=\"preserve\">Program &amp; Delivery: </w:t></w:r><w:r><w:t>Program Governance, Requirements, UAT, Release Management</w:t></w:r></w:p>".to_string(),
        p("PROFESSIONAL EXPERIENCE"),
        "<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Payments Agency</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Jun 2014 - Present</w:t></w:r></w:p>".to_string(),
        bullet(&[("Delivered the payments platform in ", false), ("eight months", true), (", with ", false), ("$200M+", true), (" collected to date across 300 groups.", false)]),
        bullet(&[("Managed contracted development teams and system integrators through UAT and release.", false)]),
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>In a table</w:t></w:r></w:p></w:tc></w:tr></w:tbl>".to_string(),
        p("EDUCATION"),
        p("Bachelor of Business Administration, Finance, State University"),
    ]
    .join("");
    let doc = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/></w:sectPr></w:body></w:document>"
    );
    let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let opts = zip::write::SimpleFileOptions::default();
    out.start_file("[Content_Types].xml", opts).unwrap();
    out.write_all(br#"<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#).unwrap();
    out.start_file("_rels/.rels", opts).unwrap();
    out.write_all(br#"<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#).unwrap();
    out.start_file("word/document.xml", opts).unwrap();
    out.write_all(doc.as_bytes()).unwrap();
    out.finish().unwrap().into_inner()
}

#[cfg(test)]
mod tests {
    #[test]
    fn ats_check_flags_what_trackers_misread() {
        let clean = from_bytes(sample_docx()).unwrap();
        let issues = ats_check(&clean);
        assert!(issues.iter().all(|i| i["level"] != "problem"), "{issues:?}");
        let body = r#"<w:body><w:p><w:r><w:txbxContent>x</w:txbxContent></w:r></w:p><w:sectPr><w:cols w:space="720" w:num="2"/></w:sectPr></w:body>"#;
        let bad = ats_issues(body, &["Jane Doe · jane@x.com · 416 555 0100".into()], "Summary\nI did things.");
        let text: Vec<&str> = bad.iter().map(|i| i["text"].as_str().unwrap()).collect();
        assert!(text.iter().any(|t| t.contains("page header")));
        assert!(text.iter().any(|t| t.contains("text boxes")));
        assert!(text.iter().any(|t| t.contains("columns")));
        assert!(text.iter().any(|t| t.contains("no email")));
        assert!(text.iter().any(|t| t.contains("Experience, Education, Skills")));
    }

    use super::*;

    fn doc() -> Doc {
        from_bytes(sample_docx()).unwrap()
    }

    fn find<'a>(d: &'a Doc, prefix: &str) -> &'a Para {
        d.paras.iter().find(|p| p.plain().starts_with(prefix)).unwrap()
    }

    #[test]
    fn reads_paragraphs_and_editability() {
        let d = doc();
        assert_eq!(d.paras.len(), 14, "table paragraphs are read too");
        assert!(!find(&d, "In a table").editable);
        assert!(!find(&d, "Jane").editable);
        assert!(find(&d, "Technical Program").editable, "headline");
        assert!(!find(&d, "Toronto").editable, "contact line");
        assert!(!find(&d, "PROFESSIONAL SUMMARY").editable);
        assert!(find(&d, "Program manager for").editable);
        assert!(find(&d, "Program & Delivery").editable);
        assert!(!find(&d, "Payments Agency").editable, "role/date line has a tab");
        assert_eq!(find(&d, "Payments Agency").plain(), "Payments Agency\tJun 2014 - Present");
        let b = find(&d, "Delivered");
        assert!(b.editable && b.bullet);
        assert!(b.marked().contains("**eight months**") && b.marked().contains("**$200M+**"));
        assert!(!find(&d, "Bachelor").editable, "education");
        assert!(d.numbered().contains("|edit] Program manager for"));
    }

    #[test]
    fn edits_keep_bold_bullets_and_labels() {
        let d = doc();
        let bullet = find(&d, "Delivered").index;
        let comp = find(&d, "Program & Delivery").index;
        let mut edits = BTreeMap::new();
        edits.insert(bullet, "Delivered the Snowflake data platform in **eight months**, collecting **$200M+** across 300 groups.".to_string());
        edits.insert(comp, "**Program & Delivery:** Program Governance, Requirements, User Acceptance Testing (UAT), Release Management".to_string());
        let out = apply_edits(&d, &edits).unwrap();
        assert!(out.rejected.is_empty(), "{:?}", out.rejected);
        assert_eq!(out.changes.len(), 2);
        let back = from_bytes(out.bytes).unwrap();
        let b = &back.paras[bullet];
        assert!(b.plain().starts_with("Delivered the Snowflake data platform"));
        let bold: Vec<&str> = b.runs.iter().filter(|r| r.bold).map(|r| r.text.as_str()).collect();
        assert_eq!(bold, vec!["eight months", "$200M+"]);
        assert!(b.bullet && b.ppr.contains("<w:numPr>"));
        assert!(b.runs.iter().all(|r| r.rpr.contains("Calibri")), "fonts carried over");
        let c = &back.paras[comp];
        assert_eq!(c.runs[0].text, "Program & Delivery: ");
        assert!(c.runs[0].bold);
        assert_eq!(c.plain(), "Program & Delivery: Program Governance, Requirements, User Acceptance Testing (UAT), Release Management");
        assert_eq!(back.paras.len(), d.paras.len());
        assert!(back.xml.contains("In a table"), "everything else untouched");
    }

    #[test]
    fn rejects_invented_figures_and_fixed_paragraphs() {
        let d = doc();
        let bullet = find(&d, "Managed contracted").index;
        let heading = find(&d, "PROFESSIONAL SUMMARY").index;
        let mut edits = BTreeMap::new();
        edits.insert(bullet, "Managed 14 contracted development teams and system integrators through UAT and release.".to_string());
        edits.insert(heading, "SUMMARY".to_string());
        edits.insert(99, "x".to_string());
        let same = find(&d, "Program manager for").index;
        edits.insert(same, find(&d, "Program manager for").plain());
        let out = apply_edits(&d, &edits).unwrap();
        assert_eq!(out.rejected.len(), 3);
        assert!(out.rejected.iter().any(|r| r.contains("“14”")));
        assert!(out.changes.is_empty());
        let back = from_bytes(out.bytes).unwrap();
        assert!(back.paras[bullet].plain().starts_with("Managed contracted"));
    }

    #[test]
    fn plain_run_gets_bold_inserted_in_schema_order() {
        assert_eq!(add_bold(r#"<w:rPr><w:rFonts w:ascii="X"/><w:sz w:val="20"/></w:rPr>"#), r#"<w:rPr><w:rFonts w:ascii="X"/><w:b/><w:sz w:val="20"/></w:rPr>"#);
        assert_eq!(add_bold(""), "<w:rPr><w:b/></w:rPr>");
        assert_eq!(remove_bold("<w:rPr><w:b/><w:bCs/><w:i/></w:rPr>"), "<w:rPr><w:i/></w:rPr>");
    }

    #[test]
    fn cover_letter_bullets_and_bold() {
        let d = from_bytes(sample_docx()).unwrap();
        let text = "**Subject: Application for Program Manager**\n\nDear Hiring Team,\n\nMy record:\n- **Delivery:** Led 12 releases.\n- **Vendors:** Managed 3 vendors.\n\nAll the best,\nJane";
        let letter = from_bytes(cover_letter(&d, text, None).unwrap()).unwrap();
        let plain = letter.plain_text();
        assert!(!plain.contains("**") && !plain.contains("- **"), "markup becomes formatting");
        assert!(plain.contains("Delivery: Led 12 releases.") && plain.contains("Vendors: Managed 3 vendors."));
        assert_eq!(letter.xml.matches(r#"w:hanging="240""#).count(), 2, "each bullet is its own indented paragraph");
        let subject = letter.paras.iter().find(|p| p.plain().contains("Subject:")).unwrap();
        assert!(subject.runs.iter().all(|r| r.text.is_empty() || r.bold));
        let lead = letter.paras.iter().find(|p| p.plain().contains("My record:")).unwrap();
        assert!(!lead.plain().contains("Delivery"), "the lead-in and the bullets are separate paragraphs");
    }

    /// A tiny valid PNG (1x1, transparent) stretched by its header to 400x100.
    fn png(w: u32, h: u32) -> Vec<u8> {
        let mut b = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        b.extend(w.to_be_bytes());
        b.extend(h.to_be_bytes());
        b.extend([8, 6, 0, 0, 0, 0, 0, 0, 0]);
        b
    }

    #[test]
    fn preview_blocks() {
        let d = from_bytes(sample_docx()).unwrap();
        let blocks = preview(&d);
        assert_eq!(blocks.len(), d.paras.len());
        assert!(blocks.iter().any(|b| b["kind"] == "heading"));
        assert!(blocks.iter().any(|b| b["kind"] == "bullet"));
    }

    #[test]
    fn cover_letter_signature() {
        assert_eq!(image_info(&png(400, 100)), Some(("png", 400, 100)));
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 11, 8, 0, 50, 0, 200, 3, 0, 0];
        assert_eq!(image_info(&jpeg), Some(("jpeg", 200, 50)));
        assert_eq!(image_info(b"GIF89a"), None);

        let d = from_bytes(sample_docx()).unwrap();
        let bytes = cover_letter(&d, "Dear Hiring Team,\n\nHello.\n\nAll the best,\nJane Candidate", Some(&png(400, 100))).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
        assert!(z.by_name("word/media/image9001.png").is_ok());
        let mut rels = String::new();
        z.by_name("word/_rels/document.xml.rels").unwrap().read_to_string(&mut rels).unwrap();
        assert!(rels.contains(SIGNATURE_REL));
        let mut types = String::new();
        z.by_name("[Content_Types].xml").unwrap().read_to_string(&mut types).unwrap();
        assert!(types.to_lowercase().contains(r#"extension="png""#));
        let letter = from_bytes(bytes.clone()).unwrap();
        let (sign_off, drawing, name) = (letter.xml.find("All the best,").unwrap(), letter.xml.find("<w:drawing>").unwrap(), letter.xml.rfind("Jane Candidate").unwrap());
        assert!(sign_off < drawing && drawing < name, "the signature sits between the sign-off and the name");
        assert!(letter.xml.contains("xmlns:wp="));
        // Not an image: the letter is written without it.
        let plain = cover_letter(&d, "Dear Hiring Team,\n\nAll the best,\nJane", Some(b"not an image")).unwrap();
        assert!(!from_bytes(plain).unwrap().xml.contains("<w:drawing>"));
    }

    #[test]
    fn cover_letter_uses_letterhead() {
        let d = doc();
        let bytes = cover_letter(&d, "Dear Hiring Manager,\n\nI led delivery & release.\n\nJane", None).unwrap();
        let l = from_bytes(bytes).unwrap();
        let text: Vec<String> = l.paras.iter().map(|p| p.plain()).filter(|t| !t.is_empty()).collect();
        assert_eq!(text, vec!["Jane Candidate", "Toronto, ON • jane@example.com", "Dear Hiring Manager,", "I led delivery & release.", "Jane"]);
        assert!(l.xml.contains("<w:sectPr>"));
    }

    fn docx(body: &str) -> Doc {
        let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        out.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        out.write_all(format!("<w:document><w:body>{body}</w:body></w:document>").as_bytes()).unwrap();
        from_bytes(out.finish().unwrap().into_inner()).unwrap()
    }

    fn p(t: &str) -> String {
        format!("<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", escape(t))
    }

    fn bold_p(t: &str) -> String {
        format!("<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>{}</w:t></w:r></w:p>", escape(t))
    }

    #[test]
    fn other_layouts_title_case_headings_typed_bullets_tables() {
        let body = [
            p("Alex Morgan"),
            p("Senior data analyst who turns messy operational data into decisions"),
            p("alex@example.com | +1 416 555 0100"),
            format!("<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>Summary</w:t></w:r></w:p>"),
            p("Analyst with eight years in retail and logistics, building forecasting models and dashboards."),
            bold_p("Work Experience"),
            bold_p("Data Analyst, Freight Co"),
            "<w:tbl><w:tr><w:tc>".to_string() + &p("• Built a demand forecast that cut stock-outs across 40 stores.") + "</w:tc></w:tr></w:tbl>",
            "<w:p><w:r><w:t>-</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Automated weekly reporting in SQL and Power BI for the operations team.</w:t></w:r></w:p>".to_string(),
            p("Skills: SQL, Python, Power BI, Excel"),
            bold_p("Education:"),
            p("BSc Statistics, University of Toronto, with a minor in economics"),
        ].join("");
        let d = docx(&body);
        let f = |pre: &str| d.paras.iter().find(|p| p.plain().contains(pre)).unwrap();
        assert!(f("Senior data analyst").editable, "headline");
        assert!(!f("alex@").editable, "contact");
        assert!(f("Analyst with eight").editable, "summary under a Heading1 in title case");
        assert!(!f("Data Analyst, Freight").editable, "role line");
        assert!(f("Built a demand forecast").editable && f("Built a demand forecast").bullet, "typed bullet inside a table");
        assert!(f("Automated weekly").editable, "dash and tab bullet");
        assert!(!f("Skills: SQL").editable, "a content line under Experience, not a heading or bullet");
        assert!(!f("BSc Statistics").editable, "education");

        // Rewriting keeps the typed bullets.
        let mut edits = BTreeMap::new();
        edits.insert(f("Built a demand").index, "• Built a demand forecast that reduced stock-outs across 40 stores.".to_string());
        edits.insert(f("Automated weekly").index, "Automated weekly operations reporting with SQL and Power BI for the operations team.".to_string());
        let out = apply_edits(&d, &edits).unwrap();
        assert!(out.rejected.is_empty(), "{:?}", out.rejected);
        let back = from_bytes(out.bytes).unwrap();
        let g = |pre: &str| back.paras.iter().find(|p| p.plain().contains(pre)).unwrap().plain();
        assert_eq!(g("Built a demand"), "• Built a demand forecast that reduced stock-outs across 40 stores.");
        assert_eq!(g("Automated weekly"), "-\tAutomated weekly operations reporting with SQL and Power BI for the operations team.");
    }

    #[test]
    fn built_cv_is_fully_tailorable() {
        use crate::claude::{CvItem, CvSection, StructuredCv};
        let cv = StructuredCv {
            name: "Alex Morgan".into(),
            headline: "Senior Data Analyst · Retail and Logistics".into(),
            contact: vec!["Toronto, ON".into(), "alex@example.com · +1 416 555 0100".into()],
            sections: vec![
                CvSection { heading: "Summary".into(), items: vec![CvItem { text: "Analyst with eight years building forecasting models and dashboards.".into(), ..CvItem::default() }] },
                CvSection { heading: "Skills".into(), items: vec![CvItem { text: "Tools: SQL, Python, Power BI\nMethods: forecasting, A/B testing, segmentation".into(), ..CvItem::default() }] },
                CvSection { heading: "Experience".into(), items: vec![CvItem {
                    title: "Data Analyst".into(), subtitle: "Freight Co, Toronto".into(), dates: "2019 – Present".into(),
                    bullets: vec!["Built a demand forecast that cut stock-outs across 40 stores.".into()], ..CvItem::default() }] },
                CvSection { heading: "Education".into(), items: vec![CvItem { title: "BSc Statistics".into(), subtitle: "University of Toronto".into(), dates: "2015".into(), ..CvItem::default() }] },
            ],
        };
        let d = from_bytes(build_docx(&cv).unwrap()).unwrap();
        let f = |pre: &str| d.paras.iter().find(|p| p.plain().contains(pre)).unwrap();
        assert!(f("Senior Data Analyst ·").editable);
        assert!(f("Analyst with eight").editable);
        assert!(f("Tools: SQL").editable && f("Tools: SQL").runs[0].bold);
        assert!(f("Built a demand").editable && f("Built a demand").bullet);
        assert!(!f("Data Analyst\t2019").editable);
        assert!(!f("BSc Statistics").editable && !f("University of Toronto").editable);
        assert!(!f("alex@").editable);
        let letter = from_bytes(cover_letter(&d, "Dear team,\n\nHello.\n\nAlex", None).unwrap()).unwrap();
        assert_eq!(letter.paras[0].plain(), "Alex Morgan");
    }

    #[test]
    fn coverage() {
        let text = "Led User Acceptance Testing (UAT) and vendor management for C# services.";
        let kws: Vec<String> = ["UAT", "Vendor Management", "C#", "Kubernetes"].iter().map(|s| s.to_string()).collect();
        assert_eq!(keyword_coverage(text, &kws), (0.75, vec!["Kubernetes".to_string()]));
        assert_eq!(keyword_coverage(text, &[]), (1.0, vec![]));
    }

    #[test]
    fn ai_tells_are_taken_out() {
        let h = |t: &str| humanize(t, "");
        assert_eq!(h("Led the rollout \u{2014} on time and on budget."), "Led the rollout, on time and on budget.");
        assert_eq!(h("Teams\u{2014}finance and tax\u{2014}across Canada"), "Teams, finance and tax, across Canada");
        assert_eq!(h("2019\u{2014}2021"), "2019\u{2013}2021");
        assert_eq!(h("Spearheaded a seamless migration, utilizing SAP."), "Led a smooth migration, using SAP.");
        assert_eq!(h("Strong\u{00A0}fit\u{200B} here\u{00AD}."), "Strong fit here.");
        assert_eq!(h("Delivery \u{2013} on time"), "Delivery, on time");
        assert_eq!(h("Ended with a dash \u{2014}\nNext"), "Ended with a dash\nNext");
        // Your own CV's style stays.
        assert_eq!(humanize("Spearheaded X \u{2014} Y", "I spearheaded \u{2014} things"), "Spearheaded X \u{2014} Y");
        assert_eq!(h("Sept 2019 \u{2013} 2021"), "Sept 2019 \u{2013} 2021", "a range stays");
    }
}
