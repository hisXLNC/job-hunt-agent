//! What to search for and how: target roles per CV track, locations, filters, sources, calendar.
//! Stored as JSON in the database and edited on the Settings page.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Track {
    /// Short id, also the CV's file name: data/cv/<name>.docx
    pub name: String,
    pub label: String,
    pub titles: Vec<String>,
    pub keywords: Vec<String>,
    /// What was uploaded: "docx", "pdf" or "text". PDFs and text are converted to a Word copy.
    pub kind: String,
    /// The uploaded file's name, for display.
    pub original: String,
    /// How cover letters for this CV read: "standard", "formal", "short" or "warm".
    pub letter_style: String,
    /// The areas of experience Claude found in it, e.g. "Digital transformation: moved 30 services online".
    pub areas: Vec<String>,
}

impl Default for Track {
    fn default() -> Self {
        Track { name: "main".into(), label: "Main CV".into(), titles: vec![], keywords: vec![], kind: "docx".into(), original: String::new(), letter_style: "standard".into(), areas: vec![] }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Sources {
    pub adzuna_country: String,
    pub adzuna_where: Vec<String>,
    pub adzuna_days: u32,
    pub greenhouse: Vec<String>,
    pub lever: Vec<String>,
    pub ashby: Vec<String>,
    /// Workday careers sites, as their links (e.g. https://rbc.wd3.myworkdayjobs.com/RBCGLOBAL1).
    pub workday: Vec<String>,
    /// SmartRecruiters company names (jobs.smartrecruiters.com/<name>).
    pub smartrecruiters: Vec<String>,
    /// Workable account names (apply.workable.com/<name>).
    pub workable: Vec<String>,
    /// BambooHR company names (<name>.bamboohr.com/careers).
    pub bamboohr: Vec<String>,
    /// Search Indeed through the Indeed connector on your Claude account (needs Claude Code).
    pub indeed: bool,
    /// Search LinkedIn: its signed-out job search, or through Apify when there's a token.
    pub linkedin: bool,
    /// Search Canada's Job Bank (jobbank.gc.ca) for your titles and places.
    pub jobbank: bool,
    /// Recruiters' and job sites' own listings you turned on (see sites::SITES).
    pub sites: Vec<String>,
    /// Job sites you added by their search address.
    pub custom_sites: Vec<crate::sites::CustomSite>,
    /// Find employers near your locations by itself (weekly, and when searches find little that's
    /// new), add the ones with matching jobs, and drop boards that no longer exist.
    pub auto_boards: bool,
    /// Connections you turned off (their keys and boards stay saved): "jsearch", "jooble",
    /// "adzuna", "boards", "alerts" and the like. Indeed and LinkedIn have their own switches.
    pub off: Vec<String>,
}

impl Sources {
    /// Whether you turned this connection off, or it doesn't search in your country.
    pub fn is_off(&self, id: &str) -> bool {
        !self.available(id) || match id {
            "indeed" => !self.indeed,
            "linkedin" => !self.linkedin,
            "jobbank" => !self.jobbank,
            _ => self.off.iter().any(|x| x == id),
        }
    }

    /// Whether this source searches in your country: Job Bank is Canada's, Adzuna covers some.
    pub fn available(&self, id: &str) -> bool {
        match id {
            "jobbank" => self.adzuna_country == "ca",
            "adzuna" => crate::sources::adzuna_currency(&self.adzuna_country).is_some(),
            _ => true,
        }
    }

    /// Turn a connection on or off.
    pub fn set_on(&mut self, id: &str, on: bool) {
        match id {
            "indeed" => self.indeed = on,
            "linkedin" => self.linkedin = on,
            "jobbank" => self.jobbank = on,
            _ => {
                self.off.retain(|x| x != id);
                if !on {
                    self.off.push(id.to_string());
                }
            }
        }
    }
}

impl Default for Sources {
    fn default() -> Self {
        Sources {
            adzuna_country: "ca".into(),
            adzuna_where: vec![],
            adzuna_days: 7,
            greenhouse: vec![],
            lever: vec![],
            ashby: vec![],
            workday: vec![],
            bamboohr: vec![],
            smartrecruiters: vec![],
            workable: vec![],
            indeed: false,
            linkedin: false,
            jobbank: false,
            sites: vec![],
            custom_sites: vec![],
            auto_boards: true,
            off: vec![],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct CalendarPrefs {
    pub calendar_id: String,
    pub work_start: u32,
    pub work_end: u32,
    pub slot_minutes: i64,
    pub propose_slots: usize,
    pub prep_minutes: i64,
    pub followup_days: Vec<i64>,
}

impl Default for CalendarPrefs {
    fn default() -> Self {
        CalendarPrefs {
            calendar_id: "primary".into(),
            work_start: 9,
            work_end: 17,
            slot_minutes: 60,
            propose_slots: 3,
            prep_minutes: 60,
            followup_days: vec![1, 7],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Profile {
    pub name: String,
    pub email: String,
    pub timezone: String,
    pub locations: Vec<String>,
    pub remote_ok: bool,
    /// A big city brings in the area around it: Toronto the GTA, London Greater London.
    pub include_metro: bool,
    pub min_salary: Option<f64>,
    /// Postings scored at or above this get a tailored CV and cover letter.
    pub score_threshold: i64,
    /// At most this many applications are tailored per search (the rest wait for the next one).
    pub max_per_run: usize,
    /// Tailor every role at or above the threshold right after a search. Off: they wait for you
    /// to pick which ones to tailor.
    pub auto_tailor: bool,
    /// At most this many new postings are scored per search, to spare your Claude usage.
    pub max_scored_per_run: usize,
    pub exclude_companies: Vec<String>,
    pub exclude_title_keywords: Vec<String>,
    pub tracks: Vec<Track>,
    pub sources: Sources,
    pub calendar: CalendarPrefs,
    /// Local hour of the daily search.
    pub search_hour: u32,
    /// Minutes between inbox checks.
    pub inbox_minutes: u32,
    /// Anything the scorer should weigh, in your words (e.g. "I want hybrid roles in fintech").
    pub guidance: String,
    /// True achievements and stories cover letters may use, beyond what the CV says.
    pub stories: String,
    /// Days after applying with no reply before a follow-up email is drafted (0: never).
    pub follow_up_after: u32,
    /// Facts application forms ask for: work authorization, notice period, salary expectations…
    pub application_facts: String,
    /// Applications you aim to send each week (0: no target).
    pub weekly_goal: u32,
    /// Remove postings you never acted on after this many days (0: keep them).
    pub purge_after_days: u32,
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            name: String::new(),
            email: String::new(),
            timezone: "America/Toronto".into(),
            locations: vec![],
            remote_ok: true,
            include_metro: true,
            min_salary: None,
            score_threshold: 70,
            max_per_run: 10,
            purge_after_days: 0,
            auto_tailor: false,
            max_scored_per_run: 40,
            exclude_companies: vec![],
            exclude_title_keywords: vec!["intern".into(), "junior".into(), "entry level".into(), "co-op".into(), "student".into()],
            tracks: vec![],
            sources: Sources::default(),
            calendar: CalendarPrefs::default(),
            search_hour: 7,
            inbox_minutes: 30,
            guidance: String::new(),
            stories: String::new(),
            follow_up_after: 8,
            application_facts: String::new(),
            weekly_goal: 10,
        }
    }
}

impl Profile {
    /// Your country's name, like "Qatar": where searches look when no place is given.
    pub fn country(&self) -> String {
        let name = country_name(&self.sources.adzuna_country);
        if name.is_empty() { self.sources.adzuna_country.to_uppercase() } else { name.to_string() }
    }

    pub fn track(&self, name: Option<&str>) -> Option<&Track> {
        name.and_then(|n| self.tracks.iter().find(|t| t.name == n)).or(self.tracks.first())
    }

    /// A new track id from a label, unique among the existing ones.
    pub fn new_track_id(&self, label: &str) -> String {
        let base = crate::util::slug(label, 30);
        let base = if base.is_empty() { "cv".to_string() } else { base };
        let mut id = base.clone();
        let mut n = 2;
        while self.tracks.iter().any(|t| t.name == id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        id
    }

    /// Problems that would stop searching, as messages for the Settings page.
    pub fn problems(&self) -> Vec<String> {
        let mut out = vec![];
        let mut seen = std::collections::HashSet::new();
        for t in &self.tracks {
            if t.name.is_empty() || !t.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
                out.push(format!("Track id {:?} must be letters, digits, - or _ only.", t.name));
            }
            if !seen.insert(t.name.clone()) {
                out.push(format!("Two tracks are called {:?}.", t.name));
            }
        }
        if self.timezone.parse::<chrono_tz::Tz>().is_err() {
            out.push(format!("{:?} isn't a time zone name like America/Toronto.", self.timezone));
        }
        if self.calendar.work_start >= self.calendar.work_end || self.calendar.work_end > 24 {
            out.push("Working hours must start before they end.".into());
        }
        if !(0..=100).contains(&self.score_threshold) {
            out.push("The score threshold must be between 0 and 100.".into());
        }
        out
    }

    pub fn tz(&self) -> chrono_tz::Tz {
        self.timezone.parse().unwrap_or(chrono_tz::America::Toronto)
    }

    /// Every place name a job's location may contain to count as one of yours: each location you
    /// listed, with a region like "GTA" spread into its cities and districts.
    pub fn place_names(&self) -> Vec<String> {
        let mut out: Vec<String> = vec![];
        for l in self.locations.iter().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            let more = self.region(l).map(|r| r.members).unwrap_or(&[]);
            for n in std::iter::once(l).chain(more.iter().copied()) {
                if !out.iter().any(|x| x.eq_ignore_ascii_case(n)) {
                    out.push(n.to_lowercase());
                }
            }
        }
        out
    }

    /// The places to give job-search services: your locations, with a region searched once around
    /// its centre ("GTA", "Mississauga" and "Markham" are all one search around Toronto) since the
    /// services search a radius around the place. Empty when you search anywhere.
    pub fn search_places(&self) -> Vec<String> {
        // Older versions had a separate list for the search services; it's used only when there
        // are no locations.
        let listed = if self.locations.iter().any(|l| !l.trim().is_empty()) { &self.locations } else { &self.sources.adzuna_where };
        let mut out: Vec<String> = vec![];
        for l in listed.iter().map(|l| l.trim()).filter(|l| !l.is_empty()) {
            // A whole area is searched once around its centre; a city on its own, around itself.
            let centre = self.region(l).map(|r| r.centre).unwrap_or(l);
            if !out.iter().any(|x| x.eq_ignore_ascii_case(centre)) {
                out.push(centre.to_string());
            }
        }
        out
    }
}

/// Countries Job Hunt knows: (code, name, other names postings use, time zones). The code is the
/// ISO one Google for Jobs and LinkedIn understand.
pub const COUNTRIES: &[(&str, &str, &[&str], &[&str])] = &[
    ("ae", "United Arab Emirates", &["uae", "dubai", "abu dhabi", "sharjah"], &["Asia/Dubai"]),
    ("ar", "Argentina", &[], &["America/Argentina/Buenos_Aires"]),
    ("at", "Austria", &["österreich"], &["Europe/Vienna"]),
    ("au", "Australia", &[], &["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth", "Australia/Adelaide", "Australia/Hobart", "Australia/Darwin"]),
    ("bd", "Bangladesh", &[], &["Asia/Dhaka"]),
    ("be", "Belgium", &["belgique", "belgië"], &["Europe/Brussels"]),
    ("bh", "Bahrain", &["manama"], &["Asia/Bahrain"]),
    ("br", "Brazil", &["brasil"], &["America/Sao_Paulo"]),
    ("ca", "Canada", &[], &["America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/Regina", "America/Moncton"]),
    ("ch", "Switzerland", &["schweiz", "suisse"], &["Europe/Zurich"]),
    ("cl", "Chile", &[], &["America/Santiago"]),
    ("cn", "China", &[], &["Asia/Shanghai"]),
    ("co", "Colombia", &[], &["America/Bogota"]),
    ("cy", "Cyprus", &[], &["Asia/Nicosia"]),
    ("cz", "Czechia", &["czech republic"], &["Europe/Prague"]),
    ("de", "Germany", &["deutschland"], &["Europe/Berlin"]),
    ("dk", "Denmark", &["danmark"], &["Europe/Copenhagen"]),
    ("eg", "Egypt", &["cairo"], &["Africa/Cairo"]),
    ("es", "Spain", &["españa"], &["Europe/Madrid"]),
    ("fi", "Finland", &["suomi"], &["Europe/Helsinki"]),
    ("fr", "France", &[], &["Europe/Paris"]),
    ("gb", "United Kingdom", &["uk", "england", "scotland", "wales", "northern ireland"], &["Europe/London"]),
    ("gr", "Greece", &[], &["Europe/Athens"]),
    ("hk", "Hong Kong", &[], &["Asia/Hong_Kong"]),
    ("hu", "Hungary", &[], &["Europe/Budapest"]),
    ("id", "Indonesia", &[], &["Asia/Jakarta"]),
    ("ie", "Ireland", &[], &["Europe/Dublin"]),
    ("il", "Israel", &[], &["Asia/Jerusalem"]),
    ("in", "India", &[], &["Asia/Kolkata", "Asia/Calcutta"]),
    ("iq", "Iraq", &["baghdad", "erbil"], &["Asia/Baghdad"]),
    ("it", "Italy", &["italia"], &["Europe/Rome"]),
    ("jo", "Jordan", &["amman"], &["Asia/Amman"]),
    ("jp", "Japan", &[], &["Asia/Tokyo"]),
    ("ke", "Kenya", &["nairobi"], &["Africa/Nairobi"]),
    ("kr", "South Korea", &["korea"], &["Asia/Seoul"]),
    ("kw", "Kuwait", &[], &["Asia/Kuwait"]),
    ("lb", "Lebanon", &["beirut"], &["Asia/Beirut"]),
    ("lu", "Luxembourg", &[], &["Europe/Luxembourg"]),
    ("ma", "Morocco", &["maroc"], &["Africa/Casablanca"]),
    ("mx", "Mexico", &["méxico"], &["America/Mexico_City"]),
    ("my", "Malaysia", &["kuala lumpur"], &["Asia/Kuala_Lumpur"]),
    ("ng", "Nigeria", &["lagos"], &["Africa/Lagos"]),
    ("nl", "Netherlands", &["nederland", "the netherlands"], &["Europe/Amsterdam"]),
    ("no", "Norway", &["norge"], &["Europe/Oslo"]),
    ("nz", "New Zealand", &[], &["Pacific/Auckland"]),
    ("om", "Oman", &["muscat"], &["Asia/Muscat"]),
    ("pe", "Peru", &[], &["America/Lima"]),
    ("ph", "Philippines", &["manila"], &["Asia/Manila"]),
    ("pk", "Pakistan", &[], &["Asia/Karachi"]),
    ("pl", "Poland", &["polska"], &["Europe/Warsaw"]),
    ("pt", "Portugal", &[], &["Europe/Lisbon"]),
    ("qa", "Qatar", &["doha"], &["Asia/Qatar"]),
    ("ro", "Romania", &[], &["Europe/Bucharest"]),
    ("sa", "Saudi Arabia", &["ksa", "riyadh", "jeddah", "dammam", "khobar"], &["Asia/Riyadh"]),
    ("se", "Sweden", &["sverige"], &["Europe/Stockholm"]),
    ("sg", "Singapore", &[], &["Asia/Singapore"]),
    ("th", "Thailand", &["bangkok"], &["Asia/Bangkok"]),
    ("tr", "Türkiye", &["turkey", "turkiye", "istanbul"], &["Europe/Istanbul"]),
    ("tw", "Taiwan", &["taipei"], &["Asia/Taipei"]),
    ("ua", "Ukraine", &[], &["Europe/Kyiv", "Europe/Kiev"]),
    ("us", "United States", &["usa", "u.s.", "united states of america"], &["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "America/Anchorage", "America/Detroit", "Pacific/Honolulu"]),
    ("vn", "Vietnam", &["viet nam"], &["Asia/Ho_Chi_Minh"]),
    ("za", "South Africa", &[], &["Africa/Johannesburg"]),
];

/// Cities (and areas) to pick from, by country: the ones job postings usually name.
pub const CITIES: &[(&str, &[&str])] = &[
    ("ae", &["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Al Ain"]),
    ("ar", &["Buenos Aires", "Córdoba", "Rosario", "Mendoza"]),
    ("at", &["Vienna", "Graz", "Linz", "Salzburg", "Innsbruck"]),
    ("au", &["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Canberra", "Gold Coast", "Hobart"]),
    ("bd", &["Dhaka", "Chittagong"]),
    ("be", &["Brussels", "Antwerp", "Ghent", "Liège", "Leuven"]),
    ("bh", &["Manama", "Muharraq", "Riffa", "Isa Town"]),
    ("br", &["São Paulo", "Rio de Janeiro", "Brasília", "Belo Horizonte", "Curitiba", "Porto Alegre"]),
    ("ca", &["Toronto", "GTA", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton", "Winnipeg", "Quebec City", "Hamilton", "Kitchener", "Waterloo", "London, ON", "Halifax", "Victoria", "Saskatoon", "Regina", "Mississauga", "Markham", "Oakville"]),
    ("ch", &["Zurich", "Geneva", "Basel", "Bern", "Lausanne", "Zug"]),
    ("cl", &["Santiago", "Valparaíso", "Concepción"]),
    ("cn", &["Shanghai", "Beijing", "Shenzhen", "Guangzhou", "Hangzhou", "Chengdu"]),
    ("co", &["Bogotá", "Medellín", "Cali", "Barranquilla"]),
    ("cy", &["Nicosia", "Limassol", "Larnaca", "Paphos"]),
    ("cz", &["Prague", "Brno", "Ostrava"]),
    ("de", &["Berlin", "Munich", "Frankfurt", "Hamburg", "Cologne", "Düsseldorf", "Stuttgart", "Leipzig"]),
    ("dk", &["Copenhagen", "Aarhus", "Odense"]),
    ("eg", &["Cairo", "Giza", "Alexandria", "New Cairo"]),
    ("es", &["Madrid", "Barcelona", "Valencia", "Seville", "Málaga", "Bilbao"]),
    ("fi", &["Helsinki", "Espoo", "Tampere", "Oulu"]),
    ("fr", &["Paris", "Lyon", "Marseille", "Toulouse", "Lille", "Nantes", "Bordeaux", "Nice"]),
    ("gb", &["London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Leeds", "Bristol", "Cambridge", "Oxford", "Belfast", "Cardiff", "Reading"]),
    ("gr", &["Athens", "Thessaloniki"]),
    ("hk", &["Hong Kong", "Kowloon", "Central"]),
    ("hu", &["Budapest", "Debrecen"]),
    ("id", &["Jakarta", "Surabaya", "Bandung", "Bali"]),
    ("ie", &["Dublin", "Cork", "Galway", "Limerick"]),
    ("il", &["Tel Aviv", "Jerusalem", "Haifa", "Herzliya"]),
    ("in", &["Bengaluru", "Mumbai", "Delhi", "Gurugram", "Noida", "Hyderabad", "Pune", "Chennai", "Kolkata", "Ahmedabad"]),
    ("iq", &["Baghdad", "Erbil", "Basra", "Sulaymaniyah"]),
    ("it", &["Milan", "Rome", "Turin", "Bologna", "Florence", "Naples"]),
    ("jo", &["Amman", "Irbid", "Aqaba"]),
    ("jp", &["Tokyo", "Osaka", "Yokohama", "Nagoya", "Fukuoka", "Kyoto"]),
    ("ke", &["Nairobi", "Mombasa", "Kisumu"]),
    ("kr", &["Seoul", "Busan", "Incheon", "Seongnam"]),
    ("kw", &["Kuwait City", "Hawalli", "Salmiya", "Farwaniya", "Jahra", "Ahmadi", "Fahaheel", "Mangaf", "Shuwaikh", "Sharq"]),
    ("lb", &["Beirut", "Jounieh", "Tripoli"]),
    ("lu", &["Luxembourg", "Esch-sur-Alzette"]),
    ("ma", &["Casablanca", "Rabat", "Marrakesh", "Tangier"]),
    ("mx", &["Mexico City", "Guadalajara", "Monterrey", "Querétaro"]),
    ("my", &["Kuala Lumpur", "Petaling Jaya", "Penang", "Johor Bahru", "Cyberjaya"]),
    ("ng", &["Lagos", "Abuja", "Port Harcourt"]),
    ("nl", &["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"]),
    ("no", &["Oslo", "Bergen", "Stavanger", "Trondheim"]),
    ("nz", &["Auckland", "Wellington", "Christchurch", "Hamilton"]),
    ("om", &["Muscat", "Sohar", "Salalah", "Nizwa"]),
    ("pe", &["Lima", "Arequipa"]),
    ("ph", &["Manila", "Makati", "Taguig", "Quezon City", "Cebu"]),
    ("pk", &["Karachi", "Lahore", "Islamabad", "Rawalpindi"]),
    ("pl", &["Warsaw", "Kraków", "Wrocław", "Gdańsk", "Poznań"]),
    ("pt", &["Lisbon", "Porto", "Braga"]),
    ("qa", &["Doha", "Al Rayyan", "Lusail", "Al Wakrah"]),
    ("ro", &["Bucharest", "Cluj-Napoca", "Iași", "Timișoara"]),
    ("sa", &["Riyadh", "Jeddah", "Dammam", "Al Khobar", "Dhahran", "Mecca", "Medina", "NEOM"]),
    ("se", &["Stockholm", "Gothenburg", "Malmö", "Uppsala"]),
    ("sg", &["Singapore"]),
    ("th", &["Bangkok", "Chiang Mai", "Phuket"]),
    ("tr", &["Istanbul", "Ankara", "Izmir"]),
    ("tw", &["Taipei", "Hsinchu", "Taichung", "Kaohsiung"]),
    ("ua", &["Kyiv", "Lviv", "Kharkiv", "Odesa"]),
    ("us", &["New York", "San Francisco", "Bay Area", "Los Angeles", "Chicago", "Seattle", "Boston", "Austin", "Washington, DC", "Dallas", "Houston", "Atlanta", "Denver", "Miami", "Philadelphia", "San Diego", "Phoenix", "Minneapolis"]),
    ("vn", &["Ho Chi Minh City", "Hanoi", "Da Nang"]),
    ("za", &["Johannesburg", "Cape Town", "Durban", "Pretoria"]),
];

/// The country's name, like "Qatar" ("" for a code Job Hunt doesn't know).
pub fn country_name(code: &str) -> &'static str {
    COUNTRIES.iter().find(|c| c.0.eq_ignore_ascii_case(code)).map(|c| c.1).unwrap_or("")
}

/// The names a posting may give the country in, lowercase: "kuwait"; "united kingdom", "uk", ...
pub fn country_names(code: &str) -> Vec<String> {
    COUNTRIES.iter().find(|c| c.0.eq_ignore_ascii_case(code))
        .map(|c| std::iter::once(c.1).chain(c.2.iter().copied()).map(|n| n.to_lowercase()).collect())
        .unwrap_or_default()
}

/// Countries small enough that "anywhere in it" is a sensible commute: a posting there counts as in
/// your place even when it names another town (Al Rayyan for Doha, say).
pub fn small_country(code: &str) -> bool {
    ["kw", "bh", "qa", "sg", "hk", "lu", "cy", "lb"].contains(&code.to_lowercase().as_str())
}

/// Regions people name instead of a city: (names, the places in them, where to search from).
/// A metropolitan area: what people call it, its main city, its country, the places in it (the
/// first ones are its own longer names), and where to centre a search of it.
pub struct Region {
    pub name: &'static str,
    pub city: &'static str,
    pub country: &'static str,
    pub members: &'static [&'static str],
    pub centre: &'static str,
}

/// Metro areas. Places are matched as part of a posting's location, so each name is one that
/// doesn't turn up inside other places' names.
pub const REGIONS: &[Region] = &[
    Region { name: "GTA", city: "Toronto", country: "ca", centre: "Toronto, ON", members: &[
        "Greater Toronto Area", "Greater Toronto", "Toronto", "North York", "Scarborough", "Etobicoke", "East York", "York, ON",
        "Mississauga", "Brampton", "Caledon", "Markham", "Vaughan", "Richmond Hill", "Concord, ON", "Maple, ON", "Woodbridge",
        "Thornhill", "Unionville", "Stouffville", "Aurora", "Newmarket", "King City", "Oakville", "Burlington", "Milton",
        "Halton Hills", "Georgetown, ON", "Pickering", "Ajax", "Whitby", "Oshawa", "Uxbridge", "Bolton, ON",
    ] },
    Region { name: "Metro Vancouver", city: "Vancouver", country: "ca", centre: "Vancouver, BC", members: &[
        "Greater Vancouver", "Lower Mainland", "Vancouver", "Burnaby", "Richmond, BC", "Richmond, British Columbia", "Surrey, BC",
        "Surrey, British Columbia", "Coquitlam", "New Westminster", "Port Moody", "Langley", "Delta, BC", "Maple Ridge",
    ] },
    Region { name: "Greater Montreal", city: "Montreal", country: "ca", centre: "Montreal, QC", members: &[
        "Grand Montréal", "Montréal", "Montreal", "Laval", "Longueuil", "Brossard", "Pointe-Claire", "Dorval", "Saint-Laurent",
        "Boucherville", "Terrebonne", "Kirkland, QC",
    ] },
    Region { name: "Ottawa–Gatineau", city: "Ottawa", country: "ca", centre: "Ottawa, ON", members: &[
        "National Capital Region", "Ottawa-Gatineau", "Ottawa", "Gatineau", "Kanata", "Nepean", "Orléans", "Orleans, ON",
    ] },
    Region { name: "Halifax area", city: "Halifax", country: "ca", centre: "Halifax, NS", members: &[
        "Halifax Regional Municipality", "Halifax, NS", "Halifax", "Dartmouth", "Bedford, NS", "Lower Sackville", "Cole Harbour", "Burnside, NS",
    ] },
    Region { name: "Calgary area", city: "Calgary", country: "ca", centre: "Calgary, AB", members: &["Calgary Region", "Calgary Metropolitan", "Calgary", "Airdrie", "Cochrane, AB", "Chestermere", "Okotoks"] },
    Region { name: "New York City area", city: "New York", country: "us", centre: "New York, NY", members: &[
        "New York City Metropolitan Area", "NYC", "New York", "Manhattan", "Brooklyn", "Bronx", "Staten Island", "Jersey City",
        "Hoboken", "Newark, NJ", "Newark, New Jersey", "Stamford", "White Plains", "Long Island",
    ] },
    Region { name: "San Francisco Bay Area", city: "San Francisco", country: "us", centre: "San Francisco, CA", members: &[
        "Bay Area", "SF Bay Area", "San Francisco", "Oakland", "San Jose", "Palo Alto", "Mountain View", "Sunnyvale", "Menlo Park",
        "Redwood City", "Santa Clara", "Berkeley", "Fremont", "San Mateo", "Cupertino",
    ] },
    Region { name: "Greater London", city: "London", country: "gb", centre: "London", members: &[
        "London Area", "Greater London", "London", "Croydon", "Canary Wharf", "Westminster", "Stratford", "Hammersmith", "Wimbledon",
        "Uxbridge", "Watford", "Slough",
    ] },
    Region { name: "Dubai area", city: "Dubai", country: "ae", centre: "Dubai", members: &["Dubai Emirate", "Dubai", "Sharjah", "Ajman", "Jebel Ali"] },
    Region { name: "Greater Sydney", city: "Sydney", country: "au", centre: "Sydney NSW", members: &["Sydney Area", "Sydney", "Parramatta", "North Sydney", "Chatswood", "Macquarie Park"] },
    Region { name: "Greater Melbourne", city: "Melbourne", country: "au", centre: "Melbourne VIC", members: &["Melbourne Area", "Melbourne", "Docklands", "Richmond, VIC", "Box Hill", "Dandenong"] },
];

impl Profile {
    /// The area a location names, in your country: "GTA" or "Greater Toronto Area", "Toronto area",
    /// or, with `include_metro`, any city in it ("Toronto", "Oakville").
    pub fn region(&self, l: &str) -> Option<&'static Region> {
        let l = l.trim();
        let l = l.strip_suffix(" area").or_else(|| l.strip_suffix(" Area")).filter(|_| l.len() > 5).map(|c| (c, true)).unwrap_or((l, false));
        REGIONS.iter().filter(|r| r.country == self.sources.adzuna_country).find(|r| {
            let in_it = r.city.eq_ignore_ascii_case(l.0) || r.members.iter().any(|n| n.eq_ignore_ascii_case(l.0));
            r.name.eq_ignore_ascii_case(l.0) || r.members.iter().take(2).any(|n| n.eq_ignore_ascii_case(l.0)) || (in_it && (l.1 || self.include_metro))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starter_is_valid_and_partial_json_fills_defaults() {
        assert!(crate::testkit::sample_profile().problems().is_empty());
        let p: Profile = serde_json::from_str(r#"{"name":"J","tracks":[{"name":"a"}]}"#).unwrap();
        assert_eq!(p.score_threshold, 70);
        assert_eq!(p.tracks[0].label, "Main CV");
        assert_eq!(p.tracks[0].kind, "docx");
        assert!(Profile::default().tracks.is_empty() && Profile::default().locations.is_empty());
        assert_eq!(p.new_track_id("A"), "a-2");
        assert_eq!(p.new_track_id("Product Management!"), "product-management");
        let mut bad = p.clone();
        bad.timezone = "Mars/Base".into();
        bad.tracks.push(Track { name: "a".into(), ..Track::default() });
        assert_eq!(bad.problems().len(), 2);
    }

    #[test]
    fn regions_and_search_places() {
        let p = Profile { locations: vec!["Toronto".into(), "GTA".into(), "Mississauga".into(), "Ottawa".into()], ..Profile::default() };
        let names = p.place_names();
        assert!(names.contains(&"markham".to_string()) && names.contains(&"ottawa".to_string()) && names.contains(&"etobicoke".to_string()));
        assert_eq!(p.search_places(), vec!["Toronto, ON", "Ottawa, ON"]);
        let only_city = Profile { locations: vec!["Toronto".into()], include_metro: false, ..Profile::default() };
        assert_eq!(only_city.place_names(), vec!["toronto"], "a city alone isn't widened when you say so");
        let metro = Profile { include_metro: true, ..only_city.clone() };
        assert!(metro.place_names().contains(&"mississauga".to_string()), "Toronto brings in the GTA");
        assert!(Profile { locations: vec!["Toronto area".into()], ..only_city.clone() }.place_names().contains(&"vaughan".to_string()));
        // London, Ontario isn't Greater London.
        let mut london = Profile { locations: vec!["London".into()], ..Profile::default() };
        assert_eq!(london.place_names(), vec!["london"]);
        london.sources.adzuna_country = "gb".into();
        assert!(london.place_names().contains(&"croydon".to_string()));
        assert_eq!(london.search_places(), vec!["London"]);
        let old = Profile { sources: Sources { adzuna_where: vec!["Calgary".into()], ..Sources::default() }, ..Profile::default() };
        assert_eq!(old.search_places(), vec!["Calgary, AB"]);
        assert!(Profile::default().search_places().is_empty());
    }
}
