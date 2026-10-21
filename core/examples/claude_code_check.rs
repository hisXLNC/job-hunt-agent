//! Developer check against the real Claude Code on this machine:
//!     cargo run --example claude_code_check -- <cv.docx> [cv.pdf] [out-folder]
use jobhunt_core::claude::{Claude, CvSource, Engine, Llm};
use jobhunt_core::{claude_code, cv, db::Job};
use std::collections::BTreeMap;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let st = claude_code::status("");
    println!("Claude Code: found={} version={} signed_in={} method={} {}", st.found, st.version, st.signed_in, st.method, st.problem);
    let claude = Claude::with(Engine::Code(claude_code::find("")), "");
    let doc = cv::open(std::path::Path::new(&args[1])).unwrap();
    let out = args.get(3).cloned().unwrap_or_else(|| ".".into());

    let t = Instant::now();
    let p = claude.cv_profile(&doc.plain_text()).unwrap();
    println!("\n[cv_profile {:?}] {p:?}", t.elapsed());

    let job = Job {
        title: "Senior Technical Program Manager, Payments Platform".into(),
        company: "Northbank".into(),
        location: "Toronto, ON (hybrid)".into(),
        description: "Lead delivery of our payments modernization program. You will own program governance, requirements, \
            UAT and release management across vendor and internal teams, manage system integrators, and report to the steering \
            committee. Requirements: PMP, 8+ years delivering large regulated financial platforms, stakeholder management, \
            Agile and waterfall delivery, vendor management, Jira, and experience with Kubernetes-based platforms.".into(),
        ..Job::default()
    };
    let t = Instant::now();
    let s = claude.score(&[("program".into(), doc.plain_text())], "Hybrid roles in Toronto preferred", &job).unwrap();
    println!("\n[score {:?}] {} on {} – {}\nflags: {:?}\nkeywords: {:?}", t.elapsed(), s.score, s.track, s.reasoning, s.red_flags, s.keywords);

    let t = Instant::now();
    let tl = claude.tailor("Sam Rivera", &doc.numbered(), &job, &s.keywords, "", "standard").unwrap();
    println!("\n[tailor {:?}] {} edits, gaps {:?}", t.elapsed(), tl.edits.len(), tl.keyword_gaps);
    let edits: BTreeMap<usize, String> = tl.edits.iter().map(|e| (e.index, e.text.clone())).collect();
    let applied = cv::apply_edits(&doc, &edits).unwrap();
    println!("accepted {} / refused {:?}", applied.changes.len(), applied.rejected);
    for c in applied.changes.iter().take(4) {
        println!("  - {}\n  + {}", c.before, c.after);
    }
    let (b, _) = cv::keyword_coverage(&doc.plain_text(), &s.keywords);
    let (a, _) = cv::keyword_coverage(&cv::from_bytes(applied.bytes.clone()).unwrap().plain_text(), &s.keywords);
    println!("keyword coverage {:.0}% -> {:.0}%", b * 100.0, a * 100.0);
    std::fs::write(format!("{out}/real_tailored.docx"), &applied.bytes).unwrap();
    std::fs::write(format!("{out}/real_letter.docx"), cv::cover_letter(&doc, &tl.cover_letter, None).unwrap()).unwrap();
    println!("\ncover letter:\n{}", tl.cover_letter);

    if let Some(pdf) = args.get(2) {
        let t = Instant::now();
        let structured = claude.convert_cv(&CvSource::Pdf(std::fs::read(pdf).unwrap())).unwrap();
        let built = cv::from_bytes(cv::build_docx(&structured).unwrap()).unwrap();
        println!("\n[convert pdf {:?}] {} sections, {} paragraphs, {} editable", t.elapsed(), structured.sections.len(), built.paras.len(), built.paras.iter().filter(|p| p.editable).count());
        std::fs::write(format!("{out}/real_converted.docx"), cv::build_docx(&structured).unwrap()).unwrap();
    }
}
