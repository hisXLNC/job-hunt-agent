//! Finding free interview slots in your working hours.

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Utc, Weekday};
use chrono_tz::Tz;

pub type Busy = Vec<(DateTime<Utc>, DateTime<Utc>)>;

pub fn is_free(busy: &Busy, start: DateTime<Utc>, end: DateTime<Utc>) -> bool {
    busy.iter().all(|(b0, b1)| end <= *b0 || start >= *b1)
}

fn local(tz: Tz, day: NaiveDate, hour: u32) -> DateTime<Utc> {
    tz.from_local_datetime(&day.and_hms_opt(hour, 0, 0).unwrap()).earliest().unwrap().with_timezone(&Utc)
}

/// First `count` weekday slots of `minutes` in working hours that avoid `busy`, at most one per day
/// so a recruiter gets a spread of days. Starts the day after `now`; slots start on the hour or half hour.
pub fn free_slots(busy: &Busy, now: DateTime<Utc>, tz: Tz, hours: (u32, u32), minutes: i64, count: usize) -> Vec<(DateTime<Utc>, DateTime<Utc>)> {
    let mut out = vec![];
    let mut day = now.with_timezone(&tz).date_naive() + Duration::days(1);
    for _ in 0..21 {
        if out.len() >= count {
            break;
        }
        if !matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
            let close = local(tz, day, hours.1);
            let mut cursor = local(tz, day, hours.0);
            while cursor + Duration::minutes(minutes) <= close {
                let end = cursor + Duration::minutes(minutes);
                if is_free(busy, cursor, end) {
                    out.push((cursor, end));
                    break;
                }
                cursor += Duration::minutes(30);
            }
        }
        day += Duration::days(1);
    }
    out
}

/// The next weekday at `hour` local time, `days` after `from` (moved past a weekend).
pub fn weekday_after(from: DateTime<Utc>, tz: Tz, days: i64, hour: u32) -> DateTime<Utc> {
    let mut day = from.with_timezone(&tz).date_naive() + Duration::days(days);
    while matches!(day.weekday(), Weekday::Sat | Weekday::Sun) {
        day += Duration::days(1);
    }
    local(tz, day, hour)
}

/// Parse a time from Claude or Google; one without an offset is taken to be in `tz`.
pub fn parse_time(s: &str, tz: Tz) -> Option<DateTime<Utc>> {
    if let Ok(d) = DateTime::parse_from_rfc3339(s.trim()) {
        return Some(d.with_timezone(&Utc));
    }
    for f in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = chrono::NaiveDateTime::parse_from_str(s.trim(), f) {
            return tz.from_local_datetime(&n).earliest().map(|d| d.with_timezone(&Utc));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::America::Toronto;

    fn t(day: u32, h: u32) -> DateTime<Utc> {
        local(Toronto, NaiveDate::from_ymd_opt(2026, 10, day).unwrap(), h)
    }

    #[test]
    fn slots_skip_busy_weekends_and_today() {
        let now = t(16, 11); // Friday
        let busy = vec![(t(19, 9), t(19, 12))];
        let s = free_slots(&busy, now, Toronto, (9, 17), 60, 3);
        assert_eq!(s.iter().map(|x| x.0).collect::<Vec<_>>(), vec![t(19, 12), t(20, 9), t(21, 9)]);
    }

    #[test]
    fn followups_and_parsing() {
        assert_eq!(weekday_after(t(16, 14), Toronto, 1, 9), t(19, 9)); // Friday + 1 day -> Monday
        assert_eq!(parse_time("2026-10-21T14:00:00-04:00", Toronto), Some(t(21, 14)));
        assert_eq!(parse_time("2026-10-21T14:00", Toronto), Some(t(21, 14)));
        assert_eq!(parse_time("next Tuesday", Toronto), None);
    }
}
