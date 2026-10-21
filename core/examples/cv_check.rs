//! Developer check: cargo run --example cv_check -- <cv.docx> <out.docx>
use jobhunt_core::cv;
use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let d = cv::open(std::path::Path::new(&args[1])).unwrap();
    println!("editable: {:?}", d.paras.iter().filter(|p| p.editable).map(|p| p.index).collect::<Vec<_>>());
    let mut edits = BTreeMap::new();
    edits.insert(7, "**Program & Delivery:** Technical Program Management, Program Governance, Requirements & Functional Design, Hybrid (Agile/Waterfall) Delivery, User Acceptance Testing (UAT), Defect Triage, Release Management, Product Roadmapping".to_string());
    edits.insert(16, "Led delivery of a new payments platform in **eight months**, live two months ahead of the first deadline; **300+ groups** have registered.".to_string());
    edits.insert(19, "Delivered 15 new integrations with partner agencies.".to_string());
    edits.insert(2, "hack the address".to_string());
    let out = cv::apply_edits(&d, &edits).unwrap();
    println!("rejected: {:?}", out.rejected);
    std::fs::write(&args[2], &out.bytes).unwrap();
    let back = cv::from_bytes(out.bytes).unwrap();
    for i in [2, 7, 16, 19] {
        println!("{i}: {:?}", back.paras[i].runs.iter().map(|r| (r.bold, r.text.chars().take(30).collect::<String>())).collect::<Vec<_>>());
    }
    std::fs::write(args[2].replace(".docx", "_letter.docx"), cv::cover_letter(&d, "Dear Hiring Manager,\n\nI am applying for the Technical Program Manager role.\n\nKind regards,\nSam Rivera", None).unwrap()).unwrap();
}
