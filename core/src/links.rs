//! Links in your tailored CV and cover letter that tell you when someone opens them. Each web
//! link in the Word file (LinkedIn, a portfolio) is pointed at Job Hunt's public address, which
//! notes the click and sends the reader on. The text the reader sees doesn't change. Needs Job
//! Hunt reachable from the internet (the server version behind Cloudflare, say).

use crate::pipeline::Agent;
use crate::{Error, R};
use serde_json::{json, Value};
use std::io::{Read, Write};

/// Where links point, as https://<address>; empty when it's off.
pub fn base(agent: &Agent) -> String {
    let b = agent.secret("links.base");
    let b = b.trim().trim_end_matches('/');
    if b.starts_with("https://") && b.len() > 12 { b.to_string() } else { String::new() }
}

pub fn set_base(agent: &Agent, address: &str) -> R<()> {
    let a = address.trim().trim_end_matches('/');
    if !a.is_empty() && !(a.starts_with("https://") && a[8..].contains('.') && !a[8..].contains(' ')) {
        return Err(Error("Use Job Hunt's public address as it opens in a browser, starting with https://, like https://jobhunt.example.com.".into()));
    }
    agent.db().set("links.base", a)
}

/// A token for one link: the company in letters, then a few random letters ("maple-bank-qx3").
fn token(company: &str) -> String {
    let slug: String = company.to_lowercase().split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).take(3).collect::<Vec<_>>().join("-");
    let slug = if slug.is_empty() { "cv".to_string() } else { slug };
    use rand::Rng;
    let mut r = rand::thread_rng();
    let tail: String = (0..4).map(|_| (b'a' + r.gen_range(0..26)) as char).collect();
    format!("{slug}-{tail}")
}

/// The Word file with each web link pointed at `base`/l/<token>; `keep(token, target)` saves each.
/// Links already pointing at `base`, email links and anything not http(s) stay as they are.
pub fn rewrite_docx(bytes: &[u8], base: &str, company: &str, keep: &mut dyn FnMut(&str, &str) -> R<()>) -> R<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| Error("That isn't a Word file.".into()))?;
    let mut out = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let target = regex::Regex::new(r#"Target="(https?://[^"]+)""#).unwrap();
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| Error("Couldn't read the Word file.".into()))?;
        let name = f.name().to_string();
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut data = vec![];
        f.read_to_end(&mut data)?;
        if name.starts_with("word/_rels/") && name.ends_with(".rels") {
            let text = String::from_utf8_lossy(&data).to_string();
            let mut err = None;
            let new = target.replace_all(&text, |c: &regex::Captures| {
                let url = c[1].replace("&amp;", "&");
                if url.starts_with(base) || err.is_some() {
                    return c[0].to_string();
                }
                let t = token(company);
                if let Err(e) = keep(&t, &url) {
                    err = Some(e);
                    return c[0].to_string();
                }
                format!(r#"Target="{base}/l/{t}""#)
            });
            if let Some(e) = err {
                return Err(e);
            }
            data = new.into_owned().into_bytes();
        }
        out.start_file(name, opts).map_err(|_| Error("Couldn't write the Word file.".into()))?;
        out.write_all(&data)?;
    }
    Ok(out.finish().map_err(|_| Error("Couldn't write the Word file.".into()))?.into_inner())
}

/// Point the web links in this application's file at Job Hunt, when it has a public address.
pub fn track(agent: &Agent, job_id: &str, company: &str, bytes: Vec<u8>) -> Vec<u8> {
    let b = base(agent);
    if b.is_empty() {
        return bytes;
    }
    let db = agent.db();
    rewrite_docx(&bytes, &b, company, &mut |t, url| db.add_link(t, job_id, url)).unwrap_or(bytes)
}

/// Someone opened a link: where to send them, after noting it (link previewers counted apart).
pub fn open(agent: &Agent, token: &str, user_agent: &str) -> Option<String> {
    let db = agent.db();
    let target = db.link_target(token).ok().flatten()?;
    let ua = user_agent.to_lowercase();
    let bot = ua.is_empty() || ["bot", "crawl", "spider", "preview", "facebookexternalhit", "slack", "whatsapp", "outlook", "safelinks", "proofpoint", "mimecast", "barracuda", "curl", "python", "headless"].iter().any(|w| ua.contains(w));
    let _ = db.add_click(token, bot);
    Some(target)
}

/// The links in an application's files, with how often each was opened.
pub fn for_job(agent: &Agent, job_id: &str) -> Vec<Value> {
    agent.db().links(job_id).unwrap_or_default().into_iter().map(|mut l| {
        let host = url::Url::parse(l["target"].as_str().unwrap_or("")).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_default();
        l["site"] = json!(host);
        l
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn web_links_in_a_word_file_point_at_job_hunt() {
        let mut buf = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let o = zip::write::SimpleFileOptions::default();
        buf.start_file("word/document.xml", o).unwrap();
        buf.write_all(b"<w:document>linkedin.com/in/alex</w:document>").unwrap();
        buf.start_file("word/_rels/document.xml.rels", o).unwrap();
        buf.write_all(br#"<Relationships><Relationship Id="rId5" Type="x/hyperlink" Target="https://www.linkedin.com/in/alex?a=1&amp;b=2" TargetMode="External"/><Relationship Id="rId6" Type="x/hyperlink" Target="mailto:alex@example.com" TargetMode="External"/><Relationship Id="rId1" Type="x/styles" Target="styles.xml"/></Relationships>"#).unwrap();
        let bytes = buf.finish().unwrap().into_inner();
        let mut kept = vec![];
        let out = rewrite_docx(&bytes, "https://jh.example.com", "Maple Bank Inc.", &mut |t, u| { kept.push((t.to_string(), u.to_string())); Ok(()) }).unwrap();
        assert_eq!(kept.len(), 1, "email links stay");
        assert_eq!(kept[0].1, "https://www.linkedin.com/in/alex?a=1&b=2");
        assert!(kept[0].0.starts_with("maple-bank-inc-"), "{}", kept[0].0);
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(out)).unwrap();
        let mut rels = String::new();
        z.by_name("word/_rels/document.xml.rels").unwrap().read_to_string(&mut rels).unwrap();
        assert!(rels.contains(&format!(r#"Target="https://jh.example.com/l/{}""#, kept[0].0)) && rels.contains("mailto:alex@example.com") && rels.contains(r#"Target="styles.xml""#), "{rels}");
        let mut doc = String::new();
        z.by_name("word/document.xml").unwrap().read_to_string(&mut doc).unwrap();
        assert!(doc.contains("linkedin.com/in/alex"), "the text the reader sees stays");
    }
}
