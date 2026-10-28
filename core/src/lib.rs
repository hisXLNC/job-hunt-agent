//! Job Hunt's logic, kept apart from the window so it builds and tests on any machine.
//!
//! Search job boards, score postings against your CVs with Claude, tailor a copy of the matching
//! CV and a cover letter, track every application, triage job email and book interviews.

pub mod api;
pub mod backup;
pub mod claude;
pub mod claude_code;
pub mod cv;
pub mod db;
pub mod filters;
pub mod fill;
pub mod google;
pub mod mcp;
pub mod network;
pub mod pipeline;
pub mod profile;
pub mod recruiters;
pub mod slots;
pub mod sites;
pub mod sources;
pub mod sync;
pub mod usage;
pub mod util;
pub mod web;
#[cfg(test)]
mod testkit;

use std::fmt;

/// An error with a message meant for the person using the app.
#[derive(Debug, Clone, PartialEq)]
pub struct Error(pub String);

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

pub type R<T> = Result<T, Error>;

pub fn err<T>(msg: impl Into<String>) -> R<T> {
    Err(Error(msg.into()))
}

macro_rules! from_err {
    ($($t:ty),*) => {$(
        impl From<$t> for Error {
            fn from(e: $t) -> Self { Error(e.to_string()) }
        }
    )*};
}
from_err!(std::io::Error, rusqlite::Error, serde_json::Error, reqwest::Error, zip::result::ZipError);
